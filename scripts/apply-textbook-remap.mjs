#!/usr/bin/env node
/** TOOL-5 教材重映射执行器（D-034）：按策展映射表把义务段数据层换到新版教材。
 *
 * 输入：
 *  - docs/textbook-units/remap-2026.json   人工策展映射表
 *  - docs/textbook-units/{stem}.json       新版单元基线（lesson 页码取自单元页）
 *  - data/topics.json、data/lessons/*.json
 *
 * 映射表条目（每册）：
 *   editionYear           新版批次年（写入 topic.textbook.editionYear）
 *   units                 { 旧unit值: 新unit值 | {stem, unit} }   ← {stem,unit}=跨册
 *   topics                { topicId: {unit|{stem,unit}, note?} }   ← 逐点覆盖（拆分用）
 *   deferred              [旧unit值...]                            ← 新版暂无对应（保留旧锚）
 *
 * 规则：
 *  - 跨册目标同步改 topic.grade/semester/textbook.{grade,volume} 与 ageRange 平移；
 *    知识点 id 永不变（D-003）。
 *  - lesson.source.unit/pages 与 topic.textbook.unit 成对更新（validate 强一致）；
 *    页码取目标册基线的单元起始页（缺页时回退首节页），止于下一单元起始页-1。
 *  - 未在映射表且不在 deferred 的旧 unit 值 → 记 warning，退出码 1（需补表）。
 *
 * 用法：
 *   node scripts/apply-textbook-remap.mjs --dry   # 只报告
 *   node scripts/apply-textbook-remap.mjs         # 落盘
 *   node scripts/apply-textbook-remap.mjs --table <path> [--dry]
 *     # 指定过滤表（默认 docs/textbook-units/remap-2026.json）。表条目被批次
 *     # 应用后即消费完毕，累计表重放会对已切换册次报警（旧键已不存在）；
 *     # 后续批次用 --table 传仅含本批册次的过滤表执行。
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const TI = process.argv.indexOf('--table');
const TABLE = TI > -1 && process.argv[TI + 1]
  ? process.argv[TI + 1]
  : join(ROOT, 'docs/textbook-units/remap-2026.json');
const TODAY = new Date().toISOString().slice(0, 10);

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const cnGrade = (g) => (g <= 9 ? CN[g] : String(g));

/** 单元值归一：基线键用 index（有编号单元）或 title（无编号主题单元）。
 *  可读目标值「第一单元·识字」→「1」；「时间在哪里」→ 原样（title 键）。 */
const CN_DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** 中文数字→整数（含 十/二十/二十一 式，B-NE4 物理二十章暴露原 reduce 公式 二十→30 的错误） */
function cn2num(g) {
  if (/^\d+$/.test(g)) return parseInt(g, 10);
  const i = g.indexOf('十');
  if (i === -1) return g.split('').reduce((a, c) => a * 10 + (CN_DIGIT[c] ?? 0), 0);
  const a = g.slice(0, i);
  const b = g.slice(i + 1);
  return (a ? (CN_DIGIT[a] ?? 1) : 1) * 10 + (b ? (CN_DIGIT[b] ?? 0) : 0);
}
function normUnitKey(v) {
  const s = String(v);
  const m = s.match(/^第([一二三四五六七八九十\d]+)[单元章]/);
  if (m) return String(cn2num(m[1]));
  const e = s.match(/^Unit\s*(\d+)/i); // 英语锚值「Unit 1·Making friends」
  if (e) return e[1];
  return s;
}
const baselineKey = (u) => String(u.index ?? u.title);

/** (学科, 年级, 上/下学期) → 本地卷册 stem（与 relocate-exercise-pages.py 同口径）。 */
function stemOf(subject, grade, volume) {
  const v = volume === '全' ? '全一册' : `${volume}册`;
  if (grade <= 6) {
    if (subject === '思想政治') return null;
    return `${subject}${cnGrade(grade)}年级${v}`;
  }
  if (grade <= 9) {
    if (subject === '英语' && grade === 9)
      return volume === '全' ? '初中英语九年级全一册' : `初中英语九年级${v}`; // 新版拆上下册（B-NE6）
    if (subject === '物理' && grade === 9) return '初中物理九年级全一册';
    return `初中${subject}${cnGrade(grade)}年级${v}`;
  }
  return null;
}

/** stem → {subject, grade, semester}（跨册回填用；与 fetch/extract 注册表同口径）。 */
const STEM_META = (() => {
  const m = new Map();
  const reg = (subject, grade, vol) => {
    const stem = stemOf(subject, grade, vol);
    if (stem) m.set(stem, { subject, grade, semester: vol });
  };
  for (let g = 1; g <= 9; g++) {
    for (const v of ['上', '下']) {
      for (const s of ['数学', '语文', '历史', '地理', '生物学', '道德与法治']) {
        if (s === '地理' && g > 8) continue;
        if (s === '生物学' && g > 8) continue;
        if (s === '历史' && g < 7) continue;
        if (s === '道德与法治' && g < 1) reg(s, g, v); else reg(s, g, v);
      }
      reg('数学', g, v);
      if (g >= 3) reg('英语', g, v);
      if (g >= 8) reg('物理', g, v);
      if (g === 9) reg('化学', g, v);
    }
  }
  m.set('初中物理九年级全一册', { subject: '物理', grade: 9, semester: '全' });
  m.set('初中英语九年级全一册', { subject: '英语', grade: 9, semester: '全' });
  return m;
})();

function unitPagesOf(stem) {
  const p = join(ROOT, 'docs/textbook-units', `${stem}.json`);
  try {
    return JSON.parse(readFileSync(p, 'utf8')).units ?? [];
  } catch {
    return [];
  }
}

function main() {
  const remap = JSON.parse(readFileSync(TABLE, 'utf8'));
  const topics = JSON.parse(readFileSync(join(ROOT, 'data/topics.json'), 'utf8'));

  const stats = { topics: 0, moved: 0, lessons: 0, deferred: 0, outOfScope: 0, warn: [] };
  const changes = [];
  const remappedIds = new Set();

  // 1) topics
  for (const t of topics.topics) {
    if (t.grade > 9) { stats.outOfScope++; continue; }
    const stem = stemOf(t.subject, t.grade, t.textbook?.volume);
    const entry = stem ? remap[stem] : undefined;
    if (!entry) { stats.deferred++; continue; }

    let target = entry.topics?.[t.id];
    let note;
    if (target) {
      note = target.note;
      if (target && typeof target === 'object' && !target.stem) target = target.unit;
    } else {
      const key = String(t.textbook.unit);
      if (key in (entry.units ?? {})) target = entry.units[key];
      else if ((entry.deferred ?? []).includes(key)) { stats.deferred++; continue; }
      else { stats.warn.push({ topicId: t.id, stem, oldUnit: t.textbook.unit }); continue; }
    }

    const fromGrade = t.grade;
    const fromSem = t.semester;
    let targetStem = stem;
    let newUnit = target;
    if (target && typeof target === 'object' && target.stem) {
      targetStem = target.stem;
      newUnit = target.unit;
    }
    const meta = STEM_META.get(targetStem);
    if (!meta) { stats.warn.push({ topicId: t.id, stem: targetStem, why: '未知目标册' }); continue; }

    t.textbook.unit = newUnit;
    // 全一册册次（物理/英语九年级）不写 volume='全'——schema 枚举仅 上/下，
    // 且 stemOf 对九年级全一册有特例，卷字段保持学期口径（B-NE4 实证）
    t.textbook.volume = meta.semester === '全' ? t.textbook.volume : meta.semester;
    t.textbook.editionYear = remap[targetStem]?.editionYear ?? t.textbook.editionYear;
    if (meta.grade !== fromGrade) {
      const d = meta.grade - fromGrade;
      t.grade = meta.grade;
      if (t.textbook) t.textbook.grade = meta.grade;
      if (Number.isFinite(t.ageRangeStart)) t.ageRangeStart += d;
      if (Number.isFinite(t.ageRangeEnd)) t.ageRangeEnd += d;
      stats.moved++;
    }
    if (meta.semester !== fromSem && meta.semester !== '全') t.semester = meta.semester;
    if (note) changes.push({ topicId: t.id, note });
    changes.push({ topicId: t.id, from: `${stem}|u${t.textbook.unit}`, to: `${targetStem}|${newUnit}` });
    stats.topics++;
    remappedIds.add(t.id);
  }

  // 2) lessons（仅处理已重映射主题；页码取目标册基线）
  const byId = new Map(topics.topics.map((t) => [t.id, t]));
  const lessonFiles = readdirSync(join(ROOT, 'data/lessons')).filter((f) => f.endsWith('.json'));
  for (const f of lessonFiles) {
    const p = join(ROOT, 'data/lessons', f);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    let touched = 0;
    for (const l of j.lessons ?? []) {
      const t = byId.get(l.topicId);
      if (!t || t.grade > 9 || !l.source) continue;
      if (!remappedIds.has(t.id)) continue; // 挂起/未切换册的 lesson 保持原样
      const stem = stemOf(t.subject, t.grade, t.textbook?.volume);
      if (!stem || !remap[stem]) continue;
      const units = unitPagesOf(stem);
      const want = normUnitKey(t.textbook.unit);
      const idx = units.findIndex((u) => baselineKey(u) === want
        || String(u.title) === String(t.textbook.unit));
      if (idx === -1) {
        stats.warn.push({ topicId: l.topicId, stem, unit: t.textbook.unit, why: '目标基线无此单元' });
        continue;
      }
      const u = units[idx];
      const start = u.page ?? (u.sections ?? []).find((s) => s.page)?.page ?? 1;
      const next = units[idx + 1]?.page;
      const end = next ? next - 1 : start + 30;
      l.source.unit = t.textbook.unit;
      l.source.pages = [start, Math.max(start, end)];
      l.source.alignedAt = TODAY;
      touched++;
      stats.lessons++;
    }
    if (!DRY && touched) {
      writeFileSync(p, JSON.stringify(j, null, 1) + '\n', 'utf8');
      console.log(`  ✓ data/lessons/${f}: ${touched} 条`);
    }
  }

  // 3) 落盘 topics + 报告
  if (!DRY) {
    writeFileSync(join(ROOT, 'data/topics.json'), JSON.stringify(topics, null, 1) + '\n', 'utf8');
    writeFileSync(join(ROOT, '.scratch/remap-changes.json'),
      JSON.stringify({ date: TODAY, stats, changes }, null, 1) + '\n', 'utf8');
  } else {
    writeFileSync(join(ROOT, '.scratch/remap-changes.json'),
      JSON.stringify({ date: TODAY, dry: true, stats, changes }, null, 1) + '\n', 'utf8');
  }
  console.log(`\ntopics 更新 ${stats.topics}（跨年级 ${stats.moved}），lessons 更新 ${stats.lessons}，` +
    `未登记册/挂起 ${stats.deferred}，高中跳过 ${stats.outOfScope}`);
  if (stats.warn.length) {
    console.log(`\n⚠ 警告 ${stats.warn.length} 条：`);
    for (const w of stats.warn.slice(0, 30)) console.log('  ', JSON.stringify(w));
    process.exitCode = 1;
  }
}

main();
