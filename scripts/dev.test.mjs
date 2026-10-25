import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../viewer/logic.js';
import {
  mimeOf, safeJoin, topicQueryOf, handleApi,
} from './dev.mjs';

// ---------- 静态辅助 ----------

test('mimeOf 常见扩展名映射正确', () => {
  assert.equal(mimeOf('/viewer/index.html'), 'text/html; charset=utf-8');
  assert.equal(mimeOf('/viewer/viewer.js'), 'text/javascript; charset=utf-8');
  assert.equal(mimeOf('/data/topics.json'), 'application/json; charset=utf-8');
  assert.equal(mimeOf('/logo.svg'), 'image/svg+xml');
  assert.equal(mimeOf('/nope'), 'application/octet-stream');
});

test('safeJoin 正常解析并拦截目录穿越', () => {
  const root = resolve('/srv/repo');
  assert.equal(safeJoin(root, '/viewer/index.html'), join(root, 'viewer', 'index.html'));
  assert.equal(safeJoin(root, '/data/../data/topics.json'), join(root, 'data', 'topics.json'));
  assert.equal(safeJoin(root, '/..%2F..%2Fetc/passwd'), null);   // 编码 ..
  assert.equal(safeJoin(root, '/../../etc/passwd'), null);       // 明文 ..
  assert.equal(safeJoin(root, '/%00'), null);                    // NUL
});

// ---------- 查询参数 ----------

test('topicQueryOf 数字化与别名（q/query），非法值归零', () => {
  const q = topicQueryOf(new URLSearchParams('q=函数&subject=数学&grade=3&limit=10&offset=5'));
  assert.deepEqual(
    { query: q.query, subject: q.subject, domain: q.domain, grade: q.grade },
    { query: '函数', subject: '数学', domain: '', grade: 3 },
  );
  assert.equal(q.limit, 10);
  assert.equal(q.offset, 5);
  const bad = topicQueryOf(new URLSearchParams('grade=abc&limit=-1'));
  assert.equal(bad.grade, 0);
  assert.equal(bad.limit, 0);
  assert.equal(topicQueryOf(new URLSearchParams('query=x')).query, 'x'); // query 别名
});

// ---------- handleApi（内存数据源） ----------

const topicsDoc = {
  schemaVersion: 2, version: '9.9.9',
  topics: [
    { id: 'ct_a_01', subject: '数学', domain: '数与代数', name: '凑十法', description: '进位加法', grade: 1, semester: '上' },
    { id: 'ct_a_02', subject: '数学', domain: '数与代数', name: '退位减法', description: '退位减法', grade: 1, semester: '下' },
    { id: 'ct_b_01', subject: '语文', domain: '识字与写字', name: '拼音', description: '声母韵母', grade: 1, semester: '上' },
  ],
};
const depsDoc = {
  dependencies: [
    { topicId: 'ct_a_02', prerequisiteId: 'ct_a_01', strength: 'hard', reason: '想加算减' },
  ],
};
const stdDoc = {
  curricula: [
    { slug: 'csmath-2022', title: '义务教育数学课程标准（2022年版）',
      topics: [{ key: 'csmath-2022:S1.NA.NO.01', code: 'S1.NA.NO.01', title: '10以内数的认识' }] },
    { slug: 'cschinese-2022', title: '义务教育语文课程标准（2022年版）', topics: [] },
  ],
};

const memDeps = () => ({
  loadIndex: () => ({ index: buildIndex(topicsDoc, depsDoc), doc: topicsDoc }),
  loadStandards: () => stdDoc,
});

// GET helper：把完整 URL 拆成 pathname + searchParams（与 dev server 主循环一致）
const GET = (path, deps) => {
  const u = new URL(path, 'http://x');
  return handleApi('GET', u.pathname, u.searchParams, deps);
};

test('/api/summary 汇总版本与计数', async () => {
  const r = await GET('/api/summary', memDeps());
  assert.equal(r.status, 200);
  assert.equal(r.body.version, '9.9.9');
  assert.equal(r.body.topicCount, 3);
  assert.equal(r.body.edgeCount, 1);
  assert.deepEqual(r.body.subjects, ['数学', '语文']);
});

test('/api/topics 按 subject/grade/q 过滤并分页', async () => {
  const r = await GET('/api/topics?subject=数学&limit=1', memDeps());
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 2);
  assert.equal(r.body.count, 1);
  assert.equal(r.body.topics[0].id, 'ct_a_01');
  const q = await GET('/api/topics?q=退位', memDeps());
  assert.equal(q.body.total, 1);
  assert.equal(q.body.topics[0].id, 'ct_a_02');
});

test('/api/topic/:id 详情 + 先修/解锁；未知 id 404', async () => {
  const r = await GET('/api/topic/ct_a_02', memDeps());
  assert.equal(r.status, 200);
  assert.equal(r.body.topic.id, 'ct_a_02');
  assert.deepEqual(r.body.prereqs.map((e) => e.prerequisiteId), ['ct_a_01']);
  assert.equal(r.body.prereqStats.uniqueCount, 1);
  const miss = await GET('/api/topic/ct_none', memDeps());
  assert.equal(miss.status, 404);
});

test('/api/standards 按 curriculum/code 过滤；未知 404', async () => {
  const all = await GET('/api/standards', memDeps());
  assert.equal(all.body.curricula.length, 2);
  const one = await GET('/api/standards?curriculum=csmath-2022', memDeps());
  assert.equal(one.body.slug, 'csmath-2022');
  assert.equal(one.body.topics.length, 1);
  const code = await GET('/api/standards?code=S1.NA.NO.01', memDeps());
  assert.equal(code.body.curriculum, 'csmath-2022');
  assert.equal((await GET('/api/standards?curriculum=nope', memDeps())).status, 404);
});

test('API 只支持 GET：POST 405、OPTIONS 204、未知路径 404', async () => {
  assert.equal((await handleApi('POST', '/api/summary', new URLSearchParams(), memDeps())).status, 405);
  assert.equal((await handleApi('OPTIONS', '/api/summary', new URLSearchParams(), memDeps())).status, 204);
  assert.equal((await GET('/api/nope', memDeps())).status, 404);
});

test('createDataSources 读真仓数据并通过 mtime 热缓存', async () => {
  const { createDataSources } = await import('./dev.mjs');
  const ds = createDataSources({ root: resolve(dirname(fileURLToPath(import.meta.url)), '..') });
  const { index, doc } = ds.loadIndex();
  assert.equal(doc.topicCount, index.topics.length);
  assert.ok(index.topics.length > 1500, `期望全量主题，实际 ${index.topics.length}`);
  assert.ok(index.byId.has('ct_g1a_22'));
  // 二次调用命中同一索引对象（未改文件不重建）
  assert.equal(ds.loadIndex().index, index);
});
