// viewer/lesson-page.js — 独立学习页（lesson.html 入口逻辑，与主站抽屉共用
// lesson-render.js 的渲染与 DOM 类名）。
// 数据：fetch ../data/topics.json 取知识点元信息（标题/学科/年级），
// fetch ../data/lessons/<code>.json 取讲解内容（按需单学科，不拉 dependencies）。
// URL：lesson.html?id=<topicId>；标题与 meta description 动态更新，可直接分享。
// 锚点导航：lessonSectionsHtml 返回的节清单生成，scroll+rAF 高亮当前节。

import { lessonFileOf } from './logic.js';
import { subjectDeep } from './graph3d.js';
import { lessonSectionsHtml, emptyHtml, esc } from './lesson-render.js';

const DATA_BASE = '../data/';
const params = new URLSearchParams(location.search);
const topicId = params.get('id') ?? '';

const els = {
  back: document.querySelector('#lp-back'),
  ingraph: document.querySelector('#lp-ingraph'),
  topName: document.querySelector('#lp-top-name'),
  nav: document.querySelector('#lp-nav'),
  article: document.querySelector('#lp-article'),
};

function showError(title, detail) {
  els.topName.textContent = '';
  els.article.innerHTML = `
    <div class="lp-error">
      <p class="lp-error-title">${esc(title)}</p>
      <p class="lp-error-detail">${esc(detail)}</p>
      <a class="lp-error-back" href="index.html">← 返回图谱</a>
    </div>`;
}

function renderShell(t) {
  document.title = `${t.name} · 讲解与练习`;
  document.querySelector('meta[name="description"]')
    ?.setAttribute('content', String(t.description ?? '').slice(0, 120));
  const inGraphHref = `index.html#id=${encodeURIComponent(t.id)}`;
  els.back.href = inGraphHref;
  els.ingraph.href = inGraphHref;
  els.ingraph.hidden = false;
  els.topName.textContent = t.name;
  els.article.innerHTML = `
    <header class="lp-head">
      <span class="lesson-dot" id="lp-dot" aria-hidden="true"></span>
      <div class="lp-head-title">
        <h1 class="lp-name">${esc(t.name)}</h1>
        <p class="lp-meta">${esc(t.subject)} · ${esc(t.domain)} · ${t.grade} 年级${t.semester}</p>
      </div>
    </header>
    <div id="lp-content"><p class="lesson-loading">加载讲解中…</p></div>`;
  document.querySelector('#lp-dot').style.background = subjectDeep(t.subject);
}

function renderNav(nav) {
  els.nav.innerHTML = nav
    .map((n) => `<a href="#${n.id}">${esc(n.label)}</a>`)
    .join('');
  els.nav.hidden = false;
}

// 滚动高亮：取视口内最后一个上沿越过「双 sticky 条下沿」的节（节少，全量算足够快）
function bindSpy(nav) {
  const links = new Map(nav.map((n) => [n.id, els.nav.querySelector(`a[href="#${n.id}"]`)]));
  const secs = nav.map((n) => document.getElementById(n.id)).filter(Boolean);
  if (!secs.length) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const offset = 64 + els.nav.getBoundingClientRect().height;   // 顶栏 + 锚点条
    let cur = secs[0].id;
    for (const s of secs) {
      if (s.getBoundingClientRect().top - offset <= 0) cur = s.id;
    }
    links.forEach((a, key) => a?.classList.toggle('on', key === cur));
  };
  const schedule = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  addEventListener('scroll', schedule, { passive: true });
  // 兜底：锚点跳转后轮询到滚动停止。刻意用 setTimeout 而非 rAF——
  // 后台/不可见标签的 rAF 会被挂起（rAF 主通道仅在可见时工作）。
  addEventListener('hashchange', () => {
    let last = -1;
    const settle = () => {
      update();
      if (scrollY !== last) {
        last = scrollY;
        setTimeout(settle, 150);
      }
    };
    setTimeout(settle, 150);
  });
  update();
}

function renderContent(t, lesson) {
  const content = document.querySelector('#lp-content');
  if (lesson) {
    const { html, nav } = lessonSectionsHtml(lesson);
    content.innerHTML = html;
    renderNav(nav);
    bindSpy(nav);
  } else {
    content.innerHTML = emptyHtml(t);
  }
}

async function main() {
  if (!topicId) {
    showError('未指定知识点', '请从知识图谱进入：点击知识点的「查看讲解与例题」，或使用抽屉里的「⤢ 完整页面」。');
    return;
  }
  let topicsDoc;
  try {
    topicsDoc = await (await fetch(`${DATA_BASE}topics.json`)).json();
  } catch {
    showError('图谱数据加载失败', '请检查网络后刷新重试。');
    return;
  }
  const t = topicsDoc.topics.find((x) => x.id === topicId);
  if (!t) {
    showError('没有找到这个知识点', `链接中的标识「${topicId}」不在图谱中，可能已过期。`);
    return;
  }
  renderShell(t);

  const code = lessonFileOf(t.subject);
  if (!code) return renderContent(t, null);
  let lesson = null;
  try {
    const r = await fetch(`${DATA_BASE}lessons/${code}.json`);
    if (r.ok) {
      const lessonsDoc = await r.json();
      lesson = lessonsDoc.lessons.find((l) => l.topicId === topicId) ?? null;
    }
  } catch { /* 网络失败按无内容处理 */ }
  renderContent(t, lesson);
}

main();
