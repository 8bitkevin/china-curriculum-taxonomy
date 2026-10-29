// viewer/pathmap.js — 学习路径图：以当前知识点为中心的「关键路径」Canvas 图。
// 产品语义（2026-10 重构）：全展开的传递闭包在早期知识点上等于半张学科图
// （538 节点 / 52 列的「蜘蛛网」），路径图的任务不是展示全图，而是回答
// 「先学什么、学完去哪」——因此两侧非对称：
//   来路（左）= 路由：只沿「必需」边构成关键路径，加粗玫红主线（地铁线路图
//     隐喻：主线 = 必须走的路，站点 = 知识点），超过 40 站按层渐进展开；
//     当前知识点的「有益」先修挂 1 跳叶子，不递归。
//   去路（右）= 一跳直接解锁 + 底部「学完通向」学期时间轴热条：传递影响是
//     计数不是网（每格 = 该册通向多少知识点，点开列清单，可直达）。
// 布局 = 学期泳道（时间自上而下）× 依赖列（学习顺序自左向右）：先修自然落
// 左上、当前知识点居中、解锁落右下，主线大致沿对角线贯穿；跨多泳道的连线
// 即「跳级依赖」，一眼可辨。自研泳道布局取代 dagre——节点 Y 由学期决定
// （时间语义），X 由依赖列决定，无需交叉最小化也能保持可读。
// 配色 = 图谱仓设计语言 v5（K12aixue 令牌）：必需 = 玫红实线（主线加粗）/
// 有益 = 琥珀虚线（线型+文字双重编码，色觉冗余）/ 当前知识点 = 品牌绿实心卡
// / 学科色条与 3D 全景同源（graph3d SUBJECT_COLORS）。

import { pathGraph } from './logic.js';
import { subjectDeep } from './graph3d.js';

const NW = 150;            // 节点卡宽
const NH = 34;             // 节点卡高
const PAD = 56;            // fit 视图的内边距
const STRIP_H = 58;        // 底部时间轴热条预留高（fit 时扣除）
const LANE_GAP = 22;       // 泳道间距
const LANE_PAD = 11;       // 泳道上下留白
const STACK_GAP = 8;       // 同泳道同列的堆叠间距
const COL_GAP = 54;        // 依赖列间距
const LABEL_W = 64;        // 左侧学期标签预留宽（计入 bounds 供 fit）
const FONT = '"Segoe UI", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';
// 画布配色（与 style.css 的 --hard/--soft/--accent 等变量同源，改一处核两处；
// 中性色/品牌绿取自 K12aixue 设计系统，设计语言 v5）
const C = {
  hardA: '216,30,106',     // 必需（玫红 #d81e6a，与学科色零撞车）——主线同色加粗
  softA: '192,124,0',      // 有益（琥珀 #c07c00）
  card: '#ffffff',
  cardLine: '#dce1e7',
  ink: '#1b2b33',
  sub: '#8a97a5',
  brand: '#0fa968',        // K12 品牌绿 = 当前知识点/交互强调（--accent）
  brandPress: '#0b8f57',
  brandA: '15,169,104',
};
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const termIdx = (t) => t.grade * 2 + (t.semester === '下' ? 1 : 0);       // 学期排序键
const termLabel = (t) => `${CN_NUM[t.grade - 1] ?? t.grade}${t.semester}`; // 如「三上」

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class PathMap {
  /**
   * @param mount   挂载元素（.pm-stage 外层）
   * @param {{ index, onOpen(id), onLesson(id) }} opts
   */
  constructor(mount, opts = {}) {
    this.index = opts.index;
    this.onOpen = opts.onOpen;
    this.onLesson = opts.onLesson;
    this.reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    this.preDepth = null;               // null = 自适应（hard 闭包 ≤40 站全显）
    this.view = { x: 0, y: 0, k: 1 };   // 平移 + 缩放（屏幕 = 数据 * k + t）
    this.userView = false;              // 用户手动平移/缩放后，画布尺寸变化不再自动适配
    this.hoverId = null;
    this.selId = null;
    this.lineage = null;                // hover/选中节点的世系（高亮集）
    this.anim = null;
    this.vAnim = null;
    this.onKey = null;
    this.onDocDown = null;
    this.dirty = true;

    this.dom = this.buildDom(mount);
    this.initCanvas();
    this.bindEvents();
    this.raf = requestAnimationFrame(this.frame.bind(this));
  }

  // ---------- DOM 骨架（工具条 / 画布区 + 常驻详情侧栏 / 图例 / 时间轴热条） ----------
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
          <button class="pm-btn" id="pm-fit" type="button">适配</button>
          <button class="pm-btn" id="pm-reset" type="button">重置</button>
        </div>
      </div>
      <div class="pm-stage">
        <div class="pm-canvas-wrap" id="pm-wrap">
          <canvas class="pm-cv" aria-label="学习路径图：薄荷画布上，左侧先修主线（玫红）带起点锚与学段门、右侧直接解锁，底部学期热条＝学完通向；滚轮缩放、拖拽平移"></canvas>
          <div class="pm-legend" aria-hidden="true">
            <span class="lg-item"><i class="lg-line hard"></i>必需</span>
            <span class="lg-item"><i class="lg-line soft"></i>有益</span>
            <span class="lg-item"><i class="lg-line main"></i>主线</span>
            <span class="lg-dir">← 先学 · 后学 →</span>
          </div>
          <div class="pm-hint" aria-hidden="true">单击看详情 · 双击跳转 · 底部时间轴＝学完通向</div>
          <div class="pm-tip" id="pm-tip" hidden></div>
          <div class="pm-strip" id="pm-strip" hidden>
            <div class="pm-strip-cap" id="pm-strip-cap"></div>
            <div class="pm-strip-cells" id="pm-strip-cells"></div>
          </div>
          <div class="pm-pop" id="pm-pop" hidden></div>
        </div>
        <aside class="pm-side" id="pm-side">
          <div class="pm-side-head">
            <span class="pm-side-k">学习详情</span>
            <button class="pm-side-close" type="button" title="关闭 (Esc)">×</button>
          </div>
          <div class="pm-side-body" id="pm-side-body"></div>
        </aside>
      </div>`;
    const $ = (s) => mount.querySelector(s);
    this.ui = {
      stat: $('#pm-stat'), hidden: $('#pm-hidden'), more: $('#pm-more'),
      strip: $('#pm-strip'), stripCap: $('#pm-strip-cap'), stripCells: $('#pm-strip-cells'),
      pop: $('#pm-pop'), tip: $('#pm-tip'), wrap: $('#pm-wrap'),
      side: $('#pm-side'), sideBody: $('#pm-side-body'), sideClose: $('.pm-side-close'),
      cv: $('.pm-cv'),
    };
    $('#pm-fit').addEventListener('click', () => this.fit(true));
    $('#pm-more').addEventListener('click', () => this.setDepth());
    $('#pm-reset').addEventListener('click', () => {
      this.selId = null; this.hideCard();
      this.setRoot(this.rootId);
    });
    this.ui.sideClose.addEventListener('click', () => {
      this.selId = null; this.lineage = null; this.hideCard(); this.dirty = true;
    });
    return mount;
  }

  initCanvas() {
    const wrap = this.ui.wrap;
    this.ctx = this.ui.cv.getContext('2d');
    this.DPR = 1; this.W = 0; this.H = 0;
    this.resize();
    this.ro = new ResizeObserver(() => {
      this.resize();
      // 画布尺寸变化（首帧样式就位 / 窗口缩放）：非用户视图时重新适配
      if (!this.userView && this.rootId) this.fit(false);
      this.dirty = true;
    });
    this.ro.observe(wrap);
  }

  resize() {
    const wrap = this.ui.wrap;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    this.W = w; this.H = h;
    this.ui.cv.width = w * this.DPR; this.ui.cv.height = h * this.DPR;
    this.ui.cv.style.width = w + 'px'; this.ui.cv.style.height = h + 'px';
  }

  // ---------- 数据与布局 ----------
  /** 换知识点：全新数据 + 立即适配（无过渡动画）。 */
  setRoot(id) {
    this.preDepth = null;
    this.rootId = id;
    this.g = pathGraph(this.index, id, null);
    this.layout();
    this.anim = null;
    this.selId = null; this.hoverId = null; this.lineage = null;
    this.hideCard(); this.hideTip(); this.hidePop();
    this.fit(false);
    this.syncToolbar(); this.syncStrip();
    this.dirty = true;
  }

  /** 先修主线加深一层（渐进披露；解锁侧是一跳+计数，无「展开」概念）。 */
  setDepth() {
    this.preDepth = this.g.counts.preLevels + 1;
    const old = new Map([...this.pos.entries()].map(([k, v]) => [k, { ...v }]));
    this.g = pathGraph(this.index, this.rootId, this.preDepth);
    this.layout();
    if (!this.reduce) {
      this.anim = { t0: performance.now(), dur: 280, from: old };
    }
    this.fit(true);
    this.syncToolbar(); this.syncStrip();
    this.dirty = true;
  }

  /**
   * 学期泳道布局：Y = 学期（时间自上而下），X = 依赖列（先修负、解锁正）。
   * 同泳道同列的节点垂直堆叠；泳道高度随其最大堆叠自适应。先修自然落
   * 左上（学期早 + 依赖深）、解锁落右下，主线沿对角线贯穿——这比 dagre 的
   * 交叉最小化更有信息量：时间结构显式可见，跨泳道长线即「跳级依赖」。
   */
  layout() {
    // 泳道：可见节点的学期（升序 = 时间自上而下）
    const laneOf = new Map();           // termKey -> lane 对象
    for (const { id } of this.g.nodes.values()) {
      const t = this.index.byId.get(id);
      const k = termIdx(t);
      if (!laneOf.has(k)) laneOf.set(k, { key: k, label: termLabel(t), cols: new Map() });
    }
    const lanes = [...laneOf.values()].sort((a, b) => a.key - b.key);

    // 归位：每个节点进入 (泳道, 列) 格子，同格堆叠
    for (const n of this.g.nodes.values()) {
      const t = this.index.byId.get(n.id);
      const lane = laneOf.get(termIdx(t));
      if (!lane.cols.has(n.depth)) lane.cols.set(n.depth, []);
      lane.cols.get(n.depth).push(n.id);
    }

    // 泳道高度与 y 基线
    let y = 6;
    for (const lane of lanes) {
      let maxStack = 1;
      for (const arr of lane.cols.values()) maxStack = Math.max(maxStack, arr.length);
      lane.h = maxStack * (NH + STACK_GAP) - STACK_GAP + LANE_PAD * 2;
      lane.y = y;
      y += lane.h + LANE_GAP;
    }

    // 列 x：depth 已是连续带符号列号（root=0），排序映射为等距 x
    const cols = [...new Set([...this.g.nodes.values()].map((n) => n.depth))].sort((a, b) => a - b);
    const colX = new Map(cols.map((c, i) => [c, i * (NW + COL_GAP)]));

    const pos = new Map();              // id -> { x, y }（节点左上角）
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const lane of lanes) {
      for (const [col, arr] of lane.cols) {
        arr.forEach((id, i) => {
          const x = colX.get(col), yy = lane.y + LANE_PAD + i * (NH + STACK_GAP);
          pos.set(id, { x, y: yy });
          minX = Math.min(minX, x); maxX = Math.max(maxX, x + NW);
          minY = Math.min(minY, yy); maxY = Math.max(maxY, yy + NH);
        });
      }
    }
    this.pos = pos;
    this.lanes = lanes;
    this.rootLaneKey = termIdx(this.index.byId.get(this.rootId));
    minX -= LABEL_W;                    // 左侧学期标签计入可视范围（fit 不裁掉）
    this.bounds = { minX, minY, maxX, maxY };

    // 文本截断缓存（需要在 ctx 上量宽）
    this.labels = new Map();
    // 旅程坐标：主线起点锚 + 跨学段门（纯渲染层，不进图数据）
    this.journey = this.buildJourney();
  }

  /** 旅程坐标：chain.ids 自最早可见先修排到 root。主线起点仅在必修闭包完整
      （hidden=0）时标注，否则最早可见站只是折叠点、不是真起点；学段门画在
      主线跨学段（小学→初中→高中）的相邻两站之间。 */
  buildJourney() {
    const ids = this.g.chain.ids;
    const stageOf = (g) => (g <= 6 ? 0 : g <= 9 ? 1 : 2);
    const gates = [];
    for (let i = 1; i < ids.length; i++) {
      const a = this.index.byId.get(ids[i - 1]), b = this.index.byId.get(ids[i]);
      if (stageOf(a.grade) !== stageOf(b.grade))
        gates.push({ fromId: ids[i - 1], toId: ids[i], label: stageOf(b.grade) === 1 ? '入初中' : '入高中' });
    }
    const startTag = (this.g.counts.hidden === 0 && ids.length > 1) ? ids[0] : null;
    return { gates, startTag };
  }

  /** 屏幕空间固定尺寸的旅程芯片（学段门/起点锚），压在主线上、不参与拾取。 */
  drawChip(cx, cy, text, fill, stroke, color) {
    const { ctx } = this;
    ctx.font = `600 12px ${FONT}`;
    const w = Math.ceil(ctx.measureText(text).width) + 16;
    const h = 20;
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 6);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 0.5);
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
    const reserveB = this.g.counts.closureNext > 0 ? STRIP_H : 0;
    // 下限 0.55：更小的图宁可超出画布（可拖拽平移），不牺牲节点文字可读性
    const k = clamp(Math.min((this.W - PAD * 2) / w, (this.H - PAD * 2 - reserveB) / h), 0.55, 1.15);
    const tx = this.W / 2 - (b.minX + w / 2) * k;
    const ty = (this.H - reserveB) / 2 - (b.minY + h / 2) * k;
    if (animate && !this.reduce) {
      const from = { ...this.view };
      this.vAnim = { t0: performance.now(), dur: 300, from, to: { x: tx, y: ty, k } };
    } else {
      this.view = { x: tx, y: ty, k };
    }
    this.userView = false;
    this.dirty = true;
  }

  zoomAt(mx, my, factor) {
    const k = clamp(this.view.k * factor, 0.2, 2.6);
    this.view.x = mx - (mx - this.view.x) * (k / this.view.k);
    this.view.y = my - (my - this.view.y) * (k / this.view.k);
    this.view.k = k;
    this.userView = true;
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
        this.userView = true;
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
      if (hit?.badge) {
        // 先修侧「+N」= 加深一层；解锁侧「+N」= 该知识点自己的解锁影响数，看出卡片
        const n = this.g.nodes.get(hit.id);
        if (n && n.side === 'next') this.select(hit.id);
        else this.setDepth();
        return;
      }
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
      if (e.key === 'Escape') {
        if (!this.ui.pop.hidden) { this.hidePop(); return; }
        if (this.selId) {
          this.selId = null; this.lineage = null; this.hideCard(); this.dirty = true;
        }
      }
    });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    window.removeEventListener('keydown', this.onKey);
    if (this.onDocDown) document.removeEventListener('pointerdown', this.onDocDown);
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

  /** 常驻详情侧栏：无选中时显示引导占位（窄屏下侧栏仅在选中时滑出）。 */
  showCard(id) { this.renderSide(id); }
  hideCard() { this.renderSide(null); }

  renderSide(id) {
    const body = this.ui.sideBody;
    if (!id) {
      this.ui.side.classList.remove('open');
      body.innerHTML = `<div class="pm-side-empty">
        <b>先选一个知识点</b>
        <p>单击图上的知识点卡：这里会展示「为什么先学它」「学会后解锁什么」，以及讲解与练习入口。</p>
        <p class="pm-side-tip">主线上的<span class="pm-chip-demo gate">入初中</span>是学段门，<span class="pm-chip-demo start">起点</span>是必修链第一站。</p>
      </div>`;
      return;
    }
    this.ui.side.classList.add('open');
    const t = this.index.byId.get(id);
    const isRoot = id === this.rootId;
    const onChain = this.g.chain.idSet.has(id);
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
    body.innerHTML = `
      <div class="pm-tip-meta"><i style="background:${subjectDeep(t.subject)}"></i>${esc(t.subject)} · ${esc(t.domain)} · ${t.grade}年级${t.semester}${isRoot ? ' · <b>当前知识点</b>' : ''}${onChain ? ' · <b class="pm-chain-mark">主线</b>' : ''}</div>
      <h4>${esc(t.name)}</h4>
      ${preEdges.length ? `
        <div class="pm-card-sec"><span class="pm-sh">为什么先学这些（${preEdges.length}）</span>
          ${preEdges.map(edgeRow).join('')}</div>` :
        '<div class="pm-card-sec"><span class="pm-sh">先修</span><p class="pm-none">起点知识点，无前置要求。</p></div>'}
      ${nextEdges.length ? `
        <div class="pm-card-sec"><span class="pm-sh">学会后解锁（${nextEdges.length}）</span>
          <div class="pm-next-list">${nextList}${nextEdges.length > 8 ? `<span class="pm-next-more">等 ${nextEdges.length} 个</span>` : ''}</div></div>` :
        '<div class="pm-card-sec"><span class="pm-sh">解锁</span><p class="pm-none">暂无后续知识点依赖它。</p></div>'}
      <button class="pm-lesson" type="button">📖 讲解与例题</button>
      <button class="pm-open" type="button">打开这个知识点 →</button>`;
    const $ = (s) => body.querySelector(s);
    $('.pm-lesson').addEventListener('click', () => this.onLesson?.(id));
    $('.pm-open').addEventListener('click', () => this.onOpen?.(id));
    body.querySelectorAll('b[data-id]').forEach((el) =>
      el.addEventListener('click', () => this.select(el.dataset.id)));
    body.querySelectorAll('.pm-next-item').forEach((el) =>
      el.addEventListener('click', () => this.select(el.dataset.id)));
    body.scrollTop = 0;
  }

  syncToolbar() {
    const { counts } = this.g;
    const parts = [];
    parts.push(counts.chainLen > 1 ? `主线 ${counts.chainLen} 站` : '起点知识点');
    parts.push(`直接解锁 ${counts.next}`);
    if (counts.closureNext) parts.push(`通向 ${counts.closureNext} 个知识点`);
    this.ui.stat.textContent = parts.join(' · ');
    const hasHidden = counts.hidden > 0;
    this.ui.hidden.hidden = !hasHidden;
    this.ui.more.hidden = !hasHidden;
    if (hasHidden) this.ui.hidden.textContent = `还有 ${counts.hidden} 站必修未展开`;
  }

  // ---------- 学完通向：学期时间轴热条 ----------
  /** 传递解锁按学期聚合计数：每格 = 该册通向多少知识点（计数不是网），
      当前学期高亮描边，点格弹出该册清单（可直达知识点）。 */
  syncStrip() {
    const { counts } = this.g;
    if (!counts.closureNext) { this.ui.strip.hidden = true; return; }
    this.ui.strip.hidden = false;
    const rootT = this.index.byId.get(this.rootId);
    this.ui.stripCap.innerHTML = `学完通向<b>${counts.closureNext}</b>个知识点`;

    const cells = [...counts.nextByTerm.values()].sort((a, b) =>
      a.grade * 2 + (a.semester === '下' ? 1 : 0) - (b.grade * 2 + (b.semester === '下' ? 1 : 0)));
    const max = Math.max(...cells.map((c) => c.count), 1);
    const rootKey = `${rootT.grade}|${rootT.semester}`;
    const frag = [];
    for (const cell of cells) {
      const a = 0.14 + 0.8 * Math.sqrt(cell.count / max);          // 感知线性：平方根映射
      const here = `${cell.grade}|${cell.semester}` === rootKey;
      const light = cell.count / max > 0.55;                       // 深底换白字
      frag.push(`<button class="pm-cell${here ? ' here' : ''}" type="button"
        data-key="${esc(`${cell.grade}|${cell.semester}`)}"
        style="background:rgba(${C.brandA},${a.toFixed(3)});${light ? 'color:#fff' : ''}"
        title="${cell.grade}年级${cell.semester}册 · 通向 ${cell.count} 个知识点">
        <b>${cell.count}</b><i${light ? ' style="color:rgba(255,255,255,.85)"' : ''}>${termLabel(cell)}</i></button>`);
    }
    this.ui.stripCells.innerHTML = frag.join('');
    this.ui.stripCells.querySelectorAll('.pm-cell').forEach((el) =>
      el.addEventListener('click', () => this.showPop(el)));
  }

  showPop(cellEl) {
    const key = cellEl.dataset.key;
    const cell = this.g.counts.nextByTerm.get(key);
    if (!cell) return;
    const items = cell.ids.map((id) => {
      const t = this.index.byId.get(id);
      return `<button class="pm-pop-item" data-id="${esc(id)}" type="button">${esc(t.name)}<small>${termLabel(t)}</small></button>`;
    }).join('');
    this.ui.pop.innerHTML = `
      <h5>${cell.grade}年级${cell.semester}册 · 通向 ${cell.count} 个知识点</h5>
      ${items}${cell.count > cell.ids.length ? `<span class="pm-next-more">等 ${cell.count} 个</span>` : ''}`;
    this.ui.pop.hidden = false;
    // 弹层定位在触发热条格上方
    const stage = this.ui.pop.parentElement.getBoundingClientRect();
    const cr = cellEl.getBoundingClientRect();
    const pw = this.ui.pop.offsetWidth;
    const left = clamp(cr.left - stage.left + cr.width / 2 - pw / 2, 8,
      stage.width - pw - 8);
    this.ui.pop.style.left = left + 'px';
    this.ui.pop.querySelectorAll('.pm-pop-item').forEach((el) =>
      el.addEventListener('click', () => this.onOpen?.(el.dataset.id)));
    // 点外部关闭
    if (this.onDocDown) document.removeEventListener('pointerdown', this.onDocDown);
    document.addEventListener('pointerdown', this.onDocDown = (e) => {
      if (!this.ui.pop.hidden && !this.ui.pop.contains(e.target) &&
        !this.ui.stripCells.contains(e.target)) this.hidePop();
    });
  }
  hidePop() {
    this.ui.pop.hidden = true;
    if (this.onDocDown) {
      document.removeEventListener('pointerdown', this.onDocDown);
      this.onDocDown = null;
    }
  }

  // ---------- 绘制 ----------
  nodePos(id) {
    const p = this.pos.get(id);
    if (!this.anim) return p;
    const a = this.anim.from.get(id);
    if (!a) return p;   // 新节点：直接落位
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

    // ---- 学期泳道背景带 + 左侧标签（时间自上而下）----
    const x0 = this.bounds.minX + LABEL_W, x1 = this.bounds.maxX;
    this.lanes.forEach((lane, i) => {
      const isRootLane = lane.key === this.rootLaneKey;
      const p0 = this.toScreen({ x: x0 - 12, y: lane.y });
      const p1 = this.toScreen({ x: x1 + 12, y: lane.y + lane.h });
      const band = isRootLane ? `rgba(${C.brandA},.08)`              // 当前学期：品牌绿淡带
        : (i % 2 === 1 ? 'rgba(255,255,255,.55)' : null);            // 其余：隔行白带（薄荷画布上）
      if (band) {
        ctx.fillStyle = band;
        ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      }
      // 标签
      ctx.font = `600 ${Math.max(10.5 * this.view.k, 8.5)}px ${FONT}`;
      ctx.fillStyle = isRootLane ? C.brandPress : C.sub;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(lane.label, p0.x - 10 * this.view.k, (p0.y + p1.y) / 2);
    });

    const lin = this.lineage;
    const hasFocus = !!lin;

    // ---- 边 ----（普通边先画，主线压在其上：粗玫红实线 = 必须走的关键路径）
    const backbone = [];
    for (let i = 0; i < this.g.edges.length; i++) {
      const e = this.g.edges[i];
      if (e.backbone) { backbone.push(e); continue; }
      this.drawEdge(e, {
        rgb: e.strength === 'hard' ? C.hardA : C.softA,
        on: !hasFocus || lin.edges.has(i),
        hasFocus,
        width: on => (on && hasFocus ? 2.1 : 1.5),
      });
    }
    for (const e of backbone) {
      this.drawEdge(e, { rgb: C.hardA, on: true, hasFocus: false, width: () => 3.2 });
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
      // 卡片底（v2：去阴影，层次交给 1px 描边与薄荷画布的图底关系）
      roundRect(ctx, s.x, s.y, w, h, r);
      ctx.fillStyle = isRoot ? C.brand : C.card;
      ctx.fill();
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

    // ---- 旅程坐标：学段门压在主线跨学段处，起点锚挂在主线首站左上 ----
    for (const g of this.journey.gates) {
      const pa = this.nodePos(g.fromId), pb = this.nodePos(g.toId);
      if (!pa || !pb) continue;
      const sa = this.toScreen({ x: pa.x + NW / 2, y: pa.y + NH / 2 });
      const sb = this.toScreen({ x: pb.x + NW / 2, y: pb.y + NH / 2 });
      this.drawChip((sa.x + sb.x) / 2, (sa.y + sb.y) / 2, g.label,
        '#fff6e5', 'rgba(192,124,0,0.45)', '#8a6100');
    }
    if (this.journey.startTag) {
      const p0 = this.nodePos(this.journey.startTag);
      if (p0) {
        const sp = this.toScreen(p0);
        this.drawChip(sp.x + 26, Math.max(sp.y - 12, 12), '起点', '#e6f7ef', '#bce5cf', '#0b7a4c');
      }
    }
  }

  /** 学习顺序连线：from 右缘 → to 左缘的三次贝塞尔（主线由调用方加粗压层）。 */
  drawEdge(e, { rgb, on, hasFocus, width }) {
    const { ctx } = this;
    const a = this.nodePos(e.from), b = this.nodePos(e.to);
    if (!a || !b) return;
    const p1 = this.toScreen({ x: a.x + NW, y: a.y + NH / 2 });
    const p2 = this.toScreen({ x: b.x, y: b.y + NH / 2 });
    ctx.strokeStyle = `rgba(${rgb},${on ? (hasFocus ? 0.9 : 0.42) : 0.05})`;
    ctx.lineWidth = width(on);
    ctx.setLineDash(e.strength === 'soft' ? [6, 5] : []);
    const dx = clamp((p2.x - p1.x) * 0.45, 30, 92);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.bezierCurveTo(p1.x + dx, p1.y, p2.x - dx, p2.y, p2.x, p2.y);
    ctx.stroke();
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
