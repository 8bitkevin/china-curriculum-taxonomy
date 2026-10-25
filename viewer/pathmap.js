// viewer/pathmap.js — 学习路径图：以当前主题为中心的交互式 Canvas DAG。
// 左 ← 先修（越左越基础）· 中心 = 当前主题 · 右 → 解锁（越右越后续），
// 所有连线统一从左向右流动（学习顺序），不逐边画箭头。
// 布局 = dagre（Sugiyama 分层算法的行业标准实现，viewer/vendor/dagre.min.js，
// MIT，本地 vendor 零构建）：同层节点按邻接重排（交叉最小化）+ 边路由点。
// 视觉参照 React Flow / 课程先修图：纸面白底点阵、圆角节点卡、圆角折线连线；
// hard 必需 = 玫红实线 / soft 有益 = 琥珀虚线（线型+文字双重编码，色觉冗余），
// 当前主题 = 靛蓝实心卡。配色 = 图谱仓独立设计语言 v4，与 style.css 变量同源。

import { pathGraph } from './logic.js';
import { subjectDeep } from './graph3d.js';

const dagre = globalThis.dagre;   // 由 index.html 经典脚本先于本模块加载

const NW = 150;            // 节点卡宽
const NH = 34;             // 节点卡高
const PAD = 56;            // fit 视图的内边距
const FONT = '"Segoe UI", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';
// 画布配色（与 style.css 的 --hard/--soft/--accent 等变量同源，改一处核两处；
// 中性色/品牌绿取自 K12aixue 设计系统，设计语言 v5）
const C = {
  hardA: '216,30,106',     // 必需（玫红 #d81e6a，与学科色零撞车）
  softA: '192,124,0',      // 有益（琥珀 #c07c00）
  card: '#ffffff',
  cardLine: '#dce1e7',
  ink: '#1b2b33',
  sub: '#8a97a5',
  brand: '#0fa968',        // K12 品牌绿 = 当前主题/交互强调（--accent）
  brandPress: '#0b8f57',
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class PathMap {
  /**
   * @param mount   挂载元素（.pm-stage）
   * @param {{ index, onOpen(id) }} opts
   */
  constructor(mount, opts = {}) {
    this.index = opts.index;
    this.onOpen = opts.onOpen;
    this.reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    this.depth = 2;                    // 当前每侧展开深度（默认 2 层：先保证节点文字可读，
                                       // 更深的链用「+1 层 / 展开全部」渐进披露）
    this.view = { x: 0, y: 0, k: 1 };  // 平移 + 缩放（屏幕 = 数据 * k + t）
    this.hoverId = null;
    this.selId = null;
    this.lineage = null;               // hover/选中节点的世系（高亮集）
    this.anim = null;
    this.vAnim = null;
    this.onKey = null;
    this.dirty = true;

    this.dom = this.buildDom(mount);
    this.initCanvas();
    this.bindEvents();
    this.raf = requestAnimationFrame(this.frame.bind(this));
  }

  // ---------- DOM 骨架（工具条 / 画布 / 图例 / 提示 / 节点卡） ----------
  buildDom(mount) {
    mount.innerHTML = `
      <div class="pm-top">
        <div class="pm-title">
          <span class="pm-ic" aria-hidden="true"></span>
          <b>学习路径</b>
          <span class="pm-stat" id="pm-stat"></span>
        </div>
        <div class="pm-acts">
          <span class="pm-hidden" id="pm-hidden" hidden></span>
          <button class="pm-btn" id="pm-more" type="button" hidden>+ 1 层</button>
          <button class="pm-btn" id="pm-all" type="button" hidden>展开全部</button>
          <button class="pm-btn" id="pm-fit" type="button">适配</button>
          <button class="pm-btn" id="pm-reset" type="button">重置</button>
        </div>
      </div>
      <div class="pm-stage">
        <canvas class="pm-cv" aria-label="学习路径图：左侧为先修主题，右侧为解锁主题，滚轮缩放、拖拽平移"></canvas>
        <div class="pm-legend" aria-hidden="true">
          <span class="lg-item"><i class="lg-line hard"></i>必需</span>
          <span class="lg-item"><i class="lg-line soft"></i>有益</span>
          <span class="lg-dir">← 先学 · 后学 →</span>
        </div>
        <div class="pm-hint" aria-hidden="true">拖拽平移 · 滚轮缩放 · 单击看理由 · 双击打开主题</div>
        <div class="pm-tip" id="pm-tip" hidden></div>
        <aside class="pm-card" id="pm-card" hidden></aside>
      </div>`;
    const $ = (s) => mount.querySelector(s);
    this.ui = {
      stat: $('#pm-stat'), hidden: $('#pm-hidden'), more: $('#pm-more'), all: $('#pm-all'),
      tip: $('#pm-tip'), card: $('#pm-card'), cv: $('.pm-cv'),
    };
    $('#pm-fit').addEventListener('click', () => this.fit(true));
    $('#pm-more').addEventListener('click', () => this.setDepth(this.depth + 1));
    $('#pm-all').addEventListener('click', () => this.setDepth(Infinity));
    const reset = $('#pm-reset');
    reset.addEventListener('click', () => {
      this.selId = null; this.hideCard();
      this.setRoot(this.rootId, { keepDepth: false });
    });
    return mount;
  }

  initCanvas() {
    const stage = this.dom.querySelector('.pm-stage');
    this.ctx = this.ui.cv.getContext('2d');
    this.DPR = 1; this.W = 0; this.H = 0;
    this.resize();
    this.ro = new ResizeObserver(() => { this.resize(); this.dirty = true; });
    this.ro.observe(stage);
  }

  resize() {
    const stage = this.dom.querySelector('.pm-stage');
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    this.W = w; this.H = h;
    this.ui.cv.width = w * this.DPR; this.ui.cv.height = h * this.DPR;
    this.ui.cv.style.width = w + 'px'; this.ui.cv.style.height = h + 'px';
  }

  // ---------- 数据与布局 ----------
  /** 换主题：全新数据 + 立即适配（无过渡动画）。 */
  setRoot(id, { keepDepth = false } = {}) {
    if (!keepDepth) this.depth = 2;
    this.rootId = id;
    this.g = pathGraph(this.index, id, this.depth);
    this.layout();
    this.anim = null;
    this.selId = null; this.hoverId = null; this.lineage = null;
    this.hideCard(); this.hideTip();
    this.fit(false);
    this.syncToolbar();
    this.dirty = true;
  }

  /** 加深展开：节点位置带过渡动画滑到新布局。 */
  setDepth(d) {
    this.depth = d;
    const old = new Map([...this.pos.entries()].map(([k, v]) => [k, { ...v }]));
    this.g = pathGraph(this.index, this.rootId, this.depth);
    this.layout();
    if (!this.reduce) {
      this.anim = { t0: performance.now(), dur: 280, from: old };
    }
    this.fit(true);
    this.syncToolbar();
    this.dirty = true;
  }

  /**
   * 布局：dagre（Sugiyama 分层算法的行业标准实现，本地 vendor，MIT）。
   * 整个子图一次性 LR 布局——先修自然落左、解锁自然落右；同层节点按
   * 邻接关系重排（交叉最小化）+ 边路由点，这是自研 tidy 布局「乱」的解药。
   * 边路由点存入 edgePts，绘制为圆角折线（跨层边不再横穿节点）。
   */
  layout() {
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: 'LR',
      nodesep: 14,            // 同层节点垂直间距
      edgesep: 6,
      ranksep: 50,            // 层间水平间距
      marginx: 12, marginy: 12,
    });
    g.setDefaultEdgeLabel(() => ({}));
    for (const { id } of this.g.nodes.values()) g.setNode(id, { width: NW, height: NH });
    for (const e of this.g.edges) g.setEdge(e.from, e.to);
    dagre.layout(g);

    const pos = new Map();      // id -> { x, y }（节点左上角）
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { id } of this.g.nodes.values()) {
      const n = g.node(id);
      const x = n.x - NW / 2, y = n.y - NH / 2;
      pos.set(id, { x, y });
      minX = Math.min(minX, x); maxX = Math.max(maxX, x + NW);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y + NH);
    }
    this.pos = pos;
    this.bounds = { minX, minY, maxX, maxY };

    this.edgePts = new Map();   // "from>to" -> [{x,y}, ...]（dagre 路由点）
    for (const e of g.edges()) {
      this.edgePts.set(`${e.v}>${e.w}`, g.edge(e).points ?? []);
    }

    // 文本截断缓存（需要在 ctx 上量宽）
    this.labels = new Map();
  }

  /** 按「屏幕像素字号」截断节点名：缩小时文字不低于 9.5px（最小可读补偿），
      缓存键含字号与可用宽，拖拽/缩放中 k 不变即命中。 */
  labelAt(id, isRoot, fontPx, maxW) {
    const key = `${id}|${isRoot ? 1 : 0}|${Math.round(fontPx * 2)}|${Math.round(maxW)}`;
    let s = this.labels.get(key);
    if (s === undefined) {
      const name = this.index.byId.get(id).name;
      s = truncate(this.ctx, name, maxW, `${isRoot ? 'bold' : '600'} ${fontPx}px ${FONT}`);
      this.labels.set(key, s);
    }
    return s;
  }

  // ---------- 视图 ----------
  fit(animate) {
    const b = this.bounds;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    // 下限 0.55：更小的图宁可超出画布（可拖拽平移），不牺牲节点文字可读性
    const k = clamp(Math.min((this.W - PAD * 2) / w, (this.H - PAD * 2) / h), 0.55, 1.15);
    const tx = this.W / 2 - (b.minX + w / 2) * k;
    const ty = this.H / 2 - (b.minY + h / 2) * k;
    if (animate && !this.reduce) {
      const from = { ...this.view };
      this.vAnim = { t0: performance.now(), dur: 300, from, to: { x: tx, y: ty, k } };
    } else {
      this.view = { x: tx, y: ty, k };
    }
    this.dirty = true;
  }

  zoomAt(mx, my, factor) {
    const k = clamp(this.view.k * factor, 0.2, 2.6);
    this.view.x = mx - (mx - this.view.x) * (k / this.view.k);
    this.view.y = my - (my - this.view.y) * (k / this.view.k);
    this.view.k = k;
    this.dirty = true;
  }

  toScreen(p) { return { x: p.x * this.view.k + this.view.x, y: p.y * this.view.k + this.view.y }; }
  toData(x, y) { return { x: (x - this.view.x) / this.view.k, y: (y - this.view.y) / this.view.k }; }

  // ---------- 交互 ----------
  bindEvents() {
    const cv = this.ui.cv;
    let drag = null;

    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      drag = { x: e.clientX, y: e.clientY, moved: false, id: this.hoverId };
      cv.setPointerCapture?.(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        this.view.x += dx; this.view.y += dy;
        drag.x = e.clientX; drag.y = e.clientY;
        this.dirty = true;
        return;
      }
      const hit = this.pick(mx, my);
      const id = hit?.id ?? null;
      if (id !== this.hoverId) {
        this.hoverId = id;
        this.lineage = id ? this.buildLineage(id) : (this.selId ? this.buildLineage(this.selId) : null);
        this.dirty = true;
        if (id) this.showTip(id, mx, my); else this.hideTip();
      } else if (id) this.placeTip(mx, my);
    });
    const endDrag = (e) => {
      if (!drag) return;
      const r = cv.getBoundingClientRect();
      const moved = drag.moved;
      drag = null;
      if (moved) return;
      const hit = this.pick(e.clientX - r.left, e.clientY - r.top);
      if (hit?.badge) { this.setDepth(this.depth + 1); return; }   // 点「+N」徽标 = 加深
      if (hit?.id) this.select(hit.id);
      else { this.selId = null; this.hideCard(); this.lineage = null; this.dirty = true; }
    };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', () => { drag = null; });
    cv.addEventListener('dblclick', (e) => {
      const r = cv.getBoundingClientRect();
      const hit = this.pick(e.clientX - r.left, e.clientY - r.top);
      if (hit?.id) this.onOpen?.(hit.id);
    });
    cv.addEventListener('pointerleave', () => {
      this.hoverId = null;
      this.lineage = this.selId ? this.buildLineage(this.selId) : null;
      this.hideTip(); this.dirty = true;
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016));
    }, { passive: false });

    // 触屏双指缩放
    const pts = new Map(); let pinch = 0;
    cv.addEventListener('pointerdown', (e) => pts.set(e.pointerId, [e.clientX, e.clientY]));
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.zoomAt(this.W / 2, this.H / 2, d / pinch);
        pinch = d; drag = null;
      }
    });
    const rel = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
    ['pointerup', 'pointercancel'].forEach((ev) => cv.addEventListener(ev, rel));

    window.addEventListener('keydown', this.onKey = (e) => {
      if (e.key === 'Escape' && this.selId) {
        this.selId = null; this.lineage = null; this.hideCard(); this.dirty = true;
      }
    });
    // 卡片内交互不冒泡到画布手势
    ['pointerdown', 'pointerup', 'click', 'wheel'].forEach((ev) =>
      this.ui.card.addEventListener(ev, (e) => e.stopPropagation()));
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    window.removeEventListener('keydown', this.onKey);
  }

  pick(mx, my) {
    // 徽标（+N）：节点右上角外贴的 pill
    for (const [id, p] of this.pos) {
      const n = this.g.truncated.get(id);
      if (!n) continue;
      const s = this.toScreen({ x: p.x + NW - 6, y: p.y - 8 });
      if (Math.abs(mx - s.x) <= 16 && Math.abs(my - s.y) <= 9) return { id, badge: true };
    }
    const p = this.toData(mx, my);
    for (const [id, q] of this.pos) {
      if (p.x >= q.x - 3 && p.x <= q.x + NW + 3 && p.y >= q.y - 3 && p.y <= q.y + NH + 3) return { id };
    }
    return null;
  }

  buildLineage(id) {
    // 显示子图内的定向世系：id 的传递先修 ∪ 传递解锁 + 沿途边
    const nodes = new Set([id]), edges = new Set();
    const walk = (start, dir) => {
      const q = [start];
      while (q.length) {
        const u = q.shift();
        for (let i = 0; i < this.g.edges.length; i++) {
          const e = this.g.edges[i];
          const from = dir === 'pre' ? e.to : e.from;    // pre: 找「我依赖的」→ e.to = 我
          const to = dir === 'pre' ? e.from : e.to;
          if (from !== u) continue;
          edges.add(i);
          if (!nodes.has(to)) { nodes.add(to); q.push(to); }
        }
      }
    };
    walk(id, 'pre'); walk(id, 'next');
    return { nodes, edges };
  }

  select(id) {
    this.selId = id;
    this.lineage = this.buildLineage(id);
    this.showCard(id);
    this.dirty = true;
  }

  // ---------- 浮层 ----------
  showTip(id, mx, my) {
    const t = this.index.byId.get(id);
    const el = this.ui.tip;
    el.innerHTML = `
      <div class="pm-tip-meta"><i style="background:${subjectDeep(t.subject)}"></i>${esc(t.subject)} · ${esc(t.domain)} · ${t.grade}年级${t.semester}</div>
      <div class="pm-tip-name">${esc(t.name)}</div>
      <div class="pm-tip-hint">单击查看先修理由 · 双击打开</div>`;
    el.hidden = false;
    this.placeTip(mx, my);
  }
  placeTip(mx, my) {
    const el = this.ui.tip;
    let x = mx + 14, y = my + 14;
    if (x + el.offsetWidth > this.W - 8) x = mx - el.offsetWidth - 14;
    if (y + el.offsetHeight > this.H - 8) y = my - el.offsetHeight - 14;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  hideTip() { this.ui.tip.hidden = true; }

  showCard(id) {
    const t = this.index.byId.get(id);
    const isRoot = id === this.rootId;
    const preEdges = (this.index.prereqsOf.get(id) ?? []);
    const nextEdges = (this.index.unlocksOf.get(id) ?? []);
    const edgeRow = (e) => {
      const p = this.index.byId.get(e.prerequisiteId);
      return `<div class="pm-edge ${e.strength}">
        <span class="pm-edge-k">${e.strength === 'hard' ? '必需' : '有益'}</span>
        <span class="pm-edge-w"><b data-id="${esc(e.prerequisiteId)}">${esc(p.name)}</b><i>${esc(e.reason)}</i></span>
      </div>`;
    };
    const nextList = nextEdges.slice(0, 8).map((e) => {
      const n = this.index.byId.get(e.topicId);
      return `<button class="pm-next-item" data-id="${esc(n.id)}" type="button">${esc(n.name)}</button>`;
    }).join('');
    this.ui.card.innerHTML = `
      <button class="pm-card-close" type="button" title="关闭 (Esc)">×</button>
      <div class="pm-tip-meta"><i style="background:${subjectDeep(t.subject)}"></i>${esc(t.subject)} · ${esc(t.domain)} · ${t.grade}年级${t.semester}${isRoot ? ' · <b>当前主题</b>' : ''}</div>
      <h4>${esc(t.name)}</h4>
      ${preEdges.length ? `
        <div class="pm-card-sec"><span class="pm-sh">为什么先学这些（${preEdges.length}）</span>
          ${preEdges.map(edgeRow).join('')}</div>` :
        '<div class="pm-card-sec"><span class="pm-sh">先修</span><p class="pm-none">起点主题，无前置要求。</p></div>'}
      ${nextEdges.length ? `
        <div class="pm-card-sec"><span class="pm-sh">学会后解锁（${nextEdges.length}）</span>
          <div class="pm-next-list">${nextList}${nextEdges.length > 8 ? `<span class="pm-next-more">等 ${nextEdges.length} 个</span>` : ''}</div></div>` :
        '<div class="pm-card-sec"><span class="pm-sh">解锁</span><p class="pm-none">暂无后续主题依赖它。</p></div>'}
      <button class="pm-open" type="button">打开这个主题 →</button>`;
    this.ui.card.hidden = false;
    const $ = (s) => this.ui.card.querySelector(s);
    $('.pm-card-close').addEventListener('click', () => {
      this.selId = null; this.lineage = null; this.hideCard(); this.dirty = true;
    });
    $('.pm-open').addEventListener('click', () => this.onOpen?.(id));
    this.ui.card.querySelectorAll('b[data-id]').forEach((el) =>
      el.addEventListener('click', () => this.select(el.dataset.id)));
    this.ui.card.querySelectorAll('.pm-next-item').forEach((el) =>
      el.addEventListener('click', () => this.select(el.dataset.id)));
    this.ui.card.scrollTop = 0;
  }
  hideCard() { this.ui.card.hidden = true; }

  syncToolbar() {
    const { counts } = this.g;
    this.ui.stat.textContent =
      `先修 ${counts.pre} · 解锁 ${counts.next}` +
      (counts.pre + counts.next === 0 ? '' : ` · ${this.g.truncated.size ? '部分展开' : '全部展开'}`);
    const hasHidden = counts.hidden > 0;
    this.ui.hidden.hidden = !hasHidden;
    this.ui.more.hidden = !hasHidden;
    this.ui.all.hidden = !hasHidden;
    if (hasHidden) this.ui.hidden.textContent = `还有 ${counts.hidden} 个主题未展开`;
  }

  // ---------- 绘制 ----------
  nodePos(id) {
    const p = this.pos.get(id);
    if (!this.anim) return p;
    const a = this.anim.from.get(id);
    if (!a) return p;   // 新节点：直接落位（配合整卡透明度渐入可后续增强）
    const t = clamp((performance.now() - this.anim.t0) / this.anim.dur, 0, 1);
    const e = 1 - Math.pow(1 - t, 3);   // ease-out cubic
    return { x: a.x + (p.x - a.x) * e, y: a.y + (p.y - a.y) * e };
  }
  animating() {
    if (!this.anim) return false;
    if (performance.now() - this.anim.t0 >= this.anim.dur) { this.anim = null; return false; }
    return true;
  }

  draw() {
    const { ctx, W, H, DPR } = this;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 画布透明：不铺底色、无点阵，露出 .pathmap 卡片的白底（与整站纸面一致）
    ctx.clearRect(0, 0, W, H);

    const lin = this.lineage;
    const hasFocus = !!lin;

    // ---- 边 ----（稳态用 dagre 路由点画圆角折线——跨层边绕行不横穿节点；
    //      展开过渡期节点在滑动，退化为端点贝塞尔跟随插值位置）
    const animating = this.animating();
    for (let i = 0; i < this.g.edges.length; i++) {
      const e = this.g.edges[i];
      const a = this.nodePos(e.from), b = this.nodePos(e.to);
      if (!a || !b) continue;
      const on = !hasFocus || lin.edges.has(i);
      const rgb = e.strength === 'hard' ? C.hardA : C.softA;
      ctx.strokeStyle = `rgba(${rgb},${on ? (hasFocus ? 0.9 : 0.42) : 0.05})`;
      ctx.lineWidth = on && hasFocus ? 2.1 : 1.5;
      ctx.setLineDash(e.strength === 'soft' ? [6, 5] : []);
      const pts = !animating ? this.edgePts.get(`${e.from}>${e.to}`) : null;
      ctx.beginPath();
      if (pts && pts.length > 2) {
        roundedPolyline(ctx, pts.map((p) => this.toScreen(p)), 7);
      } else {
        const p1 = pts?.length === 2 && !animating
          ? this.toScreen(pts[0]) : this.toScreen({ x: a.x + NW, y: a.y + NH / 2 });
        const p2 = pts?.length === 2 && !animating
          ? this.toScreen(pts[1]) : this.toScreen({ x: b.x, y: b.y + NH / 2 });
        const dx = Math.max(36, (p2.x - p1.x) / 2);
        ctx.moveTo(p1.x, p1.y);
        ctx.bezierCurveTo(p1.x + dx, p1.y, p2.x - dx, p2.y, p2.x, p2.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // ---- 节点 ----
    for (const { id } of this.g.nodes.values()) {
      const p = this.nodePos(id);
      const t = this.index.byId.get(id);
      const s = this.toScreen(p);
      const k = this.view.k;
      const w = NW * k, h = NH * k, r = Math.min(9 * k, 9);
      const isRoot = id === this.rootId;
      const isHover = id === this.hoverId;
      const isSel = id === this.selId;
      const on = !hasFocus || lin.nodes.has(id);
      const alpha = on ? 1 : 0.16;

      ctx.globalAlpha = alpha;
      // 卡片底
      if (isRoot) { ctx.shadowColor = 'rgba(15,169,104,.32)'; ctx.shadowBlur = 16 * k; }
      else { ctx.shadowColor = 'rgba(27,43,51,.07)'; ctx.shadowBlur = 5 * k; }
      roundRect(ctx, s.x, s.y, w, h, r);
      ctx.fillStyle = isRoot ? C.brand : C.card;
      ctx.fill();
      ctx.shadowBlur = 0;
      // 边框
      roundRect(ctx, s.x, s.y, w, h, r);
      ctx.strokeStyle = isHover || isSel ? C.brand : (isRoot ? C.brandPress : C.cardLine);
      ctx.lineWidth = (isHover || isSel) && !isRoot ? 2 : (isRoot ? 1.2 : 1);
      ctx.stroke();
      // 学科色条（root 无需 —— 整卡即强调；deep 档适配浅底）
      if (!isRoot) {
        roundRect(ctx, s.x + 4 * k, s.y + 5 * k, 3.5 * k, h - 10 * k, 2 * k);
        ctx.fillStyle = subjectDeep(t.subject);
        ctx.fill();
      }
      // 名称（最小可读补偿：屏幕字号 ≥9.5px，避免缩小后节点名不可读）
      const fsName = Math.max((isRoot ? 12.5 : 12) * k, 9.5);
      const fsGrade = Math.max(10 * k, 8.5);
      ctx.textBaseline = 'middle';
      ctx.font = `${isRoot ? 'bold' : '600'} ${fsName}px ${FONT}`;
      ctx.fillStyle = isRoot ? '#ffffff' : C.ink;
      ctx.textAlign = 'left';
      ctx.fillText(this.labelAt(id, isRoot, fsName, w - 44 * k), s.x + 13 * k, s.y + h / 2, w - 44 * k);
      // 年级徽标
      ctx.font = `${fsGrade}px ${FONT}`;
      ctx.fillStyle = isRoot ? 'rgba(255,255,255,.85)' : C.sub;
      ctx.textAlign = 'right';
      ctx.fillText(`${t.grade}${t.semester}`, s.x + w - 9 * k, s.y + h / 2, 26 * k);
      ctx.globalAlpha = 1;

      // 折叠徽标「+N」
      const hidden = this.g.truncated.get(id);
      if (hidden) {
        const bx = s.x + w - 5 * k, by = s.y - 7 * k;
        const label = `+${hidden > 99 ? '99' : hidden}`;
        ctx.font = `bold ${Math.max(9.5 * k, 8.5)}px ${FONT}`;
        const tw = ctx.measureText(label).width + 10 * k;
        const bh = 15 * k;
        roundRect(ctx, bx - tw, by - bh / 2, tw, bh, bh / 2);
        ctx.fillStyle = '#edf0f3';
        ctx.fill();
        ctx.strokeStyle = '#dce1e7';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#5a6b77';
        ctx.textAlign = 'center';
        ctx.fillText(label, bx - tw / 2, by + 0.5);
      }
    }
  }

  frame(ts) {
    // 布局/视图过渡
    if (this.vAnim) {
      const t = clamp((ts - this.vAnim.t0) / this.vAnim.dur, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const { from, to } = this.vAnim;
      this.view = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        k: from.k + (to.k - from.k) * e,
      };
      if (t >= 1) this.vAnim = null;
      this.dirty = true;
    }
    if (this.animating()) this.dirty = true;
    if (this.dirty) { this.draw(); this.dirty = false; }
    this.raf = requestAnimationFrame(this.frame.bind(this));
  }
}

// ---------- 工具 ----------
/** 折线拐点圆角化（屏幕坐标，r 为圆角半径，短段自动减半防越界）。 */
function roundedPolyline(ctx, pts, r) {
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], prev = pts[i - 1], next = pts[i + 1];
    const d1 = Math.hypot(p.x - prev.x, p.y - prev.y);
    const d2 = Math.hypot(next.x - p.x, next.y - p.y);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const t1 = rr / Math.max(d1, 1e-6), t2 = rr / Math.max(d2, 1e-6);
    const ax = p.x + (prev.x - p.x) * t1, ay = p.y + (prev.y - p.y) * t1;
    const bx = p.x + (next.x - p.x) * t2, by = p.y + (next.y - p.y) * t2;
    ctx.lineTo(ax, ay);
    ctx.quadraticCurveTo(p.x, p.y, bx, by);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx, text, maxW, font) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 1, hi = text.length - 1, best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return text.slice(0, best) + '…';
}
