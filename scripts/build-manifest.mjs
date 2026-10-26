#!/usr/bin/env node
/**
 * build-manifest.mjs — 从权威数据生成 manifest.json。
 *
 * 步骤：
 *   1. 读取 data/dependencies.json，把先修列表按字母序注入每个知识点的
 *      prerequisites 冗余字段（topics.json 是权威，但该字段允许省略）。
 *   2. 重写 data/topics.json（2 空格缩进 + 尾换行，字节稳定）。
 *   3. 扫描 data/lessons/*.json（学习内容层，D-030），统计覆盖率。
 *   4. 计算各文件 sha256/bytes，写入 data/manifest.json。
 *
 * 修改 topics.json / dependencies.json / curriculum-standards.json /
 * data/lessons/*.json 后运行：
 *   node scripts/build-manifest.mjs && node scripts/validate.mjs
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(readFileSync(resolve(ROOT, name), 'utf8'));
const dump = (value) => `${JSON.stringify(value, null, 2)}\n`;

const topicsDoc = read('data/topics.json');
const depsDoc = read('data/dependencies.json');
const standardsDoc = read('data/curriculum-standards.json');
const deprecatedDoc = read('data/deprecated.json');

// 1) 注入 prerequisites 冗余字段（从依赖边派生，去重排序）
const prereqOf = new Map();
for (const d of depsDoc.dependencies) {
  if (!prereqOf.has(d.topicId)) prereqOf.set(d.topicId, new Set());
  prereqOf.get(d.topicId).add(d.prerequisiteId);
}
for (const t of topicsDoc.topics) {
  const list = [...(prereqOf.get(t.id) ?? [])].sort();
  if (list.length) t.prerequisites = list;
  else delete t.prerequisites;
}
writeFileSync(resolve(ROOT, 'data/topics.json'), dump(topicsDoc));

// 2) 学习内容层（D-030）：扫描 data/lessons/*.json（目录可为空 = 覆盖率 0）
const lessonsDir = resolve(ROOT, 'data', 'lessons');
const lessonDocs = (existsSync(lessonsDir)
  ? readdirSync(lessonsDir).filter((n) => n.endsWith('.json')).sort()
  : []
).map((name) => ({ name, doc: JSON.parse(readFileSync(resolve(lessonsDir, name), 'utf8')) }));
const lessonTotal = lessonDocs.reduce((n, { doc }) => n + doc.lessons.length, 0);
const lessonCovered = new Set(lessonDocs.flatMap(({ doc }) => doc.lessons.map((l) => l.topicId))).size;
// D-031：练习数与教材对齐标记数（lesson.source 存在即视为已对齐）
const lessonExercises = lessonDocs.reduce(
  (n, { doc }) => n + doc.lessons.reduce((m, l) => m + (Array.isArray(l.exercises) ? l.exercises.length : 0), 0), 0);
const lessonsAligned = lessonDocs.reduce(
  (n, { doc }) => n + doc.lessons.filter((l) => l.source).length, 0);

// 3) manifest
const byGrade = {};
for (const t of topicsDoc.topics) {
  const k = `${t.grade}年级${t.semester}`;
  byGrade[k] = (byGrade[k] ?? 0) + 1;
}
const files = {};
for (const name of ['topics.json', 'dependencies.json', 'curriculum-standards.json', 'deprecated.json']) {
  const bytes = readFileSync(resolve(ROOT, 'data', name));
  files[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
for (const { name } of lessonDocs) {
  const bytes = readFileSync(resolve(lessonsDir, name));
  files[`lessons/${name}`] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const manifest = {
  taxonomy: 'china-curriculum-taxonomy',
  version: topicsDoc.version,
  generatedAt: new Date().toISOString().slice(0, 10),
  counts: {
    topics: topicsDoc.topics.length,
    dependencies: depsDoc.dependencies.length,
    standards: standardsDoc.curricula.reduce((n, c) => n + c.topics.length, 0),
    deprecated: deprecatedDoc.entries.length,
    lessons: lessonTotal,
    lessonExercises,
    byGrade,
  },
  coverage: {
    scope: 'K12（小学 1-6 / 初中 7-9 / 高中 10-12）',
    subjects: [...new Set(topicsDoc.topics.map((t) => t.subject))],
    grades: [...new Set(topicsDoc.topics.map(t => t.grade))].sort((a, b) => a - b),
    textbookSeries: [...new Set(topicsDoc.topics.map((t) => `${t.textbook.publisher}·${t.textbook.editionYear} 年版`))].sort(),
    lessonCoverage: { topics: lessonCovered, of: topicsDoc.topics.length, aligned: lessonsAligned },
    note: `覆盖 ${[...new Set(topicsDoc.topics.map((t) => t.subject))].join('、')}（人教系/统编教材）；进度详见 CHANGELOG。`,
  },
  files,
};
writeFileSync(resolve(ROOT, 'data/manifest.json'), dump(manifest));
console.log(`✓ manifest 已生成：${manifest.counts.topics} 知识点 / ${manifest.counts.dependencies} 依赖 / ${manifest.counts.standards} 课标条目 / ${lessonTotal} 条学习内容（覆盖 ${lessonCovered} 个知识点，教材对齐 ${lessonsAligned} 条，练习 ${lessonExercises} 题）`);
