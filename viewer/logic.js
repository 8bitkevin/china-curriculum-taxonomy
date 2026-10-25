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

/**
 * 树去重：同一主题只在首次出现处展开子树，后续出现剪为叶子并标 repeat。
 * 全路径树在稠密区（如一年级计算主线）同一主题可沿几十条路径重复，
 * 不去重会让详情页渲染数万节点；去重后节点数与 uniqueCount 同量级。
 */
export function dedupeTree(tree) {
  const seen = new Set();
  const walk = (node) => {
    if (seen.has(node.id)) return { id: node.id, via: node.via, nodes: [], repeat: true };
    seen.add(node.id);
    return { id: node.id, via: node.via, nodes: node.nodes.map(walk) };
  };
  return walk(tree);
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

/**
 * 学习路径图数据：以 rootId 为中心、先修向左 / 解锁向右的限深去重 DAG。
 *
 * - 两侧各自从 root 做限深 BFS 收集显示集：同一主题只在首次到达处展开
 *   （BFS 去重），跨支引用仅补边不重复建点；节点 depth 为侧内最长路径
 *   层号压缩成的连续列号（root=0，pre 负、next 正），保证每条边 from 在 to 左侧。
 * - 无环图保证两侧节点集不相交（否则 root 会依赖自己的传递解锁，成环）。
 * - edges 方向统一为「学习顺序」：from = 先学（左侧），to = 后学（右侧），
 *   布局中所有箭头一致向右流动，无需逐边画箭头。
 * - truncated：每个已显示节点沿其方向（root 双向）的传递后代中尚未显示
 *   的主题数 —— 渲染为节点上的「+N」折叠徽标。
 *
 * @returns {{ rootId, nodes: Map, childrenOf: Map, edges: object[], truncated: Map,
 *             counts: { pre, next, hidden } }}
 */
export function pathGraph(index, rootId, depth = 3) {
  const nodes = new Map([[rootId, { id: rootId, side: 'root', depth: 0 }]]);
  const childrenOf = new Map();          // 侧内展开树：父（近根） -> [子（远根）]
  const adjOf = { pre: index.prereqsOf, next: index.unlocksOf };

  for (const side of ['pre', 'next']) {
    let frontier = [rootId];
    for (let d = 1; d <= depth && frontier.length; d++) {
      const next = [];
      for (const pid of frontier) {
        for (const e of adjOf[side].get(pid) ?? []) {
          const other = side === 'pre' ? e.prerequisiteId : e.topicId;
          if (nodes.has(other)) continue;                 // 去重：只补边不展开
          nodes.set(other, { id: other, side, depth: d });
          if (!childrenOf.has(pid)) childrenOf.set(pid, []);
          childrenOf.get(pid).push(other);
          next.push(other);
        }
      }
      frontier = next;
    }
  }

  // 层号修正：BFS 首达深度在有长短两条路径时会出现「反层边」（依赖边两端
  // 同层甚至反向）。L(n) 改为 n 距 root 的最长路径长度 —— pre 侧沿解锁边
  // 朝 root 递推、next 侧沿先修边朝 root 递推（记忆化，DAG 无环安全），
  // 保证每条边 from 恒比 to 远离根；再把出现的层号压缩为连续列（无空列）。
  const Lmemo = new Map([[rootId, 0]]);
  const sideL = (id, side) => {
    if (Lmemo.has(id)) return Lmemo.get(id);
    // pre 侧找「依赖我的」已显示邻居（更近 root）；next 侧找「我依赖的」
    const adj = side === 'pre' ? index.unlocksOf.get(id) : index.prereqsOf.get(id);
    let mx = 0;
    for (const e of adj ?? []) {
      const other = side === 'pre' ? e.topicId : e.prerequisiteId;
      const o = nodes.get(other);
      if (!o || (o.side !== side && other !== rootId)) continue;
      mx = Math.max(mx, sideL(other, side));
    }
    Lmemo.set(id, mx + 1);
    return mx + 1;
  };
  const col = new Map();  // side|L -> 连续列号（root=0，pre 负，next 正）
  for (const side of ['pre', 'next']) {
    const ls = [...new Set([...nodes.values()]
      .filter((n) => n.side === side).map((n) => sideL(n.id, side)))].sort((a, b) => a - b);
    ls.forEach((l, i) => col.set(`${side}|${l}`, side === 'pre' ? -(i + 1) : i + 1));
  }
  for (const n of nodes.values()) {
    if (n.side !== 'root') n.depth = col.get(`${n.side}|${Lmemo.get(n.id)}`);
  }
  // 边：显示集内两端都可见的邻接全部收入（自然补全跨支边），按 (from,to) 去重
  const seen = new Set();
  const edges = [];
  const pushEdge = (from, to, e) => {
    const key = `${from}>${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, strength: e.strength, reason: e.reason });
  };
  for (const { id, side } of nodes.values()) {
    for (const e of index.prereqsOf.get(id) ?? []) {
      if (side !== 'next' && nodes.has(e.prerequisiteId)) pushEdge(e.prerequisiteId, id, e);
    }
    for (const e of index.unlocksOf.get(id) ?? []) {
      if (side !== 'pre' && nodes.has(e.topicId)) pushEdge(id, e.topicId, e);
    }
  }

  // 折叠计数：节点沿各自方向的定向传递后代 ∖ 显示集。pre 方向（沿先修）与
  // next 方向（沿解锁）是两次独立的定向 BFS —— 混在一个遍历里会退化成无向
  // 连通分量，把与 root 无依赖路径的主题也计进来。已显示节点继续穿越不计数。
  const truncated = new Map();
  const reachDir = (start, dir) => {
    const reach = new Set();
    const visited = new Set([start]);
    const q = [start];
    while (q.length) {
      const u = q.shift();
      for (const e of adjOf[dir].get(u) ?? []) {
        const other = dir === 'pre' ? e.prerequisiteId : e.topicId;
        if (visited.has(other)) continue;
        visited.add(other);
        if (!nodes.has(other)) reach.add(other);
        q.push(other);
      }
    }
    return reach;
  };
  for (const { id: nid, side } of nodes.values()) {
    const reach = new Set();
    if (side !== 'next') for (const x of reachDir(nid, 'pre')) reach.add(x);
    if (side !== 'pre') for (const x of reachDir(nid, 'next')) reach.add(x);
    if (reach.size) truncated.set(nid, reach.size);
  }

  const counts = {
    pre: [...nodes.values()].filter((n) => n.side === 'pre').length,
    next: [...nodes.values()].filter((n) => n.side === 'next').length,
    hidden: truncated.get(rootId) ?? 0,
  };
  return { rootId, nodes, childrenOf, edges, truncated, counts };
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
    bySubject: dist((t) => t.subject),
    byDomain: dist((t) => (t.subject && t.subject !== '数学' ? `${t.subject}·` : '') + t.domain),
    byType: dist((t) => t.type),
  };
}

/** 列表过滤：搜索（名称/描述/id）+ 学科 + 年级 + 领域，保持册内顺序。 */
export function filterTopics(index, { query = '', subject = '', grade = 0, domain = '' } = {}) {
  const q = query.trim().toLowerCase();
  return index.topics.filter((t) => {
    if (subject && t.subject !== subject) return false;
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
