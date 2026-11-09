// viewer/lesson.js — 知识点学习内容抽屉（D-030：讲解 / 方法 / 例题；D-031：练习）。
// 零构建组件：initLessonDrawer 挂到 index.html 的 #lesson-mount 上。
// 渲染函数抽至 lesson-render.js（独立学习页 lesson.html 共用同一套 DOM）。
// 数据懒加载：首次打开某学科的知识点时才 fetch data/lessons/<code>.json
// （Map 缓存；404 = 该学科暂无内容，显示空态）。URL 由 viewer.js 的路由
// 统一管理：open/close 只改 UI，通过 onClose 回调让 viewer 同步 hash（#lesson=）。
// 抽屉定位 = 图谱旁的轻量速览；完整阅读走头部「⤢ 完整页面」新标签打开
// lesson.html?id=…。

import { lessonFileOf } from './logic.js';
import { subjectDeep } from './graph3d.js';
import { lessonSectionsHtml, emptyHtml } from './lesson-render.js';

/**
 * @param {{ index, dataBase?: string, onClose?: () => void }} opts  index = logic.buildIndex 产物
 * @returns {{ open(topicId: string): void, close(): void, isOpen(): boolean }}
 */
export function initLessonDrawer({ index, dataBase = '../data/', onClose } = {}) {
  const mount = document.querySelector('#lesson-mount');
  // 学科码 -> Promise<Map<topicId, lesson> | null>（null = 文件不存在）
  const subjectCache = new Map();

  mount.innerHTML = `
    <div class="lesson-veil" data-close></div>
    <aside class="lesson-drawer" role="dialog" aria-modal="true" aria-label="知识点讲解">
      <header class="lesson-head">
        <span class="lesson-dot" aria-hidden="true"></span>
        <div class="lesson-title">
          <h3 class="lesson-name"></h3>
          <p class="lesson-meta"></p>
        </div>
        <button class="lesson-fullpage" type="button" title="在新标签页完整阅读">⤢ 完整页面</button>
        <button class="lesson-close" type="button" title="关闭 (Esc)">×</button>
      </header>
      <div class="lesson-body"></div>
    </aside>`;

  const veil = mount.querySelector('.lesson-veil');
  const drawer = mount.querySelector('.lesson-drawer');
  const body = mount.querySelector('.lesson-body');
  let lastFocus = null;
  let currentId = null;   // 当前抽屉知识点（⤢ 完整页面按钮跳转用）

  const loadSubject = (subject) => {
    const code = lessonFileOf(subject);
    if (!code) return Promise.resolve(null);
    if (!subjectCache.has(code)) {
      const p = fetch(`${dataBase}lessons/${code}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((doc) => (doc ? new Map(doc.lessons.map((l) => [l.topicId, l])) : null))
        .catch(() => null);
      subjectCache.set(code, p);
    }
    return subjectCache.get(code);
  };

  const open = async (topicId) => {
    const t = index.byId.get(topicId);
    if (!t) return;
    lastFocus = document.activeElement;
    currentId = topicId;
    mount.querySelector('.lesson-dot').style.background = subjectDeep(t.subject);
    mount.querySelector('.lesson-name').textContent = t.name;
    mount.querySelector('.lesson-meta').textContent =
      `${t.subject} · ${t.domain} · ${t.grade} 年级${t.semester}`;
    body.innerHTML = '<p class="lesson-loading">加载讲解中…</p>';
    mount.hidden = false;
    drawer.scrollTop = 0;
    mount.querySelector('.lesson-close').focus();

    const byId = await loadSubject(t.subject);
    if (mount.hidden) return;   // 等待期间已关闭
    const lesson = byId?.get(topicId);
    body.innerHTML = lesson ? lessonSectionsHtml(lesson).html : emptyHtml(t);
  };

  const close = () => {
    if (mount.hidden) return;
    mount.hidden = true;
    lastFocus?.focus?.();
    lastFocus = null;
    onClose?.();   // URL 同步交给 viewer 的统一路由（#lesson= → #id=…）
  };

  // 新标签页打开完整学习页（lesson.html 与本页同目录）
  mount.querySelector('.lesson-fullpage').addEventListener('click', () => {
    if (currentId) window.open(`lesson.html?id=${encodeURIComponent(currentId)}`, '_blank', 'noopener');
  });

  veil.addEventListener('click', close);
  mount.querySelector('.lesson-close').addEventListener('click', close);
  // 捕获阶段拦截 Esc：抽屉在最上层，先于 pathmap/g3-card 的 Esc 关闭
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !mount.hidden) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }, true);
  // 抽屉内交互不落到背后页面
  ['pointerdown', 'pointerup', 'click', 'wheel'].forEach((ev) =>
    drawer.addEventListener(ev, (e) => e.stopPropagation()));

  return { open, close, isOpen: () => !mount.hidden };
}
