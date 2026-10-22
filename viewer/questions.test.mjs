import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFill, judgeFill, sourceLine, splitAnswerAlt, formatAnswer } from './questions.js';

test('normalizeFill 剥离 LaTeX 记号与空白后等价', () => {
  assert.equal(normalizeFill('$x^{2}+y^{2}=2$'), normalizeFill('x^2+y^2=2'));
  assert.equal(normalizeFill('  \\frac{1}{2} '), normalizeFill('frac12'));
  assert.equal(normalizeFill('1, 2'), normalizeFill('12')); // 分隔标点被剥
});

test('judgeFill 宽松判对：等价写法算对', () => {
  assert.equal(judgeFill('$x^{2}+y^{2}=2$', ['x^2+y^2=2']), true);
  assert.equal(judgeFill('2', ['\\frac{2}{1}', '2']), true);
  assert.equal(judgeFill('3', ['2']), false);
  assert.equal(judgeFill('', ['2']), false); // 空作答不算对
});

test('judgeFill 支持「\\# \\#」分隔的多可接受写法（分数/小数）', () => {
  const answer = ['$\\frac{3}{10} \\# \\# 0.3$'];
  assert.equal(judgeFill('0.3', answer), true);
  assert.equal(judgeFill('$\\frac{3}{10}$', answer), true);
  assert.equal(judgeFill('0.5', answer), false);
});

test('formatAnswer 拆分备用写法并重整定界符', () => {
  assert.equal(formatAnswer(['$\\frac{3}{10} \\# \\# 0.3$']), '$\\frac{3}{10}$；0.3');
  assert.deepEqual(splitAnswerAlt('$\\frac{3}{10} \\# \\# 0.3$'), ['$\\frac{3}{10}', '0.3$']);
  assert.equal(formatAnswer(['$x^{2}+y^{2}=2$']), '$x^{2}+y^{2}=2$');
});

test('sourceLine 含年份/卷别/难度星数', () => {
  const line = sourceLine({
    difficulty: 3,
    source: { year: 2022, paper: '新课标Ⅰ', category: '选择题' },
  });
  assert.match(line, /2022/);
  assert.match(line, /新课标Ⅰ/);
  assert.match(line, /★★★/);
  assert.match(line, /☆☆/);
});
