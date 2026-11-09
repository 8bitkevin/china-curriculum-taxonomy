// viewer/lesson-render.test.mjs — 学习内容渲染的 Node 测试（纯字符串模块）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, DIFF_ZH, KIND_ZH, lessonSectionsHtml, emptyHtml, exampleHtml, exerciseHtml,
} from './lesson-render.js';

test('esc：HTML 特殊字符转义，防注入', () => {
  assert.equal(esc('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

const fullLesson = {
  topicId: 'ct_test_01',
  summary: '一句话概述',
  explanation: ['第一段讲解', '第二段讲解'],
  methods: [{ name: '方法一', steps: ['步骤1', '步骤2'], tip: '小提示' }],
  examples: [{ question: '例题题干', solution: '解答', pitfall: '易错点', difficulty: 2 }],
  mistakes: ['易错一', '易错二'],
  exercises: [{ question: '练习题干', answer: 'A', solution: '解析', kind: 'textbook', difficulty: 1, options: ['A. 1', 'B. 2'] }],
};

test('lessonSectionsHtml：全节渲染，各节固定锚点 id + nav 清单', () => {
  const { html, nav } = lessonSectionsHtml(fullLesson);
  const ids = ['sec-overview', 'sec-explain', 'sec-methods', 'sec-examples', 'sec-mistakes', 'sec-exercises'];
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `应含锚点 ${id}`);
  assert.deepEqual(nav.map((n) => n.id), ids);
  // 内容组件类名与抽屉一致（DOM 复用）
  assert.ok(html.includes('lesson-summary') && html.includes('lesson-sec') && html.includes('lesson-method'));
  assert.ok(html.includes('例 1') && html.includes('对答案 · 看解析') && html.includes('查看解答'));
});

test('lessonSectionsHtml：缺节不渲染对应锚点，nav 与节一一对应', () => {
  const { html, nav } = lessonSectionsHtml({ summary: '只有概述', explanation: ['讲解'] });
  assert.ok(!html.includes('sec-methods') && !html.includes('sec-exercises'));
  assert.deepEqual(nav.map((n) => n.id), ['sec-overview', 'sec-explain']);
});

test('exampleHtml / exerciseHtml：难度与分类徽标文案', () => {
  assert.ok(exampleHtml({ question: 'q', solution: 's', difficulty: 3 }).includes('挑战'));
  const exr = exerciseHtml({ question: 'q', answer: 'B', solution: 's', kind: 'variant', difficulty: 2 });
  assert.ok(exr.includes('变式') && exr.includes('提高'));
  assert.equal(DIFF_ZH[1], '基础');
  assert.equal(KIND_ZH.textbook, '同步');
});

test('emptyHtml：含知识点名与贡献引导', () => {
  const html = emptyHtml({ name: '凑十法：9 加几' });
  assert.ok(html.includes('凑十法：9 加几') && html.includes('CONTRIBUTING.md'));
  // 内容走 esc，不带原始 HTML
  assert.ok(!emptyHtml({ name: '<b>x</b>' }).includes('<b>x</b>'));
});
