'use strict';
/* ================================================================
   联机模式 · 房主端 UI 适配器
   房主手机运行完整游戏引擎（utils/game.js），此适配器把引擎的三类
   UI 请求桥接到云数据库：
   - render()          → 公开快照写 rooms.public + 每人底牌写 hands
   - modal(o)          → o.player 指定玩家：私密弹窗写其 hands.prompt；
                         'all'（默认）：公开弹窗写 public.prompt，
                         房主本机同时弹窗，全员先到先得
   - pickHoleCard(i..) → 私密选牌写给第 i 位玩家
   ================================================================ */
const poker = require('./poker.js');
const game = require('./game.js');
const cloudRoomImpl = require('./cloudRoom.js');

function createHostUI(opts) {
  const page = opts.page, roomId = opts.roomId, mySeat = opts.mySeat, players = opts.players;
  const cloudRoom = opts.cloudRoom || cloudRoomImpl;   // 可注入模拟实现（测试用）
  let seq = 0;
  let pending = null;        // {pid, target:'all'|seat, resolve, done}
  let publicPrompt = null;   // 当前公开提示（随快照广播）

  async function clearPrompts() {
    publicPrompt = null;
    try { await cloudRoom.updateRoomPublic(roomId, withPrompt(game.getSnapshot(), null)); } catch (e) {}
    if (pending && typeof pending.target === 'number' && pending.target !== mySeat) {
      try { await cloudRoom.clearHandPrompt(roomId, pending.target); } catch (e) {}
    }
  }
  function withPrompt(snap, prompt) {
    snap.prompt = prompt;
    return snap;
  }

  /* 操作馈送里匹配当前等待的动作 */
  function feed(a) {
    if (!pending || pending.done) return false;
    if (a.pid !== pending.pid) return false;
    if (pending.target === 'all') {
      pending.done = true;
      const p = pending.resolve; pending = null;
      clearPrompts().then(() => p(a.value));
      return true;
    }
    if (pending.target === a.seat) {
      pending.done = true;
      const p = pending.resolve; pending = null;
      const v = a.type === 'pick' ? a.idx : a.value;
      clearPrompts().then(() => p(v));
      return true;
    }
    return false;
  }

  /* 房主本机弹窗参与"先到先得"竞速 */
  function localRace(o, pid) {
    page.showModal(o).then(v => {
      if (pending && pending.pid === pid && !pending.done) {
        pending.done = true;
        const p = pending.resolve; pending = null;
        clearPrompts().then(() => p(v));
      }
    });
  }

  const ui = {
    /* 房主本机渲染 + 广播 */
    render: async () => {
      const snap = withPrompt(game.getSnapshot(), publicPrompt);
      try { await cloudRoom.updateRoomPublic(roomId, snap); } catch (e) { console.error('[host] 公开快照广播失败', e && (e.errMsg || e.message || e)); }
      try { await cloudRoom.writeHands(roomId, game.state.players, players.map(p => p.id || p.openid || '')); } catch (e) { console.error('[host] 底牌写入失败', e && (e.errMsg || e.message || e)); }
      page.sync(snap);
    },

    /* 弹窗：o.player 缺省 = 全员 */
    modal: (o) => {
      seq += 1;
      const pid = seq;
      const target = o.player === undefined ? 'all' : o.player;

      if (target === mySeat) {
        // 房主本人的私密弹窗：仅本机
        return page.showModal(o);
      }
      if (target === 'all') {
        publicPrompt = { pid, title: o.title, body: o.body, actions: o.actions, target: 'all' };
        // 关键：pending 必须同步先挂上——本机弹窗立即出现，房主可能比写库更快点击。
        // 此前 pending 等写库完成后才赋值，快速点击会被丢弃 → 引擎永远等一个无人能回应的弹窗
        // （表现为弹窗关掉后流程卡死：筹码不上桌、公共牌不翻）。
        return new Promise(res => {
          pending = { pid, target: 'all', resolve: res, done: false };
          localRace(o, pid);
          cloudRoom.updateRoomPublic(roomId, withPrompt(game.getSnapshot(), publicPrompt))
            .catch(err => console.error('[host] 公开弹窗写库失败（流程继续，等任一玩家回应）', err && (err.errMsg || err.message || err)));
        });
      }
      // 指定某位玩家（私密弹窗）：正文走公开通道（所有人可见，与热座一致；
      // 底牌牌面 cards/reveal 只走私密通道发给本人）。此前正文只写 hands 文档，
      // 且目标玩家回复时 pid 取不到 → 房主永远等不到动作，表现为"弹窗不出现"
      publicPrompt = { pid, target, waitName: game.state.players[target].name, title: o.title, body: o.body, actions: o.actions };
      return new Promise(res => {
        pending = { pid, target, resolve: res, done: false };   // 同步先挂，理由同上
        Promise.all([
          cloudRoom.setHandPrompt(roomId, target, {
            pid, title: o.title, body: o.body, actions: o.actions,
            cards: o.cards || null, reveal: o.reveal || null,
          }),
          cloudRoom.updateRoomPublic(roomId, withPrompt(game.getSnapshot(), publicPrompt)),
        ]).catch(err => console.error('[host] 私密弹窗写库失败（流程继续，等目标玩家回应）', err && (err.errMsg || err.message || err)));
      });
    },

    /* 私密选底牌：写给第 i 位玩家 */
    pickHoleCard: (i, prompt, excludeCard) => {
      seq += 1;
      const pid = seq;
      const hole = game.state.players[i].hole;
      const cards = [];
      hole.forEach((c, idx) => {
        if (excludeCard && c === excludeCard) return;
        cards.push({ idx, face: poker.cardFace(c) });
      });
      if (i === mySeat) {
        return page.showPick(i, prompt, excludeCard);
      }
      publicPrompt = { pid, target: i, waitName: game.state.players[i].name };
      return new Promise(res => {
        pending = { pid, target: i, resolve: res, done: false };   // 同步先挂，理由同上
        Promise.all([
          cloudRoom.setHandPrompt(roomId, i, { pid, pickHole: true, prompt, cards }),
          cloudRoom.updateRoomPublic(roomId, withPrompt(game.getSnapshot(), publicPrompt)),
        ]).catch(err => console.error('[host] 选牌写库失败（流程继续，等目标玩家回应）', err && (err.errMsg || err.message || err)));
      });
    },

    onGameOver: () => {
      if (page.setData) page.setData({ gameOver: true });
      cloudRoom.updateRoom(roomId, { status: 'over' });
    },
  };
  return { ui, feed };
}

module.exports = { createHostUI };
