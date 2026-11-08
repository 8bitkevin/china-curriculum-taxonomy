// viewer/viewer.js — DOM 渲染与交互（零构建、无框架）。
// 数据：浏览器直接 fetch data/*.json（GitHub Pages 与本地静态服务器同构）。

import {
  buildIndex, prereqTree, unlockTree, treeStats, dedupeTree,
  qualityMetrics, filterTopics, renderPrompt,
} from './logic.js';
import { Graph3D, buildLayout, subjectDeep } from './graph3d.js';
import { PathMap } from './pathmap.js';
import { initLessonDrawer } from './lesson.js?v=ui10';

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
  lessonDrawer = initLessonDrawer({
    index: state.index,
    dataBase: DATA_BASE,
    onClose: () => {
      state.lessonId = null;
      syncHash(true);   // 抽屉关闭 → URL 归一化回 #id=…（replace，不新增历史）
    },
  });
  state.standards = standardsDoc;
  for (const c of standardsDoc.curricula ?? []) {
    for (const s of c.topics ?? []) state.stdByKey.set(s.key, { title: s.title, curriculum: c.title });
  }
  const subjCount = [...new Set(topicsDoc.topics.map((t) => t.subject))];
  $('#brand-sub').textContent =
    `${subjCount.join(' · ')} · ${topicsDoc.topics.length} 知识点 · ${depsDoc.dependencies.length} 先修边 · ${topicsDoc.version}`;
  initControls();
  initLanding();
  renderList();
  renderQuality();   // 预渲染质量视图（切页签零延迟）
  applyHash();
}

// ---------- 控件 ----------
const SUBJECT_ORDER = ['数学', '语文', '英语', '物理', '化学', '生物学', '历史', '地理', '道德与法治', '思想政治'];

function initControls() {
  fillGradeAndDomainOptions();

  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    if (!state.selectedId) syncHash(true);   // 搜索词入 URL（replace，不刷历史）；选中详情时保持 #id=
    renderList();
  });
  $('#grade').addEventListener('change', (e) => {
    state.grade = +e.target.value;
    if (!state.selectedId) syncHash(true);
    renderList();
  });
  $('#domain').addEventListener('change', (e) => {
    state.domain = e.target.value;
    // 学科层选中其他学科的领域（数学层选「力学」）：退回全部学科层再看该领域
    if (state.subject && state.domain &&
        !state.index.topics.some((t) => t.subject === state.subject && t.domain === state.domain)) {
      state.subject = '';
      fillGradeAndDomainOptions();
    }
    if (!state.selectedId) syncHash(true);
    renderList();
  });
  $('#back-btn').addEventListener('click', () => navTo(''));   // 返回全部学科（volOpen 保留，再进该科时还在）
  $('#tab-graph').addEventListener('click', () => gotoView('graph'));
  $('#tab-graph3d').addEventListener('click', () => gotoView('graph3d'));
  $('#tab-quality').addEventListener('click', () => gotoView('quality'));
  $('#brand-home').addEventListener('click', () => navTo(''));   // 品牌 = 回首页（落地页）
  window.addEventListener('hashchange', applyHash);
  window.addEventListener('popstate', applyHash);   // 浏览器返回/前进
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

// ---------- 路由（hash = 唯一真相）----------
// URL 参数：view=3d|quality · q=搜索词 · subject/grade/domain=列表筛选 · id=知识点 · lesson=抽屉
// 用户动作 → navTo(push)：浏览器返回/前进可逐级回退（首页 ⇄ 学科 ⇄ 筛选 ⇄ 知识点 ⇄ 抽屉）；
// 返回/前进 → popstate/hashchange → applyHash 按 URL 重建状态。站内历史用 history.state.app 标记。
function parseHash() {
  const p = {};
  for (const kv of location.hash.replace(/^#/, '').split('&')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    const k = i < 0 ? kv : kv.slice(0, i);
    try { p[k] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1)); }
    catch { p[k] = i < 0 ? '' : kv.slice(i + 1); }
  }
  return p;
}

function hashFor() {
  if (state.view === 'graph3d') return '#view=3d';
  if (state.view === 'quality') return '#view=quality';
  if (state.selectedId) {
    const p = [`id=${state.selectedId}`];
    if (state.lessonId) p.push(`lesson=${state.lessonId}`);   // 抽屉可展示其他知识点的讲解
    return `#${p.join('&')}`;
  }
  const p = [];
  if (state.query) p.push(`q=${encodeURIComponent(state.query)}`);
  if (state.subject) p.push(`subject=${encodeURIComponent(state.subject)}`);
  if (state.grade) p.push(`grade=${state.grade}`);
  if (state.domain) p.push(`domain=${encodeURIComponent(state.domain)}`);
  return p.length ? `#${p.join('&')}` : '';
}

// 导航到目标 hash：push 进历史（replace=true 则只替换当前条目，用于搜索词/筛选等高频变更）
function navTo(hash, { replace = false } = {}) {
  const url = hash || location.pathname + location.search;
  if (replace) history.replaceState({ app: 1 }, '', url);
  else history.pushState({ app: 1 }, '', url);
  applyHash();   // pushState 不触发 hashchange，需手动应用；_hash 由 applyHash 自己记录
}

// 按当前 state 归一化 URL（抽屉开合、筛选微调后调用）
const syncHash = (replace = false) => navTo(hashFor(), { replace });

// 视图切换的纯 UI 应用（不带路由；路由入口一律走 navTo → applyHash → 这里）
function applyViewState(view) {
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

const VIEW_HASH = { graph: '', graph3d: '#view=3d', quality: '#view=quality' };
function gotoView(view) {
  if (state.view === view) return;
  navTo(VIEW_HASH[view] ?? '');
}

// 详情页「‹ 返回」：有站内历史则原生回退，深链直达无站内历史则回首页
function goBackOrHome() {
  if (history.state && history.state.app) history.back();
  else navTo('');
}

function applyHash() {
  if (state._hash === location.hash) return;   // 幂等：同一 hash 不重复应用
  if (!state.index) return;                    // 数据未就绪：保持 _hash 未更新，load() 完成后重放
  state._hash = location.hash;
  const params = parseHash();

  // 1) 视图（3D/质量自查页签也是路由的一部分，可深链、可返回）
  const view = params.view === '3d' ? 'graph3d' : params.view === 'quality' ? 'quality' : 'graph';
  if (view !== state.view) applyViewState(view);
  if (view !== 'graph') return;

  // 2) 知识点态（#id= / 兼容旧深链 #lesson=）
  const target = params.lesson || params.id || '';
  if (target && state.index.byId.has(target)) {
    if (state.selectedId !== target) selectTopic(target, { scroll: true, fromHash: true });
    if (params.lesson && state.index.byId.has(params.lesson)) {
      if (!lessonDrawer || state.lessonId !== params.lesson || !lessonDrawer.isOpen()) {
        openLessonDrawer(params.lesson);
      }
    } else if (lessonDrawer?.isOpen()) {
      lessonDrawer.close();   // onClose 会 syncHash 归一化 URL
    }
    return;
  }

  // 3) 列表/落地态：subject/grade/domain/q 全量按 URL 对齐
  state.selectedId = null;
  state.lessonId = null;
  state.query = params.q || '';
  state.subject = params.subject || '';
  state.grade = +(params.grade || 0) || 0;
  state.domain = params.domain || '';
  $('#search').value = state.query;
  fillGradeAndDomainOptions();
  renderList();
  showLanding();
  syncMatrixSel();
  if (lessonDrawer?.isOpen()) lessonDrawer.close();
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
      el.addEventListener('click', () =>
        navTo(`#subject=${encodeURIComponent(el.dataset.subject)}`)));
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

function selectTopic(id, { scroll = false, fromHash = false } = {}) {
  const t = state.index.byId.get(id);
  if (!t) return;
  const changed = state.selectedId !== id;
  // 从搜索/3D/hash/详情树链接进入且不在当前学科层：自动下钻到该科并展开所在册
  if (t.subject !== state.subject) {
    state.subject = t.subject;
    state.volOpen.add(volKey(t));
    fillGradeAndDomainOptions();
  }
  state.selectedId = id;
  recordRecent(id);
  if (!fromHash && changed) syncHash(false);   // push #id=…：浏览器返回键可逐级回退到上一个知识点/列表态
  renderList({ revealSelected: true });
  renderDetail();
  if (scroll) $('#detail').scrollTo({ top: 0 });
}

// 抽屉打开统一入口：记录抽屉知识点（可与当前详情不同源，如路径图节点）并同步 URL
function openLessonDrawer(id) {
  if (!lessonDrawer || !state.index.byId.has(id)) return;
  state.lessonId = id;
  lessonDrawer.open(id);
  syncHash(true);   // #id=当前详情&lesson=抽屉知识点（replace，不新增历史）
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
  if (!t) { showLanding(); return; }
  detachLanding();   // innerHTML 重建详情前摘下落地页节点（含矩阵/最近浏览状态）复用

  const pTree = dedupeTree(prereqTree(index, t.id));
  const uTree = dedupeTree(unlockTree(index, t.id));
  const pStats = treeStats(pTree);
  const uStats = treeStats(uTree);
  state.trees = { prereq: pTree, unlock: uTree };

  // unit 为数字（数学等按单元号锚定）时拼「第 N 单元」，副科为整段文本时原样展示
  const unit = t.textbook.unit;
  const unitText = typeof unit === 'number' ? `第 ${unit} 单元` : String(unit);

  el.innerHTML = `
    <button class="detail-back" type="button" data-detail-back>‹ 返回</button>
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
  el.querySelector('[data-detail-back]')?.addEventListener('click', goBackOrHome);
  el.querySelector('.lesson-entry')?.addEventListener('click', () => openLessonDrawer(t.id));
  // 学习路径图：详情 DOM 每次 innerHTML 重建，组件随建随毁（单实例，防 rAF 泄漏）
  if (pathmapIns) pathmapIns.destroy();
  pathmapIns = new PathMap(el.querySelector('#pathmap'), {
    index,
    onOpen: (id) => selectTopic(id, { scroll: true }),
    onLesson: (id) => openLessonDrawer(id),
    onSubject: (s) => navTo(`#subject=${encodeURIComponent(s)}`),   // 清搜索等由 applyHash 统一处理
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

// ---------- 落地页（未选中知识点的空态：三问 Hero + 年级×学科矩阵 + 三步导览 + 精选示例） ----------
// 节点整块摘下复用：详情 innerHTML 重建不销毁它，回空态时原样放回（保留矩阵选中/最近浏览）
let landingEl = null;

function detachLanding() {
  if (landingEl) return;
  const ph = document.getElementById('landing');
  if (ph) { landingEl = ph; ph.remove(); }
}

function showLanding() {
  const el = $('#detail');
  if (landingEl && !landingEl.isConnected) { el.innerHTML = ''; el.appendChild(landingEl); }
}

// 学段分段：矩阵分组标签与 pathmap 的学段口径一致
const GRADE_BAND = (g) => (g <= 6 ? '小学' : g <= 9 ? '初中' : '高中');
const RECENT_KEY = 'k12-graph-recent';
const RECENT_MAX = 4;

function initLanding() {
  const { index } = state;
  const subjects = [...new Set(index.topics.map((t) => t.subject))]
    .sort((a, b) => SUBJECT_ORDER.indexOf(a) - SUBJECT_ORDER.indexOf(b));
  const grades = [...new Set(index.topics.map((t) => t.grade))].sort((a, b) => a - b);
  const cnt = new Map();
  for (const t of index.topics) {
    const k = `${t.grade}|${t.subject}`;
    cnt.set(k, (cnt.get(k) ?? 0) + 1);
  }

  // ---- 年级×学科矩阵（真实计数；点击=路由到 subject+grade，侧栏下钻由 applyHash 统一应用） ----
  const mx = document.getElementById('landing-matrix');
  const bands = [];
  for (const g of grades) {
    const b = GRADE_BAND(g);
    if (!bands.length || bands[bands.length - 1].name !== b) bands.push({ name: b, from: g, to: g });
    else bands[bands.length - 1].to = g;
  }
  mx.innerHTML =
    `<div class="mx-hcell" aria-hidden="true"></div>` +
    subjects.map((s) =>
      `<div class="mx-hcell"><span class="dot" style="background:${subjectDeep(s)}"></span>${esc(s)}</div>`).join('') +
    bands.map((b, bi) => `<div class="mx-glabel${bi === 0 ? ' first' : ''}">${b.name}（${b.from}–${b.to} 年级）</div>` +
      Array.from({ length: b.to - b.from + 1 }, (_, i) => {
        const g = b.from + i;
        return `<div class="mx-grow">${g} 年</div>` + subjects.map((s) => {
          const n = cnt.get(`${g}|${s}`) ?? 0;
          if (!n) return `<span class="mx-zero" aria-hidden="true">–</span>`;
          return `<button class="mx-cell" type="button" data-g="${g}" data-s="${esc(s)}" aria-label="${g} 年级 ${esc(s)} ${n} 个知识点">${n}</button>`;
        }).join('');
      }).join('')).join('');
  mx.querySelectorAll('.mx-cell').forEach((cell) => cell.addEventListener('click', () => {
    navTo(`#subject=${encodeURIComponent(cell.dataset.s)}&grade=${cell.dataset.g}`);
  }));

  // ---- 搜索入口（Hero 输入/示例 chip → 顶栏搜索的全局结果视图；下钻状态保留，清搜索即回到原学科层） ----
  const heroInput = document.getElementById('landing-search');
  const doSearch = (q) => {
    q = q.trim();
    if (!q) { heroInput.focus(); return; }
    state.query = q;
    $('#search').value = q;
    heroInput.value = q;
    if (!state.selectedId) syncHash(true);   // #q=… 入 URL（replace）；选中详情时保持 #id=
    renderList();
  };
  document.getElementById('landing-search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    doSearch(heroInput.value);
  });
  document.querySelectorAll('#landing .chip[data-q]').forEach((el) =>
    el.addEventListener('click', () => doSearch(el.dataset.q)));

  // ---- 精选示例：按名称解析真实 id（名称失配即整卡下线，避免死链），填充真实度数并绑定直达 ----
  document.querySelectorAll('#landing .fcard').forEach((card) => {
    const t = index.topics.find((x) => x.name === card.dataset.topicName);
    if (!t) { card.remove(); return; }
    const parts = [`先修 ${index.inDeg.get(t.id) ?? 0} · 解锁 ${index.outDeg.get(t.id) ?? 0}`];
    if (t.standards?.length) parts.push('课标对齐 ✓');
    if (t.assessmentPrompt) parts.push('在家就能测 ✓');
    card.querySelector('[data-fstat]').textContent = parts.join(' · ');
    card.addEventListener('click', () => selectTopic(t.id, { scroll: true }));
  });

  // ---- 数据背书条（口径同质量自查页签） ----
  const m = qualityMetrics(index);
  document.getElementById('landing-stats').innerHTML =
    `<b>${m.topicCount}</b> 知识点 · <b>${m.edgeCount}</b> 先修边 · <b>${subjects.length}</b> 科 · ` +
    `<b>${grades[0]}–${grades[grades.length - 1]}</b> 全学段 · 课标对齐 <b>${(m.standardsCoverage * 100).toFixed(0)}%</b>` +
    ` · 测评问法 <b>${(m.promptCoverage * 100).toFixed(0)}%</b>`;

  // ---- 次级入口：3D 星系全景 ----
  document.getElementById('landing-g3d-link').addEventListener('click', (e) => {
    e.preventDefault();
    gotoView('graph3d');
  });

  renderRecent();
}

// 矩阵选中态与 URL 对齐（Back/Forward 回到列表态时恢复格子高亮与提示）
function syncMatrixSel() {
  const mx = document.getElementById('landing-matrix');
  if (!mx) return;
  mx.querySelectorAll('.mx-cell.sel').forEach((x) => x.classList.remove('sel'));
  const hint = document.getElementById('landing-matrix-hint');
  const cell = state.subject && state.grade
    ? [...mx.querySelectorAll('.mx-cell')].find((c) => c.dataset.g == state.grade && c.dataset.s === state.subject)
    : null;
  if (!cell) return;
  cell.classList.add('sel');
  hint.textContent = `已下钻「${state.subject} · ${state.grade} 年级」，左侧列表显示对应知识点；点左上角 ‹ 返回全部学科。`;
}

// ---- 最近浏览（localStorage，回访续接；失效 id 自动过滤） ----
function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}

function renderRecent(list = readRecent()) {
  const box = document.getElementById('landing-recent');
  if (!box) return;
  const valid = list.filter((x) => state.index?.byId.has(x.id));
  box.hidden = !valid.length;
  const listBox = document.getElementById('landing-recent-list');
  listBox.innerHTML = valid.map((x) =>
    `<button class="chip chip-recent" type="button" data-id="${esc(x.id)}">${esc(x.name)}</button>`).join('');
  listBox.querySelectorAll('.chip-recent').forEach((el) =>
    el.addEventListener('click', () => selectTopic(el.dataset.id, { scroll: true })));
}

function recordRecent(id) {
  const t = state.index.byId.get(id);
  if (!t) return;
  const list = readRecent().filter((x) => x.id !== id);
  list.unshift({ id, name: t.name });
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* 隐私模式等场景静默降级 */ }
  renderRecent(list.slice(0, RECENT_MAX));
}

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
    onOpenTopic: (id) => navTo(`#id=${id}`),   // 纯路由：视图切回图谱由 applyHash 统一处理
    onLesson: (id) => openLessonDrawer(id),
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
