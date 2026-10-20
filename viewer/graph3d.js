// 3D 全景（WebGL）：视觉对标 withmarble.com/curriculum/
// 依赖 index.html 先加载 vendor/three.min.js（r128, MIT, 全局 THREE）。
// 布局：竖直纺锤 + 四领域螺旋上升——Y=年级（1→12 向上生长），
// 领域按方位角成四股藤蔓，半径随年级张开；先修深度微调半径。
// 交互：惯性拖拽旋转 / 滚轮缩放 / 点击拾取 / 搜索飞行 / Esc / 复位；
// 选中后先修闭包橙色分层高亮、解锁闭包青色、其余变暗，路径节点浮现中文标签。

import { buildPrereqClosure, buildUnlockClosure } from './closure.js';

const DOMAIN_COLORS = {
  '数与代数': 0x60a5fa,
  '图形与几何': 0x34d399,
  '统计与概率': 0xfbbf24,
  '综合与实践': 0xa78bfa,
};
const PREREQ_COLOR = 0xf97316;
const UNLOCK_COLOR = 0x06b6d4;
const DIM_FACTOR = 0.22;

// ---------- 布局（纺锤螺旋） ----------
export function buildLayout(index) {
  const domains = [...new Set(index.topics.map((t) => t.domain))];
  const nodes = index.topics.map((t) => {
    const d = domains.indexOf(t.domain);
    const gy = (t.grade - 1) * 3.1 + (t.semester === '上' ? 0 : 1.55);
    // 四股螺旋：领域基础方位角 + 随年级缓慢扭转
    const theta = (d / domains.length) * Math.PI * 2 + (t.grade - 1) * 0.42
      + (hash01(t.id) - 0.5) * 0.5;
    const radius = 4.5 + t.grade * 1.85 + (hash01(t.id + 'r') - 0.5) * 3.2;
    const degree = (index.prereqsOf.get(t.id)?.length ?? 0)
      + (index.unlocksOf.get(t.id)?.length ?? 0);
    return {
      id: t.id, topic: t,
      x: Math.cos(theta) * radius + (hash01(t.id + 'x') - 0.5) * 3.4,
      y: gy + (hash01(t.id + 'y') - 0.5) * 2.6,
      z: Math.sin(theta) * radius + (hash01(t.id + 'z') - 0.5) * 3.4,
      // 幂律尺寸：多数小、少数枢纽大（Marble 观感）
      r: 0.34 + Math.min(1.5, Math.pow(degree, 0.8) * 0.16),
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = index.deps.map((e) => ({
    a: byId.get(e.prerequisiteId),
    b: byId.get(e.topicId),
    strength: e.strength,
  })).filter((e) => e.a && e.b);
  return { nodes, edges, domains };
}

const hash01 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
};

// ---------- 主类 ----------
export class Graph3D {
  constructor(mount, layout, opts = {}) {
    this.layout = layout;
    this.onOpenTopic = opts.onOpenTopic;
    this.selected = null;
    this.hover = null;
    this.filters = new Set(layout.domains);
    this.closures = new Map();
    this.appear = 0;                 // 入场进度 0→1
    this.t0 = performance.now();
    this.lastInteract = performance.now();
    this.vel = { t: 0, p: 0 };       // 旋转惯性
    this.orbit = { theta: -Math.PI / 2 + 0.35, phi: 1.12, radius: 62 };
    this.flyAnim = null;
    this.labels = [];

    this.dom = this.buildDom(mount);
    this.initScene(mount);
    this.bindEvents();
    this.renderLoop = this.renderLoop.bind(this);
    this.renderLoop(); // 首帧同步渲染：rAF 被后台暂停时画面也不至于空白
  }

  buildDom(mount) {
    mount.innerHTML = `
      <div class="g3-toolbar">
        <input class="g3-search" type="search" placeholder="搜索微主题…" />
        <button class="g3-reset" type="button">复位视角</button>
      </div>
      <div class="g3-legend"></div>
      <div class="g3-tip"></div>
      <div class="g3-labels"></div>
      <div class="g3-card"></div>
      <div class="g3-hint">拖拽旋转 · 滚轮缩放 · 点击节点追踪先修路径</div>`;
    const $ = (s) => mount.querySelector(s);
    // 图例：色点 + 领域名 + 数量，点击切换显隐
    const legend = $('.g3-legend');
    for (const d of this.layout.domains) {
      const count = this.layout.nodes.filter((n) => n.topic.domain === d).length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'g3-lg-item';
      b.innerHTML = `<i style="background:#${(DOMAIN_COLORS[d] ?? 0x94a3b8).toString(16).padStart(6, '0')}"></i>
        <span>${esc(d)}</span><em>${count}</em>`;
      b.addEventListener('click', () => {
        if (this.filters.has(d)) this.filters.delete(d); else this.filters.add(d);
        b.classList.toggle('off', !this.filters.has(d));
        this.refreshVisibility();
      });
      legend.appendChild(b);
    }
    const search = $('.g3-search');
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const q = search.value.trim();
      if (!q) return;
      const hit = this.layout.nodes.find((n) => n.topic.name.includes(q))
        ?? this.layout.nodes.find((n) => n.topic.id === q);
      if (hit) this.select(hit.id, { fly: true });
      else { this.flashTip(`未找到「${q}」`); }
      search.blur();
    });
    $('.g3-reset').addEventListener('click', () => {
      this.orbit = { theta: -Math.PI / 2 + 0.35, phi: 1.12, radius: 62 };
      this.center = this.layoutCenterY();
      this.vel = { t: 0, p: 0 };
      this.lastInteract = performance.now();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.selected !== null) this.select(null);
    });
    return { mount, search, tip: $('.g3-tip'), labels: $('.g3-labels'), card: $('.g3-card') };
  }

  layoutCenterY() {
    const ys = this.layout.nodes.map((n) => n.y);
    return { x: 0, y: (Math.min(...ys) + Math.max(...ys)) / 2, z: 0 };
  }

  initScene(mount) {
    const W = mount.clientWidth || 800, H = mount.clientHeight || 500;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0e14, 0.0045);
    this.camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 600);
    this.center = this.layoutCenterY();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(W, H);
    this.renderer.setClearColor(0x0a0e14, 1);
    mount.insertBefore(this.renderer.domElement, mount.firstChild);

    this.buildStars();
    this.buildNodes();
    this.buildEdges();
    this.buildSelRing();
    this.buildGradeRings();
  }

  // 背景星尘：数百个 1px 白点（远近两层视差）
  buildStars() {
    const N = 700;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 70 + hash01('s' + i) * 160;
      const t = hash01('st' + i) * Math.PI * 2;
      const p = Math.acos(2 * hash01('sp' + i) - 1);
      pos[i * 3] = r * Math.sin(p) * Math.cos(t);
      pos[i * 3 + 1] = r * Math.cos(p) * 0.6 + this.center.y;
      pos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xbfcae0, size: 0.55, sizeAttenuation: true,
      transparent: true, opacity: 0.4, depthWrite: false,
    }));
    this.scene.add(this.stars);
  }

  buildNodes() {
    this.nodeMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 20, 16),
      new THREE.MeshBasicMaterial({ toneMapped: false }), this.layout.nodes.length);
    this.nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nodeIdx = new Map(this.layout.nodes.map((n, i) => [n.id, i]));
    this.scene.add(this.nodeMesh);
    // 路径节点的辉光贴点（加色混合，选中时重建）
    this.glowTex = makeGlowTexture();
    this.glow = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
      map: this.glowTex, vertexColors: true, size: 3.2, transparent: true,
      opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
      sizeAttenuation: true,
    }));
    this.scene.add(this.glow);
    this.refreshColors(); this.refreshMatrices(1);
  }

  buildEdges() {
    // 底图：极淡星尘网（全部边）
    const pos = new Float32Array(this.layout.edges.length * 6);
    this.layout.edges.forEach((e, i) => {
      pos.set([e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z], i * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.edgeMesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color: 0x8ea3bd, transparent: true, opacity: 0.10, depthWrite: false,
    }));
    this.scene.add(this.edgeMesh);
    // 高亮路径（选中时重建）
    this.pathMesh = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
    this.scene.add(this.pathMesh);
  }

  buildSelRing() {
    // 选中节点的外圈圆环（Marble 式标记），带微弱脉动
    this.ringTex = makeRingTexture();
    this.selRing = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.ringTex, color: 0xffffff, transparent: true, opacity: 0.95,
      depthTest: false, depthWrite: false,
    }));
    this.selRing.scale.setScalar(3.4);
    this.selRing.visible = false;
    this.scene.add(this.selRing);
  }

  // 年级刻度：每学年起始高度的淡环 + 「N年级」小字
  buildGradeRings() {
    const grades = [...new Set(this.layout.nodes.map((n) => n.topic.grade))].sort((a, b) => a - b);
    this.gradeGroup = new THREE.Group();
    for (const g of grades) {
      const y = (g - 1) * 3.1;
      const pts = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * 3.2, y, Math.sin(a) * 3.2));
      }
      const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x8ea3bd, transparent: true, opacity: 0.12 }));
      this.gradeGroup.add(ring);
      const label = makeTextSprite(`${g}年级`, 'rgba(190,200,220,0.75)', 60);
      label.position.set(0, y, 0);
      label.scale.setScalar(4.4);
      this.gradeGroup.add(label);
    }
    this.scene.add(this.gradeGroup);
  }

  // ---------- 状态刷新 ----------
  nodeVisible(n) { return this.filters.has(n.topic.domain); }

  refreshVisibility() {
    const v = this.selected;
    this.select(v ?? null, { keepCard: v != null });
  }

  refreshColors() {
    const sel = this.selected;
    const cl = sel ? this.closureOf(sel) : null;
    const c = new THREE.Color();
    this.layout.nodes.forEach((n, i) => {
      let col = DOMAIN_COLORS[n.topic.domain] ?? 0x94a3b8;
      let f = 1;
      if (cl) {
        if (n.id === sel) { col = 0xffffff; f = 1; }
        else if (cl.p.set.has(n.id)) { col = PREREQ_COLOR; f = 1 - Math.min(0.55, (cl.p.layer.get(n.id) - 1) * 0.12); }
        else if (cl.u.set.has(n.id)) { col = UNLOCK_COLOR; f = 0.95; }
        else { f = DIM_FACTOR; }
      }
      if (!this.nodeVisible(n)) f *= 0.06;
      c.setHex(col).multiplyScalar(f);
      this.nodeMesh.setColorAt(i, c);
    });
    this.nodeMesh.instanceColor.needsUpdate = true;
  }

  refreshMatrices(appear) {
    const m = new THREE.Matrix4();
    const sel = this.selected;
    const cl = sel ? this.closureOf(sel) : null;
    this.layout.nodes.forEach((n, i) => {
      let s = n.r * appear;
      if (cl && (n.id === sel)) s *= 1.22;
      else if (cl && (cl.p.set.has(n.id) || cl.u.set.has(n.id))) s *= 1.18;
      m.makeScale(s, s, s);
      m.setPosition(n.x, n.y, n.z);
      this.nodeMesh.setMatrixAt(i, m);
    });
    this.nodeMesh.instanceMatrix.needsUpdate = true;
  }

  refreshGlow() {
    const sel = this.selected;
    const cl = sel ? this.closureOf(sel) : null;
    const ids = cl ? [sel, ...cl.p.set, ...cl.u.set].filter((x) => x !== sel) : [];
    const pos = new Float32Array(ids.length * 3);
    const col = new Float32Array(ids.length * 3);
    const c = new THREE.Color();
    ids.forEach((id, i) => {
      const n = this.layout.nodes[this.nodeIdx.get(id)];
      pos.set([n.x, n.y, n.z], i * 3);
      const isP = cl.p.set.has(id);
      c.setHex(isP ? PREREQ_COLOR : UNLOCK_COLOR).multiplyScalar(isP ? 0.9 : 0.7);
      col.set([c.r, c.g, c.b], i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.glow.geometry.dispose();
    this.glow.geometry = g;
  }

  refreshPath() {
    const sel = this.selected;
    const cl = sel ? this.closureOf(sel) : null;
    const segs = [];
    if (cl) {
      for (const e of this.layout.edges) {
        const inP = cl.p.set.has(e.a.id) && cl.p.set.has(e.b.id) && cl.p.edgeKeys.has(ek(e));
        const inU = cl.u.set.has(e.a.id) && cl.u.set.has(e.b.id) && cl.u.edgeKeys.has(ek(e));
        if (inP || inU) segs.push([e.a, e.b, inP ? PREREQ_COLOR : UNLOCK_COLOR]);
      }
    }
    const pos = new Float32Array(segs.length * 6);
    const col = new Float32Array(segs.length * 6);
    const c = new THREE.Color();
    segs.forEach(([a, b, hex], i) => {
      pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      c.setHex(hex);
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.pathMesh.geometry.dispose();
    this.pathMesh.geometry = g;
    this.pathMesh.visible = segs.length > 0;
  }

  // ---------- 选择 ----------
  closureOf(id) {
    if (this.closures.has(id)) return this.closures.get(id);
    const v = { p: buildPrereqClosure(this.layout, id), u: buildUnlockClosure(this.layout, id) };
    if (this.closures.size > 64) this.closures.clear();
    this.closures.set(id, v);
    return v;
  }

  select(id, { fly = false, keepCard = false } = {}) {
    this.selected = id;
    if (id == null) this.closures.clear();
    this.refreshColors(); this.refreshMatrices(Math.max(this.appear, 0.001));
    this.refreshGlow(); this.refreshPath();
    if (id != null) {
      const n = this.layout.nodes[this.nodeIdx.get(id)];
      this.selRing.visible = true;
      this.selRing.position.set(n.x, n.y, n.z);
      if (fly) this.flyTo(n);
      this.renderCard(n);
    } else {
      this.selRing.visible = false;
      if (!keepCard) this.dom.card.classList.remove('show');
    }
    this.lastInteract = performance.now();
  }

  flyTo(n) {
    this.flyAnim = {
      t0: performance.now(), dur: 900,
      from: { ...this.orbit, c: { ...this.center } },
      to: {
        theta: this.orbit.theta, phi: Math.min(this.orbit.phi, 1.05),
        radius: Math.min(this.orbit.radius, 48),
        c: { x: n.x * 0.4, y: n.y * 0.78, z: n.z * 0.4 },
      },
    };
  }

  renderCard(n) {
    const t = n.topic;
    const { p, u } = this.closureOf(t.id);
    const card = this.dom.card;
    const dhex = '#' + (DOMAIN_COLORS[t.domain] ?? 0x94a3b8).toString(16).padStart(6, '0');
    card.innerHTML = `
      <button class="g3-card-x" type="button" title="关闭">×</button>
      <div class="g3-card-kicker"><i style="background:${dhex}"></i>${esc(t.domain)} · ${t.grade}年级${t.semester}册</div>
      <h3>${esc(t.name)}</h3>
      <p class="g3-card-desc">${esc(t.description)}</p>
      <div class="g3-card-stats">
        <div><b style="color:#fb923c">${p.set.size}</b><span>个先修（含间接）</span></div>
        <div><b style="color:#22d3ee">${u.set.size}</b><span>个被解锁</span></div>
      </div>
      <button class="g3-card-open" type="button">查看完整先修链与测评问法 →</button>`;
    card.querySelector('.g3-card-x').addEventListener('click', () => this.select(null));
    card.querySelector('.g3-card-open').addEventListener('click', () => this.onOpenTopic?.(n.id));
    card.classList.add('show');
  }

  flashTip(text) {
    const tip = this.dom.tip;
    tip.textContent = text; tip.classList.add('show');
    setTimeout(() => tip.classList.remove('show'), 1600);
  }

  // ---------- 交互 ----------
  bindEvents() {
    const c = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let drag = null, suppressClick = false;

    const castAt = (mx, my) => {
      const r = c.getBoundingClientRect();
      ptr.set(((mx - r.left) / r.width) * 2 - 1, -((my - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, this.camera);
      const hit = ray.intersectObject(this.nodeMesh)[0];
      if (!hit || hit.instanceId == null) return null;
      const n = this.layout.nodes[hit.instanceId];
      return this.nodeVisible(n) ? n : null;
    };

    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      this.lastInteract = performance.now();
    });
    c.addEventListener('pointermove', (e) => {
      this.lastInteract = performance.now();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        this.orbit.theta -= dx * 0.0052;
        this.orbit.phi = clamp(this.orbit.phi - dy * 0.0042, 0.25, 1.5);
        this.vel = { t: -dx * 0.0052, p: -dy * 0.0042 };
        drag.x = e.clientX; drag.y = e.clientY;
      } else {
        const n = castAt(e.clientX, e.clientY);
        this.hover = n?.id ?? null;
        c.style.cursor = n ? 'pointer' : 'grab';
        const tip = this.dom.tip;
        if (n) {
          tip.innerHTML = `<b>${esc(n.topic.name)}</b><span class="muted">${n.topic.grade}年级${n.topic.semester}册 · ${esc(n.topic.domain)}</span>`;
          tip.classList.add('show');
          tip.style.left = `${e.clientX - c.getBoundingClientRect().left + 14}px`;
          tip.style.top = `${e.clientY - c.getBoundingClientRect().top - 8}px`;
        } else tip.classList.remove('show');
      }
    });
    c.addEventListener('pointerup', () => {
      suppressClick = Boolean(drag?.moved);
      drag = null;
    });
    c.addEventListener('pointerleave', () => { this.hover = null; this.dom.tip.classList.remove('show'); });
    c.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      const n = castAt(e.clientX, e.clientY);
      this.select(n?.id ?? null, { fly: Boolean(n) });
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.radius = clamp(this.orbit.radius * (e.deltaY > 0 ? 1.09 : 0.92), 14, 170);
      this.lastInteract = performance.now();
    }, { passive: false });
    this.resizeHandler = () => this.resize();
    window.addEventListener('resize', this.resizeHandler);
  }

  resize() {
    const mount = this.dom.mount;
    const W = mount.clientWidth || 800, H = mount.clientHeight || 500;
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H);
  }

  // ---------- 渲染循环 ----------
  renderLoop(ts) {
    requestAnimationFrame(this.renderLoop);
    const t = ts ?? performance.now();

    // 入场：按年级自下而上浮现
    if (this.appear < 1) {
      this.appear = clamp((t - this.t0) / 2400, 0, 1);
      this.refreshMatrices(easeOut(this.appear));
    }
    // 惯性衰减 + 闲置自转
    if (this.appear >= 1) {
      this.orbit.theta += this.vel.t; this.orbit.phi = clamp(this.orbit.phi + this.vel.p, 0.25, 1.5);
      this.vel = { t: this.vel.t * 0.93, p: this.vel.p * 0.93 };
      if (t - this.lastInteract > 3600) this.orbit.theta += 0.0018;
    }
    // 飞行动画
    if (this.flyAnim) {
      const f = this.flyAnim, k = clamp((t - f.t0) / f.dur, 0, 1), e = easeOut(k);
      this.orbit.theta = lerp(f.from.theta, f.to.theta, e);
      this.orbit.phi = lerp(f.from.phi, f.to.phi, e);
      this.orbit.radius = lerp(f.from.radius, f.to.radius, e);
      this.center = { x: lerp(f.from.c.x, f.to.c.x, e), y: lerp(f.from.c.y, f.to.c.y, e), z: lerp(f.from.c.z, f.to.c.z, e) };
      if (k >= 1) this.flyAnim = null;
    }
    // 相机
    const { theta, phi, radius } = this.orbit;
    this.camera.position.set(
      this.center.x + radius * Math.sin(phi) * Math.cos(theta),
      this.center.y + radius * Math.cos(phi),
      this.center.z + radius * Math.sin(phi) * Math.sin(theta));
    this.camera.lookAt(this.center.x, this.center.y, this.center.z);

    // 选中环微脉动
    if (this.selRing.visible) {
      const s = 3.2 + Math.sin(t * 0.004) * 0.25;
      this.selRing.scale.set(s, s, 1);
      this.selRing.material.rotation += 0.01;
    }
    this.stars.rotation.y = theta * 0.12;

    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  }

  // 路径节点标签：投影到屏幕的 DOM（贪心防碰撞）
  updateLabels() {
    const sel = this.selected;
    const host = this.dom.labels;
    const cl = sel ? this.closureOf(sel) : null;
    const ids = cl ? [sel, ...[...cl.p.set], ...[...cl.u.set]] : [];
    const need = ids.length + 1;
    while (this.labels.length < need) {
      const el = document.createElement('div');
      el.className = 'g3-label';
      host.appendChild(el);
      this.labels.push(el);
    }
    const v = new THREE.Vector3();
    const items = [];
    for (const id of ids) {
      const n = this.layout.nodes[this.nodeIdx.get(id)];
      if (!this.nodeVisible(n)) continue;
      v.set(n.x, n.y, n.z).project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      const r = this.renderer.domElement.getBoundingClientRect();
      const x = (v.x * 0.5 + 0.5) * r.width, y = (-v.y * 0.5 + 0.5) * r.height;
      const dist = this.camera.position.distanceTo(new THREE.Vector3(n.x, n.y, n.z));
      items.push({ id, n, x, y, dist });
    }
    items.sort((a, b) => a.dist - b.dist);
    const placed = [];
    let li = 0;
    for (const it of items) {
      const el = this.labels[li++];
      if (!el) break;
      const isSel = it.id === sel;
      const isP = cl.p.set.has(it.id);
      el.textContent = it.n.topic.name;
      el.className = `g3-label${isSel ? ' sel' : isP ? ' p' : ' u'}`;
      const w = el.offsetWidth || 60, h = 18;
      let x = it.x + 10, y = it.y - 9;
      if (placed.some((p2) => x < p2.x + p2.w + 2 && x + w + 2 > p2.x && y < p2.y + h + 1 && y + h + 1 > p2.y)) {
        y = it.y - 26 - placed.length * 2; // 撞位则上移错开
      }
      placed.push({ x, y, w, h });
      el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
      el.style.opacity = clamp(1.6 - it.dist / 70, 0.45, 1);
      el.style.display = 'block';
    }
    for (let i = li; i < this.labels.length; i++) this.labels[i].style.display = 'none';
  }
}

// ---------- 纹理工具 ----------
function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,0.9)');
  rg.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
function makeRingTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 5;
  g.beginPath(); g.arc(48, 48, 38, 0, Math.PI * 2); g.stroke();
  return new THREE.CanvasTexture(c);
}
function makeTextSprite(text, color, px) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `${px}px "PingFang SC","Microsoft YaHei",sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 8;
  c.width = w; c.height = px * 1.3;
  const g2 = c.getContext('2d');
  g2.font = `${px}px "PingFang SC","Microsoft YaHei",sans-serif`;
  g2.fillStyle = color;
  g2.textBaseline = 'middle';
  g2.fillText(text, 4, c.height / 2);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
  }));
  sp.scale.set(w / px * 1.2, c.height / px * 1.2, 1);
  return sp;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const ek = (e) => `${e.a.id}->${e.b.id}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
