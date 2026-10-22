// viewer/questions.js — 主题详情页「相关真题」区块（M8，PROD-3 公开演示部分）。
// 数据：题库仓 build/pack.json（china-curriculum-questions，仅已打标题）。
// 零构建约束不变：本文件无构建依赖；KaTeX 从 CDN 惰性加载（首次展开题目时），
// 加载失败自动降级为纯文本公式。作答仅本地判定，不落任何存储（学生模型属 tutor-app，M9+）。

const DEFAULT_PACK_URL = 'https://raw.githubusercontent.com/8bitkevin/china-curriculum-questions/main/build/pack.json';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 纯函数（供单测） ----------

/** 填空题宽松比对：剥 $、反斜杠、空白与常见中文标点后忽略大小写比较；
 *  源数据答案偶用「\# \#」分隔多个可接受写法（如分数与小数），先拆分再逐一比对 */
export function normalizeFill(s) {
  return String(s ?? '')
    .replace(/\$/g, '')
    .replace(/\\[a-zA-Z]+/g, (m) => m.slice(1)) // \frac → frac（只影响相等性比对）
    .replace(/\\/g, '')
    .replace(/[\s{}]/g, '')
    .replace(/[，,。；;：:]/g, '')
    .toLowerCase();
}

export function splitAnswerAlt(answer) {
  return String(answer ?? '').split(/\\?#/).map((s) => s.trim()).filter(Boolean);
}

export function judgeFill(userInput, answerList) {
  const got = normalizeFill(userInput);
  if (!got) return false;
  return answerList.some((a) => splitAnswerAlt(a).some((alt) => normalizeFill(alt) === got));
}

/** 答案展示：拆分备用写法、重整 $ 定界符（KaTeX 渲染用） */
export function formatAnswer(answerList) {
  return answerList
    .flatMap((a) => splitAnswerAlt(a))
    .map((alt) => {
      const bare = alt.replace(/\$/g, '').trim();
      return /\\[a-zA-Z]|[\^_{}]/.test(bare) ? `$${bare}$` : bare;
    })
    .join('；');
}

/** 展示用来源行 */
export function sourceLine(q) {
  const s = q.source;
  return `${s.year} 年${s.paper}·${s.category}·难度 ${'★'.repeat(q.difficulty)}${'☆'.repeat(5 - q.difficulty)}`;
}

// ---------- pack 加载 ----------

const state = { status: 'loading', byTopic: new Map(), meta: null };

export function packUrl() {
  const fromQuery = new URLSearchParams(location.search).get('pack');
  return fromQuery || window.QUESTIONS_PACK_URL || DEFAULT_PACK_URL;
}

export function loadQuestions() {
  if (state.status !== 'loading') return Promise.resolve(state);
  return fetch(packUrl())
    .then((r) => { if (!r.ok) throw Error(`HTTP ${r.status}`); return r.json(); })
    .then((pack) => {
      for (const q of pack.questions) {
        for (const tid of q.topicIds) {
          if (!state.byTopic.has(tid)) state.byTopic.set(tid, []);
          state.byTopic.get(tid).push(q);
        }
      }
      state.meta = { count: pack.questionCount, version: pack.version };
      state.status = 'ready';
      return state;
    })
    .catch((err) => {
      console.warn(`[questions] 题库索引不可用（${err.message}），「相关真题」区块隐藏`);
      state.status = 'unavailable';
      return state;
    });
}

// ---------- KaTeX 惰性加载（双 CDN 降级） ----------

let katexPromise = null;
function loadKaTeX() {
  if (katexPromise) return katexPromise;
  // 国内可达性优先放前面；单个 CDN 挂起（不触发 onerror）6s 后自动跳下一个
  const BASES = [
    'https://registry.npmmirror.com/katex/0.16.11/files/dist',
    'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist',
    'https://unpkg.com/katex@0.16.11/dist',
  ];
  const tryLoad = (base) => new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = `${base}/katex.min.css`;
    document.head.appendChild(css);
    // katex.min.js 只定义 window.katex；逐题渲染所需的 renderMathInElement 在 contrib/auto-render 扩展里，需链式加载
    const js = document.createElement('script');
    js.src = `${base}/katex.min.js`;
    js.onload = () => {
      const ext = document.createElement('script');
      ext.src = `${base}/contrib/auto-render.min.js`;
      ext.onload = resolve; ext.onerror = reject;
      document.head.appendChild(ext);
      setTimeout(reject, 6000);
    };
    js.onerror = reject;
    document.head.appendChild(js);
    setTimeout(reject, 6000); // 挂起兜底：超时视为失败
  });
  katexPromise = new Promise((resolve) => {
    const tryNext = (i) => {
      if (i >= BASES.length) return resolve(false); // 全部失败 → 纯文本
      tryLoad(BASES[i]).then(() => resolve(true)).catch(() => tryNext(i + 1));
    };
    tryNext(0);
  });
  return katexPromise;
}

function renderMath(el) {
  loadKaTeX().then((ok) => {
    if (ok && window.renderMathInElement) {
      window.renderMathInElement(el, {
        delimiters: [{ left: '$$', right: '$$', display: false }, { left: '$', right: '$', display: false }],
        throwOnError: false,
      });
    }
  });
}

// ---------- 渲染与交互 ----------

const TYPE_ZH = { 'single-choice': '单选', 'fill-in': '填空', 'open-ended': '解答' };
const PREVIEW_COUNT = 5;

function questionCard(q) {
  const bodyId = `qb-${q.id}`;
  let body = '';
  if (q.type === 'single-choice') {
    body = `<div class="qopts" data-qid="${esc(q.id)}">` + (q.options || [])
      .map((opt, i) => `<button class="qopt" data-letter="${'ABCD'[i]}" type="button"><b>${'ABCD'[i]}.</b> ${esc(opt)}</button>`)
      .join('') + `</div>`;
  } else if (q.type === 'fill-in') {
    body = `<div class="qfill" data-qid="${esc(q.id)}">
      <input type="text" placeholder="输入答案（公式可写 LaTeX）" aria-label="填空作答">
      <button class="qbtn" data-act="submit" type="button">提交</button>
    </div>`;
  } else {
    body = `<div class="qoe" data-qid="${esc(q.id)}">
      <textarea rows="3" placeholder="在纸上或这里写出过程，再对照参考解答自评"></textarea>
      <button class="qbtn" data-act="submit" type="button">完成，看参考解答</button>
    </div>`;
  }
  return `
  <div class="qcard" data-id="${esc(q.id)}">
    <button class="qhead" type="button" aria-expanded="false">
      <span class="qtag">${TYPE_ZH[q.type] ?? q.type}</span>
      <span class="qsrc">${esc(sourceLine(q))}</span>
      <span class="qtoggle">展开 ▾</span>
    </button>
    <div class="qbody" id="${bodyId}" hidden>
      <p class="qstem">${esc(q.stem)}</p>
      ${body}
      <div class="qverdict" hidden></div>
      <div class="qanswer" hidden>
        <p class="qans-line"><b>参考答案</b>：${esc(formatAnswer(q.answer))}</p>
        ${q.analysis ? `<details class="qanalysis"><summary>解析</summary><div>${esc(q.analysis)}</div></details>` : ''}
      </div>
    </div>
  </div>`;
}

function mountSection(container, topicId) {
  const qs = state.byTopic.get(topicId) ?? [];
  if (!qs.length) return;
  const anchor = [...container.querySelectorAll('.sec h3')].find((h) => h.textContent.includes('↑ 先修链'))?.closest('.sec');
  const sec = document.createElement('div');
  sec.className = 'sec questions-sec';
  sec.innerHTML = `
    <h3>✎ 相关真题 <span class="count">${qs.length} 题（${state.meta?.count ?? '?'} 题索引中已挂到该主题）</span></h3>
    <div class="qlist">${qs.slice(0, PREVIEW_COUNT).map(questionCard).join('')}</div>
    ${qs.length > PREVIEW_COUNT ? `<button class="qmore" type="button">展开全部 ${qs.length} 题</button>` : ''}
    <p class="muted qfoot">题目与主题挂标来自公开题库仓 <a href="https://github.com/8bitkevin/china-curriculum-questions" target="_blank" rel="noopener">china-curriculum-questions</a>（GAOKAO-Bench，Apache-2.0；打标推进中）。作答仅在本地判定。</p>`;
  container.insertBefore(sec, anchor ?? null);
  bindCards(sec, qs);
}

function bindCards(sec, allQuestions) {
  const byId = new Map(allQuestions.map((q) => [q.id, q]));
  sec.querySelector('.qmore')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.insertAdjacentHTML('beforebegin', allQuestions.slice(PREVIEW_COUNT).map(questionCard).join(''));
    btn.remove();
    bindCards(sec, allQuestions); // 重新绑定（含新卡片）
  });
  for (const head of sec.querySelectorAll('.qhead')) {
    head.addEventListener('click', () => {
      const body = head.nextElementSibling;
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute('aria-expanded', String(open));
      head.querySelector('.qtoggle').textContent = open ? '收起 ▴' : '展开 ▾';
      if (open) renderMath(body); // 首次展开惰性渲染公式
    });
  }
  for (const btn of sec.querySelectorAll('.qopt')) {
    btn.addEventListener('click', () => {
      const q = byId.get(btn.closest('.qopts').dataset.qid);
      if (!q) return;
      const verdict = btn.closest('.qcard').querySelector('.qverdict');
      const chosen = btn.dataset.letter;
      const right = q.answer[0] === chosen;
      for (const b of btn.parentElement.querySelectorAll('.qopt')) {
        b.disabled = true;
        if (b.dataset.letter === q.answer[0]) b.classList.add('right');
      }
      if (!right) btn.classList.add('wrong');
      verdict.hidden = false;
      verdict.textContent = right ? '✓ 回答正确' : `✗ 应选 ${q.answer[0]}`;
      verdict.className = `qverdict ${right ? 'ok' : 'bad'}`;
      revealAnswer(btn.closest('.qcard'));
    });
  }
  for (const box of sec.querySelectorAll('.qfill, .qoe')) {
    box.querySelector('.qbtn')?.addEventListener('click', () => {
      const q = byId.get(box.dataset.qid);
      const card = box.closest('.qcard');
      const verdict = card.querySelector('.qverdict');
      if (q.type === 'fill-in') {
        const input = box.querySelector('input');
        const ok = judgeFill(input.value, q.answer);
        verdict.hidden = false;
        verdict.className = `qverdict ${ok ? 'ok' : 'bad'}`;
        verdict.textContent = ok ? '✓ 回答正确' : '✗ 不完全匹配，请对照参考答案';
        input.disabled = true;
      } else {
        verdict.hidden = false;
        verdict.className = 'qverdict';
        verdict.textContent = '已提交，请对照参考解答自评';
        box.querySelector('textarea').disabled = true;
      }
      revealAnswer(card);
    });
  }
}

function revealAnswer(card) {
  const ans = card.querySelector('.qanswer');
  if (ans.hidden) {
    ans.hidden = false;
    renderMath(ans);
  }
}

/** 入口：viewer.js 在渲染完主题详情后调用（详情容器, 主题 id） */
export function mountQuestions(container, topicId) {
  if (state.status === 'unavailable') return;
  if (state.status === 'ready') { mountSection(container, topicId); return; }
  loadQuestions().then(() => { if (state.status === 'ready') mountSection(container, topicId); });
}
