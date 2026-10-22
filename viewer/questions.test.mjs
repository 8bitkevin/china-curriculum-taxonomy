import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFill, judgeFill, sourceLine, splitAnswerAlt, formatAnswer,
  isLocalOrigin, fetchPack,
} from './questions.js';

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

// ---------- pack 源选择（本地 dev API 探测 + 回退） ----------

test('isLocalOrigin 仅认 localhost/127.0.0.1 源', () => {
  assert.equal(isLocalOrigin('http://localhost:8787'), true);
  assert.equal(isLocalOrigin('http://127.0.0.1:8000'), true);
  assert.equal(isLocalOrigin('https://8bitkevin.github.io'), false);
  assert.equal(isLocalOrigin('http://example.com:8787'), false); // 端口相同也非本地
});

test('fetchPack：本地源先探同源 API，失败回退远程', async () => {
  const calls = [];
  // 本地 API 可用 → 用之，不再碰远程
  let r = await fetchPack({
    origin: 'http://localhost:8787',
    fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => ({ questionCount: 766 }) }; },
  });
  assert.equal(r.pack.questionCount, 766);
  assert.equal(r.origin, 'local-api: /api/questions/pack');
  assert.equal(calls.length, 1);

  // 本地 API 404（python -m http.server 场景）→ 回退远程 URL
  calls.length = 0;
  r = await fetchPack({
    origin: 'http://127.0.0.1:8000',
    globalConfig: 'https://cfg.example/pack.json',
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === '/api/questions/pack') return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => ({ via: url }) };
    },
  });
  assert.equal(r.pack.via, 'https://cfg.example/pack.json');
  assert.deepEqual(calls, ['/api/questions/pack', 'https://cfg.example/pack.json']);

  // 非本地源 → 直接远程，零探测（线上 GitHub Pages 行为）
  calls.length = 0;
  r = await fetchPack({
    origin: 'https://8bitkevin.github.io',
    fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => ({}) }; },
  });
  assert.deepEqual(calls, ['https://raw.githubusercontent.com/8bitkevin/china-curriculum-questions/main/build/pack.json']);

  // ?pack= 显式指定 → 跳过探测始终用之
  calls.length = 0;
  r = await fetchPack({
    origin: 'http://localhost:8787',
    search: '?pack=https://mirror.example/pack.json',
    fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => ({ via: url }) }; },
  });
  assert.deepEqual(calls, ['https://mirror.example/pack.json']);
});
