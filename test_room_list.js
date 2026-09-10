/* 回归：可加入房间列表 + 死房间自动释放 + joinRoom 满员保护
   用内存假数据库注入 wx.cloud（云函数 reap 也做了行为模拟），验证：
   1) 只列 status='lobby' 且"有人在线"的房间（僵尸房间/对局中房间不出现）
   2) 无人活跃的房间 → 自动释放（调用云函数 reap，且房号可复用）
   3) 有活跃玩家的房间绝不释放
   4) leaveRoom：只剩"僵尸文档"（心跳早已停）时也要释放房间
   5) joinRoom 在第 6 人时拒绝（满员） */
'use strict';

const ONLINE_MS = 45000;
const now = Date.now();

const rooms = [
  { _id: '111111', status: 'lobby', hostName: '房主甲', createdAt: now - 30000 },
  { _id: '222222', status: 'playing', hostName: '房主乙', createdAt: now - 60000 },
  { _id: '333333', status: 'lobby', hostName: '僵尸房', createdAt: now - 900000 },
  { _id: '444444', status: 'lobby', hostName: '满员房', createdAt: now - 20000 },
  { _id: '555555', status: 'lobby', hostName: '待释放房', hostPid: 'e1', createdAt: now - 100000 },
  { _id: '666666', status: 'lobby', hostName: '换房主房', hostPid: 'f1', createdAt: now - 5000 },
  { _id: '777777', status: 'lobby', hostName: '七人房', hostPid: 'g1', createdAt: now - 15000 },
];
const players = [
  { _id: 'a1', roomId: '111111', name: '甲', created: 1, lastSeen: now - 5000 },
  { _id: 'a2', roomId: '111111', name: '乙', created: 2, lastSeen: now - 12000 },
  { _id: 'a3', roomId: '111111', name: '丙(掉线)', created: 3, lastSeen: now - 120000 },
  { _id: 'b1', roomId: '333333', name: '僵尸', created: 4, lastSeen: now - 600000 },
  { _id: 'c1', roomId: '444444', name: '1', created: 5, lastSeen: now - 1000 },
  { _id: 'c2', roomId: '444444', name: '2', created: 6, lastSeen: now - 2000 },
  { _id: 'c3', roomId: '444444', name: '3', created: 7, lastSeen: now - 3000 },
  { _id: 'c4', roomId: '444444', name: '4', created: 8, lastSeen: now - 4000 },
  { _id: 'c5', roomId: '444444', name: '5', created: 9, lastSeen: now - 5000 },
  { _id: 'c6', roomId: '444444', name: '6', created: 10, lastSeen: now - 6000 },
  { _id: 'c7', roomId: '444444', name: '7', created: 11, lastSeen: now - 7000 },
  { _id: 'c8', roomId: '444444', name: '8', created: 12, lastSeen: now - 8000 },
  // 777777：7 人在场（旧上限 6 时进不去，新上限 8 应当可加入）
  { _id: 'g1', roomId: '777777', name: '甲', created: 21, lastSeen: now - 1000 },
  { _id: 'g2', roomId: '777777', name: '乙', created: 22, lastSeen: now - 1000 },
  { _id: 'g3', roomId: '777777', name: '丙', created: 23, lastSeen: now - 1000 },
  { _id: 'g4', roomId: '777777', name: '丁', created: 24, lastSeen: now - 1000 },
  { _id: 'g5', roomId: '777777', name: '戊', created: 25, lastSeen: now - 1000 },
  { _id: 'g6', roomId: '777777', name: '己', created: 26, lastSeen: now - 1000 },
  { _id: 'g7', roomId: '777777', name: '庚', created: 27, lastSeen: now - 1000 },
  // 555555：房主早已失联（僵尸文档），另一人正常心跳
  { _id: 'e1', roomId: '555555', name: '失联房主', created: 11, lastSeen: now - 300000 },
  { _id: 'e2', roomId: '555555', name: '在场者', created: 12, lastSeen: now - 2000 },
  // 666666：两人都活跃，用于验证房主转移后房间不释放
  { _id: 'f1', roomId: '666666', name: '房主F', created: 13, lastSeen: now - 1000 },
  { _id: 'f2', roomId: '666666', name: '帮众F', created: 14, lastSeen: now - 1000 },
];
const actions = [];

const arr = name => (name === 'rooms' ? rooms : name === 'players' ? players : actions);

function match(doc, q) {
  return Object.keys(q || {}).every(k => {
    const cond = q[k];
    if (cond && cond.__in) return cond.__in.indexOf(doc[k]) >= 0;
    return doc[k] === cond;
  });
}
function makeQuery(name, q) {
  const state = { q: q || {}, order: null, dir: 'asc', lim: 20 };
  const api = {
    where(nq) { state.q = nq; return api; },
    orderBy(f, d) { state.order = f; state.dir = d || 'asc'; return api; },
    limit(n) { state.lim = n; return api; },
    async get() {
      let list = arr(name).filter(d => match(d, state.q));
      if (state.order) list = list.slice().sort((a, b) => (state.dir === 'desc' ? b[state.order] - a[state.order] : a[state.order] - b[state.order]));
      return { data: list.slice(0, state.lim).map(d => Object.assign({}, d)) };
    },
    async remove() {
      const list = arr(name);
      for (let i = list.length - 1; i >= 0; i--) if (match(list[i], state.q)) list.splice(i, 1);
      return { stats: { removed: 1 } };
    },
  };
  return api;
}
function makeDoc(name, id) {
  return {
    async get() { const d = arr(name).find(x => x._id === id); return { data: d ? Object.assign({}, d) : null }; },
    async update({ data }) {
      const d = arr(name).find(x => x._id === id);
      if (d) Object.assign(d, data);
      return { stats: { updated: d ? 1 : 0 } };
    },
    async remove() {
      const list = arr(name); const i = list.findIndex(x => x._id === id);
      if (i >= 0) list.splice(i, 1);
      return { stats: { removed: i >= 0 ? 1 : 0 } };
    },
    async set({ data }) {
      const d = arr(name).find(x => x._id === id);
      if (d) Object.assign(d, data); else arr(name).push(Object.assign({ _id: id }, data));
      return {};
    },
  };
}
function makeCollection(name) {
  return {
    where(q) { return makeQuery(name, q); },
    orderBy(f, d) { return makeQuery(name, {}).orderBy(f, d); },
    limit(n) { return makeQuery(name, {}).limit(n); },
    doc(id) { return makeDoc(name, id); },
    async add({ data }) { const id = 'new_' + Math.random().toString(36).slice(2, 8); arr(name).push(Object.assign({ _id: id }, data)); return { _id: id }; },
  };
}

/* 云函数 reap 的行为模拟（服务端时间判定 + 全量清理） */
const reapCalls = [];
function fakeCallFunction({ data }) {
  if (data && data.action === 'reap') {
    const roomId = data.roomId;
    reapCalls.push(roomId);
    const active = players.some(p => p.roomId === roomId && (now - p.lastSeen) <= ONLINE_MS);
    if (active) return Promise.resolve({ result: { ok: true, reaped: false, reason: 'active' } });
    for (const a of [players, actions]) {
      for (let i = a.length - 1; i >= 0; i--) if (a[i].roomId === roomId) a.splice(i, 1);
    }
    const i = rooms.findIndex(r => r._id === roomId);
    if (i >= 0) rooms.splice(i, 1);
    return Promise.resolve({ result: { ok: true, reaped: true, players: 0 } });
  }
  return Promise.resolve({ result: { ok: true } });
}

global.wx = {
  cloud: {
    init() {},
    database() {
      return {
        collection: makeCollection,
        serverDate: () => new Date(),
        command: { in: a => ({ __in: a }) },
      };
    },
    callFunction: fakeCallFunction,
  },
};

const cloudRoom = require('./zhipaibang-miniprogram/utils/cloudRoom.js');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('listRooms 过滤：');
  const list = await cloudRoom.listRooms();
  await sleep(80);   // 释放是后台 fire-and-forget，等一轮微任务/事件循环
  const codes = list.map(r => r.code);
  ok(!codes.includes('222222'), '对局中(playing)房间不出现');
  ok(!codes.includes('333333'), '全员掉线的僵尸房间不出现');
  ok(codes.includes('111111'), '大厅房间出现');
  const r1 = list.find(r => r.code === '111111');
  ok(r1 && r1.count === 2, '在线人数=2（超时玩家不计入），实际 ' + (r1 && r1.count));
  ok(r1 && r1.hostName === '房主甲', '房主昵称正确');
  ok(r1 && r1.max === 8, '上限 8 人，实际 ' + (r1 && r1.max));
  const r44 = list.find(r => r.code === '444444');
  ok(r44 && r44.count === 8, '八人在线全部计入（房间数增至 8），实际 ' + (r44 && r44.count));
  const order = list.map(r => r.createdAt);
  ok(JSON.stringify(order) === JSON.stringify(order.slice().sort((a, b) => b - a)), '按创建时间倒序');

  console.log('死房间自动释放：');
  ok(reapCalls.includes('333333'), '无人活跃的大厅房间被释放');
  ok(reapCalls.includes('222222'), '全员掉线的对局中房间也被释放');
  ok(!reapCalls.includes('111111'), '有活跃玩家的房间不释放');
  ok(!reapCalls.includes('444444'), '满员活跃房间不释放');
  ok(!rooms.some(r => r._id === '333333'), '释放后房间文档已从库中删除（房号可复用）');
  ok(!players.some(p => p.roomId === '333333'), '释放后残留玩家文档一并清理');

  console.log('leaveRoom 只认活跃玩家：');
  // 555555：在场者正常退出后，只剩"失联房主"的僵尸文档 → 房间必须释放
  const lv = await cloudRoom.leaveRoom('555555', 'e2');
  await sleep(30);
  ok(lv && lv.dissolved === true, '只剩僵尸文档 → 判定为该释放（dissolved）');
  ok(!rooms.some(r => r._id === '555555'), '释放后房间文档消失');
  // 666666：两人都活跃，房主退出 → 房间保留 + 房主转移
  const lv2 = await cloudRoom.leaveRoom('666666', 'f1');
  await sleep(30);
  ok(lv2 && lv2.newHostPid === 'f2', '两活跃玩家时房主转移给下一位，实际：' + JSON.stringify(lv2));
  ok(rooms.some(r => r._id === '666666'), '仍有活跃玩家 → 房间保留');

  console.log('joinRoom 满员保护（上限 8 人）：');
  ok(cloudRoom.MAX_PLAYERS === 8, '云层上限常量为 8，实际 ' + cloudRoom.MAX_PLAYERS);
  ok(cloudRoom.MIN_PLAYERS === 3, '云层下限常量为 3，实际 ' + cloudRoom.MIN_PLAYERS);
  let err = null;
  try { await cloudRoom.joinRoom('444444', '第九人'); } catch (e) { err = e; }
  ok(err && /已满/.test(err.message) && /8/.test(err.message),
    '8 人房间拒绝加入且提示 8 人，实际：' + (err && err.message));
  const j7 = await cloudRoom.joinRoom('777777', '第八人').catch(e => e);
  ok(j7 && j7.roomId === '777777', '7 人房间可加入第 8 人（旧上限 6 时会被拒），实际：' + JSON.stringify(j7));
  let err2 = null;
  try { await cloudRoom.joinRoom('222222', '旁观'); } catch (e) { err2 = e; }
  ok(err2 && /不存在|已开始/.test(err2.message), '已释放/对局中房间拒绝加入，实际：' + (err2 && err2.message));
  const joined = await cloudRoom.joinRoom('111111', '新来的').catch(e => e);
  ok(joined && joined.roomId === '111111' && joined.playerId, '未满房间可正常加入');

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
