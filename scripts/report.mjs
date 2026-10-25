#!/usr/bin/env node
// TOOL-2 质量报告：数据集健康度一览，供每个数据批次 PR 附带。
// 零 npm 依赖（Node ≥ 20）。用法：node scripts/report.mjs [--out 文件]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));

const topics = read('data/topics.json').topics;
const deps = read('data/dependencies.json').dependencies;
const out = [];

const emit = (s = '') => out.push(s);
const pct = (a, b) => (b === 0 ? '—' : `${((a / b) * 100).toFixed(1)}%`);

// ---------- 总览 ----------
const byId = new Map(topics.map((t) => [t.id, t]));
const inDeg = new Map(topics.map((t) => [t.id, 0]));
const outDeg = new Map(topics.map((t) => [t.id, 0]));
for (const d of deps) {
  inDeg.set(d.topicId, (inDeg.get(d.topicId) ?? 0) + 1);
  outDeg.set(d.prerequisiteId, (outDeg.get(d.prerequisiteId) ?? 0) + 1);
}

emit('# 数据质量报告');
emit();
emit(`生成于 ${new Date().toISOString().slice(0, 10)}，数据版本见 manifest。`);
emit();
emit('## 总览');
emit();
emit('| 指标 | 值 | 目标 |');
emit('|---|---|---|');
emit(`| 微主题数 | ${topics.length} | — |`);
emit(`| 先修边数 | ${deps.length} | — |`);
emit(`| 边密度（边/主题） | ${(deps.length / topics.length).toFixed(2)} | 趋势监控（os-taxonomy 对标 ≈ 2.0） |`);
const hard = deps.filter((d) => d.strength === 'hard').length;
emit(`| hard / soft 边 | ${hard} / ${deps.length - hard} | — |`);

// ---------- 分布 ----------
const dist = (select) => {
  const m = new Map();
  for (const t of topics) {
    const k = select(t);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};
const vol = (t) => `${t.grade}年级${t.semester}`;

for (const [title, rows] of [
  ['学科分布', dist((t) => t.subject)],
  ['分册分布', dist(vol)],
  ['领域分布', dist((t) => `${t.subject}·${t.domain}`)],
  ['类型分布', dist((t) => t.type)],
]) {
  emit();
  emit(`## ${title}`);
  emit();
  emit('| ' + title.slice(0, 2) + ' | 主题数 |');
  emit('|---|---|');
  for (const [k, n] of rows) emit(`| ${k} | ${n} |`);
}

// ---------- 质量指标 ----------
const islands = topics.filter((t) => inDeg.get(t.id) === 0 && outDeg.get(t.id) === 0);
const roots = topics.filter((t) => inDeg.get(t.id) === 0 && outDeg.get(t.id) > 0);
const noPrompt = topics.filter((t) => !t.assessmentPrompt);
const noStd = topics.filter((t) => !t.standards?.length);

emit();
emit('## 质量指标');
emit();
emit('| 指标 | 值 | 目标 | 状态 |');
emit('|---|---|---|---|');
emit(`| 孤岛主题（入度=出度=0） | ${islands.length} | 0 | ${islands.length === 0 ? '✅' : '❌'} |`);
emit(`| 起点主题（入度=0，有出边） | ${roots.length} | 参考（各学段起点属正常） | ℹ️ |`);
emit(`| assessmentPrompt 覆盖 | ${topics.length - noPrompt.length}/${topics.length}（${pct(topics.length - noPrompt.length, topics.length)}） | 100% | ${noPrompt.length === 0 ? '✅' : '❌'} |`);
emit(`| 课标引用覆盖（≥1 条） | ${topics.length - noStd.length}/${topics.length}（${pct(topics.length - noStd.length, topics.length)}） | ≥95% | ${noStd.length / topics.length <= 0.05 ? '✅' : '❌'} |`);

// 跨年级倒挂：先修主题年级高于本体年级（先修应更早或同学段）
const inverted = deps
  .map((d) => ({ d, t: byId.get(d.topicId), p: byId.get(d.prerequisiteId) }))
  .filter((x) => x.t && x.p && x.p.grade > x.t.grade);
emit(`| 跨年级倒挂边 | ${inverted.length} | 0 | ${inverted.length === 0 ? '✅' : '❌'} |`);

// ---------- 清单 ----------
if (islands.length) {
  emit();
  emit('### 孤岛主题清单');
  emit();
  for (const t of islands) emit(`- \`${t.id}\` ${t.name}（${vol(t)}）`);
}
if (noPrompt.length) {
  emit();
  emit('### 缺 assessmentPrompt 主题');
  emit();
  for (const t of noPrompt) emit(`- \`${t.id}\` ${t.name}`);
}
if (noStd.length) {
  emit();
  emit('### 缺课标引用主题');
  emit();
  for (const t of noStd) emit(`- \`${t.id}\` ${t.name}`);
}
if (inverted.length) {
  emit();
  emit('### 跨年级倒挂边（先修年级 > 本体年级）');
  emit();
  for (const { d, t, p } of inverted)
    emit(`- \`${t.id}\`（${t.grade}年级 ${t.name}）← \`${p.id}\`（${p.grade}年级 ${p.name}）`);
}

// ---------- 教材基线覆盖（TOOL-1 联动） ----------
try {
  const manifest = read('data/manifest.json');
  const volumes = new Set(topics.map((t) => vol(t)));
  const subjects = [...new Set(topics.map((t) => t.subject))];
  emit();
  emit('## 教材基线（TOOL-1）');
  emit();
  emit(`- 数据版本：${manifest.version}（manifest 生成于 ${manifest.generatedAt?.slice(0, 10) ?? '?'}）`);
  emit(`- 覆盖学科：${subjects.join('、')}`);
  emit(`- 当前数据覆盖册：${[...volumes].join('、')}`);
  emit('- 教材单元基线：`docs/textbook-units/` 留档（PDF 文本提取 + 扫描版人工基线，`--check` 可校验）');
} catch { /* manifest 缺失时不阻塞报告 */ }

const text = out.join('\n') + '\n';
const argIdx = process.argv.indexOf('--out');
if (argIdx > -1) {
  writeFileSync(process.argv[argIdx + 1], text, 'utf8');
  console.error(`✓ 报告已写入 ${process.argv[argIdx + 1]}`);
} else {
  process.stdout.write(text);
}
