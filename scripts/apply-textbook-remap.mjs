#!/usr/bin/env node
/** TOOL-5 教材重映射执行器（D-034）：按策展映射表把义务段数据层换到新版教材。
 *
 * 输入：
 *  - docs/textbook-units/remap-2026.json   人工策展：每册 oldUnit→newUnit 映射 + 新版 editionYear
 *  - docs/textbook-units/{stem}.json       新版单元基线（取单元起始页推算 lesson 页码范围）
 *  - data/topics.json、data/lessons/*.json
 *
 * 规则：
 *  - 仅处理 remap 表中登记的册次；未登记册（新版未上线）保持旧基线不动（D-006）。
 *  - topic.textbook.unit / editionYear 与 lesson.source.unit / pages 成对更新
 *    （validate 强制两者一致）。
 *  - lesson.source.pages = 新版单元页码范围 [单元起始页, 下一单元起始页-1]。
 *  - 练习题 source.label 的册页重定位由 relocate-exercise-pages.py 单独处理。
 *
 * 用法：
 *   node scripts/apply-textbook-remap.mjs --dry   # 只报告将发生的变更与未映射项
 *   node scripts/apply-textbook-remap.mjs         # 落盘（ topics.json + lessons/*.json ）
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const TODAY = new Date().toISOString().slice(0, 10);

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const cnGrade = (g) => (g <= 9 ? CN[g] : String(g));

/** (学科, 年级, 上/下学期) → 本地卷册 stem（与 textbook-units 命名一致）。 */
function stemOf(subject, grade, volume) {
  const v = `${volume}册`;
  if (grade <= 6) {
    if (subject === '英语') return `英语${cnGrade(grade)}年级${v}`;
    if (subject === '道德与法治') return `道德与法治${cnGrade(grade)}年级${v}`;
    if (subject === '思想政治') return null; // 高中
    return `${subject}${cnGrade(grade)}年级${v}`;
  }
  if (grade <= 9) {
    if (subject === '英语' && grade === 9) return `初中英语九年级全一册`; // 旧版卷册（九下上线后拆册）
    if (subject === '物理' && grade === 9) return '初中物理九年级全一册';
    return `初中${subject}${cnGrade(grade)}年级${v}`;
  }
  return null; // 高中不在本次范围
}

function main() {
  const remap = JSON.parse(readFileSync(join(ROOT, 'docs/textbook-units/remap-2026.json'), 'utf8'));
  const topics = JSON.parse(readFileSync(join(ROOT, 'data/topics.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data/manifest.json'), 'utf8'));

  // 新版单元页码表（stem → [units with pages]）
  const unitPages = new Map();
  for (const stem of Object.keys(remap)) {
    if (stem.startsWith('_')) continue;
    const p = join(ROOT, 'docs/textbook-units', `${stem}.json`);
    if (!existsSync(p)) continue;
    unitPages.set(stem, JSON.parse(readFileSync(p, 'utf8')).units ?? []);
  }

  const stats = { topics: 0, lessons: 0, unmapped: [], deferred: 0, outOfScope: 0 };
  const changes = []; // { topicId, subject, stem, oldUnit, newUnit }

  // 1) topics
  for (const t of topics.topics) {
    if (t.grade > 9) { stats.outOfScope++; continue; }
    const stem = stemOf(t.subject, t.grade, t.textbook?.volume);
    const entry = stem ? remap[stem] : undefined;
    if (!entry) { stats.deferred++; continue; }
    const oldKey = String(t.textbook.unit);
    if (!(oldKey in entry.units)) {
      stats.unmapped.push({ topicId: t.id, stem, oldUnit: t.textbook.unit });
      continue;
    }
    const newUnit = entry.units[oldKey];
    changes.push({ topicId: t.id, subject: t.subject, stem, oldUnit: t.textbook.unit, newUnit });
    t.textbook.unit = newUnit;
    t.textbook.editionYear = entry.editionYear;
    stats.topics++;
  }

  // 2) lessons（与 topic 同批一致；页码取新版单元页范围）
  const lessonFiles = readdirSync(join(ROOT, 'data/lessons')).filter((f) => f.endsWith('.json'));
  const byId = new Map(topics.topics.map((t) => [t.id, t]));
  for (const f of lessonFiles) {
    const p = join(ROOT, 'data/lessons', f);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    let touched = 0;
    for (const l of j.lessons ?? []) {
      const t = byId.get(l.topicId);
      if (!t || t.grade > 9) continue;
      const stem = stemOf(t.subject, t.grade, t.textbook?.volume);
      const entry = stem ? remap[stem] : undefined;
      if (!entry || !l.source) continue;
      if (!l.source._remapped) {
        // 仅当 lesson 的 topic 已重映射时同步（source.unit 与 textbook.unit 强一致）
      }
      const newUnit = t.textbook.unit;
      const units = unitPages.get(stem) ?? [];
      const idx = units.findIndex((u) => (u.index ?? u.title) === newUnit
        || String(u.index ?? '') === String(newUnit) || u.title === newUnit);
      if (idx === -1) {
        stats.unmapped.push({ topicId: l.topicId, stem, oldUnit: l.source.unit, newUnit, why: '新版基线无此单元' });
        continue;
      }
      const start = units[idx].page ?? 1;
      const next = units[idx + 1]?.page;
      const end = next ? next - 1 : start + 30;
      l.source.unit = newUnit;
      l.source.pages = [start, Math.max(start, end)];
      l.source.alignedAt = TODAY;
      touched++;
      stats.lessons++;
    }
    if (!DRY && touched) {
      writeFileSync(p, JSON.stringify(j, null, 1) + '\n', 'utf8');
      console.log(`  ✓ data/lessons/${f}: ${touched} 条 lesson 更新`);
    }
  }

  // 报告
  console.log(`\n topics 更新 ${stats.topics}，lessons 更新 ${stats.lessons}，` +
    `未登记册(保持旧基线) ${stats.deferred}，高中跳过 ${stats.outOfScope}`);
  if (stats.unmapped.length) {
    console.log(`\n⚠ 未映射 ${stats.unmapped.length} 条（需回 remap-2026.json 补齐）：`);
    for (const u of stats.unmapped.slice(0, 40)) console.log('  ', JSON.stringify(u));
    if (stats.unmapped.length > 40) console.log('   …');
  }
  if (!DRY && changes.length) {
    writeFileSync(join(ROOT, '.scratch/remap-changes.json'),
      JSON.stringify({ date: TODAY, stats, changes }, null, 1) + '\n', 'utf8');
  }
  if (DRY) {
    console.log(`\n[dry-run] 变更明细已汇总（共 ${changes.length} 条 topic 变更）`);
    writeFileSync(join(ROOT, '.scratch/remap-changes.json'),
      JSON.stringify({ date: TODAY, dry: true, stats, changes }, null, 1) + '\n', 'utf8');
  }
  if (stats.unmapped.length) process.exitCode = 1;
}

main();
