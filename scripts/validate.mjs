#!/usr/bin/env node
/**
 * validate.mjs — 零依赖完整性校验。
 *
 * 检查：schema 一致性、声明计数、ID 唯一、依赖引用完整、无自依赖、
 * 先修图无环（DAG）、topic→课标条目引用可解析、prerequisites 冗余字段
 * 与 dependencies.json 一致、年级/学期/教材/年龄交叉一致、manifest 校验和。
 *
 *   node scripts/validate.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSchema } from './check-schema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => JSON.parse(readFileSync(resolve(ROOT, name), 'utf8'));
const bytesOf = (name) => readFileSync(resolve(ROOT, name));

const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const topicsDoc = load('data/topics.json');
const depsDoc = load('data/dependencies.json');
const standardsDoc = load('data/curriculum-standards.json');

// --- schema -----------------------------------------------------------------
const schemas = {
  'data/topics.json': load('schema/topics.schema.json'),
  'data/dependencies.json': load('schema/dependencies.schema.json'),
  'data/curriculum-standards.json': load('schema/curriculum-standards.schema.json'),
};
for (const [file, schema] of Object.entries(schemas)) {
  errors.push(...checkSchema(load(file), schema, file));
}
if (errors.length) {
  console.error(`✗ schema 校验失败：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const topics = topicsDoc.topics;
const deps = depsDoc.dependencies;

// --- 声明计数 ---------------------------------------------------------------
check(topicsDoc.topicCount === topics.length, `topics: topicCount ${topicsDoc.topicCount} != ${topics.length}`);
check(depsDoc.edgeCount === deps.length, `dependencies: edgeCount ${depsDoc.edgeCount} != ${deps.length}`);
check(standardsDoc.curriculumCount === standardsDoc.curricula.length, `curricula: curriculumCount != length`);
for (const c of standardsDoc.curricula) {
  check(c.topicCount === c.topics.length, `curriculum ${c.slug}: topicCount != length`);
}

// --- 主题 id 唯一 + 字段交叉一致 --------------------------------------------
const topicIds = new Set();
const byId = new Map();
for (const t of topics) {
  if (topicIds.has(t.id)) errors.push(`重复主题 id: ${t.id}`);
  topicIds.add(t.id);
  byId.set(t.id, t);
  check(t.textbook.publisher === '人教版', `主题 ${t.id}: 目前仅支持人教版，实际 ${t.textbook.publisher}`);
  check(t.textbook.grade === t.grade, `主题 ${t.id}: grade ${t.grade} 与教材 grade ${t.textbook.grade} 不一致`);
  check(t.textbook.volume === t.semester, `主题 ${t.id}: semester ${t.semester} 与教材 volume ${t.textbook.volume} 不一致`);
  // 中国一年级入学约 6 岁：年龄带宽 = 年级 + 4 .. 年级 + 7
  check(t.ageRangeStart >= t.grade + 4 && t.ageRangeStart <= t.grade + 6, `主题 ${t.id}: ageRangeStart ${t.ageRangeStart} 与年级 ${t.grade} 不匹配`);
  check(t.ageRangeEnd >= t.grade + 5 && t.ageRangeEnd <= t.grade + 8, `主题 ${t.id}: ageRangeEnd ${t.ageRangeEnd} 与年级 ${t.grade} 不匹配`);
  check(t.ageRangeStart <= t.ageRangeEnd, `主题 ${t.id}: 年龄区间颠倒`);
  check(!t.assessmentPrompt || t.assessmentPrompt.includes('{{name}}'), `主题 ${t.id}: assessmentPrompt 缺少 {{name}} 占位符`);
}

// --- 课标键 -----------------------------------------------------------------
const standardKeys = new Set();
const codesOnly = new Set(standardsDoc.codesOnlySources ?? []);
for (const c of standardsDoc.curricula) {
  const expectText = !codesOnly.has(c.slug);
  check(c.textIncluded === expectText, `课标 ${c.slug}: textIncluded 与 codesOnlySources 不一致`);
  for (const s of c.topics) {
    check(s.key === `${c.slug}:${s.code}`, `课标条目 key 不匹配: ${s.key}`);
    if (standardKeys.has(s.key)) errors.push(`重复课标条目 key: ${s.key}`);
    standardKeys.add(s.key);
    if (!expectText) check(!('data' in s), `codes-only 课标 ${c.slug} 在 ${s.key} 泄漏了原文`);
  }
}

// --- 依赖：引用完整、无自依赖、无环（DAG） ------------------------------------
for (const d of deps) {
  check(topicIds.has(d.topicId), `依赖引用未知 topicId ${d.topicId}`);
  check(topicIds.has(d.prerequisiteId), `依赖引用未知 prerequisiteId ${d.prerequisiteId}`);
  check(d.topicId !== d.prerequisiteId, `自依赖: ${d.topicId}`);
}

// Kahn 拓扑排序检环
{
  const indeg = new Map(topics.map(t => [t.id, 0]));
  const adj = new Map(topics.map(t => [t.id, []]));
  for (const d of deps) {
    if (!indeg.has(d.topicId) || !indeg.has(d.prerequisiteId)) continue;
    adj.get(d.prerequisiteId).push(d.topicId); // 先修 → 后续
    indeg.set(d.topicId, indeg.get(d.topicId) + 1);
  }
  const queue = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id);
  let seen = 0;
  while (queue.length) {
    const id = queue.pop();
    seen++;
    for (const next of adj.get(id)) {
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  check(seen === topics.length, `先修图存在环：仅 ${seen}/${topics.length} 个主题完成拓扑排序`);
}

// --- 重复依赖边 --------------------------------------------------------------
{
  const seen = new Set();
  for (const d of deps) {
    const k = `${d.topicId}->${d.prerequisiteId}`;
    if (seen.has(k)) errors.push(`重复依赖边: ${k}`);
    seen.add(k);
  }
}

// --- topic → 课标引用 --------------------------------------------------------
let dangling = 0;
for (const t of topics) {
  for (const key of t.standards) {
    if (!standardKeys.has(key)) {
      dangling++;
      if (dangling <= 5) errors.push(`主题 ${t.id} 引用未知课标条目 ${key}`);
    }
  }
}
if (dangling > 5) errors.push(`…另有 ${dangling - 5} 个未知课标引用`);

// --- prerequisites 冗余字段与 dependencies.json 一致 -------------------------
{
  const depPairs = new Set(deps.map(d => `${d.topicId}->${d.prerequisiteId}`));
  for (const t of topics) {
    for (const p of t.prerequisites ?? []) {
      check(depPairs.has(`${t.id}->${p}`), `主题 ${t.id}: prerequisites 含未建边 ${p}`);
    }
  }
  const withRedundant = new Set(topics.filter(t => t.prerequisites?.length).map(t => t.id));
  for (const d of deps) {
    if (withRedundant.has(d.topicId)) {
      check((byId.get(d.topicId).prerequisites ?? []).includes(d.prerequisiteId),
        `边 ${d.topicId}->${d.prerequisiteId} 未反映在 prerequisites 冗余字段中`);
    }
  }
}

// --- manifest 校验和 ---------------------------------------------------------
{
  const manifest = load('data/manifest.json');
  for (const [name, meta] of Object.entries(manifest.files ?? {})) {
    const path = resolve(ROOT, 'data', name);
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
    check(actual === meta.sha256, `${name}: 校验和不匹配（数据改过请重跑 scripts/build-manifest.mjs）`);
    check(readFileSync(path).length === meta.bytes, `${name}: 字节数不匹配`);
  }
}

// --- 汇总 -------------------------------------------------------------------
if (errors.length) {
  console.error(`✗ ${errors.length} 个问题：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const grades = {};
for (const t of topics) {
  const k = `${t.grade}年级${t.semester}`;
  grades[k] = (grades[k] ?? 0) + 1;
}
console.log(
  `✓ 有效 — ${topics.length} 个微主题, ${deps.length} 条先修边, ${standardKeys.size} 条课标条目。` +
    `引用完整性 + DAG + 校验和 通过。分册分布: ` +
    Object.entries(grades).map(([k, n]) => `${k} ${n}`).join(' / '),
);
