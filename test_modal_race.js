/* 回归：全员弹窗的"房主快速点击"竞态
   旧实现 pending 在写库完成后才赋值，房主比写库更快点击 → 回答被丢弃 →
   引擎永远等待无人能回应的弹窗（筹码不上桌/公共牌不翻）。
   正确行为：pending 同步先挂，房主本机点击立即推进流程。 */
const game = require('./zhipaibang-miniprogram/utils/game.js');
const { createHostUI } = require('./zhipaibang-miniprogram/utils/onlineHost.js');

const store = { rooms: {}, hands: {}, actions: [] };
const feedSubs = [];
let dbWriteDelayResolve = null;   // 用于挂起写库，模拟慢网络
const cloudRoom = {
  async updateRoomPublic(roomId, snap) {
    if (dbWriteDelayResolve) await new Promise(r => { dbWriteDelayResolve.push(r); });   // 慢写库
    store.rooms[roomId] = store.rooms[roomId] || {};
    store.rooms[roomId].public = JSON.parse(JSON.stringify(snap));
  },
  async updateRoom(roomId, data) { Object.assign(store.rooms[roomId] = store.rooms[roomId] || {}, JSON.parse(JSON.stringify(data))); },
  async writeHands(roomId, players) { players.forEach((p, i) => { store.hands[roomId + '_' + i] = Object.assign(store.hands[roomId + '_' + i] || { prompt: null }, { hole: JSON.parse(JSON.stringify(p.hole)) }); }); },
  async setHandPrompt(roomId, seat, prompt) { store.hands[roomId + '_' + seat] = store.hands[roomId + '_' + seat] || { prompt: null }; store.hands[roomId + '_' + seat].prompt = JSON.parse(JSON.stringify(prompt)); },
  async clearHandPrompt(roomId, seat) { if (store.hands[roomId + '_' + seat]) store.hands[roomId + '_' + seat].prompt = null; },
  async sendAction(roomId, a) { const doc = JSON.parse(JSON.stringify(Object.assign({ roomId }, a))); store.actions.push(doc); feedSubs.forEach(fn => fn(doc)); },
};

const page = {
  showModal(o) {
    // 房主"闪电手"：本机弹窗出现瞬间就点掉（此时写库必然还没完成）
    return Promise.resolve((o.actions && o.actions[0] && o.actions[0].value) !== undefined ? o.actions[0].value : undefined);
  },
  showPick() { return Promise.resolve(0); },
  sync() {},
};
const players = [{ openid: 'host' }, { openid: 'g1' }, { openid: 'g2' }];
game.newGame({ mode: 'custom', n: 3, names: ['房主', '客1', '客2'], customChals: [10] });
const { ui } = createHostUI({ page, roomId: '666666', mySeat: 0, players, cloudRoom });
game.setUI(ui);
// 客人全程不回应：流程只能靠房主本机点击推进
game.begin();

let pass = 0, fail = 0;
const T = (n, c) => c ? (pass++, console.log('OK  ', n)) : (fail++, console.log('FAIL', n));

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // 释放挂起的写库，让快照能落到 store
  await sleep(150);
  if (dbWriteDelayResolve) { dbWriteDelayResolve.forEach(r => r()); dbWriteDelayResolve = null; }
  await sleep(150);
  const s = game.state;
  T('房主快速点击全员弹窗后流程继续（不发牌确认卡死）', s.phase === 'chips' || s.round >= 1);
  T('第1轮中央筹码已上桌（含内部监控 3 张底牌局）', s.phase === 'chips' && [...s.centerChips].length === 3 && s.deck.length === 43);
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('模拟异常:', e); process.exit(1); });
