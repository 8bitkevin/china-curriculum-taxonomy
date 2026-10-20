// viewer/logic.js — 纯逻辑层：图索引、先修链/解锁树、质量指标。
// 不依赖 DOM，浏览器（viewer.js import）与 Node 测试（logic.test.mjs）
// 共用。质量指标口径与 scripts/report.mjs 保持一致。

/**
 * @param {{topics: object[]}} topicsDoc data/topics.json
 * @param {{dependencies: object[]}} depsDoc data/dependencies.json
 */
export function buildIndex(topicsDoc, depsDoc) {
  const topics = topicsDoc.topics;
  const deps = depsDoc.dependencies;
  const byId = new Map(topics.map((t) => [t.id, t]));

  const prereqsOf = new Map(); // id -> [{ prerequisiteId, strength, reason }]
  const unlocksOf = new Map(); // id -> [{ topicId, strength, reason }]（谁依赖我）
  const inDeg = new Map(topics.map((t) => [t.id, 0]));
  const outDeg = new Map(topics.map((t) => [t.id, 0]));
  for (const d of deps) {
    if (!prereqsOf.has(d.topicId)) prereqsOf.set(d.topicId, []);
    prereqsOf.get(d.topicId).push(d);
    if (!unlocksOf.has(d.prerequisiteId)) unlocksOf.set(d.prerequisiteId, []);
    unlocksOf.get(d.prerequisiteId).push(d);
    inDeg.set(d.topicId, inDeg.get(d.topicId) + 1);
    outDeg.set(d.prerequisiteId, outDeg.get(d.prerequisiteId) + 1);
  }

  const volumeOf = (t) => `${t.grade}年级${t.semester}`;
  const volumeOrder = new Map(
    [...new Set(topics.map((t) => volumeOf(t)))]
      .sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b, 'zh'))
      .map((v, i) => [v, i]),
  );

  return { topics, deps, byId, prereqsOf, unlocksOf, inDeg, outDeg, volumeOf, volumeOrder };
}

/**
 * 先修链树：id -> { id, via, nodes: [...] }
 * via = 从上层主题指向本节点的边（strength/reason）。
 * 菱形依赖会在不同路径重复出现（各路径完整）；path 集合防御环。
 */
export function prereqTree(index, id, path = new Set()) {
  const edges = index.prereqsOf.get(id) ?? [];
  if (!edges.length || path.has(id)) return { id, via: null, nodes: [] };
  path.add(id);
  const nodes = edges.map((e) => ({
    id: e.prerequisiteId,
    via: { strength: e.strength, reason: e.reason },
    nodes: prereqTree(index, e.prerequisiteId, path).nodes,
  }));
  path.delete(id);
  return { id, via: null, nodes };
}

/** 解锁树（反向）：依赖 id 的完整传递闭包，结构同 prereqTree。 */
export function unlockTree(index, id, path = new Set()) {
  const edges = index.unlocksOf.get(id) ?? [];
  if (!edges.length || path.has(id)) return { id, via: null, nodes: [] };
  path.add(id);
  const nodes = edges.map((e) => ({
    id: e.topicId,
    via: { strength: e.strength, reason: e.reason },
    nodes: unlockTree(index, e.topicId, path).nodes,
  }));
  path.delete(id);
  return { id, via: null, nodes };
}

/** 树中去重主题数与最大深度（用于「N 层 · M 个主题」摘要）。 */
export function treeStats(tree) {
  const ids = new Set();
  let depth = 0;
  const walk = (node, level) => {
    ids.add(node.id);
    depth = Math.max(depth, level);
    for (const child of node.nodes) walk(child, level + 1);
  };
  walk(tree, 0);
  return { uniqueCount: ids.size - 1, depth }; // 不含根
}

/** 质量指标（口径对齐 scripts/report.mjs）。 */
export function qualityMetrics(index) {
  const { topics, deps, inDeg, outDeg, byId } = index;
  const islands = topics.filter((t) => inDeg.get(t.id) === 0 && outDeg.get(t.id) === 0);
  const roots = topics.filter((t) => inDeg.get(t.id) === 0 && outDeg.get(t.id) > 0);
  const noPrompt = topics.filter((t) => !t.assessmentPrompt);
  const noStandards = topics.filter((t) => !t.standards?.length);
  const inverted = deps
    .map((d) => ({ d, t: byId.get(d.topicId), p: byId.get(d.prerequisiteId) }))
    .filter((x) => x.t && x.p && x.p.grade > x.t.grade);

  const dist = (select) => {
    const m = new Map();
    for (const t of topics) m.set(select(t), (m.get(select(t)) ?? 0) + 1);
    return [...m.entries()];
  };

  return {
    topicCount: topics.length,
    edgeCount: deps.length,
    edgeDensity: +(deps.length / topics.length).toFixed(2),
    hardCount: deps.filter((d) => d.strength === 'hard').length,
    islands,
    roots,
    noPrompt,
    noStandards,
    inverted,
    promptCoverage: topics.length ? (topics.length - noPrompt.length) / topics.length : 1,
    standardsCoverage: topics.length ? (topics.length - noStandards.length) / topics.length : 1,
    byVolume: dist((t) => `${t.grade}年级${t.semester}`),
    byDomain: dist((t) => t.domain),
    byType: dist((t) => t.type),
  };
}

/** 列表过滤：搜索（名称/描述/id）+ 年级 + 领域，保持册内顺序。 */
export function filterTopics(index, { query = '', grade = 0, domain = '' } = {}) {
  const q = query.trim().toLowerCase();
  return index.topics.filter((t) => {
    if (grade && t.grade !== grade) return false;
    if (domain && t.domain !== domain) return false;
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)
    );
  });
}

/** 渲染测评问法：替换 {{name}} 占位符（无占位符时原样返回）。 */
export function renderPrompt(prompt, name = '孩子') {
  if (!prompt) return null;
  return prompt.replaceAll('{{name}}', name || '孩子');
}
