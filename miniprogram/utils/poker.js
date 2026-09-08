'use strict';
/* ================= 牌与牌型引擎（移植自网页版，逻辑一致） ================= */

const SUITS = ['♣', '♦', '♥', '♠'];            // 0..3
const RED_SUITS = [1, 2];                        // ♦ ♥
const RANK_TXT = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺', '皇家同花顺'];

function freshDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
  return shuffle(d);
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function cardText(c) {
  if (c.s === 4) return '王牌J（无花色）';
  return RANK_TXT[c.r] + SUITS[c.s];
}
/* WXML 牌面视图模型 */
function cardFace(c) {
  if (c.s === 4) return { label: 'J', suit: '♛', red: false, knight: true };
  return { label: RANK_TXT[c.r], suit: SUITS[c.s], red: RED_SUITS.includes(c.s), knight: false };
}
/* rich-text 牌面片段（弹窗内使用） */
function cardSpan(c, hl) {
  if (c.s === 4) {
    return `<span style="display:inline-block;margin:4rpx;padding:6rpx 14rpx;border-radius:8rpx;background:#dfe3df;color:#556;font-weight:bold;${hl ? 'border:4rpx solid #e8c15a;' : ''}">J♛</span>`;
  }
  const red = c.s === 1 || c.s === 2;
  return `<span style="display:inline-block;margin:4rpx;padding:6rpx 14rpx;border-radius:8rpx;background:#fdfcf7;color:${red ? '#c8352e' : '#111'};font-weight:bold;${hl ? 'border:4rpx solid #e8c15a;' : ''}">${RANK_TXT[c.r]}${SUITS[c.s]}</span>`;
}

/* 5 张牌打分：返回 [类别, 决胜张...] 可按字典序比较 */
function score5(c) {
  const rs = c.map(x => x.r).sort((a, b) => b - a);
  const isFlush = c.every(x => x.s === c[0].s) && c[0].s !== 4;   // 王牌J无花色
  const uniq = [...new Set(rs)];
  let sHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) sHigh = uniq[0];                  // 普通顺子
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) sHigh = 5; // A-2-3-4-5
  }
  const cnt = {};
  for (const r of rs) cnt[r] = (cnt[r] || 0) + 1;
  const gs = Object.keys(cnt).map(r => ({ r: +r, n: cnt[r] })).sort((a, b) => b.n - a.n || b.r - a.r);
  if (isFlush && sHigh) return [8, sHigh];
  if (isFlush) return [5, ...rs];
  if (sHigh) return [4, sHigh];
  if (gs[0].n >= 4) return [7, gs[0].r, gs[1] ? gs[1].r : 0];      // 5张同点（王牌J+四条）按四条计
  if (gs[0].n === 3 && gs[1].n === 2) return [6, gs[0].r, gs[1].r];
  if (gs[0].n === 3) return [3, gs[0].r, gs[1].r, gs[2].r];
  if (gs[0].n === 2 && gs[1].n === 2) return [2, gs[0].r, gs[1].r, gs[2].r];
  if (gs[0].n === 2) return [1, gs[0].r, gs[1].r, gs[2].r, gs[3].r];
  return [0, ...rs];
}
function lex(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}
function combo5(n) {
  const out = [];
  (function rec(st, cur) {
    if (cur.length === 5) { out.push(cur.slice()); return; }
    for (let i = st; i < n; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); }
  })(0, []);
  return out;
}
/* 从任意张里选最强 5 张（镇场老大：一对 → 最强一对 A） */
function best5(cards, striker) {
  if (cards.length < 5) return null;
  let best = null, bestScore = null;
  for (const cb of combo5(cards.length)) {
    const hand = cb.map(i => cards[i]);
    const s = score5(hand);
    if (!bestScore || lex(s, bestScore) > 0) { bestScore = s; best = hand; }
  }
  if (striker && bestScore[0] === 1) {
    const ranks = [...new Set(cards.map(c => c.r))].sort((a, b) => b - a);
    const kick = [14, ...ranks.filter(r => r !== 14).slice(0, 3)];
    bestScore = [1, ...kick];
  }
  return { cards: best, score: bestScore };
}
function handName(score) {
  return score[0] === 8 && score[1] === 14 ? '皇家同花顺' : HAND_NAMES[score[0]];
}
/* 翻牌前（只有底牌时）的粗略牌型名 */
function partialHandName(hole) {
  for (let a = 0; a < hole.length; a++)
    for (let b = a + 1; b < hole.length; b++)
      if (hole[a].r === hole[b].r) return '一对 ' + RANK_TXT[hole[a].r];
  const hi = Math.max(...hole.map(c => c.r));
  return '高牌 ' + RANK_TXT[hi];
}

module.exports = {
  SUITS, RED_SUITS, RANK_TXT, HAND_NAMES,
  freshDeck, shuffle, cardText, cardFace, cardSpan,
  score5, lex, best5, handName, partialHandName,
};
