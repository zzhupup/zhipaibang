/* 回归：可加入房间列表 listRooms 过滤 + joinRoom 满员保护
   用内存假数据库注入 wx.cloud，验证：
   1) 只列 status='lobby' 且"有人在线"的房间（僵尸房间/对局中房间不出现）
   2) 在线人数按心跳窗口统计（45s 内），超过 45s 的玩家不计入
   3) joinRoom 在第 6 人时拒绝（满员） */
'use strict';

const ONLINE_MS = 45000;
const now = Date.now();

const rooms = [
  { _id: '111111', status: 'lobby', hostName: '房主甲', createdAt: now - 30000 },
  { _id: '222222', status: 'playing', hostName: '房主乙', createdAt: now - 60000 },
  { _id: '333333', status: 'lobby', hostName: '僵尸房', createdAt: now - 900000 },
  { _id: '444444', status: 'lobby', hostName: '满员房', createdAt: now - 20000 },
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
];

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
      let list = (name === 'rooms' ? rooms : name === 'players' ? players : []).filter(d => match(d, state.q));
      if (state.order) list = list.slice().sort((a, b) => (state.dir === 'desc' ? b[state.order] - a[state.order] : a[state.order] - b[state.order]));
      return { data: list.slice(0, state.lim).map(d => Object.assign({}, d)) };
    },
    async count() { return { total: (name === 'rooms' ? rooms : players).filter(d => match(d, state.q)).length }; },
  };
  return api;
}
function makeCollection(name) {
  return {
    where(q) { return makeQuery(name, q); },
    orderBy(f, d) { return makeQuery(name, {}).orderBy(f, d); },
    limit(n) { return makeQuery(name, {}).limit(n); },
    doc(id) {
      return {
        async get() { const d = (name === 'rooms' ? rooms : players).find(x => x._id === id); return { data: d ? Object.assign({}, d) : null }; },
        async update() { return {}; },
        async remove() { return {}; },
        async set() { return {}; },
      };
    },
    async add({ data }) { const id = 'new_' + Math.random().toString(36).slice(2, 8); players.push(Object.assign({ _id: id }, data)); return { _id: id }; },
  };
}
global.wx = {
  cloud: {
    init() {},
    database() {
      const db = {
        collection: makeCollection,
        serverDate: () => new Date(),
        command: { in: arr => ({ __in: arr }) },
      };
      return db;
    },
    callFunction() { return Promise.resolve({ result: { ok: true } }); },
  },
};

const cloudRoom = require('./zhipaibang-miniprogram/utils/cloudRoom.js');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };

(async () => {
  console.log('listRooms 过滤：');
  const list = await cloudRoom.listRooms();
  const codes = list.map(r => r.code);
  ok(!codes.includes('222222'), '对局中(playing)房间不出现');
  ok(!codes.includes('333333'), '全员掉线的僵尸房间不出现');
  ok(codes.includes('111111'), '大厅房间出现');
  const r1 = list.find(r => r.code === '111111');
  ok(r1 && r1.count === 2, '在线人数=2（超时玩家不计入），实际 ' + (r1 && r1.count));
  ok(r1 && r1.hostName === '房主甲', '房主昵称正确');
  ok(list.find(r => r.code === '111111') && list.find(r => r.code === '111111').max === 6, '上限 6 人');
  const order = list.map(r => r.createdAt);
  ok(JSON.stringify(order) === JSON.stringify(order.slice().sort((a, b) => b - a)), '按创建时间倒序');

  console.log('joinRoom 满员保护：');
  let err = null;
  try { await cloudRoom.joinRoom('444444', '第七人'); } catch (e) { err = e; }
  ok(err && /已满/.test(err.message), '6 人房间拒绝加入，实际：' + (err && err.message));
  let err2 = null;
  try { await cloudRoom.joinRoom('222222', '旁观'); } catch (e) { err2 = e; }
  ok(err2 && /已开始/.test(err2.message), '对局中房间拒绝加入');
  const joined = await cloudRoom.joinRoom('111111', '新来的').catch(e => e);
  ok(joined && joined.roomId === '111111' && joined.playerId, '未满房间可正常加入');

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
