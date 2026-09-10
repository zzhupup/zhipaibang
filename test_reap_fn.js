/* 回归：云函数 handops 的 reap 动作（房间自动释放的权威判定）
   用桩替换 wx-server-sdk，验证：
   1) 房内还有"心跳在窗口内"的玩家 → 拒绝释放（避免误删活房间）
   2) 全员心跳静默超过 90 秒 → 彻底释放 rooms/players/actions/hands
   3) 房间文档不存在 → 幂等返回，不报错 */
'use strict';

const Module = require('module');
const ONLINE_MS = 45000;
const RELEASE_MS = 90000;
const now = Date.now();

/* ---- 假数据库 ---- */
let store = {};
function reset() {
  store = {
    rooms: [
      { _id: '100001', status: 'lobby', createdAt: now - 5000 },                     // 有活人
      { _id: '100002', status: 'lobby', createdAt: now - 600000 },                   // 死房间
      { _id: '100003', status: 'playing', createdAt: now - 600000 },                 // 对局中掉线
    ],
    players: [
      { _id: 'p1', roomId: '100001', lastSeen: new Date(now - 3000) },
      { _id: 'p2', roomId: '100002', lastSeen: new Date(now - 600000) },
      { _id: 'p3', roomId: '100003', lastSeen: new Date(now - RELEASE_MS - 5000) },
    ],
    actions: [
      { _id: 'ac1', roomId: '100002' },
      { _id: 'ac2', roomId: '100002' },
      { _id: 'ac3', roomId: '100001' },
    ],
    hands: [
      { _id: '100002_0', roomId: '100002' },
      { _id: '100003_0' },                                   // 老文档没写 roomId，走 docId 兜底
      { _id: '100003_1' },
      { _id: '100001_0', roomId: '100001' },
    ],
  };
}
const matchQ = (d, q) => Object.keys(q || {}).every(k => d[k] === q[k]);
const fakeDb = {
  collection(name) {
    const a = () => (store[name] = store[name] || []);
    return {
      where(q) {
        return {
          limit() { return this; },
          async get() { return { data: a().filter(d => matchQ(d, q)).map(d => Object.assign({}, d)) }; },
          async remove() {
            const list = a();
            for (let i = list.length - 1; i >= 0; i--) if (matchQ(list[i], q)) list.splice(i, 1);
            return { stats: { removed: 1 } };
          },
        };
      },
      doc(id) {
        return {
          async get() {
            const d = a().find(x => x._id === id);
            if (!d) throw new Error('document does not exist');
            return { data: Object.assign({}, d) };
          },
          async update({ data }) {
            const d = a().find(x => x._id === id);
            if (d) Object.assign(d, data);
            return { stats: { updated: d ? 1 : 0 } };   // 与真机一致：不存在返回 updated=0
          },
          async set({ data }) {
            const list = a(); const d = list.find(x => x._id === id);
            if (d) Object.assign(d, data); else list.push(Object.assign({ _id: id }, data));
            return {};
          },
          async remove() {
            const list = a(); const i = list.findIndex(x => x._id === id);
            if (i < 0) throw new Error('document does not exist');
            list.splice(i, 1);
            return { stats: { removed: 1 } };
          },
        };
      },
    };
  },
};
const fakeCloud = {
  DYNAMIC_CURRENT_ENV: 'fake-env',
  init() {},
  database: () => fakeDb,
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return fakeCloud;
  return origLoad.apply(this, arguments);
};

const handops = require('./github-repo/cloudfunctions/handops/index.js');
Module._load = origLoad;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };

(async () => {
  console.log('reap：仍有人活跃 → 拒绝释放');
  reset();
  const r1 = await handops.main({ action: 'reap', roomId: '100001' });
  ok(r1.ok && r1.reaped === false && r1.reason === 'active', '返回 reaped=false/active，实际：' + JSON.stringify(r1));
  ok(store.rooms.some(r => r._id === '100001'), '房间文档保留');
  ok(store.players.some(p => p.roomId === '100001'), '玩家文档保留');

  console.log('reap：全员静默超时 → 彻底释放');
  reset();
  const r2 = await handops.main({ action: 'reap', roomId: '100002' });
  ok(r2.ok && r2.reaped === true, '返回 reaped=true，实际：' + JSON.stringify(r2));
  ok(!store.rooms.some(r => r._id === '100002'), '房间文档已删除');
  ok(!store.players.some(p => p.roomId === '100002'), '玩家文档已清理');
  ok(!store.actions.some(a => a.roomId === '100002'), '操作馈送已清理');
  ok(!store.hands.some(h => h._id === '100002_0'), '私密底牌已清理');

  console.log('reap：对局中掉线的房间同样释放（含无 roomId 字段的老底牌文档）');
  reset();
  const r3 = await handops.main({ action: 'reap', roomId: '100003' });
  ok(r3.ok && r3.reaped === true, 'playing 状态死房间被释放');
  ok(!store.rooms.some(r => r._id === '100003'), '房间文档已删除');
  ok(!store.hands.some(h => h._id === '100003_0' || h._id === '100003_1'), '按 docId 兜底删除的底牌也已清理');

  console.log('reap：房间不存在 → 幂等');
  reset();
  const r4 = await handops.main({ action: 'reap', roomId: '999999' });
  ok(r4.ok && r4.reaped === false && r4.reason === 'not-found', '返回 not-found，实际：' + JSON.stringify(r4));

  console.log('reap：缺 roomId → 参数校验');
  const r5 = await handops.main({ action: 'reap' });
  ok(r5.ok === false, '缺少 roomId 被拒绝');

  console.log('原有动作未被破坏：');
  reset();
  const d1 = await handops.main({ action: 'deal', roomId: '100001', players: [{ hole: [1, 2] }], owners: ['x'] });
  ok(d1.ok === true, 'deal 仍正常');
  const p1 = await handops.main({ action: 'prompt', roomId: '100001', seat: 0, prompt: { pid: 1 } });
  ok(p1.ok === true, 'prompt 仍正常');

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
