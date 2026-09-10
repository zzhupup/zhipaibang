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
  // 先建玩家文档拿到 playerId；房间文档记录 hostPid（房主离开时据此转交）
  // lastSeen = 在线心跳标记，用**服务端时间**（serverDate）写入：
  // 各手机本地时钟偏差可达数分钟，用本地时间会让"时钟快的手机"把所有人都判为离线
  const p = await db.collection('players').add({ data: { roomId: code, name: name || '房主', created: Date.now(), lastSeen: db.serverDate() } });
  await db.collection('rooms').doc(code).set({
    data: {
      status: 'lobby',
      hostPid: p._id,
      hostName: name || '房主',
      createdAt: Date.now(),
      public: {},
    }
  });
  return { roomId: code, playerId: p._id };
}

/* ---------- 可加入房间列表（加入页展示） ----------
   只列 status='lobby' 的房间，并且只保留"真的有人在线"的：
   players 文档 45 秒内有心跳才算在线，无人房间（历史垃圾/全员退出没删干净）不展示。
   服务器时间轴：以本次拉到的所有 lastSeen 的最新值作为"现在"参照，
   避免各手机本机时钟快慢不同把在线玩家误判为离线（同 listPlayers 的处理思路）。 */
async function listRooms() {
  init();
  const _ = db.command;
  const res = await db.collection('rooms').where({ status: 'lobby' })
    .orderBy('createdAt', 'desc').limit(20).get().catch(() => ({ data: [] }));
  const rooms = res.data || [];
  if (!rooms.length) return [];
  const codes = rooms.map(r => r._id);
  // 分批查玩家（in 数组不宜过长），最多 3 批 × 10
  const plist = [];
  for (let i = 0; i < codes.length && i < 30; i += 10) {
    const chunk = codes.slice(i, i + 10);
    const pr = await db.collection('players').where({ roomId: _.in(chunk) })
      .orderBy('created', 'desc').limit(100).get().catch(() => ({ data: [] }));
    (pr.data || []).forEach(d => plist.push(d));
  }
  let serverNow = 0;
  plist.forEach(d => { const t = normTime(d.lastSeen); if (t > serverNow) serverNow = t; });
  if (!serverNow) serverNow = Date.now();
  const online = {};
  plist.forEach(d => {
    if (serverNow - normTime(d.lastSeen) > ONLINE_MS) return;
    online[d.roomId] = (online[d.roomId] || 0) + 1;
  });
  return rooms
    .filter(r => online[r._id] > 0)
    .map(r => ({
      code: r._id,
      hostName: r.hostName || '房主',
      count: online[r._id],
      max: 6,
      createdAt: r.createdAt || 0,
    }));
}

/* ---------- 玩家加入 ---------- */
async function joinRoom(code, name) {
  init();
  const doc = await db.collection('rooms').doc(code).get();
  if (!doc.data) throw new Error('房间不存在，请核对 6 位房间号');
  if (doc.data.status !== 'lobby') throw new Error('对局已开始，无法加入');
  // 满员保护（最多 6 人）：统计"在线"玩家，用本房间最新心跳作为时间参照，
  // 避免被杀进程留下的僵尸文档把房间误判为满员
  const res = await db.collection('players').where({ roomId: code }).limit(30).get().catch(() => ({ data: [] }));
  const list = res.data || [];
  let serverNow = 0;
  list.forEach(d => { const t = normTime(d.lastSeen); if (t > serverNow) serverNow = t; });
  if (!serverNow) serverNow = Date.now();
  const onlineCount = list.filter(d => d.lastSeen && serverNow - normTime(d.lastSeen) <= ONLINE_MS).length;
  if (onlineCount >= 6) throw new Error('房间已满（最多 6 人）');
  const p = await db.collection('players').add({ data: { roomId: code, name: name || '玩家', created: Date.now(), lastSeen: db.serverDate() } });
  return { roomId: code, playerId: p._id };
}

/* ---------- 玩家列表（按加入时间排序 → 座位号；只保留 45 秒内有心跳的在线玩家） ---------- */
const ONLINE_MS = 45000;
/* serverDate 写入后客户端读到的是 Date 对象（兼容数字） */
function normTime(v) { return v instanceof Date ? v.getTime() : +v; }
/* 本机时钟与服务器时钟的偏差（毫秒）。
   判断"谁在线"必须用服务器时间轴：lastSeen 由 serverDate 写入，
   而本机 Date.now() 可能快/慢几分钟——偏差不校准，时钟快的手机
   会把所有其他玩家误判为离线（表现为"看不到其他玩家列表"）。
   校准方式：从自己的玩家文档读回 lastSeen（服务端时间），
   clockOffset = 本机当前时间 - 服务器时间。 */
let clockOffset = 0;
function calibratedNow() { return Date.now() - clockOffset; }
function calibrateFromOwnDoc(docs, myId) {
  if (!myId || !docs) return;
  const mine = docs.find(d => d._id === myId);
  if (mine && mine.lastSeen) {
    const srv = normTime(mine.lastSeen);
    if (srv > 0) clockOffset = Date.now() - srv;
  }
}
function onlineFilter(d) {
  if (!d.lastSeen) return false;
  return calibratedNow() - normTime(d.lastSeen) <= ONLINE_MS;
}
async function listPlayers(roomId, myId) {
  // 关键：必须倒序取"最新 50 条"再过滤——正序 limit 会取到最早的文档，
  // 被历史垃圾挤占后当前在线玩家的文档直接被截掉（曾导致发牌名单缺人）
  const res = await db.collection('players').where({ roomId }).orderBy('created', 'desc').limit(50).get();
  calibrateFromOwnDoc(res.data, myId);   // 顺手用自己文档校准时钟（误差 ≤ 心跳周期，可忽略）
  return res.data.filter(onlineFilter)
    .sort((a, b) => a.created - b.created)
    .map((d, i) => ({ id: d._id, openid: d._openid, name: d.name, seat: i, lastSeen: normTime(d.lastSeen) }));
}

/* ---------- 在线心跳：每 5 秒刷新自己的 lastSeen ----------
   列表只显示 20 秒内有心跳的玩家：退出即删文档，被杀进程 15 秒后自动掉列表，
   历史残留文档（无 lastSeen）永久不可见。返回句柄，页面卸载时 stop()。 */
function startHeartbeat(roomId, playerId) {
  if (!roomId || !playerId || !db) return { stop() {} };
  const tick = () => db.collection('players').doc(playerId)
    .update({ data: { lastSeen: db.serverDate() } }).catch(() => {});
  tick();
  const timer = setInterval(tick, 5000);
  return { stop() { clearInterval(timer); } };
}

/* ---------- 离开房间 ----------
   1. 删除自己的玩家文档（其余客户端列表实时更新）
   2. 房主离开 → hostPid 转交给最早加入的剩余玩家
   3. 无人剩余 → 删除房间文档（解散） */
async function leaveRoom(roomId, playerId) {
  if (!roomId || !playerId) return {};
  init();
  try { await db.collection('players').doc(playerId).remove(); } catch (e) {}
  const res = await db.collection('players').where({ roomId }).limit(20).get().catch(() => null);
  const list = res ? res.data.slice().sort((a, b) => a.created - b.created) : [];
  if (!list.length) {
    try { await db.collection('rooms').doc(roomId).remove(); } catch (e) {}
    return { dissolved: true };
  }
  const room = await db.collection('rooms').doc(roomId).get().catch(() => null);
  if (room && room.data && room.data.hostPid === playerId) {
    await db.collection('rooms').doc(roomId).update({
      data: { hostPid: list[0]._id, hostName: list[0].name },
    }).catch(() => {});
    return { newHostPid: list[0]._id };
  }
  return {};
}

/* ---------- 实时监听通用包装：断线自动重连 + HTTP 轮询兜底 ----------
   云开发实时推送（ws）在不稳定网络/代理环境下可能持续登录失败（-602002），
   而 HTTPS 普通请求是通的。因此：
   1. ws 断开期间每 3 秒通过普通 get 拉一次数据（pollFn），同一回调推送（幂等）；
   2. 同时持续尝试 ws 重连，重连成功（首帧推送）即停轮询；
   3. 重试日志每 5 次才打一条，避免刷屏。 */
function watchWithRetry(createFn, cb, onError, maxRetry, pollFn) {
  let closed = false, tries = 0, watcher = null, pollTimer = null;
  const startPoll = () => {
    if (closed || !pollFn || pollTimer) return;
    pollTimer = setInterval(async () => {
      if (closed) return;
      try {
        const d = await pollFn();
        if (d !== null && d !== undefined) cb(d);
      } catch (e) { /* 轮询失败静默，下个周期再试 */ }
    }, 3000);
  };
  const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
  const start = () => {
    if (closed) return;
    watcher = createFn(
      doc => { stopPoll(); cb(doc); },
      e => {
        if (closed) return;
        tries += 1;
        try { watcher && watcher.close(); } catch (err) {}
        startPoll();   // ws 挂了立即启用 HTTP 轮询兜底
        if (tries <= maxRetry) {
          if (tries % 5 === 1) {
            console.warn('[cloud] 实时监听断开，轮询兜底中，2秒后重连 (' + tries + '/' + maxRetry + ')',
              e && (e.errCode || e.message || ''));
          }
          setTimeout(start, 2000);
        } else {
          onError && onError(e);   // 重连放弃，但轮询继续（游戏不中断）
        }
      }
    );
  };
  start();
  return { close() { closed = true; stopPoll(); try { watcher && watcher.close(); } catch (e) {} } };
}

/* ---------- 房间文档监听 ---------- */
function watchRoom(roomId, cb, onError) {
  return watchWithRetry(
    (ok, fail) => db.collection('rooms').doc(roomId).watch({
      onChange: snap => { if (snap.docs && snap.docs[0]) ok(snap.docs[0]); },
      onError: fail,
    }),
    cb, onError, 20,
    async () => {
      const r = await db.collection('rooms').doc(roomId).get().catch(() => null);
      return (r && r.data) || null;
    }
  );
}
/* ---------- 玩家列表监听（大厅，只推 45 秒内有心跳的在线玩家）
   myId：本人玩家文档 _id —— 用于从自己的心跳自动校准本机时钟偏差 */
function watchPlayers(roomId, myId, cb, onError) {
  return watchWithRetry(
    (ok, fail) => db.collection('players').where({ roomId }).watch({
      onChange: snap => {
        calibrateFromOwnDoc(snap.docs, myId);
        const list = (snap.docs || []).filter(onlineFilter)
          .sort((a, b) => a.created - b.created)
          .map((d, i) => ({ id: d._id, openid: d._openid, name: d.name, seat: i, lastSeen: normTime(d.lastSeen) }));
        ok(list);
      },
      onError: fail,
    }),
    cb, onError, 20,
    () => listPlayers(roomId, myId)
  );
}
/* ---------- 本人私密文档监听 ---------- */
function watchHand(roomId, seat, cb, onError) {
  const docId = roomId + '_' + seat;
  return watchWithRetry(
    (ok, fail) => db.collection('hands').doc(docId).watch({
      onChange: snap => { if (snap.docs && snap.docs[0]) ok(snap.docs[0]); },
      onError: fail,
    }),
    cb, onError, 30,
    async () => {
      const r = await db.collection('hands').doc(docId).get().catch(() => null);
      return (r && r.data) || null;
    }
  );
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
/* ---------- 房主写私密文档（底牌）—— 走云函数 handops，客户端对 hands 零写权限 ---------- */
function writeHands(roomId, players, openids) {
  return wx.cloud.callFunction({
    name: 'handops',
    data: { action: 'deal', roomId, players, owners: openids },
  }).then(r => {
    const res = r.result;
    if (!res || !res.ok) throw new Error(res && res.error || 'handops deal failed');
  });
}
/* ---------- 房主写/清私密弹窗（同样走云函数） ---------- */
function setHandPrompt(roomId, seat, prompt) {
  return wx.cloud.callFunction({
    name: 'handops',
    data: { action: 'prompt', roomId, seat, prompt },
  }).then(r => {
    const res = r.result;
    if (!res || !res.ok) throw new Error(res && res.error || 'handops prompt failed');
  });
}
function clearHandPrompt(roomId, seat) {
  return setHandPrompt(roomId, seat, null);
}

/* ---------- 操作馈送 ---------- */
async function sendAction(roomId, a) {
  await db.collection('actions').add({
    data: Object.assign({ roomId, created: Date.now() }, a),
  });
}
/* 房主监听操作馈送（轮询路径按 _id 去重，避免重复投递） */
function watchActions(roomId, cb, onError) {
  const seen = new Set();
  const deliver = doc => { if (doc && doc._id && !seen.has(doc._id)) { seen.add(doc._id); cb(doc); } };
  return watchWithRetry(
    (ok, fail) => db.collection('actions').where({ roomId }).orderBy('created', 'asc').watch({
      onChange: snap => {
        (snap.docChanges || []).forEach(ch => {
          if ((ch.dataType === 'add' || ch.dataType === 'update') && ch.doc) ok(ch.doc);
        });
      },
      onError: fail,
    }),
    deliver, onError, 20,
    // 轮询拿到的是数组，必须逐条自行投递（返回 null 跳过通用单文档投递）。
    // 此前直接 return 数组被当单文档处理 → _id 取不到 → 客人所有回复被静默丢弃，
    // 房主永远等不到"确认"，游戏卡死在发牌弹窗（筹码不上桌）。
    async () => {
      const r = await db.collection('actions').where({ roomId }).orderBy('created', 'asc').limit(20).get();
      r.data.forEach(deliver);
      return null;
    }
  );
}
async function removeAction(actionId) {
  try { await db.collection('actions').doc(actionId).remove(); } catch (e) {}
}

module.exports = {
  ENV_ID, init, createRoom, joinRoom, listPlayers, listRooms, leaveRoom, startHeartbeat,
  watchRoom, watchPlayers, watchHand, watchActions,
  updateRoomPublic, updateRoom, writeHands,
  setHandPrompt, clearHandPrompt, sendAction, removeAction,
};
