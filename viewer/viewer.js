// viewer/viewer.js — DOM 渲染与交互（零构建、无框架）。
// 数据：浏览器直接 fetch data/*.json（GitHub Pages 与本地静态服务器同构）。

import {
  buildIndex, prereqTree, unlockTree, treeStats, dedupeTree,
  qualityMetrics, filterTopics, renderPrompt,
} from './logic.js';
import { Graph3D, buildLayout, subjectDeep } from './graph3d.js';
import { PathMap } from './pathmap.js';
import { initLessonDrawer } from './lesson.js';

const DATA_BASE = '../data/';
const TYPE_ZH = {
  CONCEPTUAL: '概念性', PROCEDURAL: '过程性', REPRESENTATIONAL: '表征性',
  LANGUAGE: '语言性', META: '元认知',
};
const SEMESTER_ZH = { '上': '上册', '下': '下册' };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  index: null,
  view: 'graph',            // graph | quality
  selectedId: null,
  query: '', subject: '', grade: 0, domain: '',   // subject = 侧栏当前下钻的学科
  childName: '孩子',
  volOpen: new Set(),        // 册手风琴展开状态（key = 学科|册，跨筛选保留）
  stdByKey: new Map(),      // 课标 key -> { title, curriculum }（详情页代码可读化）
  trees: {},                // 当前详情的先修/解锁树（去重后），供折叠分支按需渲染
};

// ---------- 数据加载 ----------
async function load() {
  const [topicsDoc, depsDoc, standardsDoc] = await Promise.all([
    fetch(`${DATA_BASE}topics.json`).then((r) => r.json()),
    fetch(`${DATA_BASE}dependencies.json`).then((r) => r.json()),
    fetch(`${DATA_BASE}curriculum-standards.json`).then((r) => r.json()),
  ]);
  state.index = buildIndex(topicsDoc, depsDoc);
  lessonDrawer = initLessonDrawer({ index: state.index, dataBase: DATA_BASE });
  state.standards = standardsDoc;
  for (const c of standardsDoc.curricula ?? []) {
    for (const s of c.topics ?? []) state.stdByKey.set(s.key, { title: s.title, curriculum: c.title });
  }
  const subjCount = [...new Set(topicsDoc.topics.map((t) => t.subject))];
  $('#brand-sub').textContent =
    `${subjCount.join(' · ')} · ${topicsDoc.topics.length} 知识点 · ${depsDoc.dependencies.length} 先修边 · ${topicsDoc.version}`;
  initControls();
  renderList();
  renderQuality();   // 预渲染质量视图（切页签零延迟）
  applyHash();
}

// ---------- 控件 ----------
const SUBJECT_ORDER = ['数学', '语文', '英语', '物理', '化学', '生物学', '历史', '地理', '道德与法治', '思想政治'];

function initControls() {
  fillGradeAndDomainOptions();

  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
  $('#grade').addEventListener('change', (e) => { state.grade = +e.target.value; renderList(); });
  $('#domain').addEventListener('change', (e) => {
    state.domain = e.target.value;
    // 学科层选中其他学科的领域（数学层选「力学」）：退回全部学科层再看该领域
    if (state.subject && state.domain &&
        !state.index.topics.some((t) => t.subject === state.subject && t.domain === state.domain)) {
      state.subject = '';
      fillGradeAndDomainOptions();
    }
    renderList();
  });
  $('#back-btn').addEventListener('click', () => {
    state.subject = '';                 // 返回学科层（volOpen 保留，再进该科时还在）
    fillGradeAndDomainOptions();
    renderList();
  });
  $('#tab-graph').addEventListener('click', () => switchView('graph'));
  $('#tab-graph3d').addEventListener('click', () => switchView('graph3d'));
  $('#tab-quality').addEventListener('click', () => switchView('quality'));
  window.addEventListener('hashchange', applyHash);
}

function fillGradeAndDomainOptions() {
  const scoped = state.index.topics.filter((t) => !state.subject || t.subject === state.subject);
  const gradeSel = $('#grade'), domainSel = $('#domain');
  const keepGrade = state.grade, keepDomain = state.domain;
  gradeSel.innerHTML = '<option value="0">全部</option>' +
    [...new Set(scoped.map((t) => t.grade))].sort((a, b) => a - b)
      .map((g) => `<option value="${g}">${g} 年级</option>`).join('');
  // 领域保持全量、按学科分组（当前学科组在最前）：下钻某科时其余学科领域仍可选，
  // 选中即退回全部学科层——顶栏筛选不随侧栏下钻缩水，避免看起来「只剩本学科」
  const domBySubj = new Map();
  for (const t of state.index.topics) {
    if (!domBySubj.has(t.subject)) domBySubj.set(t.subject, new Set());
    domBySubj.get(t.subject).add(t.domain);
  }
  const subjOrder = [...domBySubj.keys()].sort((a, b) =>
    (b === state.subject ? 1 : 0) - (a === state.subject ? 1 : 0) ||
    SUBJECT_ORDER.indexOf(a) - SUBJECT_ORDER.indexOf(b));
  domainSel.innerHTML = '<option value="">全部</option>' + subjOrder.map((s) =>
    `<optgroup label="${esc(s)}">${[...domBySubj.get(s)].map((d) =>
      `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</optgroup>`).join('');
  gradeSel.value = String(keepGrade || 0);
  if (keepDomain && ![...scoped].some((t) => t.domain === keepDomain)) state.domain = '';
  domainSel.value = state.domain;
}

function switchView(view) {
  state.view = view;
  $('#tab-graph').classList.toggle('active', view === 'graph');
  $('#tab-graph3d').classList.toggle('active', view === 'graph3d');
  $('#tab-quality').classList.toggle('active', view === 'quality');
  const qp = $('#quality-panel');
  if (qp) qp.hidden = view !== 'quality';   // 与 3D 的 hidden 机制一致
  $('.side').style.display = view === 'graph' ? '' : 'none';
  $('#detail').style.display = view === 'graph' ? '' : 'none';
  const g3 = $('#graph3d-mount');
  g3.hidden = view !== 'graph3d';
  if (view === 'graph3d') initGraph3D();
}

function applyHash() {
  const m = location.hash.match(/^#id=(ct_[\w]+)/);
  if (m && state.index.byId.has(m[1])) selectTopic(m[1], { scroll: true });
  // 学习内容深链 #lesson=ct_xx：背后同步选中该知识点，关闭抽屉即落在详情
  const l = location.hash.match(/^#lesson=(ct_[\w]+)/);
  if (l && lessonDrawer && state.index.byId.has(l[1])) {
    selectTopic(l[1], { scroll: true });
    lessonDrawer.open(l[1]);
  } else if (lessonDrawer?.isOpen()) {
    // hash 导航离开 #lesson= 时收起抽屉，避免背后详情已换、抽屉还残留旧知识点内容
    lessonDrawer.close();
  }
}

// ---------- 列表（三级下钻导航：学科列表 → 学科内册(可折叠) → 知识点行；搜索时全局结果视图） ----------
const volKey = (t) => `${t.subject}|${state.index.volumeOf(t)}`;

function renderList({ revealSelected = false } = {}) {
  const { index } = state;
  const q = state.query.trim();
  const itemHtml = (t, ctx = '') => {
    const island = index.inDeg.get(t.id) === 0 && index.outDeg.get(t.id) === 0;
    return `
      <button class="item ${t.id === state.selectedId ? 'sel' : ''}" data-id="${esc(t.id)}" type="button">
        <div class="row1">
          <span class="name">${esc(t.name)}</span>
        </div>
        <div class="row2">
          ${ctx}${island ? '<span class="island-flag">孤岛</span> · ' : ''}${esc(t.domain)} · ${t.grade}${SEMESTER_ZH[t.semester] ?? ''}
        </div>
      </button>`;
  };

  // 按册分组（volumeOrder 全局册序），组内保持 id 顺序
  const groupByVol = (list) => {
    const m = new Map();
    for (const t of list) {
      const v = index.volumeOf(t);
      if (!m.has(v)) m.set(v, []);
      m.get(v).push(t);
    }
    return [...m.entries()]
      .sort((a, b) => (index.volumeOrder.get(a[0]) ?? 0) - (index.volumeOrder.get(b[0]) ?? 0));
  };
  const bindItems = (root) => {
    root.querySelectorAll('.item').forEach((el) =>
      el.addEventListener('click', () => selectTopic(el.dataset.id)));
  };
  const setHead = (title, back = false) => {
    $('#list-title').textContent = title;
    $('#back-btn').hidden = !back;
  };

  // ---- 视图一：搜索（全局，忽略下钻层级；命中按 学科·册 分组平铺） ----
  if (q) {
    const hits = filterTopics(index, { ...state, subject: '' });
    setHead(`搜索「${q}」`);
    $('#list-count').textContent = `${hits.length} 个知识点`;
    const bySubj = new Map();
    for (const t of hits) {
      if (!bySubj.has(t.subject)) bySubj.set(t.subject, []);
      bySubj.get(t.subject).push(t);
    }
    const html = [...bySubj.keys()]
      .sort((a, b) => SUBJECT_ORDER.indexOf(a) - SUBJECT_ORDER.indexOf(b))
      .map((s) => groupByVol(bySubj.get(s)).map(([vol, ts]) => `
        <div class="group-h">${esc(s)} · ${esc(vol)}（${ts.length}）</div>
        ${ts.map((t) => itemHtml(t)).join('')}`).join('')).join('');
    $('#list').innerHTML = html || '<p class="muted" style="padding:12px">没有匹配的知识点。</p>';
    bindItems($('#list'));
    if (revealSelected) $('#list .item.sel')?.scrollIntoView({ block: 'nearest' });
    return;
  }

  // ---- 视图二：学科列表（顶栏年级/领域筛选反映为每科命中数；0 命中置灰） ----
  if (!state.subject) {
    const scoped = filterTopics(index, { ...state, subject: '', query: '' });
    const bySubj = new Map();
    for (const t of scoped) bySubj.set(t.subject, (bySubj.get(t.subject) ?? 0) + 1);
    const subjects = [...new Set(index.topics.map((t) => t.subject))]
      .sort((a, b) => SUBJECT_ORDER.indexOf(a) - SUBJECT_ORDER.indexOf(b));
    setHead('全部学科');
    $('#list-count').textContent = `${subjects.length} 科 · ${scoped.length} 个知识点`;
    $('#list').innerHTML = subjects.map((s) => {
      const n = bySubj.get(s) ?? 0;
      return `
      <button class="subj-row" data-subject="${esc(s)}" type="button"${n ? '' : ' disabled'}>
        <span class="sr-dot" style="background:${subjectDeep(s)}" aria-hidden="true"></span>
        <span class="sr-name">${esc(s)}</span><span class="sr-cnt">${n} 个知识点 ›</span>
      </button>`;
    }).join('');
    $('#list').querySelectorAll('.subj-row:not([disabled])').forEach((el) =>
      el.addEventListener('click', () => {
        state.subject = el.dataset.subject;
        fillGradeAndDomainOptions();   // 年级/领域选项随学科范围刷新
        renderList();
      }));
    return;
  }

  // ---- 视图三：学科内册手风琴（默认全收，点册展开知识点；选中/直达自动展开定位） ----
  const list = filterTopics(index, state);
  setHead(state.subject, true);
  $('#list-count').textContent = `${list.length} 个知识点`;
  const selTopic = state.selectedId && index.byId.get(state.selectedId);
  const selKey = selTopic && selTopic.subject === state.subject ? volKey(selTopic) : null;
  const html = groupByVol(list).map(([vol, ts]) => {
    const key = `${state.subject}|${vol}`;
    const open = state.volOpen.has(key) || key === selKey;
    return `
    <details class="vol-group" data-vol="${esc(key)}"${open ? ' open' : ''}>
      <summary><span class="sg-name">${esc(vol)}</span><span class="sg-cnt">${ts.length} 个知识点</span></summary>
      ${ts.map((t) => itemHtml(t)).join('')}
    </details>`;
  }).join('');
  $('#list').innerHTML = html || '<p class="muted" style="padding:12px">该学科没有匹配筛选的知识点。</p>';
  bindItems($('#list'));
  if (revealSelected) $('#list .item.sel')?.scrollIntoView({ block: 'nearest' });
}

// 册手风琴开合状态同步（innerHTML 重渲染后不丢；key = 学科|册）
document.addEventListener('toggle', (ev) => {
  const el = ev.target;
  if (!(el instanceof HTMLDetailsElement) || !el.classList.contains('vol-group')) return;
  if (el.open) state.volOpen.add(el.dataset.vol);
  else state.volOpen.delete(el.dataset.vol);
}, true);

// ---------- 详情 ----------
let pathmapIns = null;   // 学习路径图实例（renderDetail 重建时随之销毁重建）
let lessonDrawer = null; // 学习内容抽屉（lesson.js，全局单例，懒加载数据）

function selectTopic(id, { scroll = false } = {}) {
  const t = state.index.byId.get(id);
  // 从搜索/3D/hash/详情树链接进入且不在当前学科层：自动下钻到该科并展开所在册
  if (t && t.subject !== state.subject) {
    state.subject = t.subject;
    state.volOpen.add(volKey(t));
    fillGradeAndDomainOptions();
  }
  state.selectedId = id;
  history.replaceState(null, '', `#id=${id}`);
  renderList({ revealSelected: true });
  renderDetail();
  if (scroll) $('#detail').scrollTo({ top: 0 });
}

function topicLink(t) {
  return `<button class="tlink" data-id="${esc(t.id)}" type="button">${esc(t.name)}</button>`;
}

// 树渲染：去重后按需展开——前 TREE_OPEN_DEPTH 层直接渲染，更深的子树
// 折叠为 <details>，toggle 时从 state.trees 取子树增量渲染（否则稠密
// 解锁树一次性渲染数万节点）；repeat 节点（子树已在上方展开）只显示标记。
const TREE_OPEN_DEPTH = 3;

function treeNodeHtml(n, path, depth, kind) {
  const { index } = state;
  const t = index.byId.get(n.id);
  const via = n.via ? `<span class="tvia"><span class="edge ${esc(n.via.strength)}">${n.via.strength === 'hard' ? '必需' : '有益'}</span> — ${esc(n.via.reason)}</span>` : '';
  let kids = '';
  if (n.repeat) {
    kids = '<div class="trepeat">↺ 子树已在上方展开</div>';
  } else if (n.nodes.length) {
    kids = depth + 1 < TREE_OPEN_DEPTH
      ? `<div class="tree">${n.nodes.map((c, i) => treeNodeHtml(c, `${path}.${i}`, depth + 1, kind)).join('')}</div>`
      : `<details class="tbranch" data-kind="${esc(kind)}" data-path="${esc(path)}"><summary>▸ 展开 ${n.nodes.length} 个${kind === 'prereq' ? '先修' : '后续'}知识点</summary></details>`;
  }
  return `
      <div class="tnode">
        <div class="trow">${topicLink(t)} ${via}</div>
        ${kids}
      </div>`;
}

function renderTree(kind) {
  const tree = state.trees[kind];
  return `<div class="tree">${tree.nodes.map((n, i) => treeNodeHtml(n, String(i), 0, kind)).join('')}</div>`;
}

// toggle 不冒泡，用捕获阶段委托：折叠分支首次展开时渲染实际子树
document.addEventListener('toggle', (ev) => {
  const el = ev.target;
  if (!(el instanceof HTMLDetailsElement) || !el.classList.contains('tbranch') || el.dataset.done) return;
  el.dataset.done = '1';
  const kind = el.dataset.kind;
  let nodes = state.trees[kind]?.nodes ?? [];
  for (const i of el.dataset.path.split('.').filter(Boolean)) nodes = nodes[+i]?.nodes ?? [];
  el.insertAdjacentHTML('beforeend',
    `<div class="tree">${nodes.map((n, i) => treeNodeHtml(n, `${el.dataset.path}.${i}`, TREE_OPEN_DEPTH, kind)).join('')}</div>`);
}, true);

function bindTreeLinks(container) {
  container.querySelectorAll('.tlink').forEach((el) =>
    el.addEventListener('click', () => selectTopic(el.dataset.id, { scroll: true })));
}

function renderDetail() {
  const { index } = state;
  const t = state.selectedId && index.byId.get(state.selectedId);
  const el = $('#detail');
  if (!t) { el.innerHTML = el.dataset.placeholderHtml ?? ''; return; }

  const pTree = dedupeTree(prereqTree(index, t.id));
  const uTree = dedupeTree(unlockTree(index, t.id));
  const pStats = treeStats(pTree);
  const uStats = treeStats(uTree);
  state.trees = { prereq: pTree, unlock: uTree };

  // unit 为数字（数学等按单元号锚定）时拼「第 N 单元」，副科为整段文本时原样展示
  const unit = t.textbook.unit;
  const unitText = typeof unit === 'number' ? `第 ${unit} 单元` : String(unit);

  el.innerHTML = `
    <div class="topic-head">
      <h2>${esc(t.name)}</h2>
      <span class="badge type-${esc(t.type)}">${TYPE_ZH[t.type] ?? t.type}</span>
      <span class="badge d-${esc(t.domain)}">${esc(t.domain)}</span>
    </div>
    <div class="meta-line">
      ${t.grade} 年级${SEMESTER_ZH[t.semester] ?? ''} · 年龄 ${t.ageRangeStart}–${t.ageRangeEnd} ·
      ${esc(t.textbook.publisher)}${t.grade}${SEMESTER_ZH[t.semester] ?? ''} ${esc(unitText)}（${t.textbook.editionYear} 版）
    </div>
    <p class="desc">${esc(t.description)}</p>

    <div class="lesson-entry-row">
      <button class="lesson-entry" type="button">📖 查看讲解与例题</button>
      <span class="muted">讲解 · 方法 · 例题，几分钟快速掌握</span>
    </div>

    <div class="sec">
      <h3>掌握证据</h3>
      <ul class="evidence">${t.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
    </div>

    ${t.assessmentPrompt ? `
    <div class="sec">
      <h3>测评问法</h3>
      <div class="prompt-box">
        <span class="lbl">在家就能测</span>
        <label class="pname">称呼 <input id="child-name" type="text" value="${esc(state.childName)}" maxlength="12" title="替换问法中的称呼"></label>
        <br><span id="prompt-text">${esc(renderPrompt(t.assessmentPrompt, state.childName))}</span>
      </div>
    </div>` : ''}

    ${t.standards?.length ? `
    <div class="sec">
      <h3>课标对齐</h3>
      <p>${t.standards.map((s) => {
        const m = state.stdByKey.get(s);
        return `<code title="${esc(m?.curriculum ?? '')}">${esc(s)}</code>${m ? ` <span class="std-title">${esc(m.title)}</span>` : ''}`;
      }).join('<br>')}</p>
    </div>` : ''}

    <div class="sec">
      <h3>学习路径 <span class="count">先修 ${pStats.uniqueCount} · 解锁 ${uStats.uniqueCount}${pStats.depth || uStats.depth ? ` · ${Math.max(pStats.depth, uStats.depth)} 层` : ''}（去重）</span></h3>
      <div id="pathmap" class="pathmap"></div>
      <details class="text-tree">
        <summary>列表视图：先修链与解锁树的文字版（适合复制、读屏）</summary>
        <div class="sec">
          <h3>↑ 先修链 <span class="count">${pStats.uniqueCount ? `${pStats.depth} 层 · ${pStats.uniqueCount} 个知识点（去重）` : '无先修（起点知识点）'}</span></h3>
          ${pStats.uniqueCount ? renderTree('prereq') : '<p class="muted">这是学习的起点，没有前置要求。</p>'}
        </div>
        <div class="sec">
          <h3>↓ 解锁树 <span class="count">${uStats.uniqueCount ? `${uStats.depth} 层 · ${uStats.uniqueCount} 个知识点（去重）` : '暂无后续知识点依赖它'}</span></h3>
          ${uStats.uniqueCount ? renderTree('unlock') : '<p class="muted">尚无更高年级知识点依赖它（后续册数据推进中）。</p>'}
        </div>
      </details>
    </div>`;
  bindTreeLinks(el);
  el.querySelector('.lesson-entry')?.addEventListener('click', () => lessonDrawer?.open(t.id));
  // 学习路径图：详情 DOM 每次 innerHTML 重建，组件随建随毁（单实例，防 rAF 泄漏）
  if (pathmapIns) pathmapIns.destroy();
  pathmapIns = new PathMap(el.querySelector('#pathmap'), {
    index,
    onOpen: (id) => selectTopic(id, { scroll: true }),
    onLesson: (id) => lessonDrawer?.open(id),
  });
  pathmapIns.setRoot(t.id);
  window.__pm = pathmapIns;   // 调试钩子:控制台可检查布局/视图状态
  // 称呼输入即时重渲染问法文本（不整页重渲，避免输入焦点丢失）
  const nameInput = el.querySelector('#child-name');
  if (nameInput) nameInput.addEventListener('input', () => {
    state.childName = nameInput.value;
    const p = el.querySelector('#prompt-text');
    if (p) p.textContent = renderPrompt(t.assessmentPrompt, state.childName);
  });
}

// placeholder 初始内容留档（首次渲染后复用）
document.addEventListener('DOMContentLoaded', () => {
  const el = $('#detail');
  el.dataset.placeholderHtml = el.innerHTML;
});

// ---------- 质量视图（口径对齐 scripts/report.mjs） ----------
function renderQuality() {
  const m = qualityMetrics(state.index);
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  // 条形按本表最大值归一化（同表可比，跨表不受总数影响）；宽度为列内百分比，随容器缩放
  const distTable = (rows, firstCol) => {
    const maxN = Math.max(1, ...rows.map(([, n]) => n));
    return `<table class="qt">
      <tr><th>${esc(firstCol)}</th><th class="num">数量</th><th class="barcell-h">分布</th></tr>${
      rows.sort((a, b) => b[1] - a[1]).map(([k, n]) =>
        `<tr><td>${esc(k)}</td><td class="num">${n}</td><td class="barcell"><div class="bar" style="width:${(n / maxN * 100).toFixed(1)}%"></div></td></tr>`).join('')}</table>`;
  };

  const el = document.createElement('div');
  el.id = 'quality-panel';
  el.hidden = true;
  el.innerHTML = `
    <div class="qwrap">
      <h2 class="qtitle">数据质量自查</h2>
      <p class="muted">口径与 <code>scripts/report.mjs</code> 一致，供维护者在批次合入前后对照。</p>
      <div class="qcards">
        <div class="qcard"><div class="v">${m.topicCount}</div><div class="k">知识点</div></div>
        <div class="qcard"><div class="v">${m.edgeCount}</div><div class="k">先修边（${m.hardCount} hard / ${m.edgeCount - m.hardCount} soft）</div></div>
        <div class="qcard"><div class="v">${m.edgeDensity}</div><div class="k">边密度（对标 ≈2.0）</div></div>
        <div class="qcard ${m.islands.length ? 'bad' : 'ok'}"><div class="v">${m.islands.length}</div><div class="k">孤岛知识点（目标 0）</div></div>
        <div class="qcard ${m.noPrompt.length ? 'bad' : 'ok'}"><div class="v">${pct(m.promptCoverage)}</div><div class="k">测评问法覆盖（目标 100%）</div></div>
        <div class="qcard ${m.noStandards.length / Math.max(1, m.topicCount) > 0.05 ? 'bad' : 'ok'}"><div class="v">${pct(m.standardsCoverage)}</div><div class="k">课标引用覆盖（目标 ≥95%）</div></div>
        <div class="qcard ${m.inverted.length ? 'bad' : 'ok'}"><div class="v">${m.inverted.length}</div><div class="k">跨年级倒挂边（目标 0）</div></div>
        <div class="qcard"><div class="v">${m.roots.length}</div><div class="k">起点知识点（参考）</div></div>
      </div>

      ${m.islands.length ? `<div class="sec"><h3>孤岛知识点</h3><ul class="evidence">${m.islands.map((t) => `<li>${esc(t.id)} ${esc(t.name)}</li>`).join('')}</ul></div>` : ''}
      ${m.noPrompt.length ? `<div class="sec"><h3>缺测评问法</h3><ul class="evidence">${m.noPrompt.map((t) => `<li>${esc(t.id)} ${esc(t.name)}</li>`).join('')}</ul></div>` : ''}
      ${m.inverted.length ? `<div class="sec"><h3>跨年级倒挂边</h3><ul class="evidence">${m.inverted.map((x) => `<li>${esc(x.t.id)}（${x.t.grade} 年级）← ${esc(x.p.id)}（${x.p.grade} 年级）</li>`).join('')}</ul></div>` : ''}

      <div class="qgrid">
        <div class="sec"><h3>学科分布</h3>${distTable(m.bySubject, '学科')}</div>
        <div class="sec"><h3>类型分布</h3>${distTable(m.byType.map(([k, n]) => [TYPE_ZH[k] ?? k, n]), '类型')}</div>
      </div>
      <div class="sec"><h3>分册分布</h3>${distTable(m.byVolume, '册')}</div>
      <details class="qfold">
        <summary>领域分布 <span class="count">${m.byDomain.length} 个 · 跨学科平铺（含「学科·」前缀），默认收起</span></summary>
        ${distTable(m.byDomain, '领域')}
      </details>
    </div>`;

  $('#detail').parentElement.appendChild(el);
}

// ---------- 3D 全景（惰性初始化一次） ----------
let graph3d = null;
function initGraph3D() {
  if (graph3d) { graph3d.resize(); return; }
  graph3d = new Graph3D($('#graph3d-mount'), buildLayout(state.index), {
    onOpenTopic: (id) => { switchView('graph'); selectTopic(id); },
    onLesson: (id) => lessonDrawer?.open(id),
  });
  // 调试钩子：控制台可检查相机/选中状态
  window.__g3 = graph3d;
}

load().catch((err) => {
  $('#brand-sub').textContent = '数据加载失败';
  console.error(err);
  $('#list').innerHTML = `<p class="muted" style="padding:12px">
    加载 ${DATA_BASE}*.json 失败：${esc(err.message)}。<br>
    请通过静态服务器访问（如 <code>python -m http.server</code> 后打开
    <code>/viewer/</code>），直接双击 HTML 会因 file:// CORS 受限。</p>`;
});
