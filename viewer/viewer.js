// viewer/viewer.js — DOM 渲染与交互（零构建、无框架）。
// 数据：浏览器直接 fetch data/*.json（GitHub Pages 与本地静态服务器同构）。

import {
  buildIndex, prereqTree, unlockTree, treeStats,
  qualityMetrics, filterTopics, renderPrompt,
} from './logic.js';
import { Graph3D, buildLayout } from './graph3d.js';

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
  query: '', grade: 0, domain: '',
  childName: '孩子',
};

// ---------- 数据加载 ----------
async function load() {
  const [topicsDoc, depsDoc, standardsDoc] = await Promise.all([
    fetch(`${DATA_BASE}topics.json`).then((r) => r.json()),
    fetch(`${DATA_BASE}dependencies.json`).then((r) => r.json()),
    fetch(`${DATA_BASE}curriculum-standards.json`).then((r) => r.json()),
  ]);
  state.index = buildIndex(topicsDoc, depsDoc);
  state.standards = standardsDoc;
  $('#brand-sub').textContent = `数学 · ${topicsDoc.topics.length} 微主题 · ${depsDoc.dependencies.length} 先修边 · ${topicsDoc.version}`;
  initControls();
  renderList();
  renderQuality();   // 预渲染质量视图（切页签零延迟）
  applyHash();
}

// ---------- 控件 ----------
function initControls() {
  const grades = [...new Set(state.index.topics.map((t) => t.grade))].sort((a, b) => a - b);
  $('#grade').insertAdjacentHTML('beforeend',
    grades.map((g) => `<option value="${g}">${g} 年级</option>`).join(''));
  const domains = [...new Set(state.index.topics.map((t) => t.domain))];
  $('#domain').insertAdjacentHTML('beforeend',
    domains.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join(''));

  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
  $('#grade').addEventListener('change', (e) => { state.grade = +e.target.value; renderList(); });
  $('#domain').addEventListener('change', (e) => { state.domain = e.target.value; renderList(); });
  $('#child-name').addEventListener('input', (e) => {
    state.childName = e.target.value; renderDetail();
  });
  $('#tab-graph').addEventListener('click', () => switchView('graph'));
  $('#tab-graph3d').addEventListener('click', () => switchView('graph3d'));
  $('#tab-quality').addEventListener('click', () => switchView('quality'));
  window.addEventListener('hashchange', applyHash);
}

function switchView(view) {
  state.view = view;
  $('#tab-graph').classList.toggle('active', view === 'graph');
  $('#tab-graph3d').classList.toggle('active', view === 'graph3d');
  $('#tab-quality').classList.toggle('active', view === 'quality');
  const qp = $('#quality-panel');
  if (qp) qp.style.display = view === 'quality' ? '' : 'none';
  $('.side').style.display = view === 'graph' ? '' : 'none';
  $('#detail').style.display = view === 'graph' ? '' : 'none';
  const g3 = $('#graph3d-mount');
  g3.hidden = view !== 'graph3d';
  if (view === 'graph3d') initGraph3D();
}

function applyHash() {
  const m = location.hash.match(/^#id=(ct_[\w]+)/);
  if (m && state.index.byId.has(m[1])) selectTopic(m[1], { scroll: true });
}

// ---------- 列表 ----------
function renderList() {
  const { index } = state;
  const list = filterTopics(index, state);
  $('#list-count').textContent = `${list.length} 个主题`;

  // 按册分组，保持册内 id 顺序
  const groups = new Map();
  for (const t of list) {
    const v = index.volumeOf(t);
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(t);
  }
  const html = [...groups.entries()].map(([vol, ts]) => `
    <div class="group-h">${esc(vol)}（${ts.length}）</div>
    ${ts.map((t) => {
      const island = index.inDeg.get(t.id) === 0 && index.outDeg.get(t.id) === 0;
      return `
      <button class="item ${t.id === state.selectedId ? 'sel' : ''}" data-id="${esc(t.id)}" type="button">
        <div class="row1">
          <span class="name">${esc(t.name)}</span>
          <span class="deg">↑${index.prereqsOf.get(t.id)?.length ?? 0} ↓${index.unlocksOf.get(t.id)?.length ?? 0}</span>
        </div>
        <div class="row2">
          ${island ? '<span class="island-flag">孤岛</span> · ' : ''}${esc(t.domain)} · ${t.grade}${SEMESTER_ZH[t.semester] ?? ''} · <span class="muted">${esc(t.id)}</span>
        </div>
      </button>`;
    }).join('')}`).join('');
  $('#list').innerHTML = html || '<p class="muted" style="padding:12px">没有匹配的主题。</p>';
  $('#list').querySelectorAll('.item').forEach((el) =>
    el.addEventListener('click', () => selectTopic(el.dataset.id)));
}

// ---------- 详情 ----------
function selectTopic(id, { scroll = false } = {}) {
  state.selectedId = id;
  history.replaceState(null, '', `#id=${id}`);
  renderList();
  renderDetail();
  if (scroll) $('#detail').scrollTo({ top: 0 });
}

function topicLink(t) {
  return `<button class="tlink" data-id="${esc(t.id)}" type="button">${esc(t.name)}</button>`;
}

function renderTree(rootId, tree) {
  const { index } = state;
  const walk = (nodes) => nodes.map((n) => {
    const t = index.byId.get(n.id);
    const via = n.via ? `<span class="tvia"><span class="edge ${esc(n.via.strength)}">${n.via.strength === 'hard' ? '必需' : '有益'}</span> — ${esc(n.via.reason)}</span>` : '';
    return `
      <div class="tnode">
        <div class="trow">${topicLink(t)} ${via}</div>
        ${n.nodes.length ? `<div class="tree">${walk(n.nodes)}</div>` : ''}
      </div>`;
  }).join('');
  return `<div class="tree">${walk(tree.nodes)}</div>`;
}

function bindTreeLinks(container) {
  container.querySelectorAll('.tlink').forEach((el) =>
    el.addEventListener('click', () => selectTopic(el.dataset.id, { scroll: true })));
}

function renderDetail() {
  const { index } = state;
  const t = state.selectedId && index.byId.get(state.selectedId);
  const el = $('#detail');
  if (!t) { el.innerHTML = el.dataset.placeholderHtml ?? ''; return; }

  const pTree = prereqTree(index, t.id);
  const uTree = unlockTree(index, t.id);
  const pStats = treeStats(pTree);
  const uStats = treeStats(uTree);

  el.innerHTML = `
    <div class="topic-head">
      <h2>${esc(t.name)}</h2>
      <span class="topic-id">${esc(t.id)}</span>
      <span class="badge type-${esc(t.type)}">${TYPE_ZH[t.type] ?? t.type}</span>
      <span class="badge d-${esc(t.domain)}">${esc(t.domain)}</span>
    </div>
    <div class="meta-line">
      ${t.grade} 年级${SEMESTER_ZH[t.semester] ?? ''} · 年龄 ${t.ageRangeStart}–${t.ageRangeEnd} ·
      ${esc(t.textbook.publisher)}${t.grade}${SEMESTER_ZH[t.semester] ?? ''} 第 ${esc(String(t.textbook.unit))} 单元（${t.textbook.editionYear} 版）
    </div>
    <p class="desc">${esc(t.description)}</p>

    <div class="sec">
      <h3>掌握证据</h3>
      <ul class="evidence">${t.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
    </div>

    ${t.assessmentPrompt ? `
    <div class="sec">
      <h3>测评问法</h3>
      <div class="prompt-box"><span class="lbl">在家就能测</span><br>${esc(renderPrompt(t.assessmentPrompt, state.childName))}</div>
    </div>` : ''}

    ${t.standards?.length ? `
    <div class="sec">
      <h3>课标对齐</h3>
      <p>${t.standards.map((s) => `<code>${esc(s)}</code>`).join(' ')}</p>
    </div>` : ''}

    <div class="sec">
      <h3>↑ 先修链 <span class="count">${pStats.uniqueCount ? `${pStats.depth} 层 · ${pStats.uniqueCount} 个主题（去重）` : '无先修（起点主题）'}</span></h3>
      ${pStats.uniqueCount ? renderTree(t.id, pTree) : '<p class="muted">这是学习的起点，没有前置要求。</p>'}
    </div>

    <div class="sec">
      <h3>↓ 解锁树 <span class="count">${uStats.uniqueCount ? `${uStats.depth} 层 · ${uStats.uniqueCount} 个主题（去重）` : '暂无后续主题依赖它'}</span></h3>
      ${uStats.uniqueCount ? renderTree(t.id, uTree) : '<p class="muted">尚无更高年级主题依赖它（后续册数据推进中）。</p>'}
    </div>`;
  bindTreeLinks(el);
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
  const distRows = (rows, total) => rows.sort((a, b) => b[1] - a[1]).map(([k, n]) =>
    `<tr><td>${esc(k)}</td><td>${n}</td><td><div class="bar" style="width:${(n / total * 220).toFixed(0)}px"></div></td></tr>`).join('');

  const el = document.createElement('div');
  el.id = 'quality-panel';
  el.style.display = 'none';
  el.innerHTML = `
    <h2 style="margin:4px 0 4px">数据质量自查</h2>
    <p class="muted">口径与 <code>scripts/report.mjs</code> 一致，供维护者在批次合入前后对照。</p>
    <div class="qcards" style="margin-top:14px">
      <div class="qcard"><div class="v">${m.topicCount}</div><div class="k">微主题</div></div>
      <div class="qcard"><div class="v">${m.edgeCount}</div><div class="k">先修边（${m.hardCount} hard / ${m.edgeCount - m.hardCount} soft）</div></div>
      <div class="qcard"><div class="v">${m.edgeDensity}</div><div class="k">边密度（对标 ≈2.0）</div></div>
      <div class="qcard ${m.islands.length ? 'bad' : 'ok'}"><div class="v">${m.islands.length}</div><div class="k">孤岛主题（目标 0）</div></div>
      <div class="qcard ${m.noPrompt.length ? 'bad' : 'ok'}"><div class="v">${pct(m.promptCoverage)}</div><div class="k">测评问法覆盖（目标 100%）</div></div>
      <div class="qcard ${m.noStandards.length / Math.max(1, m.topicCount) > 0.05 ? 'bad' : 'ok'}"><div class="v">${pct(m.standardsCoverage)}</div><div class="k">课标引用覆盖（目标 ≥95%）</div></div>
      <div class="qcard ${m.inverted.length ? 'bad' : 'ok'}"><div class="v">${m.inverted.length}</div><div class="k">跨年级倒挂边（目标 0）</div></div>
      <div class="qcard"><div class="v">${m.roots.length}</div><div class="k">起点主题（参考）</div></div>
    </div>

    ${m.islands.length ? `<div class="sec"><h3>孤岛主题</h3><ul class="evidence">${m.islands.map((t) => `<li>${esc(t.id)} ${esc(t.name)}</li>`).join('')}</ul></div>` : ''}
    ${m.noPrompt.length ? `<div class="sec"><h3>缺测评问法</h3><ul class="evidence">${m.noPrompt.map((t) => `<li>${esc(t.id)} ${esc(t.name)}</li>`).join('')}</ul></div>` : ''}
    ${m.inverted.length ? `<div class="sec"><h3>跨年级倒挂边</h3><ul class="evidence">${m.inverted.map((x) => `<li>${esc(x.t.id)}（${x.t.grade} 年级）← ${esc(x.p.id)}（${x.p.grade} 年级）</li>`).join('')}</ul></div>` : ''}

    <div class="sec"><h3>分册分布</h3><table class="qt"><tr><th>册</th><th>主题</th><th></th></tr>${distRows(m.byVolume, m.topicCount)}</table></div>
    <div class="sec"><h3>领域分布</h3><table class="qt"><tr><th>领域</th><th>主题</th><th></th></tr>${distRows(m.byDomain, m.topicCount)}</table></div>
    <div class="sec"><h3>类型分布</h3><table class="qt"><tr><th>类型</th><th>主题</th><th></th></tr>${distRows(m.byType.map(([k, n]) => [TYPE_ZH[k] ?? k, n]), m.topicCount)}</table></div>`;

  $('#detail').parentElement.appendChild(el);
}

// ---------- 3D 全景（惰性初始化一次） ----------
let graph3d = null;
function initGraph3D() {
  if (graph3d) { graph3d.resize(); return; }
  graph3d = new Graph3D($('#graph3d-mount'), buildLayout(state.index), {
    onOpenTopic: (id) => { switchView('graph'); selectTopic(id); },
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
