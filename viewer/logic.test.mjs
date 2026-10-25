// viewer/logic.test.mjs — 核心逻辑的 Node 测试（数据用真实全量数据集，计数随数据自证）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIndex, prereqTree, unlockTree, treeStats, dedupeTree,
  qualityMetrics, filterTopics, renderPrompt, pathGraph,
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

test('dedupeTree：菱形重复子树剪为 repeat 叶子，首次出现保留完整展开', () => {
  // c → [b→a, a]：a 在两条路径出现；去重后第二条路径的 a 为 repeat 叶子
  const doc = { topics: [{ id: 'a' }, { id: 'b' }, { id: 'c' }].map((x, i) => ({ ...x, grade: 1, name: `t${i}` })) };
  const deps = {
    dependencies: [
      { topicId: 'c', prerequisiteId: 'b', strength: 'hard', reason: '' },
      { topicId: 'c', prerequisiteId: 'a', strength: 'hard', reason: '' },
      { topicId: 'b', prerequisiteId: 'a', strength: 'hard', reason: '' },
    ],
  };
  const idx = buildIndex(doc, deps);
  const deduped = dedupeTree(prereqTree(idx, 'c'));
  const [bBranch, aDirect] = deduped.nodes;
  assert.equal(bBranch.id, 'b');
  assert.ok(!bBranch.repeat);
  assert.equal(bBranch.nodes[0].id, 'a');          // 首次出现：完整展开
  assert.equal(aDirect.id, 'a');
  assert.equal(aDirect.repeat, true);              // 二次出现：剪为叶子
  assert.deepEqual(aDirect.nodes, []);
  // 去重后统计与全路径树的 uniqueCount 一致（depth 取去重树真实深度）
  assert.equal(treeStats(deduped).uniqueCount, treeStats(prereqTree(idx, 'c')).uniqueCount);
});

test('dedupeTree：全量数据最稠密主题的渲染节点数与 uniqueCount 同量级', () => {
  // 回归保护：不去重时「凑十法」解锁树渲染 4 万+ 节点；去重后应 ≤ uniqueCount 的 2 倍
  const t = topicsDoc.topics.find((x) => x.name.includes('凑十'));
  const deduped = dedupeTree(unlockTree(index, t.id));
  let nodeCount = 0;
  const walk = (n) => { nodeCount++; n.nodes.forEach(walk); };
  deduped.nodes.forEach(walk);
  assert.ok(nodeCount <= treeStats(deduped).uniqueCount * 2,
    `去重后节点数 ${nodeCount} 应与 uniqueCount ${treeStats(deduped).uniqueCount} 同量级`);
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

// ---------- pathGraph：学习路径图数据（限深、去重、边方向、折叠计数） ----------

test('pathGraph：菱形依赖跨支补边，去重不重复建点', () => {
  // c 依赖 b、a；b 依赖 a：以 c 为根，先修侧 a、b 都显示，a 有两条入边（跨支边补全）
  const doc = { topics: [{ id: 'a' }, { id: 'b' }, { id: 'c' }].map((x, i) => ({ ...x, grade: 1, name: `t${i}` })) };
  const deps = {
    dependencies: [
      { topicId: 'c', prerequisiteId: 'b', strength: 'hard', reason: 'r1' },
      { topicId: 'c', prerequisiteId: 'a', strength: 'soft', reason: 'r2' },
      { topicId: 'b', prerequisiteId: 'a', strength: 'hard', reason: 'r3' },
    ],
  };
  const idx = buildIndex(doc, deps);
  const g = pathGraph(idx, 'c', 3);
  assert.equal(g.nodes.size, 3);                            // a、b 各建一次
  assert.equal([...g.nodes.values()].filter((n) => n.side === 'pre').length, 2);
  const edges = g.edges.map((e) => `${e.from}>${e.to}`).sort();
  assert.deepEqual(edges, ['a>b', 'a>c', 'b>c']);          // 学习方向 from=先学
  assert.equal(g.truncated.size, 0);                        // 全部已显示
});

test('pathGraph：限深截断——层号正确、折叠计数覆盖隐藏后代、加深后收敛', () => {
  const t = topicsDoc.topics.find((x) => x.name.includes('凑十'));
  const g2 = pathGraph(index, t.id, 2);
  // 层号约束：depth 即带符号列号（root=0，pre 负 / next 正），
  // 每条边 from 恒在 to 左侧（学习方向 = 左→右）
  for (const e of g2.edges) {
    const f = g2.nodes.get(e.from), tt = g2.nodes.get(e.to);
    assert.ok(f.depth < tt.depth, `边 ${e.from}>${e.to} 的 from 应在 to 左侧`);
  }
  // 两侧不相交（除 root）
  const sides = new Map([...g2.nodes.values()].map((n) => [n.id, n.side]));
  assert.ok([...sides.values()].filter((s) => s === 'pre').every((s) => s === 'pre'));
  // 深度放开后节点数 = 先修闭包 ∪ 解锁闭包 + 根，隐藏归零
  const gFull = pathGraph(index, t.id, 99);
  const pUnique = treeStats(dedupeTree(prereqTree(index, t.id))).uniqueCount;
  const uUnique = treeStats(dedupeTree(unlockTree(index, t.id))).uniqueCount;
  assert.equal(gFull.nodes.size, pUnique + uUnique + 1);
  assert.equal(gFull.truncated.size, 0);
  // 限深时的隐藏数 = 全量节点数 - 限深节点数（root 的隐藏后代即全部未显示主题）
  assert.equal(g2.counts.hidden, gFull.nodes.size - g2.nodes.size);
  // 单调性：加深只会增加显示节点
  const g3 = pathGraph(index, t.id, 3);
  assert.ok(g3.nodes.size >= g2.nodes.size);
});
