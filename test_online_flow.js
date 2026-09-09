/* 联机流程端到端模拟：模拟房主引擎 + 2 位客人通过操作馈送完成一整次劫案
   （用内存对象模拟云数据库的 rooms/hands/actions 与 watch 通道） */
const game = require('./zhipaibang-miniprogram/utils/game.js');
const { createHostUI } = require('./zhipaibang-miniprogram/utils/onlineHost.js');

/* ---- 模拟云数据库 ---- */
const store = { rooms: {}, hands: {}, actions: [] };
const feedSubs = [];
const cloudRoom = {
  async updateRoomPublic(roomId, snap) {
    store.rooms[roomId] = store.rooms[roomId] || {};
    store.rooms[roomId].public = JSON.parse(JSON.stringify(snap));
  },
  async updateRoom(roomId, data) {
    store.rooms[roomId] = store.rooms[roomId] || {};
    Object.assign(store.rooms[roomId], JSON.parse(JSON.stringify(data)));
  },
  async writeHands(roomId, players, openids) {
    players.forEach((p, i) => {
      const id = roomId + '_' + i;
      store.hands[id] = Object.assign(store.hands[id] || { prompt: null }, { hole: JSON.parse(JSON.stringify(p.hole)) });
    });
  },
  async setHandPrompt(roomId, seat, prompt) { store.hands[roomId + '_' + seat].prompt = JSON.parse(JSON.stringify(prompt)); },
  async clearHandPrompt(roomId, seat) { store.hands[roomId + '_' + seat].prompt = null; },
  async sendAction(roomId, a) {
    const doc = JSON.parse(JSON.stringify(Object.assign({ roomId }, a)));
    store.actions.push(doc);
    feedSubs.forEach(fn => fn(doc));
  },
};

/* ---- 模拟页面（房主） ---- */
const page = {
  showModal(o) {
    // 房主本机弹窗：自动选择第一个动作
    page.lastModal = o;
    return Promise.resolve((o.actions && o.actions[0] && o.actions[0].value) !== undefined ? o.actions[0].value : undefined);
  },
  showPick(i, prompt, exclude) {
    // 房主本机选牌：选第一张
    const hole = game.state.players[i].hole;
    for (let k = 0; k < hole.length; k++) if (hole[k] !== exclude) return Promise.resolve(k);
    return Promise.resolve(0);
  },
  sync(snap) { page.lastSnap = snap; },
};

let pass = 0, fail = 0;
const T = (n, c) => c ? (pass++, console.log('OK  ', n)) : (fail++, console.log('FAIL', n));

(async () => {
  // 3 名玩家：0=房主（引擎所在），1/2=客人
  const players = [{ openid: 'host' }, { openid: 'g1' }, { openid: 'g2' }];
  game.newGame({ mode: 'standard', n: 3, names: ['房主', '客人甲', '客人乙'] });
  const { ui, feed } = createHostUI({ page, roomId: '888888', mySeat: 0, players, cloudRoom });
  game.setUI(ui);
  // 房主监听馈送：prompt/pick 转给 hostUI.feed；筹码操作直接调用引擎
  feedSubs.push(async a => {
    if (a.type === 'prompt' || a.type === 'pick') { feed(a); return; }
    const s = game.state;
    const color = game.ROUND_COLOR[s.round];
    if (a.type === 'takeCenter') { const p = s.players[a.seat]; if (s.phase === 'chips' && s.centerChips.has(a.star) && !p.chips[color]) game.doTakeCenter(a.seat, a.star); }
    else if (a.type === 'takeFrom') { const t = s.players[a.target], k = s.players[a.seat]; if (s.phase === 'chips' && a.seat !== a.target && t.chips[color] && !t.chips[color].dark && !k.chips[color]) game.doTakeFrom(a.seat, a.target); }
    else if (a.type === 'return') { if (s.phase === 'chips') game.returnChip(a.seat); }
    else if (a.type === 'confirm') { if (s.phase === 'chips' && s.players[a.seat].chips[color]) game.confirmPlayer(a.seat); }
  });

  // 异步等引擎跑
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  game.begin();

  // 模拟客人轮流：等弹窗/快照出现后操作
  for (let tick = 0; tick < 600; tick++) {
    await sleep(20);
    const snap = store.rooms['888888'].public;
    if (!snap) continue;

    // 摊牌结果板：模拟房主点"完成"放行结算（引擎等 resolveBoard）
    if (snap.showdownRows) {
      if (!page._boardDone) {
        page._boardDone = true;
        T('摊牌结果板随公开快照广播（含 ✓/✗ 标记）', snap.showdownRows.every(r => typeof r.ok === 'boolean') && !!snap.boardGate);
        game.resolveBoard();
      }
      continue;
    }
    page._boardDone = false;

    // 底牌已发放确认（第一个全员弹窗）→ 之后每轮每人拿筹码+确认
    if (snap.prompt && snap.prompt.target === 'all') {
      const pid = snap.prompt.pid;
      if (page._lastAutoPid !== pid) {
        page._lastAutoPid = pid;
        // 客人 1 先回应（先到先得）
        const act = snap.prompt.actions && snap.prompt.actions[0];
        await cloudRoom.sendAction('888888', { type: 'prompt', pid, value: act ? act.value : 1, seat: 1 });
      }
      continue;
    }

    // 定向弹窗（私密操作/摊牌亮牌）：目标玩家自动应答（与修复后的客户端一致，回复带 pid）
    if (snap.prompt && typeof snap.prompt.target === 'number' && snap.prompt.actions) {
      const pid = snap.prompt.pid;
      if (page._lastAutoPid !== pid) {
        page._lastAutoPid = pid;
        const act = snap.prompt.actions[0];
        await cloudRoom.sendAction('888888', { type: 'prompt', pid, value: act ? act.value : 1, seat: snap.prompt.target });
      }
      continue;
    }

    if (snap.phase === 'chips') {
      const color = snap.roundColor;
      // 每位玩家拿筹码（模拟牌型预期：0星→座位0拿1星…简化：座位i拿 i+1 星）
      for (let seat = 0; seat < 3; seat++) {
        const p = snap.players[seat];
        if (!p.chips[color]) {
          // 从中央拿自己"预期"的星（若被拿走则拿剩余第一枚）
          const want = seat + 1;
          const star = snap.centerChips.includes(want) ? want : snap.centerChips[0];
          if (star) await cloudRoom.sendAction('888888', { type: 'takeCenter', star, seat });
          await sleep(30);
          break;
        }
      }
      // 全员持筹 → 逐个确认
      const allHave = snap.players.every(p => p.chips[color]);
      if (allHave) {
        const un = snap.players.findIndex((p, i) => !p.confirmed);
        if (un >= 0) { await cloudRoom.sendAction('888888', { type: 'confirm', seat: un }); await sleep(30); }
      }
    }

    // 摊牌阶段由引擎全员弹窗驱动（上面 prompt 分支自动应答），无需额外操作
    if (snap.vaults >= 1 || snap.alarms >= 1) break;
  }

  const snap = store.rooms['888888'].public;
  T('联机模式走完一次劫案并结算', snap && (snap.vaults === 1 || snap.alarms === 1));
  // 公共牌是明牌（communityRaw 允许），其余部分不得含任何原始牌面（s 字段）
  const pubCopy = JSON.parse(JSON.stringify(store.rooms['888888'].public));
  const rawComm = pubCopy.communityRaw; delete pubCopy.communityRaw;
  T('公开快照不含任何底牌牌面', !JSON.stringify(pubCopy).includes('"s"') && (!rawComm || rawComm.length === snap.community.length));
  const hands = Object.entries(store.hands);
  T('私密文档只含本人底牌（每人 2 张）', hands.length === 3 && hands.every(([, h]) => h.hole && h.hole.length === 2));
  T('全员确认机制生效（快照含确认计数）', typeof snap.confirmedCount === 'number');

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('模拟异常:', e); process.exit(1); });
