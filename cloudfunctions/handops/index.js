const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 底牌写入的唯一合法通道。
 * hands 集合客户端安全规则为 write:false，只有本云函数（管理权限）可写，
 * 防止任何客户端篡改他人底牌。
 *
 * action: deal   - 开局发牌：为每个座位写 hole（docId = roomId_seat）
 * action: prompt - 房主向某座位写/清私密弹窗 prompt
 * action: reap   - 释放"房间内已无活跃玩家"的房间：彻底清理
 *                  players/actions/hands/rooms 四类文档
 */

/* 房间释放判定：所有玩家的心跳都静默超过该时长 → 视为死房间。
   心跳周期 5 秒，90 秒 = 连续漏掉 18 次心跳，不会误伤正常房间。
   这里用云函数所在服务器的 Date.now()，是权威时间轴，
   不受各台手机本地时钟快慢影响（客户端只做展示层的过滤）。 */
const RELEASE_MS = 90000;

function tsOf(v) {
  if (v instanceof Date) return v.getTime();
  const n = +v;
  return isFinite(n) ? n : 0;
}
exports.main = async (event) => {
  const { action, roomId } = event || {};
  if (!roomId) return { ok: false, error: 'roomId required' };

  try {
    if (action === 'deal') {
      const players = event.players || [];
      const owners = event.owners || [];
      if (!players.length || players.length > 20) {
        return { ok: false, error: 'invalid player count' };
      }
      for (let i = 0; i < players.length; i++) {
        if (!players[i] || !Array.isArray(players[i].hole)) {
          return { ok: false, error: 'invalid hole cards at seat ' + i };
        }
        const docId = roomId + '_' + i;
        // update 兼容两种 SDK 行为：抛异常 / 返回 updated=0
        const r = await db.collection('hands').doc(docId)
          .update({ data: { hole: players[i].hole } }).catch(() => null);
        if (!r || !r.stats || r.stats.updated === 0) {
          await db.collection('hands').doc(docId).set({
            data: { roomId, owner: owners[i] || '', seat: i, hole: players[i].hole, prompt: null }
          });
        }
      }
      return { ok: true };
    }

    if (action === 'prompt') {
      const seat = event.seat;
      if (typeof seat !== 'number' || seat < 0) return { ok: false, error: 'invalid seat' };
      const prompt = event.prompt === undefined ? null : event.prompt;
      await db.collection('hands').doc(roomId + '_' + seat).update({ data: { prompt } });
      return { ok: true };
    }

    if (action === 'reap') {
      const roomDoc = await db.collection('rooms').doc(roomId).get().catch(() => null);
      if (!roomDoc || !roomDoc.data) return { ok: true, reaped: false, reason: 'not-found' };

      // 权威判定：以服务端时间为准，看还有没有"活跃玩家"
      const nowMs = Date.now();
      const pr = await db.collection('players').where({ roomId }).limit(100).get().catch(() => ({ data: [] }));
      const list = pr.data || [];
      let latest = 0;
      list.forEach(d => { const t = tsOf(d.lastSeen); if (t > latest) latest = t; });
      if (latest && nowMs - latest <= RELEASE_MS) {
        return { ok: true, reaped: false, reason: 'active', players: list.length };
      }

      // 彻底释放：玩家 / 操作馈送 / 私密底牌 / 房间文档
      await db.collection('players').where({ roomId }).remove().catch(() => {});
      await db.collection('actions').where({ roomId }).remove().catch(() => {});
      await db.collection('hands').where({ roomId }).remove().catch(() => {});
      // hands 兜底：早期文档可能没写 roomId 字段，按 docId 规则逐个删（座位上限 20）
      for (let i = 0; i < 20; i++) {
        await db.collection('hands').doc(roomId + '_' + i).remove().catch(() => {});
      }
      await db.collection('rooms').doc(roomId).remove().catch(() => {});
      return { ok: true, reaped: true, players: list.length };
    }

    return { ok: false, error: 'unknown action' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
};
