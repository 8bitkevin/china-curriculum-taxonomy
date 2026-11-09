// viewer/lesson-render.js — 学习内容渲染（纯字符串，无 DOM / 无副作用）。
// 从 lesson.js 抽出，供两处共用：右侧抽屉（lesson.js）与独立学习页
// （lesson-page.js，lesson.html）。Node 测试（lesson-render.test.mjs）也直接
// import 本模块。渲染全部走 esc() 纯文本，例题解答与练习答案均用 <details>
// 折叠（先想再看）。lessonSectionsHtml() 额外给各分节固定锚点 id 并返回
// 存在的节清单（nav），供独立页生成锚点导航条。

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const DIFF_ZH = { 1: '基础', 2: '提高', 3: '挑战' };
// D-031/D-033 练习题分类徽标（面向用户不提来源，textbook=与课堂同步的基础题）
export const KIND_ZH = { textbook: '同步', variant: '变式', extension: '扩展' };
export const CONTRIB_URL = 'https://github.com/8bitkevin/china-curriculum-taxonomy/blob/main/CONTRIBUTING.md';

export const methodHtml = (m) => `
    <div class="lesson-method">
      <b class="lesson-method-name">${esc(m.name)}</b>
      <ol class="lesson-steps">${m.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${m.tip ? `<p class="lesson-tip">💡 ${esc(m.tip)}</p>` : ''}
    </div>`;

export const exampleHtml = (ex, i) => `
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

export const exerciseHtml = (e, i) => `
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

export const emptyHtml = (t) => `
    <div class="lesson-empty">
      <p class="lesson-empty-title">「${esc(t.name)}」的讲解还在建设中</p>
      <p>学习内容按学科分批编写。现阶段可以先看它的通俗描述、掌握证据与先修关系；
        这是一个开放图谱，也欢迎你一起贡献讲解与例题。</p>
      <a href="${CONTRIB_URL}" target="_blank" rel="noopener">如何贡献学习内容 →</a>
    </div>`;

/**
 * 完整学习内容 → 分节 HTML + 存在的节清单。
 * 各节 id 固定（sec-overview / sec-explain / sec-methods / sec-examples /
 * sec-mistakes / sec-exercises），独立页锚点导航与滚动高亮依赖这些 id；
 * 输出 DOM 结构与抽屉原 renderLesson 一致（仅新增 id 属性）。
 * @param {object} lesson data/lessons/*.json 的一条
 * @returns {{ html: string, nav: { id: string, label: string }[] }}
 */
export function lessonSectionsHtml(lesson) {
  const parts = [];
  const nav = [];
  if (lesson.summary) {
    parts.push(`<p class="lesson-summary" id="sec-overview">${esc(lesson.summary)}</p>`);
    nav.push({ id: 'sec-overview', label: '概述' });
  }
  if (lesson.explanation?.length) {
    parts.push(`
      <section class="lesson-sec" id="sec-explain">
        <h4>📖 讲解</h4>
        ${lesson.explanation.map((p) => `<p>${esc(p)}</p>`).join('')}
      </section>`);
    nav.push({ id: 'sec-explain', label: '讲解' });
  }
  if (lesson.methods?.length) {
    parts.push(`
      <section class="lesson-sec" id="sec-methods">
        <h4>🧰 方法</h4>
        ${lesson.methods.map(methodHtml).join('')}
      </section>`);
    nav.push({ id: 'sec-methods', label: '方法' });
  }
  if (lesson.examples?.length) {
    parts.push(`
      <section class="lesson-sec" id="sec-examples">
        <h4>✏️ 例题（先想再看解答）</h4>
        ${lesson.examples.map(exampleHtml).join('')}
      </section>`);
    nav.push({ id: 'sec-examples', label: '例题' });
  }
  if (lesson.mistakes?.length) {
    parts.push(`
      <section class="lesson-sec lesson-warn" id="sec-mistakes">
        <h4>⚠️ 易错提醒</h4>
        <ul>${lesson.mistakes.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      </section>`);
    nav.push({ id: 'sec-mistakes', label: '易错' });
  }
  if (lesson.exercises?.length) {
    parts.push(`
      <section class="lesson-sec" id="sec-exercises">
        <h4>📝 练习（先做再看答案）</h4>
        ${lesson.exercises.map(exerciseHtml).join('')}
      </section>`);
    nav.push({ id: 'sec-exercises', label: '练习' });
  }
  return { html: parts.join('\n'), nav };
}
