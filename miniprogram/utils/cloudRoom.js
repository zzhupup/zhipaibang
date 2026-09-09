'use strict';
/* ================================================================
   云开发房间通道：房间创建/加入、实时监听、操作馈送
   集合（需在云开发控制台创建并配置安全规则，见 README）：
   - rooms    房间文档（doc id = 6 位房间号），含 public 公开快照
   - players  玩家文档（每人一条，含 roomId/name/created/_openid）
   - hands    私密文档（doc id = `${roomId}_${seat}`，仅本人可读自己的）
   - actions  操作馈送（客人写入，房主按序消费）
   ================================================================ */

const ENV_ID = 'cloud1-d3gahr5rwf6e00397';   // ← 替换为你的云开发环境 ID
let db = null;

function init() {
  if (!wx.cloud) {
    throw new Error('当前基础库不支持云开发，请升级微信版本');
  }
  if (!db) {
    wx.cloud.init({ env: ENV_ID, traceUser: false });
    db = wx.cloud.database();
  }
  return db;
}
function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

/* ---------- 房主 ----------
   注意：客户端 add() 返回值不含 _openid（真机已验证），身份标识一律用玩家文档 _id */
async function createRoom(name) {
  init();
  let code = genCode();
  // 检查房间号是否被占用（占用则换号重试）
  for (let i = 0; i < 5; i++) {
    try {
      const doc = await db.collection('rooms').doc(code).get();
      if (doc.data) { code = genCode(); continue; }
    } catch (e) { /* 不存在则继续 */ break; }
  }
  await db.collection('rooms').doc(code).set({
    data: {
      status: 'lobby',
      hostName: name || '房主',
      createdAt: Date.now(),
      public: {},
    }
  });
  const p = await db.collection('players').add({ data: { roomId: code, name: name || '房主', created: Date.now() } });
  return { roomId: code, playerId: p._id };
}

/* ---------- 玩家加入 ---------- */
async function joinRoom(code, name) {
  init();
  const doc = await db.collection('rooms').doc(code).get();
  if (!doc.data) throw new Error('房间不存在，请核对 6 位房间号');
  if (doc.data.status !== 'lobby') throw new Error('对局已开始，无法加入');
  const p = await db.collection('players').add({ data: { roomId: code, name: name || '玩家', created: Date.now() } });
  return { roomId: code, playerId: p._id };
}

/* ---------- 玩家列表（按加入时间排序 → 座位号） ---------- */
async function listPlayers(roomId) {
  const res = await db.collection('players').where({ roomId }).orderBy('created', 'asc').limit(20).get();
  return res.data.map((d, i) => ({ id: d._id, openid: d._openid, name: d.name, seat: i }));
}

/* ---------- 房间文档监听 ---------- */
function watchRoom(roomId, cb, onError) {
  const watcher = db.collection('rooms').doc(roomId).watch({
    onChange: snap => { if (snap.docs && snap.docs[0]) cb(snap.docs[0]); },
    onError: e => { onError && onError(e); },
  });
  return watcher;
}
/* ---------- 玩家列表监听（大厅） ---------- */
function watchPlayers(roomId, cb, onError) {
  const watcher = db.collection('players').where({ roomId }).watch({
    onChange: snap => {
      const list = (snap.docs || []).sort((a, b) => a.created - b.created)
        .map((d, i) => ({ id: d._id, openid: d._openid, name: d.name, seat: i }));
      cb(list);
    },
    onError: e => { onError && onError(e); },
  });
  return watcher;
}
/* ---------- 本人私密文档监听 ---------- */
function watchHand(roomId, seat, cb, onError) {
  const docId = roomId + '_' + seat;
  const watcher = db.collection('hands').doc(docId).watch({
    onChange: snap => { if (snap.docs && snap.docs[0]) cb(snap.docs[0]); },
    onError: e => { onError && onError(e); },
  });
  return watcher;
}

/* ---------- 房主写公开快照 ---------- */
async function updateRoomPublic(roomId, snap) {
  const _ = db.command;
  await db.collection('rooms').doc(roomId).update({
    data: { public: _.set(snap), updatedAt: Date.now() },
  });
}
async function updateRoom(roomId, data) {
  await db.collection('rooms').doc(roomId).update({ data });
}
/* ---------- 房主写私密文档（底牌） ---------- */
async function writeHands(roomId, players, openids) {
  for (let i = 0; i < players.length; i++) {
    const docId = roomId + '_' + i;
    try {
      await db.collection('hands').doc(docId).update({ data: { hole: players[i].hole } });
    } catch (e) {
      // 首次不存在则创建
      await db.collection('hands').doc(docId).set({
        data: { roomId, owner: openids[i], seat: i, hole: players[i].hole, prompt: null }
      });
    }
  }
}
/* ---------- 房主写/清私密弹窗 ---------- */
async function setHandPrompt(roomId, seat, prompt) {
  await db.collection('hands').doc(roomId + '_' + seat).update({ data: { prompt } });
}
async function clearHandPrompt(roomId, seat) {
  await db.collection('hands').doc(roomId + '_' + seat).update({ data: { prompt: null } });
}

/* ---------- 操作馈送 ---------- */
async function sendAction(roomId, a) {
  await db.collection('actions').add({
    data: Object.assign({ roomId, created: Date.now() }, a),
  });
}
/* 房主监听操作馈送 */
function watchActions(roomId, cb, onError) {
  const watcher = db.collection('actions').where({ roomId }).orderBy('created', 'asc').watch({
    onChange: snap => {
      (snap.docChanges || []).forEach(ch => {
        if ((ch.dataType === 'add' || ch.dataType === 'update') && ch.doc) cb(ch.doc);
      });
    },
    onError: e => { onError && onError(e); },
  });
  return watcher;
}
async function removeAction(actionId) {
  try { await db.collection('actions').doc(actionId).remove(); } catch (e) {}
}

module.exports = {
  ENV_ID, init, createRoom, joinRoom, listPlayers,
  watchRoom, watchPlayers, watchHand, watchActions,
  updateRoomPublic, updateRoom, writeHands,
  setHandPrompt, clearHandPrompt, sendAction, removeAction,
};
