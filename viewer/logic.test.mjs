// viewer/logic.test.mjs — 核心逻辑的 Node 测试（数据用真实全量数据集，计数随数据自证）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIndex, prereqTree, unlockTree, treeStats, dedupeTree,
  qualityMetrics, filterTopics, renderPrompt, pathGraph, lessonFileOf,
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
  assert.ok(t, 'v0.1 应含「凑十法」知识点');
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

test('dedupeTree：全量数据最稠密知识点的渲染节点数与 uniqueCount 同量级', () => {
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
  assert.equal(filterTopics(index, { query: '不存在的知识点xyz' }).length, 0);
});

test('renderPrompt：{{name}} 占位符替换', () => {
  assert.equal(renderPrompt('{{name}}会数数吗？', '小明'), '小明会数数吗？');
  assert.equal(renderPrompt(null, '小明'), null);
  assert.equal(renderPrompt('没有占位符', ''), '没有占位符');
});

// ---------- pathGraph：学习路径图数据（关键路径 + 非对称展开） ----------

test('pathGraph：菱形依赖跨支补边、关键链与主线边标记', () => {
  // c 依赖 b(hard)、a(soft)；b 依赖 a(hard)：以 c 为根，先修侧 a、b 都显示，
  // a 有两条入边（跨支边补全）；关键链 = 最长 hard 链 a>b>c
  const doc = { topics: [{ id: 'a' }, { id: 'b' }, { id: 'c' }].map((x, i) => ({ ...x, grade: 1, name: `t${i}` })) };
  const deps = {
    dependencies: [
      { topicId: 'c', prerequisiteId: 'b', strength: 'hard', reason: 'r1' },
      { topicId: 'c', prerequisiteId: 'a', strength: 'soft', reason: 'r2' },
      { topicId: 'b', prerequisiteId: 'a', strength: 'hard', reason: 'r3' },
    ],
  };
  const idx = buildIndex(doc, deps);
  const g = pathGraph(idx, 'c');
  assert.equal(g.nodes.size, 3);                            // a、b 各建一次
  assert.equal([...g.nodes.values()].filter((n) => n.side === 'pre').length, 2);
  const edges = g.edges.map((e) => `${e.from}>${e.to}`).sort();
  assert.deepEqual(edges, ['a>b', 'a>c', 'b>c']);          // 学习方向 from=先学
  assert.deepEqual(g.chain.ids, ['a', 'b', 'c']);          // 主线 = 最长 hard 链
  assert.equal(g.counts.chainLen, 3);
  assert.equal(g.edges.filter((e) => e.backbone).length, 2); // a>b、b>c 两条主线边
  assert.equal(g.truncated.size, 0);                        // 全部已显示
});

test('pathGraph：非对称展开——先修走 hard 闭包（自适应上限）、解锁一跳+计数', () => {
  const t = topicsDoc.topics.find((x) => x.name.includes('凑十'));
  const g = pathGraph(index, t.id);
  // 层号约束：depth 即带符号列号（root=0，pre 负 / next 正），
  // 每条边 from 恒在 to 左侧（学习方向 = 左→右）
  for (const e of g.edges) {
    assert.ok(g.nodes.get(e.from).depth < g.nodes.get(e.to).depth,
      `边 ${e.from}>${e.to} 的 from 应在 to 左侧`);
  }
  // 解锁侧只一跳：next 节点全是 root 的直接解锁
  const directNext = new Set((index.unlocksOf.get(t.id) ?? []).map((e) => e.topicId));
  for (const n of g.nodes.values()) {
    if (n.side === 'next') assert.ok(directNext.has(n.id), `${n.id} 应为直接解锁`);
  }
  // 先修侧（非 spur）⊆ root 的 hard 传递闭包；spur 只能是 root 的直接 soft 先修
  const hardClosure = new Set();
  {
    const q = [t.id];
    while (q.length) {
      const u = q.shift();
      for (const e of index.prereqsOf.get(u) ?? []) {
        if (e.strength === 'hard' && !hardClosure.has(e.prerequisiteId)) {
          hardClosure.add(e.prerequisiteId); q.push(e.prerequisiteId);
        }
      }
    }
  }
  const directSoft = new Set((index.prereqsOf.get(t.id) ?? [])
    .filter((e) => e.strength === 'soft').map((e) => e.prerequisiteId));
  for (const n of g.nodes.values()) {
    if (n.side !== 'pre') continue;
    if (n.spur) assert.ok(directSoft.has(n.id), `${n.id} 应为 root 直接 soft 先修`);
    else assert.ok(hardClosure.has(n.id), `${n.id} 应在 hard 闭包内`);
  }
  // 「通向 N」= 解锁树去重量（计数不是网）
  const uUnique = treeStats(dedupeTree(unlockTree(index, t.id))).uniqueCount;
  assert.equal(g.counts.closureNext, uUnique);
  // 主线：全部可见、以 root 收尾、站数一致
  assert.ok(g.chain.ids.length >= 1);
  assert.ok(g.chain.ids.every((id) => g.nodes.has(id)));
  assert.equal(g.chain.ids[g.chain.ids.length - 1], t.id);
  assert.equal(g.chain.ids.length, g.counts.chainLen);
  // 自适应上限：先修侧可见 ≤ 上限 + root 直接 soft 叶（全库最大 3）
  assert.ok(g.counts.pre <= 40 + 3);
  // 渐进披露单调：若被截断，加深一层节点只增不减
  if (!g.counts.preComplete) {
    const g2 = pathGraph(index, t.id, g.counts.preLevels + 1);
    assert.ok(g2.counts.pre >= g.counts.pre);
    assert.ok(g2.nodes.size >= g.nodes.size);
  }
});

test('pathGraph：最坏案例——127 站 hard 闭包被自适应截断，显式加深后完整', () => {
  const t = topicsDoc.topics.find((x) => x.name.includes('用空间向量求距离'));
  assert.ok(t, '应存在「用空间向量求距离与空间角」知识点');
  const g = pathGraph(index, t.id);
  assert.ok(!g.counts.preComplete);                        // 127 > 40 → 截断
  assert.ok(g.counts.pre <= 40 + 3);                       // ≤ 上限 + soft 叶
  assert.ok(g.counts.hidden > 0);                          // root 徽标有剩余必修
  const gFull = pathGraph(index, t.id, 99);
  assert.ok(gFull.counts.preComplete);
  assert.ok(gFull.counts.pre >= 127);                      // hard 闭包 127 站全显
  assert.equal(gFull.counts.hidden, 0);
  // 时间轴守恒：按学期聚合计数之和 = 解锁闭包总数
  const sum = [...gFull.counts.nextByTerm.values()].reduce((s, c) => s + c.count, 0);
  assert.equal(sum, gFull.counts.closureNext);
});

// ---------- 学习内容层（D-030，lessonFileOf + data/lessons/*.json） ----------
const lessonsDoc = JSON.parse(readFileSync(join(ROOT, 'data/lessons/math.json'), 'utf8'));

test('lessonFileOf：学科 → 文件码映射（数学为 math，道法/思政分码）', () => {
  assert.equal(lessonFileOf('数学'), 'math');
  assert.equal(lessonFileOf('语文'), 'yw');
  assert.equal(lessonFileOf('道德与法治'), 'zz');
  assert.equal(lessonFileOf('思想政治'), 'sxzz');   // 与 id 前缀 zz 不同源，文件按学科分
  assert.equal(lessonFileOf('体育'), null);          // 未知学科 → null
});

test('lessons/math.json：topicId 全部可解析且学科匹配、无重复', () => {
  assert.equal(lessonsDoc.subject, '数学');
  assert.equal(lessonsDoc.lessonCount, lessonsDoc.lessons.length);
  const seen = new Set();
  for (const l of lessonsDoc.lessons) {
    const t = index.byId.get(l.topicId);
    assert.ok(t, `讲解引用未知知识点 ${l.topicId}`);
    assert.equal(t.subject, '数学', `${l.topicId} 学科不匹配`);
    assert.ok(!seen.has(l.topicId), `知识点 ${l.topicId} 讲解重复`);
    seen.add(l.topicId);
  }
});

test('lessons/math.json：每条讲解结构完备（摘要/讲解/例题带解答）', () => {
  for (const l of lessonsDoc.lessons) {
    assert.ok(l.summary.length >= 8, `${l.topicId} summary 过短`);
    assert.ok(l.explanation.length >= 3, `${l.topicId} 讲解应≥3 段`);
    for (const ex of l.examples ?? []) {
      assert.ok(ex.solution.length >= 4, `${l.topicId} 例题缺解答`);
      assert.ok([1, 2, 3].includes(ex.difficulty), `${l.topicId} 例题难度非法`);
    }
    for (const m of l.methods ?? []) {
      assert.ok(m.steps.length >= 1, `${l.topicId} 方法缺步骤`);
    }
  }
});

test('lessons/math.json：首批覆盖小一数学上册全部知识点', () => {
  const g1a = topicsDoc.topics.filter((t) => /^ct_g1a_/.test(t.id)).map((t) => t.id);
  const covered = new Set(lessonsDoc.lessons.map((l) => l.topicId));
  assert.equal(g1a.length, 24);
  for (const id of g1a) assert.ok(covered.has(id), `${id} 未覆盖`);
});
