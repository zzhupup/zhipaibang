/* 回归：单局人数上限 6 → 8
   1) 常量与文案：云层上限 8/下限 3，全项目不再残留"3~6 人""最多 6 人"硬编码
   2) 筹码星位：STAR_POS 必须覆盖 1~8（星数 = 座位数，缺 7/8 会退化成 1 星样式）
   3) 引擎冒烟：8 人开局能正常发牌（52-16=36 张余牌）且中央筹码为 1~8 星
   4) 首页人数选项由常量推导（3~8 共 6 个） */
'use strict';

const fs = require('fs');
const path = require('path');
const MP = path.join(__dirname, 'zhipaibang-miniprogram');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 1) 常量与文案 ---------- */
console.log('人数常量与文案一致性：');
global.wx = { cloud: { init() {}, database: () => ({ collection: () => ({}), serverDate: () => new Date(), command: {} }), callFunction: () => Promise.resolve({ result: {} }) }, getStorageSync: () => '' };
const cloudRoom = require(MP + '/utils/cloudRoom.js');
ok(cloudRoom.MAX_PLAYERS === 8, 'MAX_PLAYERS = 8');
ok(cloudRoom.MIN_PLAYERS === 3, 'MIN_PLAYERS = 3');

const filesToScan = [
  'utils/cloudRoom.js', 'pages/home/home.js', 'pages/home/home.wxml', 'pages/home/home.wxss',
  'pages/room/room.js', 'pages/room/room.wxml', 'pages/table/table.js', 'pages/table/table.wxml',
  'pages/table/table.wxss', 'README.md',
];
let stale = [];
filesToScan.forEach(f => {
  const p = MP + '/' + f;
  if (!fs.existsSync(p)) return;
  const t = fs.readFileSync(p, 'utf8');
  if (/3~6 人|最多 6 人|max: 6\b|>= 6\b|\[3,4,5,6\]/.test(t)) stale.push(f);
});
ok(stale.length === 0, '无"6 人"残留硬编码，实际：' + (stale.join(', ') || '无'));

const roomWxml = fs.readFileSync(MP + '/pages/room/room.wxml', 'utf8');
ok(/maxPlayers/.test(roomWxml) && /minPlayers/.test(roomWxml), '房间页人数显示/开局校验使用常量');
const homeWxml = fs.readFileSync(MP + '/pages/home/home.wxml', 'utf8');
ok(/wx:for="\{\{counts\}\}"/.test(homeWxml), '首页人数选项由 counts 常量生成');

/* ---------- 2) 筹码星位 1~8 ---------- */
console.log('筹码星位（1~8 星）：');
const tableJs = fs.readFileSync(MP + '/pages/table/table.js', 'utf8');
const m = tableJs.match(/const STAR_POS = \{[\s\S]*?\n\};/);
ok(!!m, '能在 table.js 中定位 STAR_POS');
let STAR_POS = {};
if (m) {
  // eslint-disable-next-line no-eval
  STAR_POS = eval('(' + m[0].replace('const STAR_POS = ', '').replace(/;\s*$/, '') + ')');
}
let missing = [], badCount = [], outOfRange = [];
for (let k = 1; k <= 8; k++) {
  const pts = STAR_POS[k];
  if (!pts) { missing.push(k); continue; }
  if (pts.length !== k) badCount.push(k + '→' + pts.length);
  pts.forEach(p => { if (p.x < 5 || p.x > 95 || p.y < 5 || p.y > 95) outOfRange.push(k); });
}
ok(missing.length === 0, '1~8 星阵型齐全，缺失：' + (missing.join(',') || '无'));
ok(badCount.length === 0, '每档星点数=星数，异常：' + (badCount.join(',') || '无'));
ok(outOfRange.length === 0, '星点坐标都在筹码内（5%~95%），异常：' + (outOfRange.join(',') || '无'));

/* ---------- 2.5) 牌桌 8 座位布局 ---------- */
console.log('圆桌座位布局（3~8 人）：');
const geo = tableJs.match(/const CX = (\d+), CY = (\d+), RX = (\d+), RY = (\d+);/);
ok(!!geo, '能定位圆桌椭圆参数');
const CX = +geo[1], CY = +geo[2], RX = +geo[3], RY = +geo[4];
const STAGE_W = 980, STAGE_H = 720;      // 舞台尺寸（CX*2 / CY*2）
const HALF_W = 95, HALF_H = 65;          // .seat 宽 190px，高按设计留白 ~130px
const seatXY = n => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = (Math.PI / 2) + (i * 2 * Math.PI / n);
    out.push([CX + RX * Math.cos(ang), CY + RY * Math.sin(ang)]);
  }
  return out;
};
let outBounds = [], overlaps = [];
for (let n = 3; n <= 8; n++) {
  const pts = seatXY(n);
  pts.forEach(([x, y], i) => {
    if (x - HALF_W < -2 || x + HALF_W > STAGE_W + 2 || y - HALF_H < -2 || y + HALF_H > STAGE_H + 2) {
      outBounds.push(n + '人#' + i + '(' + x.toFixed(0) + ',' + y.toFixed(0) + ')');
    }
  });
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.abs(pts[i][0] - pts[j][0]), dy = Math.abs(pts[i][1] - pts[j][1]);
      if (dx < HALF_W * 2 && dy < HALF_H * 2) overlaps.push(n + '人#' + i + '×#' + j);
    }
  }
}
ok(outBounds.length === 0, '3~8 人座位都在舞台内，出界：' + (outBounds.join(', ') || '无'));
ok(overlaps.length === 0, '3~8 人座位互不重叠，冲突：' + (overlaps.join(', ') || '无'));
ok(STAGE_W / 2 === CX && STAGE_H / 2 === CY, '椭圆中心与舞台中心一致');

/* ---------- 3) 引擎 8 人开局 ---------- */
(async () => {
  console.log('引擎 8 人开局冒烟：');
  const game = require(MP + '/utils/game.js');
  game.setUI({
    render: () => {},
    modal: o => Promise.resolve(o && o.actions && o.actions[0] ? o.actions[0].value : undefined),
    pickHoleCard: () => Promise.resolve(0),
  });
  const names = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
  game.newGame({ mode: 'standard', n: 8, names });
  const s0 = game.state;
  ok(s0.players.length === 8, '引擎接受 8 名玩家，实际 ' + s0.players.length);
  ok(s0.n === 8, 'S.n = 8');

  game.begin();
  await sleep(300);
  const s = game.state;
  const holeTotal = s.players.reduce((t, p) => t + p.hole.length, 0);
  ok(holeTotal === 16, '8 人共发 16 张底牌（每人 2 张），实际 ' + holeTotal);
  ok(s.deck.length === 36, '余牌 52-16=36 张，实际 ' + s.deck.length);
  const stars = [...s.centerChips].sort((a, b) => a - b);
  ok(JSON.stringify(stars) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]),
    '中央筹码为 1~8 星，实际 ' + JSON.stringify(stars));
  ok(stars.every(x => STAR_POS[x]), '每枚筹码都有对应星位阵型（7/8 星不退化）');

  const snap = game.getSnapshot();
  ok(snap.players.length === 8, '快照含 8 名玩家');
  ok((snap.centerChips || []).length === 8, '快照中央筹码 8 枚');

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
