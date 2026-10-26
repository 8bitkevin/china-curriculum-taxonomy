#!/usr/bin/env node
/**
 * apply-batch.mjs — 数据批次合并工具（D-008「一册一批次」的落库机械臂）。
 *
 * 输入：批次片段 JSON（不入库，放 .ct-batches/）：
 *   {
 *     "version": "0.2.0",                       // 必填，写入 topics/dependencies 的 version
 *     "topics":   [ { ...知识点，prerequisites 可省略（build-manifest 会从边派生）} ],
 *     "edges":    [ { topicId, prerequisiteId, strength, reason } ],
 *     "standardEntries": [                       // 可选：向已有课标追加条目
 *       { "curriculum": "csmath-2022", "entries": [ { code, stage, domain, title } ] }
 *     ],
 *     "curricula": [ { ...新增整套课标（slug/title/issuer/year/officialUrl/textIncluded/topics） } ]  // 可选
 *   }
 *
 * 行为：合并 → 更新计数与 version → 调 build-manifest（注入 prerequisites + 重建 manifest）
 *      → 调 validate。任一步失败即非零退出，不留半成品。
 *
 *   node scripts/apply-batch.mjs .ct-batches/g3a.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const batchPath = process.argv[2];
if (!batchPath) {
  console.error('用法：node scripts/apply-batch.mjs <批次片段.json>');
  process.exit(1);
}

const batch = JSON.parse(readFileSync(resolve(process.cwd(), batchPath), 'utf8'));
const read = (name) => JSON.parse(readFileSync(resolve(ROOT, 'data', name), 'utf8'));
const write = (name, value) => writeFileSync(resolve(ROOT, 'data', name), `${JSON.stringify(value, null, 2)}\n`);

const topicsDoc = read('topics.json');
const depsDoc = read('dependencies.json');
const stdDoc = read('curriculum-standards.json');

// --- 前置检查：id 不重复、批次内部自洽 ----------------------------------------
const existing = new Set(topicsDoc.topics.map((t) => t.id));
for (const t of batch.topics ?? []) {
  if (existing.has(t.id)) { console.error(`✗ 知识点 id 已存在：${t.id}`); process.exit(1); }
  existing.add(t.id);
  delete t.prerequisites; // 权威在 edges，统一由 build-manifest 注入
}
for (const e of batch.edges ?? []) {
  if (!existing.has(e.topicId)) { console.error(`✗ 边引用未知 topicId：${e.topicId}`); process.exit(1); }
  if (!existing.has(e.prerequisiteId)) { console.error(`✗ 边引用未知 prerequisiteId：${e.prerequisiteId}`); process.exit(1); }
}
if (!batch.version) { console.error('✗ 批次缺少 version 字段'); process.exit(1); }
if (!batch.topics?.length && !batch.edges?.length && !batch.standardEntries?.length && !batch.curricula?.length) {
  console.error('✗ 批次为空（topics/edges/standardEntries/curricula 至少一项）'); process.exit(1);
}

// --- 合并 ---------------------------------------------------------------------
let stdAdded = 0;
if (batch.topics?.length) {
  topicsDoc.topics.push(...batch.topics);
  topicsDoc.topicCount = topicsDoc.topics.length;
}
topicsDoc.version = batch.version;
depsDoc.version = batch.version;
if (batch.edges?.length) {
  depsDoc.dependencies.push(...batch.edges);
  depsDoc.edgeCount = depsDoc.dependencies.length;
}
for (const { curriculum, entries } of batch.standardEntries ?? []) {
  const c = stdDoc.curricula.find((x) => x.slug === curriculum);
  if (!c) { console.error(`✗ 课标 slug 未知：${curriculum}`); process.exit(1); }
  const known = new Set(c.topics.map((s) => s.key));
  for (const s of entries) {
    const key = `${curriculum}:${s.code}`;
    if (known.has(key)) { console.error(`✗ 课标条目重复：${key}`); process.exit(1); }
    c.topics.push({ key, ...s });
    stdAdded++;
  }
  c.topicCount = c.topics.length;
}
for (const c of batch.curricula ?? []) {
  if (stdDoc.curricula.some((x) => x.slug === c.slug)) {
    console.error(`✗ 课标 slug 已存在：${c.slug}`); process.exit(1);
  }
  if (!c.textIncluded) stdDoc.codesOnlySources = [...new Set([...(stdDoc.codesOnlySources ?? []), c.slug])];
  c.topics = c.topics.map((s) => ({ key: `${c.slug}:${s.code}`, ...s }));
  c.topicCount = c.topics.length;
  stdDoc.curricula.push(c);
  stdDoc.curriculumCount = stdDoc.curricula.length;
  stdAdded += c.topicCount;
}

// --- 写回 + 重建 manifest + 校验 ------------------------------------------------
write('topics.json', topicsDoc);
write('dependencies.json', depsDoc);
write('curriculum-standards.json', stdDoc);

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`✗ ${cmd} ${args.join(' ')} 失败`); process.exit(1); }
};
run('node', ['scripts/build-manifest.mjs']);
run('node', ['scripts/validate.mjs']);
console.log(`✓ 批次已落库：+${batch.topics?.length ?? 0} 知识点 / +${batch.edges?.length ?? 0} 边 / +${stdAdded} 课标条目 → v${batch.version}`);
