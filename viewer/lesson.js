// viewer/lesson.js — 知识点学习内容抽屉（D-030：讲解 / 方法 / 例题；D-031：练习）。
// 零构建组件：initLessonDrawer 挂到 index.html 的 #lesson-mount 上。
// 数据懒加载：首次打开某学科的知识点时才 fetch data/lessons/<code>.json
// （Map 缓存；404 = 该学科暂无内容，显示空态）。渲染全部走 esc() 纯文本，
// 例题解答与练习答案均用 <details> 折叠（先想再看）。深链 #lesson=ct_xx 由
// viewer.js 的 applyHash 驱动，open/close 用 replaceState 保持不产生历史记录。

import { lessonFileOf } from './logic.js';
import { subjectDeep } from './graph3d.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DIFF_ZH = { 1: '基础', 2: '提高', 3: '挑战' };
// D-031/D-033 练习题分类徽标（面向用户不提来源，textbook=与课堂同步的基础题）
const KIND_ZH = { textbook: '同步', variant: '变式', extension: '扩展' };
const CONTRIB_URL = 'https://github.com/8bitkevin/china-curriculum-taxonomy/blob/main/CONTRIBUTING.md';

/**
 * @param {{ index, dataBase?: string }} opts  index = logic.buildIndex 产物
 * @returns {{ open(topicId: string): void, close(): void, isOpen(): boolean }}
 */
export function initLessonDrawer({ index, dataBase = '../data/' } = {}) {
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
        <button class="lesson-close" type="button" title="关闭 (Esc)">×</button>
      </header>
      <div class="lesson-body"></div>
    </aside>`;

  const veil = mount.querySelector('.lesson-veil');
  const drawer = mount.querySelector('.lesson-drawer');
  const body = mount.querySelector('.lesson-body');
  let prevHash = null;      // open 时记录被替换的 hash，close 时还原
  let lastFocus = null;

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

  const methodHtml = (m) => `
    <div class="lesson-method">
      <b class="lesson-method-name">${esc(m.name)}</b>
      <ol class="lesson-steps">${m.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${m.tip ? `<p class="lesson-tip">💡 ${esc(m.tip)}</p>` : ''}
    </div>`;

  const exampleHtml = (ex, i) => `
    <div class="lesson-ex">
      <div class="lesson-q">
        <span class="lesson-diff d${ex.difficulty}">${DIFF_ZH[ex.difficulty] ?? ''}</span>
        <span>例 ${i + 1} · ${esc(ex.question)}</span>
      </div>
      <details class="lesson-sol">
        <summary>查看解答</summary>
        <p class="lesson-sol-text">${esc(ex.solution)}</p>
        ${ex.pitfall ? `<p class="lesson-pit">⚠ 本题易错：${esc(ex.pitfall)}</p>` : ''}
      </details>
    </div>`;

  const exerciseHtml = (e, i) => `
    <div class="lesson-ex lesson-exr">
      <div class="lesson-q">
        <span class="lesson-kind k-${e.kind}">${KIND_ZH[e.kind] ?? '练习'}</span>
        <span class="lesson-diff d${e.difficulty}">${DIFF_ZH[e.difficulty] ?? ''}</span>
        <span>${i + 1}. ${esc(e.question)}</span>
      </div>
      ${e.options ? `<ol class="lesson-opts" type="A">${e.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>` : ''}
      <details class="lesson-sol">
        <summary>对答案 · 看解析</summary>
        <p class="lesson-ans">答案：<b>${esc(e.answer)}</b></p>
        <p class="lesson-sol-text">${esc(e.solution)}</p>
      </details>
    </div>`;

  const emptyHtml = (t) => `
    <div class="lesson-empty">
      <p class="lesson-empty-title">「${esc(t.name)}」的讲解还在建设中</p>
      <p>学习内容按学科分批编写。现阶段可以先看它的通俗描述、掌握证据与先修关系；
        这是一个开放图谱，也欢迎你一起贡献讲解与例题。</p>
      <a href="${CONTRIB_URL}" target="_blank" rel="noopener">如何贡献学习内容 →</a>
    </div>`;

  const renderLesson = (t, lesson) => {
    const head = `
      <p class="lesson-summary">${esc(lesson.summary)}</p>
      <section class="lesson-sec">
        <h4>📖 讲解</h4>
        ${lesson.explanation.map((p) => `<p>${esc(p)}</p>`).join('')}
      </section>`;
    const methods = lesson.methods?.length ? `
      <section class="lesson-sec">
        <h4>🧰 方法</h4>
        ${lesson.methods.map(methodHtml).join('')}
      </section>` : '';
    const examples = lesson.examples?.length ? `
      <section class="lesson-sec">
        <h4>✏️ 例题（先想再看解答）</h4>
        ${lesson.examples.map(exampleHtml).join('')}
      </section>` : '';
    const mistakes = lesson.mistakes?.length ? `
      <section class="lesson-sec lesson-warn">
        <h4>⚠️ 易错提醒</h4>
        <ul>${lesson.mistakes.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      </section>` : '';
    const exercises = lesson.exercises?.length ? `
      <section class="lesson-sec">
        <h4>📝 练习（先做再看答案）</h4>
        ${lesson.exercises.map(exerciseHtml).join('')}
      </section>` : '';
    body.innerHTML = head + methods + examples + mistakes + exercises;
  };

  const open = async (topicId) => {
    const t = index.byId.get(topicId);
    if (!t) return;
    lastFocus = document.activeElement;
    mount.querySelector('.lesson-dot').style.background = subjectDeep(t.subject);
    mount.querySelector('.lesson-name').textContent = t.name;
    mount.querySelector('.lesson-meta').textContent =
      `${t.subject} · ${t.domain} · ${t.grade} 年级${t.semester}`;
    body.innerHTML = '<p class="lesson-loading">加载讲解中…</p>';
    mount.hidden = false;
    prevHash = location.hash.startsWith('#lesson=') ? prevHash : location.hash;
    history.replaceState(null, '', `#lesson=${topicId}`);
    drawer.scrollTop = 0;
    mount.querySelector('.lesson-close').focus();

    const byId = await loadSubject(t.subject);
    if (mount.hidden) return;   // 等待期间已关闭
    const lesson = byId?.get(topicId);
    if (lesson) renderLesson(t, lesson);
    else body.innerHTML = emptyHtml(t);
  };

  const close = () => {
    if (mount.hidden) return;
    mount.hidden = true;
    if (location.hash.startsWith('#lesson=') && prevHash !== undefined) {
      history.replaceState(null, '', prevHash || location.pathname + location.search);
    }
    prevHash = null;
    lastFocus?.focus?.();
    lastFocus = null;
  };

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
