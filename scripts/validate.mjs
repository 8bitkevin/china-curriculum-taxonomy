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

// --- 多学科受控口径（D-015/D-016，SUBJECTS-BACKFILL-PLAN §2） -------------------
// id 前缀：数学沿用 v1.0 历史格式（无学科段，id 冻结）；新学科带学科代码段。
const SUBJECT_CODE = {
  '数学': null, '语文': 'yw', '英语': 'yy', '物理': 'wl', '化学': 'hx',
  '生物学': 'sw', '历史': 'ls', '地理': 'dl', '道德与法治': 'zz', '思想政治': 'zz',
};
const DOMAIN_BY_SUBJECT = {
  '数学': ['数与代数', '图形与几何', '统计与概率', '综合与实践'],
  '语文': ['识字与写字', '阅读与鉴赏', '表达与交流', '梳理与探究'],
  '英语': ['语音', '词汇', '语法', '听说', '阅读', '写作'],
  '物理': ['力学', '热学', '声与光', '电与磁', '能量与能源', '近代物理', '实验与探究'],
  '化学': ['化学实验与探究', '无机物及其应用', '物质结构与性质', '化学反应原理', '有机化学基础', '化学与社会'],
  '生物学': ['分子与细胞', '生物体的结构层次', '植物的生活', '人体生理与健康', '生物的多样性',
    '遗传与进化', '稳态与调节', '生物与环境', '生物技术与工程'],
  '历史': ['中国古代史', '中国近代史', '中国现代史', '世界古代史', '世界近代史', '世界现代史'],
  '地理': ['地球与地图', '自然地理', '人文地理', '世界地理', '中国地理', '区域发展', '资源、环境与国家安全'],
  '道德与法治': ['道德修养', '生命安全与健康', '法治教育', '国情教育', '中华优秀传统文化与革命传统'],
  '思想政治': ['中国特色社会主义', '经济与社会', '政治与法治', '哲学与文化',
    '当代国际政治与经济', '法律与生活', '逻辑与思维'],
};
// 高中册名 → { grade, semester }（D-016「通行教学进度，映射为约定」，同 D-014 精神）
const HS_BOOKS_BY_SUBJECT = {
  '数学': { '必修第一册': [10, '上'], '必修第二册': [10, '下'], '选择性必修第一册': [11, '上'], '选择性必修第二册': [11, '下'], '选择性必修第三册': [12, '上'] },
  '语文': { '必修上册': [10, '上'], '必修下册': [10, '下'], '选择性必修上册': [11, '上'], '选择性必修中册': [11, '下'], '选择性必修下册': [12, '上'] },
  '英语': { '必修第一册': [10, '上'], '必修第二册': [10, '下'], '必修第三册': [11, '上'], '选择性必修第一册': [11, '下'], '选择性必修第二册': [12, '上'], '选择性必修第三册': [12, '下'], '选择性必修第四册': [12, '下'] },
  '物理': { '必修第一册': [10, '上'], '必修第二册': [10, '下'], '必修第三册': [11, '上'], '选择性必修第一册': [11, '下'], '选择性必修第二册': [12, '上'], '选择性必修第三册': [12, '下'] },
  '化学': { '必修第一册': [10, '上'], '必修第二册': [10, '下'], '选择性必修第一册': [11, '上'], '选择性必修第二册': [11, '下'], '选择性必修第三册': [12, '上'] },
  '生物学': { '必修1 分子与细胞': [10, '上'], '必修2 遗传与进化': [10, '下'], '选择性必修1 稳态与调节': [11, '上'], '选择性必修2 生物与环境': [11, '下'], '选择性必修3 生物技术与工程': [12, '上'] },
  '历史': { '必修 中外历史纲要（上）': [10, '上'], '必修 中外历史纲要（下）': [10, '下'], '选择性必修1 国家制度与社会治理': [11, '上'], '选择性必修2 经济与社会生活': [11, '下'], '选择性必修3 文化交流与传播': [12, '上'] },
  '地理': { '必修第一册': [10, '上'], '必修第二册': [10, '下'], '选择性必修1 自然地理基础': [11, '上'], '选择性必修2 区域发展': [11, '下'], '选择性必修3 资源、环境与国家安全': [12, '上'] },
  '思想政治': { '必修1 中国特色社会主义': [10, '上'], '必修2 经济与社会': [10, '下'], '必修3 政治与法治': [11, '上'], '必修4 哲学与文化': [11, '下'], '选择性必修1 当代国际政治与经济': [12, '上'], '选择性必修2 法律与生活': [12, '下'], '选择性必修3 逻辑与思维': [12, '下'] },
};
const RE_ID_MATH = /^ct_g\d{1,2}[ab]_\d{2}$/;

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
  check(SUBJECT_CODE.hasOwnProperty(t.subject), `主题 ${t.id}: 未知学科 ${t.subject}（受控清单见 SUBJECT_CODE）`);
  check(DOMAIN_BY_SUBJECT[t.subject]?.includes(t.domain),
    `主题 ${t.id}: 学科「${t.subject}」不允许领域「${t.domain}」（受控清单见 DOMAIN_BY_SUBJECT）`);
  // id 前缀与学科代码一致（数学 = v1.0 历史格式；其余 = ct_{code}_g…）
  const code = SUBJECT_CODE[t.subject];
  if (code === null) {
    check(RE_ID_MATH.test(t.id), `主题 ${t.id}: 数学主题 id 应为历史格式 ct_g{年级}{a|b}_{序号}`);
  } else if (code) {
    const re = new RegExp(`^ct_${code}_g\\d{1,2}[ab]_\\d{2}$`);
    check(re.test(t.id), `主题 ${t.id}: 学科「${t.subject}」id 前缀应为 ct_${code}_g{年级}{a|b}_{序号}`);
  }
  check(t.textbook.publisher === '统编版' || t.textbook.publisher.startsWith('人教'),
    `主题 ${t.id}: 目前仅支持人教系教材（人教版/人教A版/统编版），实际 ${t.textbook.publisher}`);
  // 统编三科（语文、道法/政治、历史）用「统编版」，其余人教系用「人教版/人教A版」
  const TONGBIAN = t.subject === '数学' ? null
    : ['语文', '道德与法治', '思想政治', '历史'].includes(t.subject) ? '统编版' : null;
  if (TONGBIAN) check(t.textbook.publisher === TONGBIAN,
    `主题 ${t.id}: 学科「${t.subject}」教材 publisher 应为「${TONGBIAN}」`);
  else check(t.textbook.publisher !== '统编版', `主题 ${t.id}: 非统编学科不应使用 publisher 统编版`);
  check(t.textbook.grade === t.grade, `主题 ${t.id}: grade ${t.grade} 与教材 grade ${t.textbook.grade} 不一致`);
  check(t.textbook.volume === t.semester, `主题 ${t.id}: semester ${t.semester} 与教材 volume ${t.textbook.volume} 不一致`);
  // 中国一年级入学约 6 岁：年龄带宽 = 年级 + 4 .. 年级 + 7
  check(t.ageRangeStart >= t.grade + 4 && t.ageRangeStart <= t.grade + 6, `主题 ${t.id}: ageRangeStart ${t.ageRangeStart} 与年级 ${t.grade} 不匹配`);
  check(t.ageRangeEnd >= t.grade + 5 && t.ageRangeEnd <= t.grade + 8, `主题 ${t.id}: ageRangeEnd ${t.ageRangeEnd} 与年级 ${t.grade} 不匹配`);
  check(t.ageRangeStart <= t.ageRangeEnd, `主题 ${t.id}: 年龄区间颠倒`);
  check(!t.assessmentPrompt || t.assessmentPrompt.includes('{{name}}'), `主题 ${t.id}: assessmentPrompt 缺少 {{name}} 占位符`);
  // 高中册名（D-016 按学科映射）：册名必填且与 grade/semester 约定一致；小学/初中 book 省略
  if (t.grade >= 10) {
    const books = HS_BOOKS_BY_SUBJECT[t.subject] ?? {};
    check(books.hasOwnProperty(t.textbook.book),
      `主题 ${t.id}: 学科「${t.subject}」高中主题 textbook.book 应为 ${Object.keys(books).join('/')} 之一`);
    const [g, s] = books[t.textbook.book] ?? [];
    check(g === t.grade && s === t.semester,
      `主题 ${t.id}: 册名「${t.textbook.book}」约定映射为 ${g}年级${s}，与主题 ${t.grade}年级${t.semester} 不一致`);
  } else {
    check(!('book' in t.textbook), `主题 ${t.id}: book 字段仅高中主题使用`);
  }
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

// --- 依赖：引用完整、无自依赖、无环（DAG）、同学科（D-016） --------------------
for (const d of deps) {
  check(topicIds.has(d.topicId), `依赖引用未知 topicId ${d.topicId}`);
  check(topicIds.has(d.prerequisiteId), `依赖引用未知 prerequisiteId ${d.prerequisiteId}`);
  check(d.topicId !== d.prerequisiteId, `自依赖: ${d.topicId}`);
  const ts = byId.get(d.topicId)?.subject, ps = byId.get(d.prerequisiteId)?.subject;
  check(ts === ps, `跨学科依赖边 ${d.topicId}->${d.prerequisiteId}（D-016：只建同学科边，跨学科关系记远期 backlog）`);
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

// --- 废弃主题登记（DATA-4） ---------------------------------------------------
{
  const dep = load('data/deprecated.json');
  errors.push(...checkSchema(dep, load('schema/deprecated.schema.json'), 'data/deprecated.json'));
  check(dep.entryCount === dep.entries.length, `deprecated: entryCount ${dep.entryCount} != ${dep.entries.length}`);
  const deprecatedIds = new Set();
  for (const e of dep.entries) {
    if (deprecatedIds.has(e.id)) errors.push(`废弃登记重复 id: ${e.id}`);
    deprecatedIds.add(e.id);
    check(!topicIds.has(e.id), `废弃主题 ${e.id} 仍存在于 topics.json（应先移除再登记）`);
    for (const r of e.replacedBy ?? []) {
      check(topicIds.has(r), `废弃登记 ${e.id}: replacedBy 指向未知主题 ${r}`);
    }
  }
  for (const d of deps) {
    check(!deprecatedIds.has(d.topicId), `依赖边引用已废弃主题 ${d.topicId}（topicId）`);
    check(!deprecatedIds.has(d.prerequisiteId), `依赖边引用已废弃主题 ${d.prerequisiteId}（prerequisiteId）`);
  }
  for (const t of topics) {
    for (const p of t.prerequisites ?? []) {
      check(!deprecatedIds.has(p), `主题 ${t.id}: prerequisites 引用已废弃主题 ${p}`);
    }
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
const bySubject = {};
for (const t of topics) bySubject[t.subject] = (bySubject[t.subject] ?? 0) + 1;
console.log(
  `✓ 有效 — ${topics.length} 个微主题, ${deps.length} 条先修边, ${standardKeys.size} 条课标条目。` +
    `引用完整性 + DAG + 校验和 通过。分科: ` +
    Object.entries(bySubject).map(([k, n]) => `${k} ${n}`).join(' / ') +
    `。分册分布: ` +
    Object.entries(grades).map(([k, n]) => `${k} ${n}`).join(' / '),
);
