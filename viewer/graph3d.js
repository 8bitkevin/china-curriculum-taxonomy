// viewer/graph3d.js — 3D 全景知识图谱（纯手写 Canvas 伪 3D，零依赖，D-007）。
//
// 设计（对标 withmarble.com/curriculum 并超越）：
//   1. X 轴 = 年级学期（K12 学习进程，越靠右越进阶），Z 轴 = 领域分道，
//      Y 高度 = 依赖深度（越高前置越多）——坐标有教育语义，不是随机力导向；
//   2. 点击节点：完整先修传递闭包按层渐变高亮 + 解锁闭包青色，
//      其余淡出成星尘，「一条发光的学习路径」；
//   3. 边有 hard（实线）/ soft（虚线）语义；
//   4. 详情卡展示理由/证据/测评问法，可跳转主视图深链；
//   5. 中文标签分级：重点节点常显、近处显示、hover/选中必显；
//   6. 无 three.js / 无 CDN：透视投影 + painter 排序手写，离线可用。

import { buildPrereqClosure, buildUnlockClosure } from './closure.js';

export const DOMAIN_COLORS = {
  '数与代数': [59, 130, 246],    // 蓝
  '图形与几何': [16, 185, 129],  // 绿
  '统计与概率': [217, 119, 6],   // 琥珀
  '综合与实践': [139, 92, 246],  // 紫
};
const PREREQ_COLOR = [249, 115, 22];   // 先修链：橙（近亮远暗）
const UNLOCK_COLOR = [6, 182, 212];    // 解锁链：青

// ---------------------------------------------------------------- 布局

/** 语义网格 + 弱力导向微调：返回带 3D 坐标的节点与边。 */
export function buildLayout(index) {
  const domains = [...new Set(index.topics.map((t) => t.domain))];
  const depDepth = dependencyDepth(index);
    const nodes = index.topics.map((t) => {
      const sx = (t.grade - 1) * 14 + (t.semester === '上' ? -2.2 : 2.2);
      const sz = (domains.indexOf(t.domain) - (domains.length - 1) / 2) * 20;
      const jitter = hash01(t.id);
      return {
        id: t.id, topic: t,
        x: sx + (jitter - 0.5) * 6,
        y: depDepth.get(t.id) * 2.6 + (hash01(t.id + 'y') - 0.5) * 2.6,
        z: sz + (hash01(t.id + 'z') - 0.5) * 7,
        r: 1.1 + Math.min(1.4, ((index.prereqsOf.get(t.id)?.length ?? 0) +
        (index.unlocksOf.get(t.id)?.length ?? 0)) * 0.12),
      };
    });
  // 弱力导向：连接节点轻微互聚，网格语义主导（迭代少、结果稳定）
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = index.deps.map((d) => ({
    a: byId.get(d.prerequisiteId), b: byId.get(d.topicId),
    strength: d.strength, reason: d.reason,
  })).filter((e) => e.a && e.b);
  for (let iter = 0; iter < 60; iter++) {
    for (const e of edges) {
      const dx = e.b.x - e.a.x, dz = e.b.z - e.a.z;
      e.a.x += dx * 0.002; e.a.z += dz * 0.002;
      e.b.x -= dx * 0.002; e.b.z -= dz * 0.002;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const p = nodes[i], q = nodes[j];
        const dx = q.x - p.x, dz = q.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 4 && d2 > 1e-6) {
          const push = (4 - d2) * 0.02 / Math.sqrt(d2);
          p.x -= dx * push; p.z -= dz * push;
          q.x += dx * push; q.z += dz * push;
        }
      }
    }
  }
  return { nodes, edges, domains };
}

/** 依赖深度（BFS 分层）：越深说明立在越长的先修链之上。 */
function dependencyDepth(index) {
  const depth = new Map(index.topics.map((t) => [t.id, 0]));
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 100) {
    changed = false;
    for (const d of index.deps) {
      const next = (depth.get(d.prerequisiteId) ?? 0) + 1;
      if (next > (depth.get(d.topicId) ?? 0)) {
        depth.set(d.topicId, next); changed = true;
      }
    }
  }
  return depth;
}

function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

// ---------------------------------------------------------------- 引擎

export class Graph3D {
  constructor(mount, layout, { onOpenTopic } = {}) {
    this.layout = layout;
    this.onOpenTopic = onOpenTopic;
    this.yaw = -0.5; this.pitch = 0.6; this.dist = 96;
    this.target = { x: layoutCenter(layout.nodes, 'x'), y: 4, z: 0 };
    this.selected = null;      // 节点 id
    this.hover = null;
    this.filters = { domains: new Set(), grades: new Set() }; // 空集 = 全部
    this.appear = 0;           // 入场动画进度 0..1
    this.autoSpin = true;
    this.lastInteract = performance.now();

    this.dom = this.buildDom(mount);
    this.canvas = this.dom.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    this.bindEvents();
    this.closures = { prereq: new Map(), unlock: new Map() };

    const t0 = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - this.lastT || 16) / 1000);
      this.lastT = now;
      this.appear = Math.min(1, (now - t0) / 2600);
      if (this.autoSpin && now - this.lastInteract > 3200) this.yaw += dt * 0.12;
      this.render();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  buildDom(mount) {
    mount.innerHTML = `
      <div class="g3-toolbar">
        <div class="g3-domains"></div>
        <div class="g3-right">
          <input class="g3-search" type="search" placeholder="搜索主题，回车飞行定位">
          <button class="g3-reset" type="button" title="重置视角">重置视角</button>
        </div>
      </div>
      <div class="g3-stage">
        <canvas class="g3-canvas"></canvas>
        <div class="g3-legend"></div>
        <div class="g3-tip"></div>
        <div class="g3-card"></div>
        <div class="g3-hint">拖拽旋转 · 滚轮缩放 · 点击节点追踪先修路径</div>
      </div>`;
    const $ = (s) => mount.querySelector(s);
    // 领域过滤按钮
    const box = $('.g3-domains');
    for (const d of this.layout.domains) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'g3-chip'; b.textContent = d;
      b.dataset.on = '1';
      b.style.setProperty('--c', `rgb(${DOMAIN_COLORS[d].join(',')})`);
      b.addEventListener('click', () => {
        if (b.dataset.on) { delete b.dataset.on; this.filters.domains.add(d); }
        else { b.dataset.on = '1'; this.filters.domains.delete(d); }
      });
      box.appendChild(b);
    }
    // 图例
    const legend = $('.g3-legend');
    legend.innerHTML = `
      <div><i class="dot" style="--c:rgb(${PREREQ_COLOR.join(',')})"></i>先修链（点击后高亮）</div>
      <div><i class="dot" style="--c:rgb(${UNLOCK_COLOR.join(',')})"></i>解锁方向</div>
      <div><i class="line solid"></i>必需 hard</div>
      <div><i class="line dash"></i>有益 soft</div>`;
    const search = $('.g3-search');
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const q = search.value.trim().toLowerCase();
      const hit = this.layout.nodes.find((n) =>
        n.topic.name.toLowerCase().includes(q) || n.id.toLowerCase().includes(q));
      if (hit) this.select(hit.id, { fly: true });
      else this.flashTip('没有匹配的主题');
    });
    $('.g3-reset').addEventListener('click', () => {
      this.yaw = -0.5; this.pitch = 0.6; this.dist = 96;
      this.target = { x: layoutCenter(this.layout.nodes, 'x'), y: 4, z: 0 };
      this.lastInteract = performance.now();
    });
    return { canvas: $('.g3-canvas'), tip: $('.g3-tip'), card: $('.g3-card'), search };
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(320, r.width) * dpr;
    this.canvas.height = Math.max(360, r.height) * dpr;
    this.canvas.style.width = `${r.width}px`; this.canvas.style.height = `${r.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = r.width; this.H = r.height;
  }

  bindEvents() {
    const c = this.canvas;
    let drag = null, suppressClick = false;
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      c.setPointerCapture(e.pointerId);
      this.lastInteract = performance.now();
    });
    c.addEventListener('pointermove', (e) => {
      this.lastInteract = performance.now();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        this.yaw += dx * 0.006;
        this.pitch = clamp(this.pitch + dy * 0.005, 0.08, 1.35);
        drag.x = e.clientX; drag.y = e.clientY;
      } else {
        this.updateHover(e.offsetX, e.offsetY);
      }
    });
    c.addEventListener('pointerup', () => {
      // 拖拽后的 click 不应触发拾取
      suppressClick = Boolean(drag?.moved);
      drag = null;
    });
    // 拾取挂 click：覆盖真实点击、辅助技术激活与无 PointerEvent 的环境
    c.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      this.clickPick(e.offsetX, e.offsetY);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = clamp(this.dist * (e.deltaY > 0 ? 1.1 : 0.9), 28, 320);
      this.lastInteract = performance.now();
    }, { passive: false });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.select(null);
    });
  }

  // ---- 投影 ----
  project(p) {
    const cx = Math.cos(this.yaw), sx = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    let x = p.x - this.target.x, y = p.y - this.target.y, z = p.z - this.target.z;
    let x1 = x * cx + z * sx, z1 = -x * sx + z * cx;      // yaw
    let y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;      // pitch
    const zc = z2 + this.dist;
    if (zc < 6) return null;
    const f = Math.min(this.W, this.H) * 1.38;
    const k = f / zc;
    return { sx: this.W / 2 + x1 * k, sy: this.H / 2 - y1 * k, k, zc };
  }

  nodeVisible(n) {
    const { domains, grades } = this.filters;
    if (domains.size && !domains.has(n.topic.domain)) return false;
    if (grades.size && !grades.has(n.topic.grade)) return false;
    return true;
  }

  // ---- 高亮闭包（惰性计算） ----
  closureOf(id) {
    if (!this.closures.prereq.has(id)) {
      this.closures.prereq.set(id, buildPrereqClosure(this.layout, id));
      this.closures.unlock.set(id, buildUnlockClosure(this.layout, id));
      if (this.closures.prereq.size > 64) this.closures = { prereq: new Map(), unlock: new Map() };
    }
    return { p: this.closures.prereq.get(id), u: this.closures.unlock.get(id) };
  }

  select(id, { fly = false } = {}) {
    this.selected = id;
    this.renderCard(id);
    if (id && fly) {
      const n = this.layout.nodes.find((x) => x.id === id);
      if (n) {
        this.target = { x: n.x, y: n.y, z: n.z };
        this.dist = Math.min(this.dist, 46);
      }
    }
    if (!id) this.dom.card.classList.remove('show');
  }

  renderCard(id) {
    const card = this.dom.card;
    if (!id) return;
    const n = this.layout.nodes.find((x) => x.id === id);
    const t = n.topic;
    const { p, u } = this.closureOf(id);
    card.innerHTML = `
      <button class="g3-card-x" type="button" title="关闭">×</button>
      <h3>${esc(t.name)}</h3>
      <div class="g3-card-meta">
        <span class="badge d-${esc(t.domain)}">${esc(t.domain)}</span>
        ${t.grade}年级${t.semester}册 · ${esc(t.id)}
      </div>
      <p class="g3-card-desc">${esc(t.description)}</p>
      <div class="g3-card-stats">
        <span><b style="color:rgb(${PREREQ_COLOR.join(',')})">${p.set.size}</b> 个先修（含间接）</span>
        <span><b style="color:rgb(${UNLOCK_COLOR.join(',')})">${u.set.size}</b> 个被解锁</span>
      </div>
      <button class="g3-card-open" type="button">查看完整先修链与测评问法 →</button>`;
    card.querySelector('.g3-card-x').addEventListener('click', () => this.select(null));
    card.querySelector('.g3-card-open').addEventListener('click', () => this.onOpenTopic?.(id));
    card.classList.add('show');
  }

  flashTip(text) {
    const tip = this.dom.tip;
    tip.textContent = text; tip.classList.add('show');
    setTimeout(() => tip.classList.remove('show'), 1600);
  }

  // ---- 拾取 ----
  pick(mx, my) {
    let best = null, bd = 18 * 18;
    for (const n of this.layout.nodes) {
      if (!this.nodeVisible(n)) continue;
      const s = this.screen.get(n.id);
      if (!s) continue;
      const dx = s.sx - mx, dy = s.sy - my, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = n; }
    }
    return best;
  }

  updateHover(mx, my) {
    const hit = this.pick(mx, my);
    const id = hit?.id ?? null;
    if (id !== this.hover) {
      this.hover = id;
      this.canvas.style.cursor = id ? 'pointer' : 'grab';
    }
    const tip = this.dom.tip;
    if (hit) {
      const t = hit.topic;
      tip.innerHTML = `<b>${esc(t.name)}</b><span class="muted">${t.grade}年级${t.semester}册 · ${esc(t.domain)}</span>`;
      tip.classList.add('show');
      tip.style.left = `${mx + 14}px`; tip.style.top = `${my - 8}px`;
    } else if (!tip.dataset.pinned) {
      tip.classList.remove('show');
    }
  }

  clickPick(mx, my) {
    const hit = this.pick(mx, my);
    this.select(hit?.id ?? null);
  }

  // ---- 渲染 ----
  render() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    // 背景：深空渐变
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1020'); bg.addColorStop(1, '#101830');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const sel = this.selected;
    const cl = sel ? this.closureOf(sel) : null;

    this.screen = new Map();
    const items = [];
    for (const n of this.layout.nodes) {
      const s = this.project(n);
      if (!s) continue;
      this.screen.set(n.id, s);
      items.push({ n, s });
    }
    // 深度排序（远 → 近）
    items.sort((a, b) => b.s.zc - a.s.zc);

    // 地面参考网格（X=年级, Z=领域）
    this.drawGrid(ctx);

    // 边
    for (const e of this.layout.edges) {
      const sa = this.screen.get(e.a.id), sb = this.screen.get(e.b.id);
      if (!sa || !sb) continue;
      if (!this.nodeVisible(e.a) || !this.nodeVisible(e.b)) continue;
      // 入场动画：边随进度显现（除以 13 覆盖 K12 全学段）
      const appearAt = (e.a.topic.grade + (e.a.topic.semester === '下' ? 0.5 : 0)) / 13;
      if (this.appear < appearAt) continue;
      const onPath = cl && (
        cl.p.set.has(e.b.id) && cl.p.set.has(e.a.id) && cl.p.edgeKeys.has(key(e)) ||
        cl.u.set.has(e.a.id) && cl.u.set.has(e.b.id) && cl.u.edgeKeys.has(key(e)));
      const dim = sel && !onPath;
      // 雾化按相机相对深度：zc 越大于 dist（越远）越淡
      const rel = Math.min(sa.zc, sb.zc) / Math.max(1, this.dist);
      const fog = clamp(1.55 - 0.55 * rel, 0.04, 1);
      ctx.beginPath();
      ctx.moveTo(sa.sx, sa.sy);
      // 轻微弧线（控制点抬高）
      const mx = (sa.sx + sb.sx) / 2, my2 = (sa.sy + sb.sy) / 2 - 6;
      ctx.quadraticCurveTo(mx, my2, sb.sx, sb.sy);
      if (onPath) {
        const col = cl.p.edgeKeys.has(key(e)) ? PREREQ_COLOR : UNLOCK_COLOR;
        ctx.strokeStyle = `rgba(${col.join(',')},0.95)`;
        ctx.lineWidth = 2.2;
        ctx.shadowColor = `rgba(${col.join(',')},0.85)`;
        ctx.shadowBlur = 7;
      } else {
        ctx.strokeStyle = `rgba(148,163,184,${(dim ? 0.05 : 0.16) * fog})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
        ctx.setLineDash(e.strength === 'soft' ? [3, 5] : []);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }

    // 节点
    const labelQueue = [];
    for (const { n, s } of items) {
      if (!this.nodeVisible(n)) continue;
      const appearAt = n.topic.grade / 13;
      const a = clamp((this.appear - appearAt) * 4, 0, 1);
      if (a <= 0) continue;
      const base = DOMAIN_COLORS[n.topic.domain] ?? [148, 163, 184];
      const isSel = n.id === sel;
      const inP = cl?.p.set.has(n.id), inU = cl?.u.set.has(n.id);
      const onPath = inP || inU || isSel;
      const dim = sel && !onPath;
      const rel = s.zc / Math.max(1, this.dist);
      const fog = clamp(1.55 - 0.55 * rel, 0.06, 1);
      let color = base, glow = 4 + n.r * 1.4, alpha = fog * a;
      if (isSel) { color = [255, 255, 255]; glow = 13; }
      else if (inP) {
        const layer = cl.p.layer.get(n.id);
        color = mix(PREREQ_COLOR, [120, 60, 20], Math.min(0.75, (layer - 1) * 0.16));
        glow = 8;
      } else if (inU) { color = UNLOCK_COLOR; glow = 7; }
      else if (dim) { alpha *= 0.16; glow = 0; }
      const r = Math.max(1.6, n.r * s.k * 0.9);
      if (n.id === this.hover || isSel) { glow = Math.max(glow, 11); }
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color.map(Math.round).join(',')},${alpha})`;
      ctx.shadowColor = `rgba(${color.map(Math.round).join(',')},${alpha})`;
      ctx.shadowBlur = glow;
      ctx.fill();
      ctx.shadowBlur = 0;
      // 标签分级：选中/hover 恒显；大节点近处显示
      const show = n.id === this.hover || isSel || onPath ||
        (!dim && n.r > 1.9 && s.k > 7);
      if (show) labelQueue.push({ n, s, r, alpha, onPath, prio: (n.id === this.hover || isSel) ? 3 : onPath ? 2 : 1 });
    }
    // 标签最后画（不被节点盖住）；贪心防碰撞：关键标签优先占位，普通标签重叠则让位
    ctx.font = '12.5px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    labelQueue.sort((a, b) => (b.prio - a.prio) || (a.s.zc - b.s.zc));
    const placed = [];
    const overlaps = (x, y, w, h) => placed.some((r2) =>
      x < r2.x + r2.w + 3 && x + w + 3 > r2.x && y < r2.y + r2.h + 2 && y + h + 2 > r2.y);
    for (const { n, s, r, alpha, onPath, prio } of labelQueue) {
      const text = n.topic.name;
      // 标签距离 LOD：远处标签淡出（选中/hover 除外），避免远景叠压
      const kFade = prio === 3 ? 1 : clamp((s.k - 4.6) / 3.2, 0, 1);
      if (kFade <= 0.04) continue;
      const la = alpha * kFade;
      const pad = 2;
      const w = ctx.measureText(text).width + pad * 2;
      const h = 15;
      // 候选位：节点右侧、左侧、上方
      const cands = [
        [s.sx + r + 5, s.sy - 7.5],
        [s.sx - r - 5 - w, s.sy - 7.5],
        [s.sx - w / 2, s.sy - r - 19],
      ];
      let box = null;
      for (const [x, y] of cands) {
        if (x < 2 || y < 2 || x + w > W - 2 || y + h > H - 2) continue;
        if (!overlaps(x, y, w, h)) { box = [x, y]; break; }
      }
      if (!box) {
        // 普通标签全部撞位则放弃；关键标签（选中/hover/路径）不丢弃
        if (prio < 2) continue;
        box = cands[0];
      }
      placed.push({ x: box[0], y: box[1], w, h });
      ctx.fillStyle = `rgba(10,14,26,${Math.min(0.6, la * 0.55)})`;
      ctx.fillRect(box[0], box[1], w, h);
      ctx.fillStyle = onPath || n.id === this.hover
        ? `rgba(255,255,255,${Math.min(1, la + 0.25)})`
        : `rgba(203,213,225,${la * 0.9})`;
      ctx.fillText(text, box[0] + pad, box[1] + 11.5);
    }
  }

  drawGrid(ctx) {
    const grades = [...new Set(this.layout.nodes.map((n) => n.topic.grade))].sort((a, b) => a - b);
    ctx.strokeStyle = 'rgba(148,163,184,0.10)';
    ctx.lineWidth = 1;
    const y0 = -0.5;
    for (const g of grades) {
      const x = (g - 1) * 14;
      const corners = [[x, y0, -24], [x, y0, 24]];
      const pts = corners.map((c) => this.project({ x: c[0], y: c[1], z: c[2] }));
      if (pts.every(Boolean)) {
        ctx.beginPath();
        ctx.moveTo(pts[0].sx, pts[0].sy);
        ctx.lineTo(pts[1].sx, pts[1].sy);
        ctx.stroke();
        if (this.project({ x, y: y0, z: 0 })?.k > 5) {
          ctx.fillStyle = 'rgba(148,163,184,0.4)';
          ctx.font = '11px "PingFang SC","Microsoft YaHei",sans-serif';
          ctx.textAlign = 'center';
          const lp = this.project({ x, y: y0, z: 26 });
          if (lp) ctx.fillText(`${g}年级`, lp.sx, lp.sy);
          ctx.textAlign = 'left';
        }
      }
    }
  }
}

function layoutCenter(nodes, axis) {
  const vs = nodes.map((n) => n[axis]);
  return (Math.min(...vs) + Math.max(...vs)) / 2;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = (e) => `${e.a.id}->${e.b.id}`;
