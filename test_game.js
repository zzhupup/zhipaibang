const fs = require('fs');
const html = fs.readFileSync(__dirname + '/纸牌帮/index.html', 'utf8');
const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const code = m.map(x => x[1]).join('\n');
try { new Function(code); console.log('JS 语法检查通过，脚本长度', code.length); }
catch (e) { console.log('语法错误:', e.message); process.exit(1); }

// 提取牌型函数做单元测试
const score5fn = code.match(/function score5[\s\S]*?\n}/)[0];
const lexfn = code.match(/function lex[\s\S]*?\n}/)[0];
const combo5fn = code.match(/function combo5[\s\S]*?\n}/)[0];
const best5fn = code.match(/function best5[\s\S]*?\n}/)[0];
eval(score5fn + lexfn + combo5fn + best5fn);

const C = (r, s) => ({ r, s });
let pass = 0, fail = 0;
function T(name, cond) { cond ? (pass++, console.log('OK  ', name)) : (fail++, console.log('FAIL', name)); }

const t1 = best5([C(14,2),C(13,2),C(12,2),C(11,2),C(10,2)]);
T('皇家同花顺', t1.score[0] === 8 && t1.score[1] === 14);

const t2 = best5([C(14,0),C(2,1),C(3,2),C(4,3),C(5,0)]);
T('A-2-3-4-5 低顺', t2.score[0] === 4 && t2.score[1] === 5);

const t3 = best5([C(14,0),C(11,1),C(12,2),C(13,3),C(5,0)]);
T('K-A-Q-J-5 非顺(K-A-2 禁止中间)', t3.score[0] === 0);

const t4 = best5([C(6,0),C(6,1),C(6,2),C(6,3),C(13,0)]);
T('四条6', t4.score[0] === 7);

const t5 = best5([C(11,4),C(11,0),C(11,1),C(11,2),C(11,3)]);
T('骑士J+4张J=四条J', t5.score[0] === 7 && t5.score[1] === 11);

const t6 = best5([C(11,4),C(2,0),C(2,1),C(5,2),C(9,0),C(9,3)]);
T('两对+骑士J → 两对', t6.score[0] === 2);

const t7 = best5([C(14,0),C(14,1),C(2,2),C(2,3),C(5,0)], true);
T('两对存在时打手不降级(仍两对)', t7.score[0] === 2);

const t7b = best5([C(14,0),C(14,1),C(2,2),C(5,3),C(9,0)], true);
T('打手: 一对变为最强一对A', t7b.score[0] === 1 && t7b.score[1] === 14);

// 7选2
const t8 = best5([C(2,0),C(2,1),C(7,2),C(8,3),C(9,0),C(10,1),C(11,2)]);
T('一对2 vs 顺子9-K → 顺子', t8.score[0] === 4 && t8.score[1] === 11);

// 打平比较
T('lex 比较', lex([1,14,13,12,11],[1,14,13,12,11]) === 0 && lex([2,9,5],[1,14]) > 0);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
