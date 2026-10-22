// 3D 全景：Canvas 2D 透视投影（复刻 withmarble.com/curriculum/ 的实现范式与参数，
// 代码为本仓库原创中文版）。布局为锥形（纺锤）星系：y = 年级高度场，
// 平均半径随高度线性张开；节点尺寸 = sqrt(中心性)*7.5 的幂律分布。

// 分组 = 学科（数学时代按四领域，多学科后改为按学科分股着色，D-016）。
// 色值 = 「学伴设计系统 v2」学科色板 bright 变体（tutor-app docs/UI-GUIDE §3，跨仓统一 D-023）：
// 深空底用亮色档；浅色界面（徽章等）用 base 档，两档一一对应。
const GROUP_COLORS = {
  '数学': '#60a5fa', '语文': '#f87171', '英语': '#a78bfa', '物理': '#fb923c',
  '化学': '#4ade80', '生物学': '#2dd4bf', '历史': '#d97706', '地理': '#38bdf8',
  '道德与法治': '#f472b6', '思想政治': '#f472b6',
};
const PALETTE = ['#60a5fa', '#f87171', '#a78bfa', '#fb923c', '#4ade80', '#2dd4bf', '#d97706', '#38bdf8', '#f472b6'];
const colorOf = (name, i) => GROUP_COLORS[name] ?? PALETTE[i % PALETTE.length];
const FOCUS_GLOW = 18, LINEAGE_GLOW = 9;

// ---------- 布局：锥形星系（对标 Marble 的预计算坐标分布） ----------
// 半径斜率与散布按其数据实测（avgR 117→456，r≈110+0.26y，散布 σ≈90）。
export function buildLayout(index) {
  const groups = [...new Set(index.topics.map((t) => t.subject))];
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
    const baseR = 110 + Math.max(0, y) * 0.26;
    const theta = hash01(t.id) * Math.PI * 2;
    const rr = Math.max(30, baseR + gauss(hash01(t.id + 'r'), hash01(t.id + 'r2')) * 95);
    // 中心性 c：幂律感——多数节点 0，枢纽趋近 1
    const c = deg.get(t.id) <= 1 ? 0 : Math.min(1, (deg.get(t.id) - 1) / maxDeg * 1.6);
    const g = groups.indexOf(t.subject);
    return {
      id: t.id, topic: t,
      x: Math.cos(theta) * rr, y, z: Math.sin(theta) * rr,
      g, a: t.grade,
      col: colorOf(t.subject, g),
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

// ---------- 主类（范式与参数移植自 Marble curriculum-app.js） ----------
export class Graph3D {
  constructor(mount, layout, opts = {}) {
    this.reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    this.layout = layout;
    this.onOpenTopic = opts.onOpenTopic;
    this.selected = -1; this.hover = -1; this.lineage = null;
    this.hist = [];
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
        <div class="g3-kicker">义务教育数学 · 微主题星系</div>
        <h2>一个孩子要学的一切</h2>
        <div class="g3-count mono"><b id="g3n">${n}</b> 个微主题 · <b id="g3e">${e}</b> 条先修关系</div>
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
      el.innerHTML = `<span class="sw" style="background:${colorOf(name, i)}"></span>
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
    this.DPR = 1; this.VW = 0; this.VH = 0;
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
  }

  resize() {
    const wrap = this.dom.mount;
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    this.VW = wrap.clientWidth || 800; this.VH = wrap.clientHeight || 500;
    this.cv.width = this.VW * this.DPR; this.cv.height = this.VH * this.DPR;
    this.cv.style.width = this.VW + 'px'; this.cv.style.height = this.VH + 'px';
  }

  // ---------- 投影（与 Marble 相同的公式） ----------
  project() {
    const N = this.layout.nodes, P = this.P;
    const cy = Math.cos(this.rotY), sy = Math.sin(this.rotY);
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    const cx = this.VW * 0.52, cyy = this.VH * 0.52;
    const sc = Math.min(this.VW / 1500, this.VH / 1780) * this.zoom;
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
  draw() {
    const { ctx, VW, VH, DPR } = this;
    const N = this.layout.nodes, E = this.layout.edges, P = this.P;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, VW, VH);
    this.project();
    const hasSel = !!this.lineage;

    // 先画边（在点后面）
    for (let k = 0; k < E.length; k++) {
      const e = E[k], a = e[0], b = e[1];
      if (!this.active.has(N[a].g) || !this.active.has(N[b].g) || P[a * 3 + 2] === 0 || P[b * 3 + 2] === 0) continue;
      if (!this.reduce && (N[a].appear > this.grow || N[b].appear > this.grow)) continue;
      let alpha, col = null, lw = 1;
      if (hasSel) {
        if (this.lineage.edges.has(k)) { alpha = 0.75; col = this.RGB[b]; lw = 1.6; }
        else alpha = 0.04;
      } else alpha = e[2] ? 0.10 : 0.05;
      const depth = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
      ctx.strokeStyle = col ? `rgba(${col},${alpha})` : `rgba(150,165,205,${alpha * depth})`;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(P[a * 3], P[a * 3 + 1]); ctx.lineTo(P[b * 3], P[b * 3 + 1]);
      ctx.stroke();
    }

    // 再画点，远 → 近
    this.order.sort((a, b) => P[a * 3 + 2] - P[b * 3 + 2]);
    for (const i of this.order) {
      const n = N[i];
      if (!this.active.has(n.g) || P[i * 3 + 2] === 0) continue;
      if (!this.reduce && n.appear > this.grow) continue;
      const inLin = hasSel ? this.lineage.nodes.has(i) : true;
      const isFocus = (i === this.selected) || (i === this.hover);
      let dim = 1;
      if (hasSel && !inLin) dim = 0.10;
      const sx = P[i * 3], sy = P[i * 3 + 1], pf = P[i * 3 + 2];
      const r = this.nodeR(i) * (isFocus ? 1.6 : 1);
      const rgb = this.RGB[i];
      const a = dim * (0.55 + 0.45 * Math.min(1, pf * pf));   // 深度雾
      if (isFocus || (hasSel && inLin)) {
        ctx.shadowColor = `rgb(${rgb})`; ctx.shadowBlur = isFocus ? FOCUS_GLOW : LINEAGE_GLOW;
      } else ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(${rgb},${a})`;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
      ctx.shadowBlur = 0;
      // 深色描边环：让同色点之间有边界（Marble 锐利感的来源）
      ctx.strokeStyle = `rgba(8,10,18,${0.5 * dim})`;
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
    if (this.rotYTarget !== null) {
      const d = ((this.rotYTarget - this.rotY + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      this.rotY += d * 0.12;
      if (this.tiltTarget !== null) this.tilt += (this.tiltTarget - this.tilt) * 0.12;
      if (this.zoomTarget !== null) this.zoom += (this.zoomTarget - this.zoom) * 0.12;
      if (Math.abs(d) < 0.008) { this.rotYTarget = null; this.tiltTarget = null; this.zoomTarget = null; }
    }
    this.draw();
    requestAnimationFrame(this.frame);
  }
}

// ---------- 工具 ----------
function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
}
function renderQ(prompt) {
  return String(prompt ?? '').replaceAll('{{name}}', '孩子');
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
