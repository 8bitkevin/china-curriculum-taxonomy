// viewer/pathmap.js — 学习路径图 v2：「学习旅程」横向主线图（地铁隐喻）。
// 按结构蓝图 docs/design/pathmap-v2/pathmap-v2-structure.html 落地四区结构，
// 回答学生三问「我在哪 / 先学什么 / 通向哪里」：
//   学习旅程控制条——学科 chip（可切换）· 小学/初中/高中学段分段 ·
//   目标锚点（→初中/中考/高考），hero 粉彩渐变底；
//   关键路径画布——卡片站点（结构蓝图 PATH CANVAS：圆角卡+左上角标签芯片，
//   不用圆点）串成蛇形多行主线：一行列数按画布宽自适应（大卡优先，k≥0.8），
//   满行换行继续——偶数行向右、奇数行向左，长链竖向扩展而不是压缩卡片；
//   薄荷卡=起点（学科绿框）/「+N」折叠卡、玫瑰浅卡=必需先修站、品牌绿实心
//   卡=当前知识点（全图唯一焦点）、白卡=一跳解锁、奶油卡=学段终点门
//   （中考/高考）；连线带行进方向箭头（来路深/前路浅）；root 的有益先修
//   为琥珀虚线支线卡汇入当前卡顶边（首行上方肘线，深行悬卡带短折线）；
//   跨学段处奶油金「入初中/入高中」门芯片；悬停=投影抬升、选中=描边转
//   品牌绿+投影（不画外扩环）；
//   常驻详情侧卡——01 为什么先学这些 / 02 学会后解锁 / 03 讲解与练习 /
//   04 薄弱回链（规划），薄荷 CTA 前置讲解入口；
//   底部学期热条——学完通向计数，当前学期描边联动（游标）。
// 数据口径不变（logic.js pathGraph：chain/counts），纯渲染层。

import { pathGraph } from './logic.js';
import { subjectDeep } from './graph3d.js';

const GAP = 132;           // 站点基础间距（数据坐标）
const ROW_H = 120;         // 蛇形换行行距（卡高 + 支线卡带与上一行的间隙）
const COLS_K = 0.9;        // 一行列数估算：可用宽 /（GAP × COLS_K）≈ k 0.9 的大卡观感
const BASE_Y = 0;          // 首行基线（数据坐标 y=0）
const PAD = 56;            // fit 视图内边距
const STRIP_H = 58;        // 底部时间轴热条预留高（fit 时扣除）
const FONT = '"Segoe UI", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';
// 卡片站点尺寸（数据坐标，结构蓝图比例：卡宽≈间距 0.8，随缩放整体缩放）
const CARD = {
  chain: { w: 108, h: 52 },   // 必需先修（玫瑰浅卡）
  next: { w: 104, h: 52 },    // 一跳解锁（白卡）
  start: { w: 108, h: 52 },   // 起点（薄荷卡）
  root: { w: 132, h: 64 },    // 当前知识点（品牌绿实卡，蓝图 NOW 大卡）
  gate: { w: 100, h: 48 },    // 学段终点门（奶油卡）
  soft: { w: 96, h: 44 },     // 有益支线（琥珀虚线卡）
  fold: { w: 72, h: 44 },     // 折叠卡
};
// 画布配色（与 style.css 的 --hard/--soft/--accent 变量同源，改一处核两处）
const C = {
  hardA: '216,30,106',     // 必需（玫红 #d81e6a）——来路主线
  softA: '192,124,0',      // 有益（琥珀 #c07c00）——支线虚线
  cardLine: '#dce1e7',
  ink: '#1b2b33',
  sub: '#8a97a5',
  brand: '#0fa968',        // K12 品牌绿 = 起点/交互强调（--accent）
  brandInk: '#0b7a4c',     // 品牌绿文字安全档（--accent-ink）＝当前焦点
  brandPress: '#0b8f57',
  brandA: '15,169,104',
  gate: '#c07c00',         // 学段终点门（里程碑金）
};
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const termIdx = (t) => t.grade * 2 + (t.semester === '下' ? 1 : 0);       // 学期排序键
const termLabel = (t) => `${CN_NUM[t.grade - 1] ?? t.grade}${t.semester}`; // 如「七上」
const stageOf = (g) => (g <= 6 ? 0 : g <= 9 ? 1 : 2);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class PathMap {
  /**
   * @param mount   挂载元素（.pm-stage 外层）
   * @param {{ index, onOpen(id), onLesson(id), onSubject(subject) }} opts
   */
  constructor(mount, opts = {}) {
    this.index = opts.index;
    this.onOpen = opts.onOpen;
    this.onLesson = opts.onLesson;
    this.onSubject = opts.onSubject;
    this.reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    this.preDepth = null;               // null = 自适应（hard 闭包 ≤40 站全显）
    this.view = { x: 0, y: 0, k: 1 };   // 平移 + 缩放（屏幕 = 数据 * k + t）
    this.userView = false;              // 用户手动平移/缩放后，画布尺寸变化不再自动适配
    this.hoverId = null;
    this.selId = null;
    this.onKey = null;
    this.dirty = true;

    this.dom = this.buildDom(mount);
    this.initCanvas();
    this.bindEvents();
    this.raf = requestAnimationFrame(this.frame.bind(this));
  }

  // ---------- DOM 骨架（工具条 / 旅程画布 + 常驻详情侧栏 / 图例 / 热条） ----------
  buildDom(mount) {
    mount.innerHTML = `
      <div class="pm-top">
        <div class="pm-title">
          <span class="pm-ic" aria-hidden="true"></span>
          <b>学习旅程</b>
          <span class="pm-stat" id="pm-stat"></span>
        </div>
        <div class="pm-journey" role="group" aria-label="旅程坐标：学科、学段与目标锚点">
          <button class="pm-subject" id="pm-subject" type="button" title="切换到该学科的知识点列表">
            <i id="pm-subject-dot" aria-hidden="true"></i><span id="pm-subject-name"></span>
          </button>
          <div class="pm-stages" id="pm-stages">
            <span data-s="0">小学</span><span data-s="1">初中</span><span data-s="2">高中</span>
          </div>
          <span class="pm-anchor" id="pm-anchor"></span>
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
          <canvas class="pm-cv" aria-label="学习旅程图：卡片站点串成一条水平主线，左端起点卡、右端学段终点门卡，当前知识点为品牌绿实心卡，必需先修为玫瑰浅卡，一跳解锁为白卡，有益先修为琥珀虚线卡从上方汇入；滚轮缩放、拖拽平移"></canvas>
          <div class="pm-legend" aria-hidden="true">
            <span class="lg-item"><i class="lg-line hard"></i>必需主线</span>
            <span class="lg-item"><i class="lg-line fwd"></i>前路</span>
            <span class="lg-item"><i class="lg-line soft"></i>有益支线</span>
            <span class="lg-item"><i class="lg-card now"></i>当前</span>
            <span class="lg-item"><i class="lg-card gate"></i>学段终点</span>
          </div>
          <div class="pm-hint" id="pm-hint" aria-hidden="true">单击看详情 · 双击跳转 · 底部热条＝学完通向</div>
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
      subject: $('#pm-subject'), subjectDot: $('#pm-subject-dot'), subjectName: $('#pm-subject-name'),
      stages: $('#pm-stages'), anchor: $('#pm-anchor'),
      strip: $('#pm-strip'), stripCap: $('#pm-strip-cap'), stripCells: $('#pm-strip-cells'),
      pop: $('#pm-pop'), tip: $('#pm-tip'), wrap: $('#pm-wrap'), hint: $('#pm-hint'),
      side: $('#pm-side'), sideBody: $('#pm-side-body'), sideClose: $('.pm-side-close'),
      cv: $('.pm-cv'),
    };
    $('#pm-fit').addEventListener('click', () => this.fit(true));
    $('#pm-more').addEventListener('click', () => this.setDepth());
    this.ui.subject.addEventListener('click', () => {
      const t = this.index.byId.get(this.rootId);
      if (t) this.onSubject?.(t.subject);
    });
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
      // 画布尺寸变化（首帧样式就位 / 窗口缩放）：非用户视图时重新布局适配
      if (!this.userView && this.rootId) { this.layoutJourney(); this.fit(false); }
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

  // ---------- 数据与旅程布局 ----------
  /** 换知识点：全新数据 + 立即适配（无过渡动画）。 */
  setRoot(id) {
    this.preDepth = null;
    this.rootId = id;
    this.g = pathGraph(this.index, id, null);
    this.layoutJourney();
    this.selId = null; this.hoverId = null;
    this.hideCard(); this.hideTip(); this.hidePop();
    this.fit(false);
    this.syncToolbar(); this.syncStrip();
    this.dirty = true;
  }

  /** 先修主线加深一层（渐进披露；解锁侧是一跳+计数，无「展开」概念）。 */
  setDepth() {
    this.preDepth = this.g.counts.preLevels + 1;
    this.g = pathGraph(this.index, this.rootId, this.preDepth);
    this.layoutJourney();
    this.fit(true);
    this.syncToolbar(); this.syncStrip();
    this.dirty = true;
  }

  /**
   * 旅程布局：主线站点按顺序等距排在水平基线上（数据坐标 x = i*GAP）。
   * 序列 = [折叠环?] + 必修链（起点→当前）+ 直接解锁（≤4，按学期排序）
   *        + 学段终点门。有益先修（root 的 1 跳 soft 叶子）挂在当前站上方。
   * 折叠环仅在 hard 闭包超容量时出现；此时链上最早站不是真起点，
   * 起点双环不标注（诚实性约束，与设计稿一致）。
   */
  layoutJourney() {
    const byId = this.index.byId;
    const { counts } = this.g;
    const slots = [];
    if (counts.hidden > 0) slots.push({ kind: 'fold', n: counts.hidden });
    for (const id of this.g.chain.ids) slots.push({ kind: 'chain', id });
    const rootSlot = slots.length - 1;
    const rootT = byId.get(this.rootId);
    const unlocks = (this.index.unlocksOf.get(this.rootId) ?? [])
      .slice(0, 4)
      .map((e) => byId.get(e.topicId))
      .filter(Boolean)
      .sort((a, b) => termIdx(a) - termIdx(b));
    for (const t of unlocks) slots.push({ kind: 'next', id: t.id });
    const endLabel = stageOf(rootT.grade) === 0 ? '入初中' : stageOf(rootT.grade) === 1 ? '中考门' : '高考门';
    slots.push({ kind: 'end', label: endLabel });

    // 蛇形网格：一行 COLS 张卡（按画布宽估算，k≈0.9 时卡内文字可读），
    // 满行换行继续——偶数行向右、奇数行向左（蛇形阅读序），行距 ROW_H。
    // 长链不再压卡片尺寸，而是竖向扩展行数。
    const cols = clamp(Math.floor((this.W - PAD * 2) / (GAP * COLS_K)), 3, 8);
    const posOf = (i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      return { x: (row % 2 === 0 ? col : cols - 1 - col) * GAP, y: row * ROW_H };
    };
    const stations = slots.map((s, i) => ({ ...s, i, ...posOf(i) }));
    const rootI = rootSlot;
    const rootRow = Math.floor(rootI / cols);

    // 跨学段门：可见主线相邻两站学段不同 → 奶油金芯片（横向段画在中点下方，
    // 换行竖直段画在段右侧）
    const gates = [];
    for (let i = 1; i <= rootSlot; i++) {
      const a = byId.get(slots[i - 1].id), b = byId.get(slots[i].id);
      if (a && b && stageOf(a.grade) !== stageOf(b.grade))
        gates.push({ i, label: stageOf(b.grade) === 1 ? '入初中' : '入高中' });
    }

    // 有益支线：root 的 1 跳 soft 先修。root 在首行 → 抬到左上方（肘线汇入）；
    // root 在更深处 → 支线卡带悬在 root 正上方与上一行的间隙里（短折线汇入），
    // 避免压到网格卡片。
    const inChain = new Set(this.g.chain.ids);
    const softTopics = (this.index.prereqsOf.get(this.rootId) ?? [])
      .filter((e) => e.strength === 'soft' && !inChain.has(e.prerequisiteId))
      .map((e) => byId.get(e.prerequisiteId))
      .filter(Boolean)
      .slice(0, 3);
    const rootP0 = stations[rootI];
    const branches = softTopics.map((t, i, arr) => {
      if (rootRow === 0) {
        return { id: t.id, topic: t, x: rootP0.x - GAP * 0.95 - i * GAP * 0.82, y: BASE_Y - 86 };
      }
      return {
        id: t.id, topic: t,
        x: rootP0.x + (i - (arr.length - 1) / 2) * (CARD.soft.w + 16),
        y: rootP0.y - 60,
      };
    });
    this.branchMode = rootRow === 0 ? 'top' : 'band';

    // 拾取表（数据坐标 + 卡片矩形）：折叠卡/链上卡/解锁卡/支线卡
    const pickables = [];
    for (const s of stations) {
      if (s.kind === 'fold') pickables.push({ x: s.x, y: s.y, ...CARD.fold, action: 'depth' });
      else if (s.kind === 'end') continue;                 // 终点门为装饰，不拾取
      else pickables.push({ x: s.x, y: s.y, w: CARD.chain.w, h: CARD.chain.h, id: s.id, action: 'select' });
    }
    for (const b of branches) pickables.push({ x: b.x, y: b.y, ...CARD.soft, id: b.id, action: 'select' });

    this.stations = stations;
    this.rootI = rootI;
    this.gates = gates;
    this.branches = branches;
    this.pickables = pickables;
    let minX = -PAD;
    for (const b of branches) minX = Math.min(minX, b.x - CARD.soft.w);
    const rows = Math.ceil(stations.length / cols);
    this.bounds = {
      minX,
      maxX: (cols - 1) * GAP + PAD,
      minY: -150,
      maxY: (rows - 1) * ROW_H + 70,
    };
  }

  /** 按「屏幕像素」截断站名（中文按 1em/字预算），缓存按宽度档。 */
  nameAt(topic, maxW) {
    const key = Math.round(maxW / 8);
    this._names ??= new Map();
    const k = `${topic.id}|${key}`;
    let s = this._names.get(k);
    if (s === undefined) {
      s = topic.name;
      this.ctx.font = `600 12px ${FONT}`;
      if (this.ctx.measureText(s).width > maxW) {
        let lo = 1, hi = s.length - 1, best = 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (this.ctx.measureText(s.slice(0, mid) + '…').width <= maxW) { best = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        s = s.slice(0, best) + '…';
      }
      this._names.set(k, s);
    }
    return s;
  }

  // ---------- 视图 ----------
  fit(animate) {
    const b = this.bounds;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const reserveB = this.g.counts.closureNext > 0 ? STRIP_H : 0;
    // 下限 0.8：保卡片内文字可读（结构蓝图的大卡片观感）；任一轴溢出时
    // 以当前知识点为画面中心，拖拽漫游全程（Duolingo 式路径体验）
    const k = clamp(Math.min((this.W - PAD * 2) / w, (this.H - PAD * 2 - reserveB) / h), 0.8, 1.3);
    const ovX = w * k > this.W - PAD * 2;
    const ovY = h * k > this.H - PAD * 2 - reserveB;
    this.overflow = ovX || ovY;
    const cx = ovX && this.stations ? this.stations[this.rootI].x : b.minX + w / 2;
    const cy = ovY && this.stations ? this.stations[this.rootI].y : b.minY + h / 2;
    const tx = this.W / 2 - cx * k;
    const ty = (this.H - reserveB) / 2 - cy * k;
    if (animate && !this.reduce) {
      const from = { ...this.view };
      this.vAnim = { t0: performance.now(), dur: 300, from, to: { x: tx, y: ty, k } };
    } else {
      this.view = { x: tx, y: ty, k };
    }
    if (this.ui.hint) {
      this.ui.hint.textContent = this.overflow
        ? '单击看详情 · 双击跳转 · 拖拽漫游全程'
        : '单击看详情 · 双击跳转 · 底部热条＝学完通向';
    }
    this.userView = false;
    this.dirty = true;
  }

  zoomAt(mx, my, factor) {
    const k = clamp(this.view.k * factor, 0.3, 2.6);
    this.view.x = mx - (mx - this.view.x) * (k / this.view.k);
    this.view.y = my - (my - this.view.y) * (k / this.view.k);
    this.view.k = k;
    this.userView = true;
    this.dirty = true;
  }

  toScreen(p) { return { x: p.x * this.view.k + this.view.x, y: p.y * this.view.k + this.view.y }; }

  // ---------- 交互 ----------
  bindEvents() {
    const cv = this.ui.cv;
    let drag = null;

    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
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
      if (hit?.action === 'depth') { this.setDepth(); return; }
      if (hit?.id) this.select(hit.id);
      else { this.selId = null; this.hideCard(); this.dirty = true; }
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
          this.selId = null; this.hideCard(); this.dirty = true;
        }
      }
    });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    window.removeEventListener('keydown', this.onKey);
  }

  /** 屏幕空间拾取：投影卡片中心，命中卡片矩形（含 4px 余量）。 */
  pick(mx, my) {
    for (const p of this.pickables) {
      const s = this.toScreen(p);
      const rw = p.w / 2 * this.view.k + 4;
      const rh = p.h / 2 * this.view.k + 4;
      if (Math.abs(mx - s.x) <= rw && Math.abs(my - s.y) <= rh) return p;
    }
    return null;
  }

  select(id) {
    this.selId = id;
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
      <div class="pm-tip-hint">单击查看详情 · 双击打开</div>`;
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
        <b>先选一个站点</b>
        <p>单击主线上的站点：这里会展示「为什么先学它」「学会后解锁什么」，以及讲解与练习入口。</p>
        <p class="pm-side-tip">主线左端<span class="pm-chip-demo start">起点</span>是必修链第一站，<span class="pm-chip-demo gate">入初中</span>是学段门，右端是学段终点。</p>
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
    const secNo = (n, title) => `<span class="pm-sh"><span class="pm-no">${n}</span>${title}</span>`;
    body.innerHTML = `
      <div class="pm-tip-meta"><i style="background:${subjectDeep(t.subject)}"></i>${esc(t.subject)} · ${esc(t.domain)} · ${t.grade}年级${t.semester}${isRoot ? ' · <b>当前知识点</b>' : ''}${onChain ? ' · <b class="pm-chain-mark">主线</b>' : ''}</div>
      <h4>${esc(t.name)}</h4>
      ${preEdges.length ? `
        <div class="pm-card-sec">${secNo('01', `为什么先学这些（${preEdges.length}）`)}
          ${preEdges.map(edgeRow).join('')}</div>` :
        `<div class="pm-card-sec">${secNo('01', '为什么先学这些')}<p class="pm-none">起点知识点，无前置要求。</p></div>`}
      ${nextEdges.length ? `
        <div class="pm-card-sec">${secNo('02', `学会后解锁（${nextEdges.length}）`)}
          <div class="pm-next-list">${nextList}${nextEdges.length > 8 ? `<span class="pm-next-more">等 ${nextEdges.length} 个</span>` : ''}</div></div>` :
        `<div class="pm-card-sec">${secNo('02', '学会后解锁')}<p class="pm-none">暂无后续知识点依赖它。</p></div>`}
      <div class="pm-card-sec">${secNo('03', '讲解与练习')}<p class="pm-none">讲解 · 方法 · 例题，几分钟掌握。</p></div>
      <div class="pm-card-sec pm-plan">${secNo('04', '薄弱回链')}<p class="pm-none">掌握薄弱时回补对应先修（规划中）。</p></div>
      <button class="pm-lesson" type="button">打开讲解与练习 →</button>
      <button class="pm-open" type="button">打开知识点 →</button>`;
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
    // 旅程坐标：学科 chip / 学段分段高亮 / 目标锚点（与画布终点门同语义）
    const rootT = this.index.byId.get(this.rootId);
    if (rootT) {
      const st = stageOf(rootT.grade);
      this.ui.subjectDot.style.background = subjectDeep(rootT.subject);
      this.ui.subjectName.textContent = rootT.subject;
      this.ui.stages.querySelectorAll('span').forEach((el) =>
        el.classList.toggle('on', +el.dataset.s === st));
      this.ui.anchor.textContent = `→ ${['初中', '中考', '高考'][st]}`;
    }
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
  frame(ts) {
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
    if (this.dirty) { this.draw(); this.dirty = false; }
    this.raf = requestAnimationFrame(this.frame.bind(this));
  }

  /** 屏幕空间固定尺寸的芯片（学段门/起点/折叠环），不参与拾取。 */
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

  /**
   * 结构蓝图 PATH CANVAS 的卡片站点：圆角卡 + 左上角小标签芯片 + 名称/副标。
   * 在站点屏幕位置 translate+scale 后按数据尺寸绘制，卡片与文字随缩放同步；
   * lineWidth 取 1/k 的倍数，保持屏幕空间 1px 细线（出版级规范）。
   */
  drawCard(p, k, o) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(k, k);
    const px = 1 / k;
    const half = o.h / 2;
    ctx.beginPath();
    roundRect(ctx, -o.w / 2, -half, o.w, o.h, 6);
    // 悬停/选中：卡片自身描边转品牌绿 + 轻投影抬升（行业惯例 elevation +
    // accent border），不画外扩环——双描边观感差
    if (o.sel || o.hover) {
      ctx.shadowColor = o.sel ? 'rgba(27,43,51,0.18)' : 'rgba(27,43,51,0.10)';
      ctx.shadowBlur = o.sel ? 12 : 8;
      ctx.shadowOffsetY = o.sel ? 3 : 2;
    }
    ctx.fillStyle = o.fill;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    if (o.stroke) {
      ctx.strokeStyle = o.sel ? C.brand : o.stroke;
      ctx.lineWidth = (o.sel ? 1.5 : 1) * px;
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.stroke();
      if (o.dash) ctx.setLineDash([]);
    }
    if (o.tag) {                             // 左上角标签芯片，压卡片上边缘
      ctx.font = `600 7px ${MONO}`;
      const cw = ctx.measureText(o.tag).width + 10;
      const cx0 = -o.w / 2 + 7, cy0 = -half - 4;
      ctx.beginPath();
      roundRect(ctx, cx0, cy0, cw, 11, 3);
      const chipFill = o.chipFill ?? '#f6f8fa';
      if (chipFill !== 'none') { ctx.fillStyle = chipFill; ctx.fill(); }
      ctx.strokeStyle = o.tagStroke ?? o.tagColor;
      ctx.lineWidth = 0.8 * px;
      ctx.stroke();
      ctx.fillStyle = o.tagColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.tag, cx0 + cw / 2, cy0 + 6);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const lift = o.tag ? 2 : 6;              // 有标签时内容略上让位
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = o.nameColor ?? C.ink;
    ctx.fillText(o.name, 0, o.sub ? lift : lift + 4);
    if (o.sub) {
      ctx.font = `400 10.5px ${FONT}`;
      ctx.fillStyle = o.subColor ?? C.sub;
      ctx.fillText(o.sub, 0, lift + 15);
    }
    ctx.restore();
  }

  draw() {
    const { ctx, W, H, DPR } = this;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);      // 透明画布，露出薄荷底（.pm-canvas-wrap）

    if (!this.stations?.length) return;
    const k = this.view.k;
    const P = this.stations.map((s) => this.toScreen(s));
    const rootP = P[this.rootI];

    // ---- 主线：蛇形折线（结构蓝图带方向箭头），来路玫红实、前路浅玫红 ----
    const arrow = (a, b, alpha) => {
      // 行进方向箭头画在连线中点（卡片遮住线端，中点最清晰）
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const vx = -uy, vy = ux;
      ctx.beginPath();
      ctx.moveTo(mx + ux * 5, my + uy * 5);
      ctx.lineTo(mx - ux * 4 + vx * 3.5, my - uy * 4 + vy * 3.5);
      ctx.lineTo(mx - ux * 4 - vx * 3.5, my - uy * 4 - vy * 3.5);
      ctx.closePath();
      ctx.fillStyle = `rgba(${C.hardA},${alpha})`;
      ctx.fill();
    };
    const seg = (from, to, alpha) => {
      ctx.beginPath();
      ctx.moveTo(P[from].x, P[from].y);
      for (let i = from + 1; i < to; i++) {
        ctx.arcTo(P[i].x, P[i].y, P[i + 1].x, P[i + 1].y, 10 * k);
      }
      ctx.lineTo(P[to].x, P[to].y);
      ctx.strokeStyle = `rgba(${C.hardA},${alpha})`;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      for (let i = from + 1; i <= to; i++) arrow(P[i - 1], P[i], alpha);
    };
    if (this.rootI > 0) seg(0, this.rootI, 0.92);
    if (this.rootI < P.length - 1) seg(this.rootI, P.length - 1, 0.4);

    // ---- 有益支线（琥珀虚线卡；首行上方肘线汇入 / 深行卡带短折线汇入当前卡顶边） ----
    this.branches.forEach((b, bi) => {
      const s = this.toScreen(b);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = `rgba(${C.softA},0.85)`;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      if (this.branchMode === 'top') {
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + (CARD.soft.h / 2) * k);
        ctx.lineTo(s.x, rootP.y - 42 * k);
        ctx.quadraticCurveTo(s.x, rootP.y - 32 * k, s.x + 10 * k, rootP.y - 32 * k);
        ctx.lineTo(rootP.x - 14 * k, rootP.y - 32 * k);
        ctx.stroke();
        ctx.setLineDash([]);
        // 箭头（横向指向当前卡顶边）
        ctx.beginPath();
        ctx.moveTo(rootP.x - 10 * k, rootP.y - 32 * k);
        ctx.lineTo(rootP.x - 16 * k, rootP.y - 35.5 * k);
        ctx.lineTo(rootP.x - 16 * k, rootP.y - 28.5 * k);
        ctx.closePath();
        ctx.fillStyle = `rgba(${C.softA},0.85)`;
        ctx.fill();
      } else {
        // 卡带模式：支线卡悬在当前卡上方间隙，短折线垂直落入卡顶边，
        // 箭头落点按支线序横向散开避免重叠
        const tx = rootP.x + (bi - (this.branches.length - 1) / 2) * 18 * k;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + (CARD.soft.h / 2) * k);
        ctx.lineTo(s.x, rootP.y - 36 * k);
        ctx.lineTo(tx, rootP.y - 36 * k);
        ctx.lineTo(tx, rootP.y - 32 * k);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(tx, rootP.y - 30 * k);
        ctx.lineTo(tx - 3.5 * k, rootP.y - 36 * k);
        ctx.lineTo(tx + 3.5 * k, rootP.y - 36 * k);
        ctx.closePath();
        ctx.fillStyle = `rgba(${C.softA},0.85)`;
        ctx.fill();
      }
      this.drawCard(s, k, {
        ...CARD.soft, fill: '#ffffff', stroke: 'rgba(192,124,0,0.55)', dash: [4, 3],
        tag: 'SOFT', tagColor: '#8a6100',
        name: this.nameAt(this.index.byId.get(b.id), 82), sub: '有益先修',
      });
    });

    // ---- 学段门芯片（横向段画在中点下方，换行竖直段画在段右侧） ----
    for (const g of this.gates) {
      const a = P[g.i - 1], b2 = P[g.i];
      const vertical = Math.abs(a.x - b2.x) < 1;
      const mx = vertical ? a.x + 46 : (a.x + b2.x) / 2;
      const my = vertical ? (a.y + b2.y) / 2 : b2.y + (CARD.chain.h / 2) * k + 14;
      this.drawChip(mx, my, g.label, '#fff6e5', 'rgba(192,124,0,0.45)', '#8a6100');
    }

    // ---- 站点卡片（结构蓝图 PATH CANVAS：卡片而非圆点） ----
    this.stations.forEach((s, i) => {
      const p = P[i];
      if (s.kind === 'fold') {
        // 折叠卡：更早的必修站折叠数（单击加深一层）
        this.drawCard(p, k, {
          ...CARD.fold, fill: '#edf0f3', stroke: '#dce1e7', dash: [4, 3],
          tag: 'FOLD', tagColor: '#5a6b77',
          name: `+${s.n > 99 ? 99 : s.n}`, sub: '未展开必修',
        });
        return;
      }
      if (s.kind === 'end') {
        // 学段终点门：奶油卡（入初中/中考门/高考门）
        this.drawCard(p, k, {
          ...CARD.gate, fill: '#fff6e5', stroke: 'rgba(192,124,0,0.45)',
          tag: 'GATE', tagColor: '#8a6100', name: s.label, sub: '学段终点',
        });
        return;
      }
      const t = this.index.byId.get(s.id);
      const isRoot = i === this.rootI;
      const sel = !isRoot && this.selId === s.id;
      const hov = !isRoot && !sel && this.hoverId === s.id;
      if (isRoot) {
        // 当前知识点：唯一品牌绿实卡（蓝图 NOW 大卡）；芯片用透明白描边
        //（浅底白字在深绿卡上看不清，结构蓝图 NOW 芯片即透明底+白描边）
        this.drawCard(p, k, {
          ...CARD.root, fill: C.brandInk, stroke: C.brand,
          tag: 'NOW', tagColor: '#ffffff',
          tagStroke: 'rgba(255,255,255,0.6)', chipFill: 'rgba(255,255,255,0.14)',
          name: this.nameAt(t, 116), nameColor: '#ffffff',
          sub: '当前位置', subColor: 'rgba(255,255,255,0.85)',
        });
      } else if (i === 0 && this.g.counts.hidden === 0) {
        // 起点：薄荷卡（仅必修闭包完整时，首站才是真起点）
        this.drawCard(p, k, {
          ...CARD.start, fill: '#e6f7ef', stroke: '#bce5cf',
          tag: 'ORIGIN', tagColor: C.brandInk,
          name: this.nameAt(t, 94), sub: '起点', sel, hover: hov,
        });
      } else if (s.kind === 'next') {
        // 一跳解锁：白卡 + 墨框
        this.drawCard(p, k, {
          ...CARD.next, fill: '#ffffff', stroke: 'rgba(27,43,51,0.55)',
          tag: 'NEXT', tagColor: C.ink,
          name: this.nameAt(t, 90), sub: termLabel(t), sel, hover: hov,
        });
      } else {
        // 必需先修：玫瑰浅卡 + 玫红框
        this.drawCard(p, k, {
          ...CARD.chain, fill: '#fceef5', stroke: 'rgba(216,30,106,0.35)',
          tag: 'HARD', tagColor: '#a81354',
          name: this.nameAt(t, 94), sub: termLabel(t), sel, hover: hov,
        });
      }
    });
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
