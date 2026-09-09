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
 */
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

    return { ok: false, error: 'unknown action' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
};
