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
 * via = 从上层知识点指向本节点的边（strength/reason）。
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
 * 树去重：同一知识点只在首次出现处展开子树，后续出现剪为叶子并标 repeat。
 * 全路径树在稠密区（如一年级计算主线）同一知识点可沿几十条路径重复，
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

/** 树中去重知识点数与最大深度（用于「N 层 · M 个知识点」摘要）。 */
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
 * 学习路径图数据：以 rootId 为中心的「关键路径」图（2026-10 产品重构）。
 *
 * 全展开的传递闭包在早期知识点上等于半张学科图（1 年级数学可达 538 节点 / 52 列），
 * 任何布局都不可读——路径图的任务是回答「先学什么、学完去哪」，不是展示全图。
 * 因此两侧语义非对称：
 *
 * - 先修侧（来路）＝路由：只沿 hard（必需）边收集传递先修（全库中位 7 站、
 *   96% 知识点 ≤60 站），超过 PRE_CAP(40) 时按 hard BFS 深度渐进展开（+1 层）；
 *   root 的直接 soft（有益）先修挂为 1 跳叶子（中位 0 / 最大 3），不递归。
 * - 解锁侧（去路）＝一跳：只显示直接解锁（中位 1 / 最大 7），传递影响压缩为
 *   counts.nextByTerm 按学期计数（时间轴热条）——「通向 N」是计数不是网。
 * - chain：可见集内沿 hard 边到 root 的最长链（关键路径），counts.chainLen 为
 *   站数（含 root），渲染为加粗主线（地铁线路图隐喻：主线 = 必须走的路）。
 * - edges 方向统一为「学习顺序」：from = 先学（左侧），to = 后学（右侧）；
 *   节点 depth 为可见边集上最长路径层号压缩成的连续列号（root=0，pre 负 /
 *   next 正），保证每条边 from 恒在 to 左侧。
 * - truncated 徽标：pre 侧/root = 其 hard 先修传递后代中未显示数（可 +1 层
 *   加深）；next 侧 = 其解锁传递闭包总数（信息徽标，点击出卡片不展开网）。
 *
 * @param {object} index buildIndex 产物
 * @param {string} rootId 中心知识点
 * @param {?number} preDepth null=自适应（hard 闭包 ≤PRE_CAP 全显，否则截到容量内）；
 *                           数字=显式 hard BFS 展开层数（「+1 层」渐进披露）
 * @returns {{ rootId, nodes: Map, edges: object[], chain: { ids: string[], edgeKeys: Set, idSet: Set },
 *             truncated: Map, counts: { pre, next, hidden, chainLen, closureNext, nextByTerm: Map,
 *             preComplete: boolean, preLevels: number, preLevelsTotal: number } }}
 */
const PRE_CAP = 40;   // 先修侧自适应容量：≤40 站整条主线直接显示，超过按层渐进披露

export function pathGraph(index, rootId, preDepth = null) {
  const nodes = new Map([[rootId, { id: rootId, side: 'root', depth: 0 }]]);

  // ---- 先修侧：hard 闭包按 BFS 深度分层（渐进披露的「层」单位）----
  const levels = [];
  {
    const seen = new Set([rootId]);
    let frontier = [rootId];
    while (frontier.length) {
      const next = [];
      for (const pid of frontier) {
        for (const e of index.prereqsOf.get(pid) ?? []) {
          if (e.strength !== 'hard' || seen.has(e.prerequisiteId)) continue;
          seen.add(e.prerequisiteId);
          next.push(e.prerequisiteId);
        }
      }
      if (next.length) levels.push(next);
      frontier = next;
    }
  }
  const preLevelsTotal = levels.length;
  let usedLevels = preLevelsTotal;                      // 默认全显
  if (preDepth != null) {
    usedLevels = Math.min(preDepth, preLevelsTotal);
  } else {
    const hardTotal = levels.reduce((s, l) => s + l.length, 0);
    if (hardTotal > PRE_CAP) {                          // 自适应：截到容量内（至少 1 层）
      let acc = 0; usedLevels = 0;
      for (const l of levels) { if (acc + l.length > PRE_CAP) break; acc += l.length; usedLevels++; }
      if (usedLevels === 0) usedLevels = 1;
    }
  }
  for (let d = 0; d < usedLevels; d++)
    for (const id of levels[d]) nodes.set(id, { id, side: 'pre', depth: 0 });

  // root 的直接 soft 先修：1 跳叶子（有益但非必需，理由在卡片里完整呈现，图上不递归）
  for (const e of index.prereqsOf.get(rootId) ?? []) {
    if (e.strength === 'soft' && !nodes.has(e.prerequisiteId))
      nodes.set(e.prerequisiteId, { id: e.prerequisiteId, side: 'pre', depth: 0, spur: true });
  }

  // ---- 解锁侧：直接解锁一跳（传递影响走 counts.nextByTerm 计数）----
  for (const e of index.unlocksOf.get(rootId) ?? []) {
    if (!nodes.has(e.topicId)) nodes.set(e.topicId, { id: e.topicId, side: 'next', depth: 0 });
  }

  // ---- 边：显示集内两端都可见的邻接全部收入（自然补全跨支边），按 (from,to) 去重 ----
  const seenEdge = new Set();
  const edges = [];
  const pushEdge = (from, to, e) => {
    const key = `${from}>${to}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
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

  // ---- 层号：可见边集上的最长路径层号（每条边 from 恒比 to 远离 root 一列，
  //      BFS 首达深度的「反层边」陷阱由此修复），再压缩为连续列（无空列）。
  const inE = new Map();          // id -> 指向我的可见边（from = 我的先修）
  for (const e of edges) {
    if (!inE.has(e.to)) inE.set(e.to, []);
    inE.get(e.to).push(e);
  }
  const Lmemo = new Map([[rootId, 0]]);
  const layerOf = (id) => {
    if (Lmemo.has(id)) return Lmemo.get(id);
    let mx = 0;
    for (const e of inE.get(id) ?? []) mx = Math.max(mx, layerOf(e.from));
    Lmemo.set(id, mx + 1);                          // DAG 无环，递归安全（最深 54 层）
    return Lmemo.get(id);
  };
  const col = new Map();  // side|L -> 连续列号（root=0，pre 负，next 正）
  for (const side of ['pre', 'next']) {
    const ls = [...new Set([...nodes.values()]
      .filter((n) => n.side === side).map((n) => layerOf(n.id)))].sort((a, b) => a - b);
    // layerOf 越大 = 越靠近 root（依赖链下游）：pre 侧映射为紧贴 root 的 -1 起
    // 向左递减（ls 升序，故用 -(len-i)），next 侧向右递增——每条边 from 恒在 to 左侧
    ls.forEach((l, i) => col.set(`${side}|${l}`, side === 'pre' ? -(ls.length - i) : i + 1));
  }
  for (const n of nodes.values()) {
    if (n.side !== 'root') n.depth = col.get(`${n.side}|${layerOf(n.id)}`);
  }

  // ---- 关键链：可见集内沿 hard 边（先修侧）到 root 的最长链 = 主线 ----
  const lenMemo = new Map(); const par = new Map();
  const chainLenOf = (id) => {
    if (lenMemo.has(id)) return lenMemo.get(id);
    let best = 0; let bp = null;
    for (const e of inE.get(id) ?? []) {
      if (e.strength !== 'hard') continue;
      if (nodes.get(e.from).side === 'next') continue;   // 主线只在先修侧（来路）
      const l = chainLenOf(e.from);
      if (l > best) { best = l; bp = e.from; }
    }
    lenMemo.set(id, best + 1);
    par.set(id, bp);
    return lenMemo.get(id);
  };
  const chainLen = chainLenOf(rootId);            // 递归同时填充 par（回溯表）
  const chainIds = [];
  for (let cur = rootId; cur; cur = par.get(cur)) chainIds.unshift(cur);
  const chainEdgeKeys = new Set();
  for (let i = 1; i < chainIds.length; i++) chainEdgeKeys.add(`${chainIds[i - 1]}>${chainIds[i]}`);
  for (const e of edges) e.backbone = chainEdgeKeys.has(`${e.from}>${e.to}`);

  // ---- 解锁传递闭包按学期计数（时间轴热条；ids 截 12 条供热条弹层）----
  const nextByTerm = new Map();    // `${grade}|${semester}` -> { grade, semester, count, ids }
  let closureNext = 0;
  {
    const visited = new Set();
    const q = [rootId];
    while (q.length) {
      const u = q.shift();
      for (const e of index.unlocksOf.get(u) ?? []) {
        const v = e.topicId;
        if (visited.has(v)) continue;
        visited.add(v); closureNext++;
        const t = index.byId.get(v);
        const key = `${t.grade}|${t.semester}`;
        let cell = nextByTerm.get(key);
        if (!cell) { cell = { grade: t.grade, semester: t.semester, count: 0, ids: [] }; nextByTerm.set(key, cell); }
        cell.count++;
        if (cell.ids.length < 12) cell.ids.push(v);
        q.push(v);
      }
    }
  }

  // ---- 折叠徽标计数（两侧口径不同，见函数头注释；pre 方向若混入 soft 边
  //      会虚增「还可加深」的假象，next 方向是全强度解锁影响数）----
  const truncated = new Map();
  const hardPreHidden = (start) => {               // hard 先修方向传递后代 ∖ 显示集
    const reach = new Set(); const visited = new Set([start]);
    const q = [start];
    while (q.length) {
      const u = q.shift();
      for (const e of index.prereqsOf.get(u) ?? []) {
        if (e.strength !== 'hard' || visited.has(e.prerequisiteId)) continue;
        visited.add(e.prerequisiteId);
        if (!nodes.has(e.prerequisiteId)) reach.add(e.prerequisiteId);
        q.push(e.prerequisiteId);
      }
    }
    return reach.size;
  };
  const nextReachCount = (start) => {              // 解锁方向传递闭包总数
    const visited = new Set();
    const q = [start];
    while (q.length) {
      const u = q.shift();
      for (const e of index.unlocksOf.get(u) ?? []) {
        if (visited.has(e.topicId)) continue;
        visited.add(e.topicId); q.push(e.topicId);
      }
    }
    return visited.size;
  };
  for (const { id, side } of nodes.values()) {
    const c = side === 'next' ? nextReachCount(id) : hardPreHidden(id);
    if (c > 0) truncated.set(id, c);
  }

  const counts = {
    pre: [...nodes.values()].filter((n) => n.side === 'pre').length,
    next: [...nodes.values()].filter((n) => n.side === 'next').length,
    hidden: truncated.get(rootId) ?? 0,
    chainLen,
    closureNext,
    nextByTerm,
    preComplete: usedLevels >= preLevelsTotal,
    preLevels: usedLevels,
    preLevelsTotal,
  };
  return {
    rootId, nodes, edges, truncated, counts,
    chain: { ids: chainIds, edgeKeys: chainEdgeKeys, idSet: new Set(chainIds) },
  };
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

// 学习内容层（D-030）：学科 → data/lessons/<code>.json 文件码表。
// 独立于 scripts/validate.mjs 的 SUBJECT_CODE（那里数学为 null 的历史 id
// 格式约定）；这里按学科名单独命名，道法/思政按学科各一个文件。
// scripts/validate.mjs 与 viewer/lesson.js 共用本表，避免多份副本。
export const LESSON_FILE_CODE = {
  '数学': 'math', '语文': 'yw', '英语': 'yy', '物理': 'wl', '化学': 'hx',
  '生物学': 'sw', '历史': 'ls', '地理': 'dl', '道德与法治': 'zz', '思想政治': 'sxzz',
};

/** 学科 → 学习内容文件码（data/lessons/<code>.json）；未知学科返回 null。 */
export const lessonFileOf = (subject) => LESSON_FILE_CODE[subject] ?? null;
