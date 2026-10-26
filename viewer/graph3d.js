// 3D 全景「星系」：Canvas 2D 透视投影（零依赖、零构建）。视觉范式对标
// Obsidian 社区插件 Galaxy View 的深空星系（仅概念借鉴，代码为本仓库原创中文版）：
//   ① 星云纱 nebula veil —— 品牌色系深空云，预烘焙 + 随视角微浮动；
//   ② 星壳 star shell —— 数百颗远景星，随水平旋转无缝环绕（中景视差）；
//   ③ 漂移星 field stars —— 稍大的近景星，视差更快，自转时缓慢漂移；
//   ④ 星云团 nebula puffs —— 彩色云团确定性散布在锥体内（装饰层，不与学科挂钩）；
//   ⑤ 轴心辉光 + 精灵泛光节点（微闪烁）+ 弯曲星丝（连线背离星系轴外拱）。
// 布局为锥形（纺锤）星系：y = 年级高度场，平均半径随高度线性张开；角向为
// 完全随机混布（hash01(id)×2π，九科彩色纸屑、疏密均匀，不按学科分区）。
// 节点尺寸 = sqrt(中心性)*7.5 的幂律分布。全部背景层在离屏 canvas 预烘焙
// （resize 重建），每帧仅数次 drawImage，1641 节点下仍保持 60fps。

// 分组 = 学科。学科色板采用 K12aixue 设计系统的学科彩色系（设计语言 v5）：
// 双色阶一一对应 —— bright 档用于深色画布（本视图），deep 档用于浅色界面
// （徽章/色条/圆点，白底对比 ≥4:1）。语/数/英/物/化/生六科直接取用其
// 学科色（#F0533D/#0FA968/#4A8CFF/#7B61FF/#00A8B5/#5BAE2E），
// 历史/地理/道法(思政) 为同气质扩展（金黄/深青/玫红）。同一条线的初中/
// 高中科（道德与法治/思想政治）共用一色；学科身份全程伴随文字标签（色觉
// 冗余编码）。pathmap.js（学习路径图）同样引用 —— 修改色板请两处视图一起核对。
export const SUBJECT_COLORS = {
  '数学': { deep: '#0fa968', bright: '#52d093' },
  '语文': { deep: '#f0533d', bright: '#ff8f7a' },
  '英语': { deep: '#4a8cff', bright: '#8fb8ff' },
  '物理': { deep: '#7b61ff', bright: '#ad9bff' },
  '化学': { deep: '#00a8b5', bright: '#5bd9e0' },
  '生物学': { deep: '#5bae2e', bright: '#98db63' },
  '历史': { deep: '#b9770e', bright: '#ffc043' },
  '地理': { deep: '#0e7490', bright: '#53cfe0' },
  '道德与法治': { deep: '#c2255c', bright: '#f783ae' },
  '思想政治': { deep: '#c2255c', bright: '#f783ae' },
};
const PALETTE = Object.values(SUBJECT_COLORS);
export const subjectColor = (name, i = 0) => (SUBJECT_COLORS[name] ?? PALETTE[i % PALETTE.length]).bright;
export const subjectDeep = (name, i = 0) => (SUBJECT_COLORS[name] ?? PALETTE[i % PALETTE.length]).deep;

// 锥形星系半径律（加胖版）：底部 190，随高度 0.46 线性张开；径向散布
// σ=120。coneR 在布局 / 星云团 / 轴心辉光三处共用——想调胖瘦只动这
// 三个常量。半径律在 Marble 实测（r≈110+0.26y、σ≈95）基础上整体加胖：
// 锥面周长变大、星点更稀疏，缓解「太密集太紧凑」。
const CONE_R0 = 190, CONE_SLOPE = 0.46, CONE_SIGMA = 120;
const coneR = (y) => CONE_R0 + Math.max(0, y) * CONE_SLOPE;

// ---------- 布局：锥形星系（角向完全随机混布） ----------
// 高度场沿用 Marble 范式（每年级 350）；角向为确定性随机（hash01(id)×2π，
// 与星系化改造前一致），九科彩色混布、锥面疏密均匀。
export function buildLayout(index) {
  const groups = [...new Set(index.topics.map((t) => t.subject))];
  // 同色学线在图例中相邻（道德与法治 → 思想政治），两只玫红芯片挨在一起
  const dd = groups.indexOf('道德与法治'), zz = groups.indexOf('思想政治');
  if (dd >= 0 && zz > dd + 1) { groups.splice(zz, 1); groups.splice(dd + 1, 0, '思想政治'); }
  const grades = index.topics.map((t) => t.grade);
  const minG = Math.min(...grades), maxG = Math.max(...grades);
  const LVL = 350;                                  // 每个年级的高度
  const H = (maxG - minG + 1) * LVL;

  const deg = new Map();
  for (const t of index.topics) {
    deg.set(t.id, (index.prereqsOf.get(t.id)?.length ?? 0)
      + (index.unlocksOf.get(t.id)?.length ?? 0));
  }
  const maxDeg = Math.max(1, ...deg.values());

  const nodes = index.topics.map((t) => {
    const y = (t.grade - minG) * LVL + (t.semester === '上' ? 0 : LVL / 2)
      + (hash01(t.id + 'y') - 0.5) * LVL * 0.7;
    const g = groups.indexOf(t.subject);
    const theta = hash01(t.id) * Math.PI * 2;   // 角向完全随机：九科彩色混布
    const rr = Math.max(30, coneR(y) + gauss(hash01(t.id + 'r'), hash01(t.id + 'r2')) * CONE_SIGMA);
    // 中心性 c：幂律感——多数节点 0，枢纽趋近 1
    const c = deg.get(t.id) <= 1 ? 0 : Math.min(1, (deg.get(t.id) - 1) / maxDeg * 1.6);
    return {
      id: t.id, topic: t,
      x: Math.cos(theta) * rr, y, z: Math.sin(theta) * rr,
      g, a: t.grade,
      col: subjectColor(t.subject, g),
      dm: t.subject !== '数学' ? `${t.subject}·${t.domain}` : t.domain, name: t.name, c,
      appear: y / H,
    };
  });
  const byId = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = index.deps.map((e) => [
    byId.get(e.topicId), byId.get(e.prerequisiteId),
    e.strength === 'hard' ? 1 : 0,
  ]).filter((e) => e[0] != null && e[1] != null);
  return { nodes, edges, groups, H };
}

const hash01 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
};
const gauss = (u1, u2) => Math.sqrt(-2 * Math.log(u1 + 1e-9)) * Math.cos(2 * Math.PI * u2);
// 固定种子随机：背景星空在多次 resize 重烘焙后保持稳定
const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------- 主类 ----------
export class Graph3D {
  constructor(mount, layout, opts = {}) {
    this.reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    this.layout = layout;
    this.onOpenTopic = opts.onOpenTopic;
    this.onLesson = opts.onLesson;
    this.selected = -1; this.hover = -1; this.lineage = null;
    this.hist = [];
    this.drift = 0;   // 漂移星层的累计漂移量（自转时增长）
    this.dom = this.buildDom(mount);
    this.initCanvas(mount);
    this.bindEvents();
    this.START = performance.now();
    this.lastTs = this.START;
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  buildDom(mount) {
    const n = this.layout.nodes.length, e = this.layout.edges.length;
    mount.innerHTML = `
      <div class="g3-head">
        <div class="g3-kicker">九科 K12 · 知识点星系</div>
        <h2>一个孩子要学的一切</h2>
        <div class="g3-count mono"><b id="g3n">${n}</b> 个知识点 · <b id="g3e">${e}</b> 条先修关系</div>
      </div>
      <div class="g3-legend" id="g3chips" role="group" aria-label="领域筛选"></div>
      <div class="g3-tip" id="g3tip">
        <span class="sw"></span><span class="ts"></span>
        <div class="ttl"></div><div class="q"></div>
      </div>
      <aside class="g3-card" id="g3card">
        <button class="close" type="button" title="关闭">×</button>
        <button class="back" type="button" title="上一个">‹ 返回</button>
        <div class="csw"><span class="sw"></span><span class="cs"></span></div>
        <h3 class="ctl"></h3>
        <p class="cq"></p>
        <div class="cnum"><span class="n mono"></span><span class="u"></span></div>
        <p class="sub"></p>
        <div class="sec sec-pre"><div class="sh">直接先修 <span class="k mono"></span></div><div class="rows rows-pre"></div></div>
        <div class="sec sec-next"><div class="sh">解锁后续 <span class="k mono"></span></div><div class="rows rows-next"></div></div>
        <button class="g3-lesson" type="button">📖 讲解与例题</button>
        <button class="g3-open" type="button">在图谱浏览中打开 →</button>
      </aside>
      <div class="g3-hint">拖拽旋转 · 滚轮缩放 · 点击节点看先修链</div>`;
    const $ = (s) => mount.querySelector(s);

    // 图例 chips（色点 + 名称 + 计数，可键盘操作）
    this.active = new Set(this.layout.groups.map((_, i) => i));
    const chips = $('#g3chips');
    const counts = this.layout.groups.map(() => 0);
    this.layout.nodes.forEach((nd) => counts[nd.g]++);
    this.layout.groups.forEach((name, i) => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'chip'; el.tabIndex = 0;
      el.setAttribute('role', 'button'); el.setAttribute('aria-pressed', 'true');
      el.innerHTML = `<span class="sw" style="background:${subjectColor(name, i)}"></span>
        <span class="nm">${esc(name)}</span><span class="ct mono">${counts[i]}</span>`;
      const toggle = () => {
        if (this.active.has(i)) { this.active.delete(i); el.classList.add('off'); el.setAttribute('aria-pressed', 'false'); }
        else { this.active.add(i); el.classList.remove('off'); el.setAttribute('aria-pressed', 'true'); }
      };
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
      chips.appendChild(el);
    });

    // 相机焦点补间目标
    this.rotY = 0.6; this.tilt = -0.32; this.zoom = 1;
    this.spin = this.reduce ? 0 : 0.00018;
    this.rotYTarget = null; this.tiltTarget = null; this.zoomTarget = null;
    return { mount, tip: $('#g3tip'), card: $('#g3card'), chips };
  }

  initCanvas(mount) {
    this.grow = this.reduce ? 1 : 0;
    this.cv = document.createElement('canvas');
    this.cv.id = 'g3cv';
    mount.insertBefore(this.cv, mount.firstChild);
    this.ctx = this.cv.getContext('2d');
    this.DPR = 1; this.VW = 0; this.VH = 0; this.bgGrad = null;
    this.sc = 1; this.cx0 = 0; this.cyy0 = 0;
    this.fit = 1; this.fitCy = 0;
    this.resize();
    this.resizeHandler = () => this.resize();
    window.addEventListener('resize', this.resizeHandler);

    // 邻接表：e[0] 依赖 e[1]（先修方向）
    const N = this.layout.nodes, E = this.layout.edges;
    this.incident = Array.from({ length: N.length }, () => []);
    this.directPre = Array.from({ length: N.length }, () => []);
    this.directNext = Array.from({ length: N.length }, () => []);
    E.forEach((e, i) => {
      this.incident[e[0]].push(i); this.incident[e[1]].push(i);
      this.directPre[e[0]].push(e[1]); this.directNext[e[1]].push(e[0]);
    });
    this.RGB = N.map((nd) => hex2rgb(nd.col));
    this.order = N.map((_, i) => i);
    this.P = new Float32Array(N.length * 3);

    // 微闪烁相位/频率（确定性 hash；reduce-motion 时冻结为 1）
    this.twkP = new Float32Array(N.length);
    this.twkS = new Float32Array(N.length);
    N.forEach((nd, i) => { this.twkP[i] = hash01(nd.id + 'tw') * 6.2832; this.twkS[i] = hash01(nd.id + 'ts') * 0.0009; });

    // 邻域密度衰减（一次性预计算）：均匀网格统计半径 150 内邻居数，
    // 锥底（低年级、小半径、十科汇聚）最密 —— 光晕 alpha 乘 den，
    // 密集处自动变暗，避免 additive 光晕叠加烧白；星点核心不受影响。
    {
      const cell = 120, R2 = 150 * 150, grid = new Map();
      N.forEach((nd, i) => {
        const k = Math.floor(nd.x / cell) + ',' + Math.floor(nd.y / cell) + ',' + Math.floor(nd.z / cell);
        let a = grid.get(k); if (!a) { a = []; grid.set(k, a); }
        a.push(i);
      });
      this.den = new Float32Array(N.length);
      N.forEach((nd, i) => {
        let c = 0;
        const cx = Math.floor(nd.x / cell), cy = Math.floor(nd.y / cell), cz = Math.floor(nd.z / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const arr = grid.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz));
          if (!arr) continue;
          for (const j of arr) {
            const m = N[j];
            const ddx = m.x - nd.x, ddy = m.y - nd.y, ddz = m.z - nd.z;
            if (ddx * ddx + ddy * ddy + ddz * ddz < R2) c++;
          }
        }
        this.den[i] = 1 / (1 + Math.max(0, c - 1) * 0.035);
      });
    }

    // 学科光晕精灵（泛光层，additive 叠加）
    this.glow = this.layout.groups.map((name, i) => bakeGlowSprite(subjectColor(name, i)));

    // 星云团：装饰性彩色云团（确定性 hash 散布在锥体内，不与学科挂钩——
    // 角向随机混布后学科无聚集区，学科色雾团会与脚下星点对不上色）
    const { H } = this.layout;
    this.mists = [];
    for (let k = 0; k < 14; k++) {
      const y = H * (0.08 + 0.84 * hash01('mist-y' + k));
      const th = hash01('mist-th' + k) * Math.PI * 2;
      const r = coneR(y) * (0.35 + 0.75 * hash01('mist-r' + k));
      this.mists.push({
        x: Math.cos(th) * r, y, z: Math.sin(th) * r,
        rw: 130 + r * 0.5, col: PALETTE[k % PALETTE.length].bright,
      });
    }
  }

  resize() {
    const wrap = this.dom.mount;
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    this.VW = wrap.clientWidth || 800; this.VH = wrap.clientHeight || 500;
    this.cv.width = this.VW * this.DPR; this.cv.height = this.VH * this.DPR;
    this.cv.style.width = this.VW + 'px'; this.cv.style.height = this.VH + 'px';
    this.bgGrad = null;   // 尺寸变化后重建底色渐变
    if (this.ctx) this.bakeSky();   // 背景星空层随之重烘焙（固定种子，星位稳定）
    if (this.layout?.nodes?.length) this.computeFit();   // 星系完整入画
  }

  // 自动取景：初始相机（rotY=0.6、tilt=-0.32、zoom=1）下投影全部节点，
  // 求纵向包围盒与水平最远点同时入画的缩放因子 fit 与垂直居中偏移——
  // 修复星系过高/过宽被画布边缘（如 topbar 下侧）裁掉的问题。屏幕跨度
  // 随 sc 单调但非线性（透视 pf 同随 sc 变化），逐轮乘系数会过冲，故用
  // 二分搜索；另留 12% 余量给旋转到其他角位（近点掠过相机属 3D 常态）。
  computeFit() {
    const N = this.layout.nodes;
    const ROT = 0.6, TILT = -0.32, MG = 38;   // 与构造器初始相机一致
    const cy = Math.cos(ROT), sy = Math.sin(ROT);
    const ct = Math.cos(TILT), st = Math.sin(TILT);
    const base = Math.min(this.VW / 1500, this.VH / 1780);
    const H2 = this.layout.H / 2;
    const cx0 = this.VW * 0.52;
    const availY = this.VH - MG * 2;
    const availX = Math.min(cx0, this.VW - cx0) - MG;   // 水平可用半宽
    const meas = (sc) => {   // 纵向跨度/中点 + 水平最远点（相对投影中心）
      let y0 = Infinity, y1 = -Infinity, mx = 0;
      for (let i = 0; i < N.length; i++) {
        const n = N[i];
        const py = n.y - H2;
        const px = n.x * cy + n.z * sy, z = -n.x * sy + n.z * cy;
        const y2 = py * ct - z * st, z2 = py * st + z * ct;
        const depth = 1400 + z2 * sc * 1.6;
        if (depth < 90) continue;
        const pf = 1400 / depth;
        const pys = -(y2 * sc * pf), pxs = Math.abs(px * sc * pf);
        if (pys < y0) y0 = pys; if (pys > y1) y1 = pys;
        if (pxs > mx) mx = pxs;
      }
      return [y1 - y0, (y0 + y1) / 2, mx];
    };
    const ratio = (sc) => {
      const [sp, , mx] = meas(sc);
      return Math.max(sp / availY, mx / availX) / 0.88;
    };
    let lo = base * 0.02, hi = base * 1.8, mid = base;
    for (let k = 0; k < 22; k++) {
      mid = (lo + hi) / 2;
      (ratio(mid) > 1) ? hi = mid : lo = mid;
    }
    const [, midOff] = meas(mid);
    this.fit = mid / base;
    this.fitCy = this.VH / 2 - midOff;   // 纵向包围盒中点移到画布中央
  }

  // ---------- 深空背景烘焙（Galaxy View 四层范式） ----------
  bakeSky() {
    const W = this.VW, H = this.VH, D = this.DPR;
    const cv = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w * D)); c.height = Math.max(2, Math.round(h * D)); const x = c.getContext('2d'); x.scale(D, D); return [c, x]; };

    // ① 星云纱：品牌色系深空云（墨绿主云 + 深青/暗紫/青绿辅云）+ 噪点防条带
    const OS = 28;
    const [nebulaCv, nc] = cv(W + OS * 2, H + OS * 2);
    const NW = W + OS * 2, NH = H + OS * 2;
    nc.globalCompositeOperation = 'lighter';
    const clouds = [
      [0.20, 0.26, 0.62, '#10402e', 0.68],
      [0.82, 0.18, 0.52, '#0d2c42', 0.60],
      [0.64, 0.74, 0.66, '#241d44', 0.50],
      [0.12, 0.80, 0.46, '#12303a', 0.50],
      [0.50, 0.50, 0.40, '#0b2620', 0.58],
    ];
    let rn = mulberry32(20261025);
    for (const [fx, fy, fr, col, a] of clouds) {
      const R = Math.max(NW, NH) * fr;
      const gr = nc.createRadialGradient(fx * NW, fy * NH, 0, fx * NW, fy * NH, R);
      gr.addColorStop(0, hexA(col, a));
      gr.addColorStop(0.55, hexA(col, a * 0.42));
      gr.addColorStop(1, hexA(col, 0));
      nc.fillStyle = gr;
      nc.fillRect(0, 0, NW, NH);
    }
    nc.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 260; i++) {   // 细噪点：打散渐变条带
      nc.globalAlpha = 0.015 + rn() * 0.04;
      nc.fillStyle = rn() < 0.7 ? '#9fd8bd' : '#a8c6e8';
      nc.fillRect(rn() * NW, rn() * NH, 1, 1);
    }
    nc.globalAlpha = 1;
    this.nebulaCv = nebulaCv;

    // 星体绘制 helper：横向三连绘制实现环绕平铺无缝
    const paintStars = (x2d, count, wrapW, wrapH, sizeK, alphaK, flareQ) => {
      const cols = ['#e9f5ee', '#e9f5ee', '#cfe3ff', '#ffeed2', '#d9fff1'];
      for (let i = 0; i < count; i++) {
        const px = rn() * wrapW, py = 4 + rn() * (wrapH - 8);
        const r = Math.pow(rn(), 2.6) * sizeK + 0.25;
        const a = 0.16 + Math.pow(rn(), 1.6) * alphaK;
        const col = cols[(rn() * cols.length) | 0];
        x2d.globalAlpha = a; x2d.fillStyle = col;
        x2d.beginPath(); x2d.arc(px, py, r, 0, 6.2832); x2d.fill();
        if (r > sizeK * 0.78 && rn() < flareQ) {   // 最亮星的十字光芒
          x2d.globalAlpha = a * 0.38; x2d.strokeStyle = col; x2d.lineWidth = 0.7;
          const L = r * 5.5;
          x2d.beginPath();
          x2d.moveTo(px - L, py); x2d.lineTo(px + L, py);
          x2d.moveTo(px, py - L); x2d.lineTo(px, py + L);
          x2d.stroke();
        }
      }
    };

    // ② 星壳：远景星海（水平精确环绕宽度，垂直留 80px 视差余量）
    const shH = H + 80;
    const [shellCv, sc2] = cv(W, shH);
    paintStars(sc2, Math.round(clamp(W * H / 1800, 260, 700)), W, shH, 1.25, 0.6, 0.3);
    this.shellCv = shellCv;

    // ③ 漂移星：稍大稍亮的近景星（数量少、个性强）
    const [fieldCv, fc] = cv(W, shH);
    paintStars(fc, Math.round(clamp(W * H / 9000, 70, 170)), W, shH, 1.8, 0.72, 0.5);
    this.fieldCv = fieldCv;
  }

  // ---------- 投影（与节点投影完全相同的公式） ----------
  project() {
    const N = this.layout.nodes, P = this.P;
    const cy = Math.cos(this.rotY), sy = Math.sin(this.rotY);
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    this.cx0 = this.VW * 0.52; this.cyy0 = this.fitCy || this.VH * 0.52;
    const cx = this.cx0, cyy = this.cyy0;
    const sc = Math.min(this.VW / 1500, this.VH / 1780) * this.fit * this.zoom;
    this.sc = sc;
    const H = this.layout.H;
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      const py = n.y - H / 2;
      const x = n.x * cy + n.z * sy, z = -n.x * sy + n.z * cy;
      const y2 = py * ct - z * st, z2 = py * st + z * ct;
      const depth = 1400 + z2 * sc * 1.6;
      if (depth < 70) { P[i * 3 + 2] = 0; continue; }
      const pf = 1400 / depth;
      P[i * 3] = cx + x * sc * pf;
      P[i * 3 + 1] = cyy - y2 * sc * pf;
      P[i * 3 + 2] = pf;
    }
  }

  // 任意世界坐标 → 屏幕（雾团/星丝控制点/轴心辉光共用）
  point3(x, y, z) {
    const cy = Math.cos(this.rotY), sy = Math.sin(this.rotY);
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    const px = x * cy + z * sy, pz = -x * sy + z * cy;
    const py = y - this.layout.H / 2;
    const y2 = py * ct - pz * st, z2 = py * st + pz * ct;
    const depth = 1400 + z2 * this.sc * 1.6;
    if (depth < 70) return null;
    const pf = 1400 / depth;
    return [this.cx0 + px * this.sc * pf, this.cyy0 - y2 * this.sc * pf, pf];
  }

  // ---------- 先修世系（BFS，沿依赖方向回溯） ----------
  buildLineage(i) {
    const nodes = new Set([i]), edges = new Set(), q = [i];
    while (q.length) {
      const u = q.shift();
      for (const idx of this.incident[u]) {
        const e = this.layout.edges[idx];
        if (e[0] === u) {
          edges.add(idx);
          if (!nodes.has(e[1])) { nodes.add(e[1]); q.push(e[1]); }
        }
      }
    }
    this.lineage = { nodes, edges };
  }

  // ---------- 交互 ----------
  bindEvents() {
    const cv = this.cv;
    let dragging = false, moved = false, lx = 0, ly = 0;
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
      this.cv.setPointerCapture?.(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (dragging) {
        const dx = e.clientX - lx, dy = e.clientY - ly;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        this.rotY += dx * 0.0055; this.tilt = clamp(this.tilt + dy * 0.0042, -1.35, 0.25);
        lx = e.clientX; ly = e.clientY;
      } else this.onHover(e);
    });
    cv.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      dragging = false;
      if (!moved) this.onClick(e);
    });
    cv.addEventListener('pointerleave', () => { this.hideTip(); this.hover = -1; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0016), 0.5, 4);
    }, { passive: false });
    // 触屏双指缩放
    const pts = new Map(); let pinchD = 0;
    cv.addEventListener('pointerdown', (e) => { if (e.button === 0) pts.set(e.pointerId, [e.clientX, e.clientY]); });
    cv.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const dd = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinchD) this.zoom = clamp(this.zoom * dd / pinchD, 0.5, 4);
        pinchD = dd; dragging = false;
      }
    });
    const release = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinchD = 0; };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => cv.addEventListener(ev, release));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.selected >= 0) this.clearSel();
    });

    // 卡片/图例内的指针事件不冒泡到画布手势
    ['pointerdown', 'pointerup', 'click', 'wheel'].forEach((ev) => {
      this.dom.card.addEventListener(ev, (e) => e.stopPropagation());
      this.dom.chips.addEventListener(ev, (e) => e.stopPropagation());
    });
    this.dom.card.querySelector('.close').addEventListener('click', () => this.clearSel());
    this.dom.card.querySelector('.back').addEventListener('click', () => this.goBack());
    this.dom.card.querySelector('.g3-lesson').addEventListener('click', () => {
      if (this.selected >= 0) this.onLesson?.(this.layout.nodes[this.selected].id);
    });
    this.dom.card.querySelector('.g3-open').addEventListener('click', () => {
      if (this.selected >= 0) this.onOpenTopic?.(this.layout.nodes[this.selected].id);
    });
  }

  nodeR(i) {
    const N = this.layout.nodes;
    return (2.3 + Math.sqrt(N[i].c) * 7.5) * this.P[i * 3 + 2] * Math.min(1.6, Math.max(0.9, this.zoom));
  }
  pick(mx, my) {
    const N = this.layout.nodes, P = this.P;
    let best = -1, bd = 20 * 20;
    for (let i = 0; i < N.length; i++) {
      if (!this.active.has(N[i].g) || P[i * 3 + 2] === 0) continue;
      const dx = P[i * 3] - mx, dy = P[i * 3 + 1] - my, d = dx * dx + dy * dy;
      const rr = Math.max(11, this.nodeR(i) + 6);
      if (d < rr * rr && d < bd) { bd = d; best = i; }
    }
    return best;
  }
  onHover(e) {
    const r = this.cv.getBoundingClientRect();
    const i = this.pick(e.clientX - r.left, e.clientY - r.top);
    if (i !== this.hover) { this.hover = i; i >= 0 ? this.showTip(i, e) : this.hideTip(); }
    else if (i >= 0) this.placeTip(e);
    this.spin = (this.hover >= 0 || this.selected >= 0 || this.reduce) ? 0 : 0.00018;
  }

  // 点击后转到节点正对镜头（两个候选角取近者）
  focusNode(i) {
    const n = this.layout.nodes[i];
    let best = null, bestZ = Infinity;
    for (const cand of [Math.atan2(-n.x, n.z), Math.atan2(-n.x, n.z) + Math.PI]) {
      const z2 = -n.x * Math.sin(cand) + n.z * Math.cos(cand);
      if (z2 < bestZ) { bestZ = z2; best = cand; }
    }
    this.rotYTarget = best; this.tiltTarget = -0.18; this.zoomTarget = Math.max(this.zoom, 1.5);
  }
  onClick(e) {
    const r = this.cv.getBoundingClientRect();
    const i = this.pick(e.clientX - r.left, e.clientY - r.top);
    if (i < 0) { this.clearSel(); return; }
    this.selectNode(i, true);
  }
  selectNode(i, push) {
    if (push && this.selected >= 0 && this.selected !== i) this.hist.push(this.selected);
    this.selected = i; this.buildLineage(i); this.showCard(i); this.focusNode(i); this.spin = 0;
    this.hideTip();
  }
  goBack() {
    if (!this.hist.length) return;
    this.selectNode(this.hist.pop(), false);
  }
  clearSel() {
    this.selected = -1; this.lineage = null; this.hist.length = 0;
    this.rotYTarget = null; this.tiltTarget = null; this.zoomTarget = null;
    this.dom.card.classList.remove('on');
    if (!this.reduce) this.spin = 0.00018;
  }

  // ---------- 浮层 ----------
  showTip(i, e) {
    const n = this.layout.nodes[i], tip = this.dom.tip;
    tip.querySelector('.sw').style.background = n.col;
    tip.querySelector('.ts').textContent = `${n.dm} · ${n.a}年级 · ${n.topic.subject}`;
    tip.querySelector('.ttl').textContent = n.name;
    tip.querySelector('.q').textContent = n.topic.assessmentPrompt
      ? renderQ(n.topic.assessmentPrompt) : '';
    tip.classList.add('on'); this.placeTip(e);
  }
  placeTip(e) {
    const tip = this.dom.tip, r = this.dom.mount.getBoundingClientRect();
    let x = e.clientX - r.left + 16, y = e.clientY - r.top + 16;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > this.VW - 8) x = e.clientX - r.left - w - 16;
    if (y + h > this.VH - 8) y = e.clientY - r.top - h - 16;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  hideTip() { this.dom.tip.classList.remove('on'); }

  fillRows(container, idxs) {
    const N = this.layout.nodes;
    container.innerHTML = '';
    if (!idxs.length) {
      const d = document.createElement('div'); d.className = 'empty'; d.textContent = '暂无'; container.appendChild(d); return;
    }
    idxs.slice().sort((a, b) => N[a].a - N[b].a).forEach((j) => {
      const m = N[j], b = document.createElement('button'); b.className = 'row'; b.type = 'button';
      b.innerHTML = `<span class="rdot" style="background:${m.col}"></span>
        <span class="rt">${esc(m.name)}</span><span class="ra mono">${m.a}年级</span>`;
      b.addEventListener('click', () => this.selectNode(j, true));
      container.appendChild(b);
    });
  }
  showCard(i) {
    const n = this.layout.nodes[i], card = this.dom.card;
    const cnt = this.lineage.nodes.size - 1;
    card.querySelector('.sw').style.background = n.col;
    card.querySelector('.cs').textContent = `${n.topic.subject} · ${n.dm} · ${n.a}年级${n.topic.semester}册`;
    card.querySelector('.ctl').textContent = n.name;
    card.querySelector('.cq').textContent = renderQ(n.topic.assessmentPrompt);
    card.querySelector('.n').textContent = cnt;
    card.querySelector('.u').textContent = cnt === 1 ? '个先修（含间接）' : '个先修（含间接）';
    card.querySelector('.sub').textContent = cnt > 0
      ? '学会这一项之前，孩子需要一路回溯掌握的全部内容。'
      : '这是一个起点，之前不需要任何铺垫。';
    const pre = this.directPre[i], nxt = this.directNext[i];
    card.querySelector('.sec-pre .k').textContent = pre.length ? pre.length : '';
    card.querySelector('.sec-next .k').textContent = nxt.length ? nxt.length : '';
    this.fillRows(card.querySelector('.rows-pre'), pre);
    this.fillRows(card.querySelector('.rows-next'), nxt);
    card.querySelector('.back').classList.toggle('on', this.hist.length > 0);
    card.scrollTop = 0;
    card.classList.add('on');
  }

  // ---------- 绘制 ----------
  draw(ts) {
    const { ctx, VW, VH, DPR } = this;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 深空底：垂直渐变（星云纱叠在其上）
    if (!this.bgGrad) {
      this.bgGrad = ctx.createLinearGradient(0, 0, 0, VH);
      this.bgGrad.addColorStop(0, '#0a1310');
      this.bgGrad.addColorStop(1, '#050a08');
    }
    ctx.fillStyle = this.bgGrad;
    ctx.fillRect(0, 0, VW, VH);

    this.project();

    this.drawSky();
    this.drawMist();
    this.axisGlow();
    this.drawEdges();
    this.drawHalos(ts);
    this.drawCores();
  }

  // ①②③ 星云纱 / 星壳 / 漂移星（预烘焙层 + 视差合成）
  drawSky() {
    const { ctx, VW: W, VH: H } = this;
    // 星云纱：随视角连续微浮动（不环绕，烘焙时已留 28px 余量）
    ctx.drawImage(this.nebulaCv,
      -28 + Math.sin(this.rotY) * 9, -28 + (this.tilt + 0.32) * 26, W + 56, H + 56);
    // 星壳：随水平旋转环绕平铺（两次绘制实现无缝循环）
    const so = (((-this.rotY * 26) % W) + W) % W;
    const sy = -40 + clamp((this.tilt + 0.32) * -26, -36, 36);
    ctx.globalAlpha = 0.92;
    ctx.drawImage(this.shellCv, -so, sy, W, H + 80);
    ctx.drawImage(this.shellCv, W - so, sy, W, H + 80);
    // 漂移星：视差更快，自转时缓慢漂移
    const fo = (((-this.rotY * 55 - this.drift) % W) + W) % W;
    const fy = -40 + clamp((this.tilt + 0.32) * -38, -36, 36);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(this.fieldCv, -fo, fy, W, H + 80);
    ctx.drawImage(this.fieldCv, W - fo, fy, W, H + 80);
    ctx.globalAlpha = 1;
  }

  // ④ 星云团：彩色光晕散布锥体内（additive 装饰层，选中时整体调暗）
  drawMist() {
    const { ctx } = this;
    const grow = Math.min(1, this.grow);
    const dimAll = this.lineage ? 0.45 : 1;
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.mists) {
      const p = this.point3(m.x, m.y, m.z);
      if (!p) continue;
      const R = Math.max(36, m.rw * this.sc * p[2] * 1.15);
      const fog = 0.45 + 0.55 * Math.min(1, p[2]);
      const a0 = 0.075 * dimAll * fog * grow;
      if (a0 < 0.004) continue;
      const gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
      gr.addColorStop(0, hexA(m.col, a0));
      gr.addColorStop(0.6, hexA(m.col, a0 * 0.4));
      gr.addColorStop(1, hexA(m.col, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(p[0] - R, p[1] - R, R * 2, R * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // 轴心辉光：沿锥轴的星系核淡光（品牌绿）
  axisGlow() {
    const { ctx } = this;
    const H = this.layout.H;
    const grow = Math.min(1, this.grow);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 6; k++) {
      const y = H * (k + 0.5) / 6;
      const r = coneR(y) * 0.8;
      const p = this.point3(0, y, 0);
      if (!p) continue;
      const R = Math.max(30, r * this.sc * p[2] * 1.2);
      const a0 = 0.03 * grow;
      const gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
      gr.addColorStop(0, `rgba(120,255,190,${a0})`);
      gr.addColorStop(1, 'rgba(120,255,190,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(p[0] - R, p[1] - R, R * 2, R * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // 连线：弯曲星丝——控制点取中点后背离星系轴外拱
  drawEdges() {
    const { ctx } = this;
    const N = this.layout.nodes, E = this.layout.edges, P = this.P;
    const hasSel = !!this.lineage;
    for (let k = 0; k < E.length; k++) {
      const e = E[k], a = e[0], b = e[1];
      if (!this.active.has(N[a].g) || !this.active.has(N[b].g) || P[a * 3 + 2] === 0 || P[b * 3 + 2] === 0) continue;
      if (!this.reduce && (N[a].appear > this.grow || N[b].appear > this.grow)) continue;
      // 星丝控制点：世界空间中点沿径向外推（远离星系轴）
      const mx = (N[a].x + N[b].x) / 2, my = (N[a].y + N[b].y) / 2, mz = (N[a].z + N[b].z) / 2;
      const mr = Math.hypot(mx, mz);
      const dx = mr > 1e-3 ? mx / mr : 1, dz = mr > 1e-3 ? mz / mr : 0;
      const bow = mr * 0.18 + 26;
      const pc = this.point3(mx + dx * bow, my, mz + dz * bow);
      if (!pc) continue;
      const depth = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
      const inLin = hasSel && this.lineage.edges.has(k);
      ctx.beginPath();
      ctx.moveTo(P[a * 3], P[a * 3 + 1]);
      ctx.quadraticCurveTo(pc[0], pc[1], P[b * 3], P[b * 3 + 1]);
      if (inLin) {
        const col = this.RGB[b];
        ctx.strokeStyle = `rgba(${col},0.16)`; ctx.lineWidth = 5; ctx.stroke();   // 辉光衬底
        ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineWidth = 1.8; ctx.stroke();
      } else {
        const alpha = hasSel ? 0.04 : (e[2] ? 0.10 : 0.05);
        ctx.strokeStyle = `rgba(148,178,166,${alpha * depth})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // 泛光层：学科色光晕精灵 additive 叠加（微闪烁；替代逐节点 shadowBlur）
  drawHalos(ts) {
    const { ctx } = this;
    const N = this.layout.nodes, P = this.P;
    const hasSel = !!this.lineage;
    const T = this.reduce ? 0 : ts;
    ctx.globalCompositeOperation = 'lighter';
    for (const i of this.order) {
      const n = N[i];
      if (!this.active.has(n.g) || P[i * 3 + 2] === 0) continue;
      if (!this.reduce && n.appear > this.grow) continue;
      const inLin = hasSel ? this.lineage.nodes.has(i) : true;
      const isFocus = (i === this.selected) || (i === this.hover);
      let dim = hasSel && !inLin ? 0.1 : 1;
      const sx = P[i * 3], sy = P[i * 3 + 1], pf = P[i * 3 + 2];
      const r = this.nodeR(i) * (isFocus ? 1.6 : 1);
      const hr = r * (2.1 + n.c * 1.8) + 1.2;
      const tw = T ? (0.8 + 0.2 * Math.sin(ts * (0.0006 + this.twkS[i]) + this.twkP[i])) : 1;
      // 光晕强度：节点尺寸加权 × 邻域密度衰减（密集处防烧白），枢纽亮星主导
      let a = dim * (0.16 + 0.3 * Math.min(1, pf * pf)) * tw
        * (0.28 + 0.72 * Math.min(1, r / 10)) * this.den[i];
      if (isFocus) a = Math.min(1, a * 2.2);
      else if (hasSel && inLin) a = Math.min(1, a * 1.8);
      ctx.globalAlpha = a;
      ctx.drawImage(this.glow[n.g], sx - hr, sy - hr, hr * 2, hr * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // 核心层：实心星点 + 深色描边环（保持点的锐利边界）
  drawCores() {
    const { ctx } = this;
    const N = this.layout.nodes, P = this.P;
    const hasSel = !!this.lineage;
    for (const i of this.order) {
      const n = N[i];
      if (!this.active.has(n.g) || P[i * 3 + 2] === 0) continue;
      if (!this.reduce && n.appear > this.grow) continue;
      const inLin = hasSel ? this.lineage.nodes.has(i) : true;
      const isFocus = (i === this.selected) || (i === this.hover);
      const dim = hasSel && !inLin ? 0.1 : 1;
      const sx = P[i * 3], sy = P[i * 3 + 1], pf = P[i * 3 + 2];
      const r = this.nodeR(i) * (isFocus ? 1.6 : 1);
      const rgb = this.RGB[i];
      let a = dim * (0.55 + 0.45 * Math.min(1, pf * pf));   // 深度雾
      if (hasSel && inLin) a = Math.min(1, a * 1.35);
      ctx.fillStyle = `rgba(${rgb},${a})`;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
      // 深色描边环：让同色点之间有边界
      ctx.strokeStyle = `rgba(5,10,8,${0.5 * dim})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.stroke();
      if (isFocus) {
        ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(sx, sy, r + 2.5, 0, 6.2832); ctx.stroke();
      }
    }
  }

  frame(ts) {
    if (!this.reduce) this.grow = Math.min(1.02, (ts - this.START) / 2800 * 1.02);
    const dt = Math.min(64, ts - this.lastTs); this.lastTs = ts;
    this.rotY += this.spin * dt;
    if (this.spin && !this.reduce) this.drift += dt * 0.012;   // 漂移星缓慢漂移
    if (this.rotYTarget !== null) {
      const d = ((this.rotYTarget - this.rotY + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      this.rotY += d * 0.12;
      if (this.tiltTarget !== null) this.tilt += (this.tiltTarget - this.tilt) * 0.12;
      if (this.zoomTarget !== null) this.zoom += (this.zoomTarget - this.zoom) * 0.12;
      if (Math.abs(d) < 0.008) { this.rotYTarget = null; this.tiltTarget = null; this.zoomTarget = null; }
    }
    this.draw(ts);
    requestAnimationFrame(this.frame);
  }
}

// ---------- 工具 ----------
// 学科色光晕精灵：中心偏白热核 → 学科色 → 透明（additive 泛光）
function bakeGlowSprite(hex) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const [r, gg, b] = hex2rgb(hex).split(',').map(Number);
  const mix = (t) => `${Math.round(r + (255 - r) * t)},${Math.round(gg + (255 - gg) * t)},${Math.round(b + (255 - b) * t)}`;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${mix(0.5)},0.72)`);
  gr.addColorStop(0.3, `rgba(${r},${gg},${b},0.36)`);
  gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr;
  g.beginPath(); g.arc(32, 32, 32, 0, 6.2832); g.fill();
  return c;
}
function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
}
function hexA(h, a) {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function renderQ(prompt) {
  return String(prompt ?? '').replaceAll('{{name}}', '孩子');
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
