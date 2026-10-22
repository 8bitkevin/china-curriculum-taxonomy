import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFill, judgeFill, sourceLine } from './questions.js';

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
