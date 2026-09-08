'use strict';
/* ================================================================
   无声劫案 · 合作扑克劫案 —— 游戏流程引擎（小程序版）
   逻辑与网页版一致：4 轮筹码分配 + 全员确认 + 摊牌"不弱于"判定
   标准模式 + 进阶模式（10 张挑战牌 + 10 张专家牌）
   UI 通过适配器注入：{ render, modal, pickHoleCard }
   ================================================================ */
const poker = require('./poker.js');
const {
  freshDeck, cardText, score5, lex, best5, handName, partialHandName,
  RANK_TXT, HAND_NAMES,
} = poker;

const ROUND_COLOR = { 1: 'white', 2: 'yellow', 3: 'orange', 4: 'red' };
const ROUND_NAME = { 1: '第1轮 · 翻牌前', 2: '第2轮 · 翻牌', 3: '第3轮 · 转牌', 4: '第4轮 · 河牌' };
const COLOR_TXT = { white: '白色', yellow: '黄色', orange: '橙色', red: '红色' };
const COLOR_ORDER = ['white', 'yellow', 'orange', 'red'];

const CHALLENGES = {
  1: { name: '突击入场', text: '本轮的白色筹码全部收起不用。第一轮只分发底牌，发完直接进入第二轮。' },
  2: { name: '声纹警报', text: '前三轮中，每轮的 1 星筹码以背面锁定。这类筹码一旦被人从桌面中央拿走，就固定在拿取者面前：不能再放回中央，也不能被其他人夺走。' },
  3: { name: '红外感应', text: '若第二轮翻出的公共牌中出现 J、Q 或 K：第一轮拿到 1 星白筹码的人必须把全部底牌暗置入弃牌堆，再从牌堆抽 2 张新底牌。' },
  4: { name: '虹膜验证', text: '轮到拿最大星数红筹码的人亮牌前，其余成员需商量后报出一个点数（2 到 A）。若他的底牌中没有该点数，无论筹码顺序对不对，本次行动立即判定失败。' },
  5: { name: '割玻璃', text: '第三轮停发橙色筹码。翻出第四张公共牌后，直接进入第四轮。' },
  6: { name: '排风管道', text: '前三轮中，每轮星数最大的筹码以背面锁定。这类筹码一旦被人从桌面中央拿走，就固定在拿取者面前：不能再放回中央，也不能被其他人夺走。' },
  7: { name: '激光网格', text: '若第二轮翻出的公共牌中没有 J、Q、K：第一轮拿到最大星白筹码的人必须把全部底牌暗置入弃牌堆，再从牌堆抽 2 张新底牌。' },
  8: { name: '切断电源', text: '第二轮开始时弃掉全员第一轮的筹码；第三轮开始时弃掉第二轮的筹码；第四轮开始时弃掉第三轮的筹码。每一轮都要凭记忆复现之前的筹码格局。' },
  9: { name: '指纹比对', text: '轮到拿最大星数红筹码的人亮牌前，其余成员需商量后报出一个完整牌型（高牌到皇家同花顺）。此人不得参与讨论或暗示。报错则无论筹码顺序对不对，本次行动立即判定失败。' },
  10: { name: '内部监控', text: '每人的底牌由两张增加到三张！摊牌时从三张底牌加五张公共牌共八张里，挑出最强的五张组合（不再是平时的 2+5）。' }
};
const EXPERTS = {
  1: { name: '内应', text: '全员商量后指定一人，把自己的一张底牌偷偷亮给另一位成员看。看到的人不得向任何人转述内容。' },
  2: { name: '接头人', text: '全员商量后指定一人，向众人宣告自己"当前所处的牌型档次"（高牌到皇家同花顺）。除档次外不得透露任何其他信息。' },
  3: { name: '军师点牌', text: '第一轮发完底牌后，每人报出自己底牌中人头牌（J、Q、K）的张数。' },
  4: { name: '幕后老板', text: '全员商量后指定一人，由他自选一个点数，公开自己底牌中该点数的张数。' },
  5: { name: '万能钥匙', text: '全员商量后指定一人从牌堆多摸 1 张加入底牌；随后此人必须暗弃 1 张底牌（允许弃掉刚摸的那张）。' },
  6: { name: '跑腿小子', text: '第一轮发完底牌后，每人暗中挑出 1 张底牌，同时传给自己左手边的成员。' },
  7: { name: '王牌', text: '全员商量后指定一人获得一张"无花色的 J"（它无法参与同花）。随后此人必须暗弃 1 张其他底牌。' },
  8: { name: '神算子', text: '第一轮发完底牌后，每人报出自己底牌的点数总和（2 到 10 按面值，J、Q、K 记 10，A 记 11）。' },
  9: { name: '洗牌鬼手', text: '第一轮发完底牌后，全员把底牌收回桌面中央混洗，再重新分发到每个人手中。' },
  10: { name: '镇场老大', text: '全员商量后指定一人获得"镇场"标记：摊牌时，他的"一对"直接压过其他所有同档次的牌型。' }
};

let ui = null;   // { render, modal, pickHoleCard }
const S = {
  mode: 'standard', n: 3, names: [],
  players: [], deck: [], discard: [], community: [],
  heist: 0, vaults: 0, alarms: 0,
  round: 0, phase: 'idle',
  confirmed: [], confirmHinted: false,
  centerChips: new Set(),
  chalDeck: [], expDeck: [],
  activeChallenge: null, activeExpert: null,
  lastHeistResult: null,
  logArr: [],
};

/* ---------------- UI 适配（由牌桌页注入） ---------------- */
function setUI(adapter) { ui = adapter; }

/* ---------------- 日志 ---------------- */
function log(msg, em) {
  S.logArr.unshift({ msg, em });
  if (S.logArr.length > 300) S.logArr.pop();
}

/* ---------------- 弹窗富文本片段 ---------------- */
function noteBox(s) {
  return `<div style="background:rgba(0,0,0,.3);border-left:6rpx solid #e8c15a;padding:16rpx 24rpx;margin:16rpx 0;font-size:26rpx;line-height:1.8">${s}</div>`;
}
function privWarn(name) {
  return `<div style="background:rgba(214,69,65,.15);border:2rpx solid #d64541;border-radius:12rpx;padding:16rpx;color:#ffd2cd;text-align:center;margin-bottom:16rpx;font-size:28rpx">⚠ 其他玩家请移开视线！${name ? '（' + name + ' 专用）' : ''}</div>`;
}
function cardTxt(c, hl) {
  if (c.s === 4) {
    return `<span style="display:inline-block;margin:4rpx;padding:6rpx 14rpx;border-radius:8rpx;background:#dfe3df;color:#556;font-weight:bold;${hl ? 'border:4rpx solid #e8c15a;' : ''}">J♛</span>`;
  }
  const red = c.s === 1 || c.s === 2;
  return `<span style="display:inline-block;margin:4rpx;padding:6rpx 14rpx;border-radius:8rpx;background:#fdfcf7;color:${red ? '#c8352e' : '#111'};font-weight:bold;${hl ? 'border:4rpx solid #e8c15a;' : ''}">${RANK_TXT[c.r]}${poker.SUITS[c.s]}</span>`;
}
/* 牌面视图 + 金边高亮标记（摊牌用） */
function facesWithHl(cards, bestCards) {
  const keys = new Set((bestCards || []).map(c => c.r + '_' + c.s));
  return cards.map(c => { const f = poker.cardFace(c); f.hl = keys.has(c.r + '_' + c.s); return f; });
}
function cardsHtml(hole, community, bestCards) {
  const isBest = c => bestCards && bestCards.some(b => b === c);
  let h = '<div style="color:#8fb8a3;font-size:22rpx;margin-top:8rpx">底牌：</div>';
  hole.forEach(c => h += cardTxt(c, isBest(c)));
  h += '<div style="color:#8fb8a3;font-size:22rpx;margin-top:8rpx">公共牌：</div>';
  community.forEach(c => h += cardTxt(c, isBest(c)));
  return h;
}
const RULE_DESC = ['五张不组成任何牌型，比最大单张', '两张同数值', '两对，先比大对再比小对', '三张同数值', '五张连续数值（A 可作 1 或最大，不能在中间）', '五张同花色', '三条 + 一对', '四张同数值', '同花 + 顺子', '同花 10-J-Q-K-A'];

/* ---------------- 常用弹窗 ---------------- */
function showRules() {
  let rows = '';
  for (let i = 0; i < 10; i++) {
    rows += `<div style="display:flex;border-bottom:2rpx solid rgba(46,122,88,.4);padding:10rpx 4rpx;font-size:25rpx">
      <div style="width:220rpx;color:#e8c15a;flex:none">${HAND_NAMES[i]}</div>
      <div style="flex:1;color:#cfe8da">${RULE_DESC[i]}</div></div>`;
  }
  return ui.modal({
    title: '📖 规则速查',
    body: `<b style="color:#e8c15a">牌型强弱（从低到高）</b><div style="margin-top:8rpx">${rows}</div>` +
      noteBox('<b style="color:#e8c15a">怎么玩：</b>一局由 3~5 次行动组成，每次行动分四个阶段——发底牌拿白筹码、翻三张公共牌拿黄筹码、再翻一张拿橙筹码、再翻一张拿红筹码。每个阶段人人手里都要有一枚该阶段颜色的筹码，全员确认后才进入下一阶段。<br><b style="color:#e8c15a">星数的含义：</b>它代表你对自己最终牌型强弱的预估——星星越多，等于在告诉同伴"我这张牌很硬"。筹码可以自己从桌面拿、可以从同伴手里夺，也可以把不要的丢回桌面，但同一种颜色每人面前只能放一枚。<br><b style="color:#e8c15a">最后亮牌：</b>按红筹码星星由少到多的顺序依次亮牌，后亮的人牌型不能比前一位弱（一样强也算过）。全程都对 → 金库加一分；只要有一人比前一位弱 → 警报加一分。<br><b style="color:#e8c15a">铁律：</b>不能说话、不能打手势、不能用任何方式暗示自己的牌——筹码就是你唯一的"暗号"！'),
    actions: [{ label: '关闭' }]
  });
}
function showLog() {
  const body = S.logArr.length
    ? S.logArr.map(l => `<div style="font-size:25rpx;line-height:1.9;color:${l.em ? '#e8c15a' : '#cfe8da'};border-bottom:2rpx dashed rgba(255,255,255,.1);padding:6rpx 4rpx">${l.msg}</div>`).join('')
    : '<div style="color:#8fb8a3">暂无日志</div>';
  return ui.modal({ title: '📜 游戏日志', body, actions: [{ label: '关闭' }] });
}
function showRoundInfo() {
  let body = '';
  if (S.activeChallenge) {
    const c = CHALLENGES[S.activeChallenge];
    body += `<div style="background:rgba(127,178,255,.1);border:2rpx dashed #7fb2ff;border-radius:12rpx;padding:12rpx 20rpx;margin-bottom:12rpx;font-size:25rpx;line-height:1.7"><b style="color:#7fb2ff">🃏 挑战牌 · ${c.name}</b><br>${c.text}</div>`;
  }
  if (S.activeExpert) {
    const c = EXPERTS[S.activeExpert];
    body += `<div style="background:rgba(240,160,232,.1);border:2rpx dashed #f0a0e8;border-radius:12rpx;padding:12rpx 20rpx;margin-bottom:12rpx;font-size:25rpx;line-height:1.7"><b style="color:#f0a0e8">👔 专家牌 · ${c.name}</b><br>${c.text}</div>`;
  }
  if (S.phase === 'chips') {
    const color = ROUND_COLOR[S.round];
    const extra = color === 'white' ? '拿到星数越多 = 你自认牌型越强'
      : color === 'red' ? '红色筹码星数决定摊牌顺序（从小到大）！'
      : '延续你的排名预期';
    const haveCnt = S.players.filter(p => p.chips[color]).length;
    const cfCnt = S.confirmed.filter(Boolean).length;
    body += `<div><b style="color:#e8c15a">${ROUND_NAME[S.round]}</b> — ${COLOR_TXT[color]}筹码分配中</div>` +
      `<div style="font-size:25rpx;color:#a9cbbb;margin:10rpx 0">${extra}。每人面前每种颜色至多 1 枚；可拿中央的，也可拿别人面前的，或把自己面前的放回。全部确认后才进入下一轮，筹码变动后需重新确认。</div>` +
      noteBox(`已持筹码：${haveCnt}/${S.n} · 已确认：<b style="color:#e8c15a">${cfCnt}/${S.n}</b>`);
  } else if (S.phase === 'showdown') {
    body += `<div><b style="color:#e8c15a">摊牌</b></div><div style="font-size:25rpx;color:#a9cbbb;margin-top:10rpx">按红色筹码星数从小到大依次亮牌，牌型不得弱于上一位（打平可以）</div>`;
  } else {
    body += `<div><b style="color:#e8c15a">${ROUND_NAME[S.round] || '劫案准备'}</b></div>`;
  }
  if (S.community.length) {
    body += `<div style="margin-top:16rpx;font-size:25rpx;color:#a9cbbb">已翻公共牌（${S.community.length}/5）：${S.community.map(cardText).join('、')}</div>`;
  }
  return ui.modal({ title: '🎯 当前轮次', body, actions: [{ label: '关闭' }] });
}

/* ---------------- 隐私查看底牌 ---------------- */
function peekHtml(i) {
  const p = S.players[i];
  let info;
  if (S.community.length >= 3) {
    const b = best5([...p.hole, ...S.community], p.striker);
    info = `你当前的牌型：<b style="color:#e8c15a">${handName(b.score)}</b>（底牌+公共牌中最强 5 张，仅供参考，禁止告诉别人）`;
  } else {
    info = `你目前的底牌组合：<b style="color:#e8c15a">${partialHandName(p.hole)}</b>（仅供参考，禁止告诉别人）`;
  }
  return privWarn(p.name) + `<div style="margin-top:16rpx;font-size:26rpx;line-height:1.7">${info}</div>`;
}
function peekPlayer(i) {
  const p = S.players[i];
  return ui.modal({
    title: `⚠ ${p.name} 查看底牌`,
    body: peekHtml(i),
    cards: p.hole.map(poker.cardFace),
    player: i,
    actions: [{ label: '看完了，隐藏' }]
  }).then(() => { p.msg = ''; ui.render(); });
}

/* ---------------- 私密选一张底牌 ---------------- */
function pickHoleCard(i, prompt, excludeCard) {
  return ui.pickHoleCard(i, prompt || '选择一张底牌：', excludeCard);
}
/* 私密操作两段式：回避确认 → 操作 */
async function privateStep(i, bodyFn) {
  await ui.modal({
    title: `⚠ 请其他玩家回避 — ${S.players[i].name}`,
    body: privWarn(S.players[i].name),
    player: i,
    actions: [{ label: `我是 ${S.players[i].name}，继续`, value: 1 }]
  });
  await bodyFn();
  ui.render();
}

/* ---------------- 开局 ---------------- */
function newGame(config) {
  S.mode = config.mode;
  S.n = config.n;
  S.names = config.names;
  S.players = config.names.map(n => ({
    name: n, hole: [],
    chips: { white: null, yellow: null, orange: null, red: null },
    striker: false, msg: ''
  }));
  S.heist = 0; S.vaults = 0; S.alarms = 0; S.round = 0; S.phase = 'idle';
  S.chalDeck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  S.expDeck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  S.activeChallenge = null; S.activeExpert = null;
  S.lastHeistResult = null;
  S.logArr = [];
  log('游戏开始！一局共 3~5 次劫案，成功 3 次即胜利。', true);
}
function begin() { startHeist(); }

function drawCardId(deckIds) {
  if (deckIds.length === 0) {
    deckIds.push(...poker.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    log('牌堆已用完一轮，洗混后重新排序。');
  }
  return deckIds.shift();
}

async function startHeist() {
  S.heist++;
  S.deck = freshDeck(); S.discard = [];
  S.community = []; S.round = 0; S.phase = 'idle';
  S.activeChallenge = null; S.activeExpert = null;
  S.players.forEach(p => { p.chips = { white: null, yellow: null, orange: null, red: null }; p.striker = false; p.msg = ''; });
  ui.render();

  if (S.mode === 'advanced' && S.heist >= 2 && S.lastHeistResult !== null) {
    if (S.lastHeistResult) {
      S.activeChallenge = drawCardId(S.chalDeck);
      log(`启用挑战牌：${CHALLENGES[S.activeChallenge].name}`, true);
    } else {
      S.activeExpert = drawCardId(S.expDeck);
      log(`启用专家牌：${EXPERTS[S.activeExpert].name}`, true);
    }
  }

  let introBody = `<div>第 <b style="color:#e8c15a">${S.heist}</b> 次劫案开始！洗混扑克牌，将剩余牌正面朝下放于桌面中央。</div>`;
  if (S.activeChallenge) introBody += noteBox(`🃏 本劫案生效挑战牌：<b style="color:#7fb2ff">${CHALLENGES[S.activeChallenge].name}</b><br>${CHALLENGES[S.activeChallenge].text}`);
  if (S.activeExpert) introBody += noteBox(`👔 本劫案生效专家牌：<b style="color:#f0a0e8">${EXPERTS[S.activeExpert].name}</b><br>${EXPERTS[S.activeExpert].text}`);
  await ui.modal({ title: `💰 第 ${S.heist} 次劫案`, body: introBody, actions: [{ label: '开始' }] });

  const holeN = S.activeChallenge === 10 ? 3 : 2;
  S.players.forEach(p => { p.hole = []; for (let k = 0; k < holeN; k++) p.hole.push(S.deck.pop()); });
  ui.render();

  if (S.activeExpert === 9) {
    const all = [];
    S.players.forEach(p => all.push(...p.hole));
    poker.shuffle(all);
    S.players.forEach(p => { p.hole = all.splice(0, holeN); });
    log('专家牌【洗牌鬼手】：所有底牌已洗混并重新分发。', true);
  }

  await ui.modal({
    title: '底牌已发放',
    body: `每位玩家已获得 ${holeN} 张正面朝下的底牌（点击座位上的 <b style="color:#e8c15a">👁</b> 按钮可以查看，注意让其他玩家回避）。` +
      (S.activeExpert === 9 ? '<br><br>👔 专家牌【洗牌鬼手】已生效：底牌被收拢洗混后重新分发——你这次拿到的可能不是自己的牌！' : ''),
    actions: [{ label: '知道了' }]
  });

  if (S.activeExpert) await runExpertPrePhase();

  if (S.activeChallenge === 1) {
    log('挑战牌【突击入场】：跳过白色筹码轮，直接进入第2轮。', true);
    await ui.modal({ title: '🃏 突击入场', body: '白色筹码放在一边，第1轮只分发底牌，现在直接进入第 2 轮！', actions: [{ label: '进入第2轮' }] });
    startRound(2);
  } else {
    startRound(1);
  }
}

/* ---------------- 专家牌开局引导 ---------------- */
async function pickPlayer(title, except) {
  const opts = S.players.map((p, i) => ({ label: p.name, value: i })).filter(o => o.value !== except);
  const v = await ui.modal({ title, body: '请全体商讨后选择（口头商议，由一人代点）：', actions: opts });
  return v;
}

async function runExpertPrePhase() {
  const e = S.activeExpert;
  if (e === 1) { // 内应
    const shower = await pickPlayer('内应：选择展示底牌的玩家');
    const viewer = await pickPlayer(`内应：${S.players[shower].name} 把底牌展示给谁？`, shower);
    await ui.modal({ title: '👔 内应', body: `${S.players[shower].name} 将向 <b>${S.players[viewer].name}</b> 秘密展示一张底牌。<b>${S.players[viewer].name} 不可公布</b>获得的底牌信息。`, actions: [{ label: '开始秘密展示', value: 1 }] });
    await privateStep(shower, async () => {
      const cardIdx = await pickHoleCard(shower, '选择要秘密展示的一张底牌：');
      await ui.modal({
        title: `🤫 只有 ${S.players[viewer].name} 可以看`,
        body: privWarn(S.players[viewer].name),
        cards: [poker.cardFace(S.players[shower].hole[cardIdx])],
        player: viewer,
        actions: [{ label: '记住并隐藏' }]
      });
    });
    log(`专家牌【内应】：${S.players[shower].name} 向 ${S.players[viewer].name} 秘密展示了一张底牌。`, true);
  }
  else if (e === 2) { // 接头人
    const who = await pickPlayer('接头人：选择公布牌型的玩家');
    const p = S.players[who];
    const name = p.hole.length >= 2 && p.hole[0].r === p.hole[1].r ? '一对' : '高牌';
    await ui.modal({ title: '👔 接头人', body: `<b>${p.name}</b> 公布自己当前的牌型：<br><br><b style="color:#e8c15a;font-size:40rpx">${name}</b><br><br>（不能透露牌型以外的其他信息）`, actions: [{ label: '确定' }] });
    log(`专家牌【接头人】：${p.name} 公布牌型为「${name}」。`, true);
  }
  else if (e === 3) { // 军师点牌
    let html = '<div>每位玩家公布自己底牌中人头牌（J、Q、K）的张数：</div>';
    S.players.forEach(p => {
      const cnt = p.hole.filter(c => c.r >= 11 && c.r <= 13).length;
      html += `<div style="display:flex;justify-content:space-between;border-bottom:2rpx dashed rgba(255,255,255,.15);padding:8rpx 4rpx;font-size:27rpx"><span>${p.name}</span><b style="color:#e8c15a">${cnt} 张人头牌</b></div>`;
    });
    await ui.modal({ title: '👔 军师点牌', body: html, actions: [{ label: '确定' }] });
    log('专家牌【军师点牌】：全员公布了人头牌张数。', true);
  }
  else if (e === 4) { // 幕后老板
    const who = await pickPlayer('幕后老板：选择公布信息的玩家');
    const valTxt = await ui.modal({
      title: '幕后老板：公布哪个数值？',
      body: `选择 <b>${S.players[who].name}</b> 要公布数量的牌面数值：`,
      actions: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(r => ({ label: RANK_TXT[r], value: r }))
    });
    const cnt = S.players[who].hole.filter(c => c.r === valTxt).length;
    await ui.modal({ title: '👔 幕后老板', body: `<b>${S.players[who].name}</b> 公布："我有 <b style="color:#e8c15a">${cnt} 张 ${RANK_TXT[valTxt]}</b>。"`, actions: [{ label: '确定' }] });
    log(`专家牌【幕后老板】：${S.players[who].name} 公布有 ${cnt} 张 ${RANK_TXT[valTxt]}。`, true);
  }
  else if (e === 5) { // 万能钥匙
    const who = await pickPlayer('万能钥匙：选择执行入侵的玩家');
    const card = S.deck.pop();
    S.players[who].hole.push(card);
    log(`专家牌【万能钥匙】：${S.players[who].name} 从牌堆抽了 1 张牌加入底牌。`, true);
    await privateStep(who, async () => {
      const discardIdx = await pickHoleCard(who, `你抽到了：<b>${cardText(card)}</b><br>现在选择一张底牌正面朝下放入弃牌堆（可以选刚抽到的这张）：`);
      const removed = S.players[who].hole.splice(discardIdx, 1)[0];
      S.discard.push(removed);
      await ui.modal({ title: '万能钥匙完成', body: `你已将 <b>${cardText(removed)}</b> 放入弃牌堆。`, player: who, actions: [{ label: '确定' }] });
    });
  }
  else if (e === 6) { // 跑腿小子
    await ui.modal({ title: '👔 跑腿小子', body: '每位玩家将秘密选择自己的一张底牌，传递给左边的玩家。请按座位顺序依次操作。', actions: [{ label: '开始', value: 1 }] });
    const picks = [];
    for (let i = 0; i < S.n; i++) {
      await privateStep(i, async () => {
        picks[i] = await pickHoleCard(i, '选择你要传给左边玩家的一张底牌：');
      });
    }
    const kept = S.players.map(p => p.hole.slice());
    for (let i = 0; i < S.n; i++) {
      const to = (i + 1) % S.n;
      const card = kept[i][picks[i]];
      const newHole = kept[i].filter((_, k) => k !== picks[i]);
      newHole.push(card);
      S.players[to].hole = newHole;
    }
    await ui.modal({ title: '👔 跑腿小子', body: '所有底牌已同时传递给左边的玩家！请各位重新查看自己的新底牌。', actions: [{ label: '确定' }] });
    log('专家牌【跑腿小子】：每人都把一张底牌传给了左边的玩家。', true);
  }
  else if (e === 7) { // 王牌
    const who = await pickPlayer('王牌：选择获得"王牌J"的玩家');
    const knight = { r: 11, s: 4 };
    S.players[who].hole.push(knight);
    log(`专家牌【王牌】：${S.players[who].name} 获得了无花色的王牌J，并须弃掉一张其他底牌。`, true);
    await privateStep(who, async () => {
      const idx = await pickHoleCard(who, '你获得了 <b>王牌J（无花色，不能组同花）</b>。现在选择一张"王牌"以外的底牌正面朝下放入弃牌堆：', knight);
      const removed = S.players[who].hole.splice(idx, 1)[0];
      S.discard.push(removed);
      await ui.modal({
        title: '王牌完成',
        body: `你已将 <b>${cardText(removed)}</b> 放入弃牌堆，你的底牌如下：`,
        cards: S.players[who].hole.map(poker.cardFace),
        player: who,
        actions: [{ label: '确定' }]
      });
    });
  }
  else if (e === 8) { // 神算子
    let html = '<div>每位玩家公布自己底牌数值之和（J/Q/K=10，A=11）：</div>';
    S.players.forEach(p => {
      const sum = p.hole.reduce((t, c) => t + (c.r === 14 ? 11 : Math.min(c.r, 10)), 0);
      html += `<div style="display:flex;justify-content:space-between;border-bottom:2rpx dashed rgba(255,255,255,.15);padding:8rpx 4rpx;font-size:27rpx"><span>${p.name}</span><b style="color:#e8c15a">底牌之和 = ${sum}</b></div>`;
    });
    await ui.modal({ title: '👔 神算子', body: html, actions: [{ label: '确定' }] });
    log('专家牌【神算子】：全员公布了底牌数值之和。', true);
  }
  // e === 9 洗牌鬼手已在发牌时处理
  else if (e === 10) {
    const who = await pickPlayer('镇场老大：选择获得"镇场老大"标记的玩家');
    S.players[who].striker = true;
    await ui.modal({ title: '👊 镇场老大', body: `<b>${S.players[who].name}</b> 获得镇场老大标记：摊牌时，他的"一对"将击败所有同类别（一对）的其他牌型。`, actions: [{ label: '确定' }] });
    log(`专家牌【镇场老大】：${S.players[who].name} 获得镇场老大标记。`, true);
  }
  ui.render();
}

/* ---------------- 轮次流程 ---------------- */
async function startRound(n) {
  S.round = n;
  const prevColor = ROUND_COLOR[n - 1];
  if (S.activeChallenge === 8 && n >= 2) {
    S.players.forEach(p => p.chips[prevColor] = null);
    log(`挑战牌【切断电源】：第 ${n} 轮开始，所有${COLOR_TXT[prevColor]}筹码被弃置！（须凭记忆）`, true);
  }
  const flips = n === 2 ? 3 : (n === 3 || n === 4) ? 1 : 0;
  for (let k = 0; k < flips; k++) S.community.push(S.deck.pop());
  ui.render();

  if (flips > 0) {
    const cardsTxt = S.community.slice(-flips).map(cardText).join('、');
    await ui.modal({
      title: `${ROUND_NAME[n]} — 翻开公共牌`,
      body: (flips === 3 ? '任意一位玩家从牌堆抽 3 张正面朝上放于桌面中央：<br>' : '翻开 1 张公共牌：<br>') +
        `<div style="margin-top:12rpx">${S.community.slice(-flips).map(c => cardTxt(c)).join('')}</div>`,
      actions: [{ label: '继续' }]
    });
    log(`第${n}轮翻公共牌：${cardsTxt}`, true);
  }

  if (n === 2 && (S.activeChallenge === 3 || S.activeChallenge === 7)) {
    const hasFace = S.community.slice(0, 3).some(c => c.r >= 11 && c.r <= 13);
    if (S.activeChallenge === 3 && hasFace) {
      const i = findChipHolder('white', 1);
      if (i >= 0) await forceRedraw(i, '红外感应', '第2轮公共牌中出现了 J/Q/K！');
    } else if (S.activeChallenge === 7 && !hasFace) {
      const maxStar = S.players.reduce((m, p) => Math.max(m, p.chips.white ? p.chips.white.star : 0), 0);
      const i = findChipHolder('white', maxStar);
      if (i >= 0) await forceRedraw(i, '激光网格', '第2轮公共牌中没有任何 J/Q/K！');
    }
  }

  if (n === 3 && S.activeChallenge === 5) {
    log('挑战牌【割玻璃】：第3轮不分配橙色筹码，直接进入第4轮。', true);
    await ui.modal({ title: '🃏 割玻璃', body: '第3轮不分配橙色筹码！已翻开第4张公共牌，直接进入第4轮。', actions: [{ label: '进入第4轮' }] });
    startRound(4);
    return;
  }

  const color = ROUND_COLOR[n];
  S.centerChips = new Set();
  for (let s = 1; s <= S.n; s++) S.centerChips.add(s);
  S.phase = 'chips';
  S.confirmed = S.players.map(() => false);
  S.confirmHinted = false;
  ui.render();
  log(`第${n}轮：展开所有${COLOR_TXT[color]}筹码，自由拿取。所有人拿定后需各自确认才进入下一轮。`, true);
}

function findChipHolder(color, star) {
  return S.players.findIndex(p => p.chips[color] && p.chips[color].star === star);
}
async function forceRedraw(i, challName, reason) {
  const p = S.players[i];
  await ui.modal({
    title: `🚨 挑战牌【${challName}】触发！`,
    body: `<b>${p.name}</b> 触发条件：${reason}<br>他的底牌必须正面朝下放入弃牌堆，并从牌堆抽取 2 张新底牌。`,
    actions: [{ label: '执行换牌', value: 1 }]
  });
  S.discard.push(...p.hole);
  p.hole = [S.deck.pop(), S.deck.pop()];
  log(`【${challName}】${p.name} 的底牌被替换为新的 2 张。`, true);
  await privateStep(i, async () => {
    await ui.modal({
      title: `🤫 ${p.name} 的新底牌`,
      body: privWarn(p.name),
      cards: p.hole.map(poker.cardFace),
      player: i,
      actions: [{ label: '记住了' }]
    });
  });
}

/* ---------------- 筹码操作 ---------------- */
function isDarkChip(round, star) {
  if (S.activeChallenge === 2) return round <= 3 && star === 1;
  if (S.activeChallenge === 6) return round <= 3 && star === S.n;
  return false;
}
function takeCenter(star) {
  if (S.phase !== 'chips' || !S.centerChips.has(star)) return;
  const candidates = S.players.map((p, i) => ({ p, i })).filter(x => !x.p.chips[ROUND_COLOR[S.round]]);
  if (candidates.length === 0) return;
  if (candidates.length === 1) { doTakeCenter(candidates[0].i, star); return; }
  const opts = [...candidates.map(x => ({ label: x.p.name + ' 拿', value: x.i })), { label: '取消', value: null, cls: 'ghost' }];
  ui.modal({ title: `谁拿取 ${star} 星筹码？`, body: '请拿取的玩家确认：', actions: opts })
    .then(i => { if (i != null) doTakeCenter(i, star); });
}
function doTakeCenter(i, star) {
  const color = ROUND_COLOR[S.round];
  S.centerChips.delete(star);
  S.players[i].chips[color] = { star, dark: isDarkChip(S.round, star) };
  log(`${S.players[i].name} 拿走了中央的 ${star} 星${COLOR_TXT[color]}筹码${S.players[i].chips[color].dark ? '（深色面！不可放回、不可被拿）' : ''}。`);
  S.players[i].msg = '';
  S.confirmed[i] = false;
  ui.render();
  afterMove();
}
function takeFromPlayer(targetIdx) {
  if (S.phase !== 'chips') return;
  const color = ROUND_COLOR[S.round];
  const target = S.players[targetIdx];
  if (!target.chips[color] || target.chips[color].dark) return;
  const takers = S.players.map((p, i) => ({ p, i })).filter(x => !x.p.chips[color] && x.i !== targetIdx);
  if (takers.length === 0) return;
  if (takers.length === 1) { doTakeFrom(takers[0].i, targetIdx); return; }
  const opts = [...takers.map(x => ({ label: x.p.name + ' 拿走', value: x.i })), { label: '取消', value: null, cls: 'ghost' }];
  ui.modal({ title: `谁拿走 ${target.name} 面前的筹码？`, body: '请拿取的玩家确认：', actions: opts })
    .then(i => { if (i != null) doTakeFrom(i, targetIdx); });
}
function doTakeFrom(i, targetIdx) {
  const color = ROUND_COLOR[S.round];
  S.players[i].chips[color] = S.players[targetIdx].chips[color];
  S.players[targetIdx].chips[color] = null;
  log(`${S.players[i].name} 从 ${S.players[targetIdx].name} 面前拿走了 ${S.players[i].chips[color].star} 星${COLOR_TXT[color]}筹码！`);
  S.confirmed[i] = false; S.confirmed[targetIdx] = false;
  ui.render();
  afterMove();
}
function returnChip(i) {
  const color = ROUND_COLOR[S.round];
  const chip = S.players[i].chips[color];
  if (!chip || chip.dark) return;
  S.centerChips.add(chip.star);
  S.players[i].chips[color] = null;
  log(`${S.players[i].name} 把面前的 ${chip.star} 星${COLOR_TXT[color]}筹码放回了桌面中央。`);
  S.confirmed[i] = false;
  ui.render();
}
function confirmPlayer(i) {
  const color = ROUND_COLOR[S.round];
  if (S.phase !== 'chips' || !S.players[i].chips[color]) return;
  S.confirmed[i] = !S.confirmed[i];
  log(`${S.players[i].name} ${S.confirmed[i] ? '确认了' : '取消确认'}自己的 ${S.players[i].chips[color].star} 星${COLOR_TXT[color]}筹码。`);
  ui.render();
  afterMove();
}
function afterMove() {
  const color = ROUND_COLOR[S.round];
  if (S.phase !== 'chips') return;
  const allHave = S.players.every(p => p.chips[color]);
  const allConfirmed = S.confirmed.every(Boolean);
  if (allHave && allConfirmed) { roundEnd(); return; }
  if (allHave && !allConfirmed && !S.confirmHinted) {
    S.confirmHinted = true;
    log('所有玩家都已持有筹码：请各自点击"确认"锁定。确认前仍可自由更换筹码（变动后需重新确认）。', true);
  }
}
function roundEnd() {
  S.phase = 'idle'; ui.render();
  log(`第${S.round}轮结束：所有玩家确认了各自的${COLOR_TXT[ROUND_COLOR[S.round]]}筹码。`, true);
  if (S.round < 4) {
    ui.modal({
      title: `第${S.round}轮结束`,
      body: `所有玩家都确认了${COLOR_TXT[ROUND_COLOR[S.round]]}筹码。<br>之前轮次的筹码请整齐排在自己面前——注意观察每个人每一轮的预期变化！`,
      actions: [{ label: '进入下一轮' }]
    }).then(() => startRound(S.round + 1));
  } else {
    ui.modal({
      title: '第4轮结束',
      body: '所有玩家都确认了红色筹码。<br><b style="color:#e8c15a">第4轮之后，进行摊牌！</b>',
      actions: [{ label: '开始摊牌' }]
    }).then(showdown);
  }
}

/* ---------------- 摊牌 ---------------- */
function cmpReveal(prev, cur) {
  const c1 = prev.score[0], c2 = cur.score[0];
  if (c1 === c2) {
    if (cur.striker && !prev.striker) return 1;
    if (prev.striker && !cur.striker) return -1;
  }
  return lex(cur.score, prev.score);
}
async function showdown() {
  S.phase = 'showdown'; ui.render();
  const order = S.players.map((p, i) => ({ p, i })).sort((a, b) => a.p.chips.red.star - b.p.chips.red.star);
  log(`摊牌顺序（红筹码升序）：${order.map(o => `${o.p.name}(${o.p.chips.red.star}星)`).join(' → ')}`, true);
  await ui.modal({
    title: '🃏 摊牌 — 公布真相',
    body: `按红色筹码星数<b>从小到大</b>依次展示：<br>${order.map(o => `${o.p.chips.red.star}星 → ${o.p.name}`).join('<br>')}<br><br>每位玩家展示底牌并公布自己能凑成的<b>最强五张</b>牌型。每张翻开的牌不得弱于上一位（完全打平可以）！`,
    actions: [{ label: '开始摊牌' }]
  });

  const maxRedStar = order[order.length - 1].p.chips.red.star;
  let prev = null;
  for (const o of order) {
    const p = o.p, i = o.i;
    const isMaxRed = p.chips.red.star === maxRedStar;

    if (isMaxRed && S.activeChallenge === 4) {
      const guess = await ui.modal({
        title: '🚨 虹膜验证',
        body: `在 <b>${p.name}</b> 展示手牌之前，其余玩家共同商讨并猜测他的一张底牌数值（他不能参与、不能提示）：`,
        actions: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(r => ({ label: RANK_TXT[r], value: r }))
      });
      const hit = p.hole.some(c => c.r === guess);
      if (!hit) {
        log(`虹膜验证失败：其余玩家猜 ${RANK_TXT[guess]}，${p.name} 的底牌中没有！`, true);
        return heistEnd(false, `虹膜验证失败——其余玩家猜测的数值（${RANK_TXT[guess]}）不在 ${p.name} 的底牌中。无论筹码排序是否正确，本次劫案视为失败！`);
      }
      log(`虹膜验证通过：${p.name} 的底牌中确有 ${RANK_TXT[guess]}。`, true);
      await ui.modal({ title: '✅ 虹膜验证通过', body: `${p.name} 的底牌中确实有一张 <b>${RANK_TXT[guess]}</b>！继续摊牌。`, actions: [{ label: '继续' }] });
    }
    if (isMaxRed && S.activeChallenge === 9) {
      const guess = await ui.modal({
        title: '🚨 指纹比对',
        body: `在 <b>${p.name}</b> 展示手牌之前，其余玩家共同商讨并猜测他的<b>牌型</b>（他不能参与、不能提示）：`,
        actions: HAND_NAMES.map((h, k) => ({ label: h, value: k }))
      });
      const b = best5([...p.hole, ...S.community], p.striker);
      const real = b.score[0];
      if (guess !== real) {
        log(`指纹比对失败：其余玩家猜「${HAND_NAMES[guess]}」，实际是「${HAND_NAMES[real]}」。`, true);
        return heistEnd(false, `指纹比对失败——其余玩家猜测的牌型是「${HAND_NAMES[guess]}」，但实际是「<b>${HAND_NAMES[real]}</b>」。本次劫案视为失败！`);
      }
      log(`指纹比对通过：牌型确实是「${HAND_NAMES[real]}」。`, true);
      await ui.modal({ title: '✅ 指纹比对通过', body: `猜测正确！${p.name} 的牌型确实是 <b>${HAND_NAMES[real]}</b>。继续摊牌。`, actions: [{ label: '继续' }] });
    }

    await ui.modal({
      title: `轮到 ${p.name} 摊牌`,
      body: privWarn('') + `请 ${p.name} 准备亮牌，其他玩家围观！`,
      actions: [{ label: '亮牌！', value: 1 }]
    });
    const all = [...p.hole, ...S.community];
    const b = best5(all, p.striker);
    let cmpHtml = '';
    if (prev) {
      const c = cmpReveal(prev, b);
      if (c >= 0) {
        cmpHtml = `<div style="margin-top:12rpx"><span style="font-size:26rpx;padding:6rpx 20rpx;border-radius:10rpx;background:rgba(61,155,109,.3);color:#8fe6b4;border:2rpx solid #57c48f;font-weight:bold">✔ 不弱于上一位（${handName(prev.score)}）</span></div>`;
      } else {
        await ui.modal({
          title: '💥 摊牌错误！',
          body: `<b>${p.name}</b> 的牌型（<b>${handName(b.score)}</b>）弱于上一位（<b>${handName(prev.score)}</b>）——筹码分配顺序出现错误！<div style="margin-top:10rpx">一张警报牌翻至红色面，本次劫案失败。</div>`,
          reveal: {
            holeFaces: facesWithHl(p.hole, b.cards),
            communityFaces: facesWithHl(S.community, b.cards),
          },
          actions: [{ label: '唉…接受失败' }]
        });
        log(`${p.name} 的牌型 ${handName(b.score)} 弱于上一位的 ${handName(prev.score)}，劫案失败！`, true);
        return heistEnd(false, `<b>${p.name}</b> 展示的牌型「${handName(b.score)}」弱于上一位的「${handName(prev.score)}」。你们没有正确安排分工，一张警报牌翻至红色面！`);
      }
    }
    const firstTag = !prev ? '<div style="margin-top:12rpx"><span style="font-size:26rpx;padding:6rpx 20rpx;border-radius:10rpx;background:rgba(61,155,109,.3);color:#8fe6b4;border:2rpx solid #57c48f;font-weight:bold">✔ 第一位展示，无比较对象</span></div>' : '';
    await ui.modal({
      title: `${p.name} 的牌型`,
      body: `<div style="font-size:30rpx;margin-top:8rpx">最强五张牌型：<b style="color:#e8c15a">${handName(b.score)}</b>${p.striker ? ' <span style="font-size:24rpx;color:#ffb3ae">👊 镇场老大</span>' : ''}</div>` +
        `<div style="font-size:23rpx;color:#8fb8a3;margin-top:4rpx">（金色描边的牌为参与比较的牌型组成）</div>${cmpHtml}${firstTag}`,
      reveal: {
        holeFaces: facesWithHl(p.hole, b.cards),
        communityFaces: facesWithHl(S.community, b.cards),
      },
      actions: [{ label: '下一位' }]
    });
    log(`${p.name} 展示：${handName(b.score)}${prev ? `（对比 ${handName(prev.score)}：${cmpReveal(prev, b) >= 0 ? '通过' : '失败'}）` : ''}`);
    prev = { ...b, name: p.name };
  }
  heistEnd(true);
}

/* ---------------- 劫案结算 ---------------- */
async function heistEnd(success, failReason) {
  S.phase = 'idle';
  S.lastHeistResult = success;
  if (success) {
    S.vaults++;
    log(`第 ${S.heist} 次劫案成功！金库牌翻至金色面（${S.vaults}/3）。`, true);
  } else {
    S.alarms++;
    log(`第 ${S.heist} 次劫案失败！警报牌翻至红色面（${S.alarms}/3）。`, true);
  }
  ui.render();
  if (S.activeChallenge) { S.chalDeck.push(S.activeChallenge); S.activeChallenge = null; }
  if (S.activeExpert) { S.expDeck.push(S.activeExpert); S.activeExpert = null; }

  if (S.vaults >= 3 || S.alarms >= 3) {
    const win = S.vaults >= 3;
    await ui.modal({
      title: win ? '🏆 游戏胜利！' : '🚨 游戏失败…',
      body: win
        ? `你们成功将 <b>3 张金库牌</b>翻至金色面！经过 ${S.heist} 次劫案，全员满载而归。<br><br>你们做到了完美的无言配合！`
        : `你们被迫将 <b>3 张警报牌</b>翻至红色面。警察包围了现场，这次帮派行动彻底失败…<br><br>再来一局，这次的教训是：时刻关注每一轮筹码的流转！`,
      actions: [{ label: '重新开始', cls: 'warn' }]
    });
    if (ui.onGameOver) ui.onGameOver();
    return 'GAME_OVER';
  }

  await ui.modal({
    title: success ? '✅ 劫案成功！' : '❌ 劫案失败',
    body: `${failReason || ''}${noteBox(
      (success ? '你们每次翻开的牌都不弱于上一次——完美配合！将一张<b>金库牌</b>翻至金色面。' : '一张<b>警报牌</b>翻至红色面。摊牌后当次劫案结束。') +
      `<br>当前进度：金库 <b>${S.vaults}/3</b> · 警报 <b>${S.alarms}/3</b>` +
      (S.mode === 'advanced' ? `<br>${success ? '下一次劫案将启用一张新的<b>挑战牌</b>提升难度。' : '下一次劫案将启用一张<b>专家牌</b>降低难度。'}` : '')
    )}从第 1 轮开始下一次劫案。`,
    actions: [{ label: success ? '下次劫案（更具挑战）' : '重整旗鼓，下次劫案' }]
  });
  startHeist();
}

/* ---------------- 页面快照 ---------------- */
function getSnapshot() {
  return {
    mode: S.mode,
    n: S.n,
    heist: S.heist,
    vaults: S.vaults,
    alarms: S.alarms,
    round: S.round,
    phase: S.phase,
    community: S.community.map(poker.cardFace),
    deckCount: S.deck.length,
    discardCount: S.discard.length,
    centerChips: [...S.centerChips].sort((a, b) => a - b),
    roundColor: ROUND_COLOR[S.round] || 'white',
    roundName: ROUND_NAME[S.round] || '劫案准备',
    confirmedCount: S.confirmed.filter(Boolean).length,
    activeChallenge: S.activeChallenge ? CHALLENGES[S.activeChallenge].name : null,
    activeExpert: S.activeExpert ? EXPERTS[S.activeExpert].name : null,
    players: S.players.map((p, i) => ({
      name: p.name,
      holeCount: p.hole.length,
      striker: p.striker,
      msg: p.msg || '',
      chips: {
        white: p.chips.white, yellow: p.chips.yellow,
        orange: p.chips.orange, red: p.chips.red,
      },
      confirmed: S.phase === 'chips' ? !!S.confirmed[i] : false,
      hasCurrent: S.phase === 'chips' ? !!p.chips[ROUND_COLOR[S.round]] : false,
    })),
  };
}

module.exports = {
  setUI, newGame, begin, getSnapshot,
  takeCenter, takeFromPlayer, returnChip, confirmPlayer,
  doTakeCenter, doTakeFrom,
  peekPlayer, showRules, showLog, showRoundInfo,
  ROUND_COLOR, ROUND_NAME, COLOR_TXT, CHALLENGES, EXPERTS,
  get state() { return S; },
};
