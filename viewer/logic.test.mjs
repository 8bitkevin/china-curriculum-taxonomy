// viewer/logic.test.mjs — 核心逻辑的 Node 测试（数据用真实全量数据集，计数随数据自证）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIndex, prereqTree, unlockTree, treeStats,
  qualityMetrics, filterTopics, renderPrompt,
} from './logic.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const topicsDoc = JSON.parse(readFileSync(join(ROOT, 'data/topics.json'), 'utf8'));
const depsDoc = JSON.parse(readFileSync(join(ROOT, 'data/dependencies.json'), 'utf8'));
const index = buildIndex(topicsDoc, depsDoc);

test('buildIndex：入度出度与边数一致', () => {
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  assert.equal(sum(index.inDeg), depsDoc.dependencies.length);
  assert.equal(sum(index.outDeg), depsDoc.dependencies.length);
  assert.equal(index.byId.size, topicsDoc.topics.length);
});

test('prereqTree：凑十法的先修链含分与合，边带理由', () => {
  // 用户故事 1：凑十法 ← 10以内加法 ← 5以内加法 ← 分与合 ← 1~5的认识 ← 数一数
  const t = topicsDoc.topics.find((x) => x.name.includes('凑十'));
  assert.ok(t, 'v0.1 应含「凑十法」主题');
  const tree = prereqTree(index, t.id);
  const names = [];
  const walk = (n) => { names.push(index.byId.get(n.id)?.name); n.nodes.forEach(walk); };
  tree.nodes.forEach(walk);
  assert.ok(names.some((n) => n?.includes('分与合')), '先修链应含「分与合」');
  assert.ok(names.some((n) => n?.includes('数一数')), '先修链应含「数一数」');
  const edge = tree.nodes[0];
  assert.ok(edge.via.reason.length > 0, '边应携带理由');
});

test('prereqTree/unlockTree：有环数据不无限递归（防御）', () => {
  const cyclicDoc = {
    topics: [
      { id: 'ct_x_01', name: 'A' }, { id: 'ct_x_02', name: 'B' },
    ],
  };
  const cyclicDeps = {
    dependencies: [
      { topicId: 'ct_x_02', prerequisiteId: 'ct_x_01', strength: 'hard', reason: 'r' },
      { topicId: 'ct_x_01', prerequisiteId: 'ct_x_02', strength: 'hard', reason: 'r' },
    ],
  };
  const idx = buildIndex(cyclicDoc, cyclicDeps);
  // x_01 → x_02 → x_01（遇 path 截断为叶子，不再继续展开）
  const n2 = prereqTree(idx, 'ct_x_01').nodes[0];
  assert.equal(n2.id, 'ct_x_02');
  assert.deepEqual(n2.nodes[0].nodes, []);
  const u2 = unlockTree(idx, 'ct_x_02').nodes[0];
  assert.equal(u2.id, 'ct_x_01');
  assert.deepEqual(u2.nodes[0].nodes, []);
});

test('treeStats：去重计数与深度', () => {
  // 1→2→3 链 + 1→3 菱形：树含重复路径但去重计数正确
  const doc = { topics: [{ id: 'a' }, { id: 'b' }, { id: 'c' }].map((x, i) => ({ ...x, grade: 1, name: `t${i}` })) };
  const deps = {
    dependencies: [
      { topicId: 'c', prerequisiteId: 'b', strength: 'hard', reason: '' },
      { topicId: 'c', prerequisiteId: 'a', strength: 'hard', reason: '' },
      { topicId: 'b', prerequisiteId: 'a', strength: 'hard', reason: '' },
    ],
  };
  const idx = buildIndex(doc, deps);
  const tree = prereqTree(idx, 'c'); // c → [b→a, a]
  const stats = treeStats(tree);
  assert.equal(stats.uniqueCount, 2); // 去重后 b、a
  assert.equal(stats.depth, 2);
});

test('qualityMetrics：全量数据指标全绿（口径与 report.mjs 一致）', () => {
  const m = qualityMetrics(index);
  assert.equal(m.topicCount, topicsDoc.topics.length);
  assert.equal(m.edgeCount, depsDoc.dependencies.length);
  assert.equal(m.islands.length, 0);
  assert.equal(m.inverted.length, 0);
  assert.equal(m.noPrompt.length, 0);
  assert.ok(m.promptCoverage >= 0.999);
});

test('filterTopics：搜索 + 年级 + 领域组合过滤', () => {
  assert.ok(filterTopics(index, { query: '凑十' }).length >= 1);
  assert.equal(filterTopics(index, { grade: 2, domain: '图形与几何' }).length,
    topicsDoc.topics.filter((t) => t.grade === 2 && t.domain === '图形与几何').length);
  assert.equal(filterTopics(index, { query: '不存在的主题xyz' }).length, 0);
});

test('renderPrompt：{{name}} 占位符替换', () => {
  assert.equal(renderPrompt('{{name}}会数数吗？', '小明'), '小明会数数吗？');
  assert.equal(renderPrompt(null, '小明'), null);
  assert.equal(renderPrompt('没有占位符', ''), '没有占位符');
});
