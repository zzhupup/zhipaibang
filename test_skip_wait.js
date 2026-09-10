/* 回归：目标玩家失联/退出后，房主"代为继续"（skip）可用默认答案放行引擎 */
'use strict';
const game = require('./zhipaibang-miniprogram/utils/game.js');
const { createHostUI } = require('./zhipaibang-miniprogram/utils/onlineHost.js');

const store = { rooms: {}, hands: {}, actions: [] };
const cloudRoom = {
  async updateRoomPublic(roomId, snap) { store.rooms[roomId] = store.rooms[roomId] || {}; store.rooms[roomId].public = JSON.parse(JSON.stringify(snap)); },
  async updateRoom(roomId, data) { Object.assign(store.rooms[roomId] = store.rooms[roomId] || {}, JSON.parse(JSON.stringify(data))); },
  async writeHands(roomId, players) { players.forEach((p, i) => { store.hands[roomId + '_' + i] = Object.assign(store.hands[roomId + '_' + i] || { prompt: null }, { hole: JSON.parse(JSON.stringify(p.hole)) }); }); },
  async setHandPrompt(roomId, seat, prompt) { store.hands[roomId + '_' + seat] = store.hands[roomId + '_' + seat] || { prompt: null }; store.hands[roomId + '_' + seat].prompt = JSON.parse(JSON.stringify(prompt)); },
  async clearHandPrompt(roomId, seat) { if (store.hands[roomId + '_' + seat]) store.hands[roomId + '_' + seat].prompt = null; },
  async sendAction(roomId, a) { store.actions.push(a); },
};

let hostModalShown = [];
const page = {
  showModal(o) { hostModalShown.push(o.title); return new Promise(() => {}); },  // 房主本机弹窗永不点击（模拟离开）
  showPick() { return new Promise(() => {}); },
  sync() {},
  setData() {},
};

(async () => {
  game.newGame({ mode: 'standard', n: 3, names: ['房主', '客1', '客2'] });
  const players = [{ openid: 'host' }, { openid: 'g1' }, { openid: 'g2' }];
  const api = createHostUI({ page, roomId: 'R1', mySeat: 0, players, cloudRoom });
  game.setUI(api.ui);
  const p = game.begin();
  await new Promise(r => setTimeout(r, 150));

  // 客人完全不回应。等若干拍后逐次 skip，流程必须能推进到第 1 轮筹码阶段
  let ok = false;
  for (let t = 0; t < 60; t++) {
    const snap = store.rooms.R1 && store.rooms.R1.public;
    if (snap && snap.phase === 'chips') { ok = true; break; }
    const skipped = api.skip();
    if (!skipped) await new Promise(r => setTimeout(r, 50));
  }
  const snap = game.state;
  console.log('phase =', snap.phase, '| center =', [...snap.centerChips], '| skip 放行 =', ok);
  if (!ok) { console.error('FAIL：skip 无法推进流程'); process.exit(1); }
  // skip 对已无等待的调用应安全返回 false
  if (api.skip() !== false) { console.error('FAIL：空 pending 时 skip 应返回 false'); process.exit(1); }
  console.log('SKIP-WAIT 测试 2/2 通过');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
