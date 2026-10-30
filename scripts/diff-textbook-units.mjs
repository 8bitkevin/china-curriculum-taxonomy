#!/usr/bin/env node
/** TOOL-4 教材改版 diff（D-034）：对比新旧两版 textbook-units 基线。
 *
 * 旧基线：.scratch/old-textbook-units/{stem}.json（改版前快照）
 * 新基线：docs/textbook-units/{stem}.json（新版重提取）
 *
 * 输出每个卷册的单元级对应关系（同名/改名/新增/移除），供
 * docs/textbook-units/remap-2026.json 人工策展作底稿。
 *
 * 用法：
 *   node scripts/diff-textbook-units.mjs [stem...]   # 缺省=全部两版齐备的卷册
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLD_DIR = join(ROOT, '.scratch', 'old-textbook-units');
const NEW_DIR = join(ROOT, 'docs', 'textbook-units');
const OUT_DIR = join(ROOT, '.scratch', 'textbook-diff');

/** 归一化标题：去空白与标点，保留 CJK/字母数字，便于跨版比对。 */
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s　·•、，,。．.（）()（）\-—~～～?!？!：:'’'"“”/]/g, '');
}

/** 二元组 Dice 相似度（CJK 友好）。 */
function sim(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = (s) => {
    const set = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      set.set(g, (set.get(g) ?? 0) + 1);
    }
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

function unitsOf(rec) {
  return (rec?.units ?? []).map((u) => ({
    key: u.index ?? u.title,
    index: u.index ?? null,
    title: u.title,
    page: u.page ?? null,
    sections: u.sections ?? [],
  }));
}

function diffVolume(stem) {
  const oldPath = join(OLD_DIR, `${stem}.json`);
  const newPath = join(NEW_DIR, `${stem}.json`);
  if (!existsSync(oldPath) || !existsSync(newPath)) return null;
  const oldRec = JSON.parse(readFileSync(oldPath, 'utf8'));
  const newRec = JSON.parse(readFileSync(newPath, 'utf8'));
  const sameBytes = oldRec.pdf?.sha256 === newRec.pdf?.sha256;
  const oldUnits = unitsOf(oldRec);
  const newUnits = unitsOf(newRec);

  // 新版按归一化标题索引，供旧版逐条找最佳匹配
  const byNorm = new Map();
  for (const u of newUnits) {
    const k = norm(u.title);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(u);
  }
  const used = new Set();
  const pairs = [];
  for (const o of oldUnits) {
    const k = norm(o.title);
    let best = null;
    let bestScore = 0;
    for (const [nk, list] of byNorm) {
      const s = k === nk ? 1 : sim(k, nk);
      if (s > bestScore) {
        bestScore = s;
        best = list[0];
      }
    }
    if (best && bestScore >= 0.72 && !used.has(best)) {
      used.add(best);
      pairs.push({ old: o, new: best, score: Number(bestScore.toFixed(3)),
                   status: bestScore === 1 ? 'same' : 'matched' });
    } else {
      pairs.push({ old: o, new: null, score: 0, status: 'removed' });
    }
  }
  for (const u of newUnits) {
    if (!used.has(u)) pairs.push({ old: null, new: u, score: 0, status: 'added' });
  }

  return {
    stem,
    sameBytes,
    oldSha: oldRec.pdf?.sha256?.slice(0, 10),
    newSha: newRec.pdf?.sha256?.slice(0, 10),
    oldCount: oldUnits.length,
    newCount: newUnits.length,
    pairs,
  };
}

function main() {
  const args = process.argv.slice(2);
  const stems = args.length
    ? args
    : readdirSync(NEW_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
        .filter((s) => existsSync(join(OLD_DIR, `${s}.json`)));
  mkdirSync(OUT_DIR, { recursive: true });

  const report = [];
  for (const stem of stems) {
    const d = diffVolume(stem);
    if (!d) continue;
    report.push(d);
    const changed = !d.sameBytes;
    const m = d.pairs.filter((p) => p.status === 'same').length;
    const r = d.pairs.filter((p) => p.status === 'matched').length;
    const rm = d.pairs.filter((p) => p.status === 'removed').length;
    const ad = d.pairs.filter((p) => p.status === 'added').length;
    console.log(
      `${changed ? '≠' : '='} ${stem}: ${d.oldCount}→${d.newCount} 单元 ` +
      `同名${m} 改名${r} 移除${rm} 新增${ad}`,
    );
    writeFileSync(join(OUT_DIR, `${stem}.json`), JSON.stringify(d, null, 1) + '\n');
  }
  const changed = report.filter((d) => !d.sameBytes).length;
  console.log(`\n共 ${report.length} 册，其中 ${changed} 册 PDF 已变（改版），详情写入 ${OUT_DIR}`);
  // 汇总文件：跨版单元映射建议（供 remap-2026.json 策展底稿）
  const summary = {};
  for (const d of report) {
    summary[d.stem] = d.pairs.map((p) => ({
      old: p.old ? { index: p.old.index, title: p.old.title } : null,
      new: p.new ? { index: p.new.index, title: p.new.title } : null,
      score: p.score,
      status: p.status,
    }));
  }
  writeFileSync(join(OUT_DIR, '_summary.json'), JSON.stringify(summary, null, 1) + '\n');
}

main();
