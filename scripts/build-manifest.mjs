#!/usr/bin/env node
/**
 * build-manifest.mjs — 从权威数据生成 manifest.json。
 *
 * 步骤：
 *   1. 读取 data/dependencies.json，把先修列表按字母序注入每个主题的
 *      prerequisites 冗余字段（topics.json 是权威，但该字段允许省略）。
 *   2. 重写 data/topics.json（2 空格缩进 + 尾换行，字节稳定）。
 *   3. 计算各文件 sha256/bytes，写入 data/manifest.json。
 *
 * 修改 topics.json / dependencies.json / curriculum-standards.json 后运行：
 *   node scripts/build-manifest.mjs && node scripts/validate.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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

// 2) manifest
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
const manifest = {
  taxonomy: 'china-curriculum-taxonomy',
  version: topicsDoc.version,
  generatedAt: new Date().toISOString().slice(0, 10),
  counts: {
    topics: topicsDoc.topics.length,
    dependencies: depsDoc.dependencies.length,
    standards: standardsDoc.curricula.reduce((n, c) => n + c.topics.length, 0),
    deprecated: deprecatedDoc.entries.length,
    byGrade,
  },
  coverage: {
    scope: 'K12（小学 1-6 / 初中 7-9 / 高中 10-12）',
    subjects: [...new Set(topicsDoc.topics.map((t) => t.subject))],
    grades: [...new Set(topicsDoc.topics.map(t => t.grade))].sort((a, b) => a - b),
    textbookSeries: [...new Set(topicsDoc.topics.map((t) => `${t.textbook.publisher}·${t.textbook.editionYear} 年版`))].sort(),
    note: `覆盖 ${[...new Set(topicsDoc.topics.map((t) => t.subject))].join('、')}（人教系/统编教材）；进度详见 CHANGELOG。`,
  },
  files,
};
writeFileSync(resolve(ROOT, 'data/manifest.json'), dump(manifest));
console.log(`✓ manifest 已生成：${manifest.counts.topics} 主题 / ${manifest.counts.dependencies} 依赖 / ${manifest.counts.standards} 课标条目`);
