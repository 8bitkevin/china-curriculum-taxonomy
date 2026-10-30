[![English](https://img.shields.io/badge/lang-English-blue)](./README.en-US.md) [![简体中文](https://img.shields.io/badge/lang-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-green)](./README.md)

# China K12 Curriculum Knowledge Graph (China Curriculum Taxonomy)

An open-source, structured **knowledge graph of China's K12 curriculum** (primary, middle, and high school): the curriculum is decomposed into fine-grained **knowledge points**, woven into a prerequisite DAG, and aligned to the national curriculum standards (Compulsory Education Curriculum Standards, 2022 edition; General High School Curriculum Standards, 2017 edition, revised 2020). The data model follows [Marble Skill Taxonomy (os-taxonomy)](https://github.com/withmarbleapp/os-taxonomy), with content rebuilt specifically for the Chinese curriculum.

> **Current version** `v2.4` · **Knowledge points** 1641 · **Prerequisite edges** 2272 · **Standards entries** 532 (18 curricula, codes-only) · **Lessons + exercises** 1587/1641 topics · 6348 exercises (8 of 9 subjects fully covered; History's 54 topics in progress; textbook-aligned per D-031) · **Subjects** all nine K12 subjects: Mathematics (23 volumes) / Chinese (23) / English (19) / Physics (9) / Chemistry (7) / Biology (9) / History (11) / Geography (8) / Morality & Rule of Law + Ideological & Political Education (24) — 133 semester-volumes in total, based on the state-unified and PEP textbook series. Granularity: lesson-element level for Math/Chinese; unit sentence-patterns & skills line for English; section-level core concepts for the sciences; Ideological & Political Education deepened to lesson level and elective History to unit level; Geography and Morality & Rule of Law remain unit-level knowledge points (deepening in progress).

## What is this

Using the state-unified / PEP textbook structure as the skeleton, each unit is decomposed into teachable, assessable knowledge points (lesson-element level for Math/Chinese; unit-level knowledge points and core abilities for other subjects). All nine subjects across K12 — 133 semester-volumes — are covered. Every knowledge point includes:

- **Plain-language description** — a paragraph parents can understand: what this knowledge point covers and why it matters;
- **Mastery evidence (`evidence`)** — observable behavioral criteria for judging whether a child has really learned it;
- **Assessment prompt (`assessmentPrompt`)** — a ready-to-ask oral assessment question (`{{name}}` is a placeholder for the child's name);
- **Standards alignment** — corresponding curriculum-standard codes (Compulsory Education 2022 edition, S1–S4; High School 2017 edition〔2020 revision〕, H prefix; one set per subject, all codes-only);
- **Textbook location** — grade (1–6 primary / 7–9 middle / 10–12 high school), semester, textbook edition, and unit;
- **Prerequisites** — what must / should be learned first, each edge carrying a one-sentence rationale;
- **Learning content (8 of 9 subjects fully covered; History in progress)** — lesson explanations, method steps, worked examples with analysis, common-mistake notes, and tiered exercises (textbook exercises first, each traceable to volume·page) (`data/lessons/`, one file per subject: 1587/1641 knowledge points with full lessons + 6348 exercises, textbook-aligned per D-031; History's 54 topics underway).

### Knowledge point example

> **Terminology note**: user-facing materials always say "knowledge point". The `topic` field name and the `ct_` id prefix (`topics.json`, `topicId`, `topicCount`) are the concept's frozen machine names — kept unchanged to avoid breaking downstream integrations. "Micro-topic" in early docs and the CHANGELOG is a legacy name for the same concept.

```json
{
  "id": "ct_g1a_22",
  "type": "PROCEDURAL",
  "subject": "数学",
  "domain": "数与代数",
  "name": "凑十法：9 加几",
  "description": "学习 20 以内进位加法的核心方法「凑十法」……",
  "grade": 1, "semester": "上",
  "evidence": ["能边摆小棒边说清 9+4 的凑十过程", "能脱离实物口算 9 加几"],
  "standards": ["csmath-2022:S1.NA.NO.06"],
  "textbook": { "publisher": "人教版", "grade": 1, "volume": "上", "unit": 8, "editionYear": 2022 }
}
```

(Field values such as subject and domain names are in Chinese — they are the shipped data itself.)

### Prerequisite example

```json
{ "topicId": "ct_g1b_03", "prerequisiteId": "ct_g1a_24", "strength": "hard",
  "reason": "退位减法的主算法「想加算减」依赖 20 以内进位加法熟练" }
```

`topicId` **depends on** `prerequisiteId` (learn the prerequisite first, then the topic itself); reversing every edge yields the "unlocks" view.

## Repository layout

```
data/
  topics.json                # Knowledge points (graph nodes)
  dependencies.json          # Prerequisite edges (graph edges)
  curriculum-standards.json  # Standards entries (codes-only)
  lessons/                   # Learning-content layer (one file per subject; 8 of 9 covered; History pending)
  manifest.json              # Counts and SHA-256 checksums
schema/                      # JSON Schemas for the files above
scripts/
  validate.mjs               # Zero-dependency integrity validation (incl. DAG cycle detection)
  build-manifest.mjs         # Regenerates the manifest, injects the prerequisites denormalization
  apply-batch.mjs            # Batch merge tool (merge → manifest → validate in one step)
  report.mjs                 # Quality report (orphans / coverage / inverted edges, TOOL-2)
  dev.mjs                    # Local dev server (static hosting + read-only API)
  fetch-textbooks.py         # Downloads textbook PDFs from the ChinaTextbook repo (local verification only)
textbooks/                   # Textbook PDFs (.gitignore, never committed)
```

## Usage

Pure data with zero dependencies — just load the JSON:

```js
import topics from './data/topics.json' with { type: 'json' };
import deps from './data/dependencies.json' with { type: 'json' };

const byId = new Map(topics.topics.map(t => [t.id, t]));

// What must a child master before "凑十法：9 加几" (make-ten addition)?
const prereqs = deps.dependencies
  .filter(d => d.topicId === 'ct_g1a_22')
  .map(d => ({ name: byId.get(d.prerequisiteId).name, strength: d.strength }));

// Conversely: what does mastering "10 以内加减法" unlock?
const unlocks = deps.dependencies
  .filter(d => d.prerequisiteId === 'ct_g1a_14')
  .map(d => byId.get(d.topicId).name);
```

Validate data integrity (structure, references, DAG, checksums):

```bash
npm run validate
```

After changing data, regenerate the manifest (maintains each topic's denormalized `prerequisites` field and the checksums automatically):

```bash
npm run manifest && npm run validate
```

## Online viewer

A zero-build static graph browser, deployed on GitHub Pages:

> **https://8bitkevin.github.io/china-curriculum-taxonomy/viewer/**

Features:

- **Graph browsing**: knowledge points grouped by volume (with in/out degree), grade/domain filters + search; click any knowledge point to see mastery evidence, the assessment prompt (child name customizable), standards alignment, and the **learning path map** — an interactive dependency graph centered on the current point (Canvas DAG, zero dependencies): prerequisites on the left, unlocks on the right, edges read left-to-right as learning order (required = solid, beneficial = dashed; hover highlights lineage, click shows each edge's rationale, double-click jumps to the topic); large trees expand progressively via "+1 level / expand all"; the former text-only **prerequisite chain / unlock tree** is kept as a collapsible list view (good for copying and screen readers); `#id=ct_…` deep links are shareable.
- **Learning-content drawer**: from any knowledge point (path-map card, detail page, or 3D card), an in-page right drawer opens with: one-sentence summary, plain-language explanation, method steps (with mnemonics), worked examples (try first — solutions and mistakes collapsed by default), and common-mistake notes. Content loads per subject file (8 of 9 subjects covered; History under construction — uncovered subjects show an empty state with contribution guidance); `#lesson=ct_…` deep links are shareable; data lazy-loads per subject (`data/lessons/{subject}.json`).
- **3D panorama**: a three.js WebGL (locally vendored, zero-build) deep-space galaxy view — grades grow upward along the vertical axis while nine subjects spiral as color-mixed vines; inertial drag to rotate, wheel to zoom, search to fly-and-focus; selecting a knowledge point makes its prerequisite closure glow orange in layers, its unlock closure glow cyan, and everything else dim, with Chinese labels appearing on path nodes (visual paradigm modeled on [Marble curriculum](https://withmarble.com/curriculum/), code original).
- **Quality self-check**: metric cards for orphan topics, assessment-prompt/standards coverage, cross-grade inverted edges, etc. (same definitions as `npm run report`) for maintainers to compare before/after batch merges.

Local development (recommended `npm run dev`):

```bash
npm run dev                # http://127.0.0.1:8787/viewer/ (Ctrl+C to stop)
```

The dev server (`scripts/dev.mjs`, zero-dependency) starts the whole environment with one command: static hosting of the entire repo (`Cache-Control: no-store`, refresh to see changes; `data/*.json` hot-cached by mtime) plus a read-only API consistent with the viewer's definitions (CORS wide open): `/api/summary`, `/api/topics?subject=数学&grade=1&q=凑十`, `/api/topic/ct_g1a_22` (with prerequisite/unlock trees), `/api/standards?code=S1.NA.NO.06`.

Without Node, any static file server works:

```bash
python -m http.server 8931
# open http://127.0.0.1:8931/viewer/
```

## ID and code conventions

- **Knowledge point id**: `ct_{subject-code}_g{grade}{a|b}_{seq}`. Mathematics was built first and carries no subject-code prefix (`ct_g1a_22` = 22nd knowledge point of Grade 1, fall semester); other subjects use pinyin initials: Chinese `yw`, English `yy`, Physics `wl`, Chemistry `hx`, Biology `sw`, History `ls`, Geography `dl`, Morality & Rule of Law / Ideological & Political Education `zz` (e.g. `ct_yw_g2a_03`, `ct_ls_g8a_03`). `a` = fall semester, `b` = spring semester; sequence numbers increase within a volume. Grades use 1–12 uniformly: 1–6 primary, 7–9 middle school (7 = Grade 7), 10–12 high school (10 = Grade 10).
- **Standards codes**: this repo's own stable codes (the official standards carry no item numbers), formatted `S{stage}.{domain}.{subdomain}.{seq}` (compulsory education grades 1–9; S1–S4 are the four stages) or `H{volume}.{domain}.{seq}` (high school; H1–H5 are the five PEP A-version math volumes, stage=5), e.g. `S1.NA.NO.06` = Stage 1 · Numbers & Algebra · Numbers & Operations · item 6. Domain codes: `NA` Numbers & Algebra, `GS` Geometry, `SP` Statistics & Probability, `IP` Integrated Practice. See the `codeScheme` in `data/curriculum-standards.json` for details.

## Textbook baseline

`scripts/fetch-textbooks.py` downloads textbook PDFs on demand from [ChinaTextbook](https://github.com/8bitkevin/ChinaTextbook) (a fork of [TapXWorld/ChinaTextbook](https://github.com/TapXWorld/ChinaTextbook)) into `textbooks/` (gitignored, never committed). One repo-tree API call matches everything (set the `GITHUB_TOKEN` env var for higher API limits), and the script automatically reassembles the upstream 35MB shards used for files over 50MB (`foo.pdf.1/.2…`, per the upstream README convention). Local names carry a stage prefix: primary school unprefixed, middle school `初中{subject}…`, high school `高中{subject}…`. One mainstream edition is selected per stage-subject:

**Primary school**

| Subject | Edition | Volumes |
|---|---|---:|
| Mathematics | PEP (2022 standards edition) | 12 (grades 1–6, fall/spring) |
| Chinese | State-unified (nationwide, sole edition) | 12 (grades 1–6, fall/spring) |
| Morality & Rule of Law | State-unified (nationwide, sole edition) | 12 (grades 1–6, fall/spring) |
| English | PEP (PEP Start from Grade 3) | 8 (grades 3–6, fall/spring) |
| Science | Educational Science Press | 12 (grades 1–6, fall/spring) |
| Music | PEP (numbered notation) | 12 (grades 1–6, fall/spring) |
| Art | PEP | 12 (grades 1–6, fall/spring) |
| Physical Education & Health | PEP | 3 (combined volumes for 1–2 / 3–4 / 5–6) |

**Middle school** (grades 7–9, all starting from Grade 7; Physics starts in Grade 8, Chemistry in Grade 9)

| Subject | Edition | Volumes |
|---|---|---:|
| Mathematics | PEP | 6 (grades 7–9, fall/spring) |
| Chinese | State-unified | 6 |
| English | PEP (New Goal) | 5 (grades 7–8 fall/spring + grade 9 combined) |
| Physics | PEP | 3 (grade 8 fall/spring + grade 9 combined) |
| Chemistry | PEP | 2 (grade 9) |
| Biology | PEP | 4 (grades 7–8) |
| History / Morality & Rule of Law | State-unified | 6 each |
| Geography | PEP | 4 (grades 7–8) |

**High school** (grades 10–12, 2019 standards edition; math edition settled on PEP A-version, see [DECISIONS](docs/DECISIONS.md) D-012)

| Subject | Edition | Volumes |
|---|---|---:|
| Mathematics | PEP A-version | 5 (compulsory 1–2 + elective 1–3; compulsory vol. 1 is sharded upstream, reassembled on download) |
| Chinese / History | State-unified | 5 / 5 (Chinese: compulsory 上下 + elective 上中下; History: Outlines 上下 + elective 1–3) |
| Ideological & Political Education | State-unified | 7 (compulsory 1–4 + elective 1–3) |
| English | PEP | 7 (compulsory 1–3 + elective 1–4) |
| Physics | PEP | 6 (compulsory 1–3 + elective 1–3) |
| Chemistry / Biology / Geography | PEP | 5 each (2 compulsory + 3 elective) |

The upstream repo also carries other regional editions (Beijing Normal, Jiangsu Education, Foreign Language Teaching & Research, etc.) plus "Arts" and "Calligraphy Practice", about 43 GB in total; this repo does not download them — they will be added as needed for multi-edition alignment (see roadmap).

## Data sources & copyright (important)

- **Textbooks**: unit structure is organized from PEP / state-unified textbooks (2022 standards editions, etc.). Textbook PDF files (full e-books) are neither included nor distributed; copyright belongs to People's Education Press and other publishers. The `textbooks/` directory is gitignored and for local verification only. Principles for including textbook *content* (exercises, original texts/passages): see the next item and D-031/D-032.
- **Curriculum standards**: standards entries use a **codes-only** strategy — only self-built codes and concise self-written titles are stored, no original standards text. Compulsory education (grades 1–9) follows the Compulsory Education Curriculum Standards (2022 edition) ([official MOE release](http://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html)); high school (grades 10–12) follows the General High School Curriculum Standards (2017 edition, 2020 revision).
- **This graph's original content** (knowledge-point names/descriptions/evidence/assessment prompts, dependency rationales, and the written parts of lessons & exercises) is released under **CC BY-SA 4.0** — attribution and share-alike required. **Included textbook content** (D-031/D-032): lessons and exercises align with PEP / state-unified textbooks, covering each unit's core knowledge; textbook exercises are preferred, and original passages/texts (Chinese/English) may be quoted or included directly, each annotated with volume·page for verification. Rights to that textbook content remain with People's Education Press and other copyright holders and original authors; this repo compiles from the original textbooks and does not alter their ownership.

## Roadmap

**Mathematics (first subject, K12 end-to-end)**

- [x] Grades 1–2 (Stage 1) ✅ v0.1
- [x] Grades 3–6 (Stages 2–3) ✅ 2026-10-21
- [x] Middle school 7–9 (Stage 4) ✅ 2026-10-21
- [x] High school 10–12 (compulsory/elective) ✅ 2026-10-21 → **Math K12 complete = v1.0.0**

**Other subjects (after Math v1.0)**

- [x] Chinese, English (K12) ✅ 2026-10-21
- [x] Physics, Chemistry (middle school up), Biology, History, Geography, Morality & Rule of Law / Ideological & Political Education ✅ 2026-10-21 (all nine K12 → **v2.0.0**)
- [x] Learning-content layer (lessons + exercises, textbook-aligned per D-031): Math 563 topics ✅ 2026-10-28; English/Chinese/Physics/Chemistry/Biology/Geography/Morality/Ideological & Political ✅ 2026-10-30 (1587/1641)
- [ ] Learning-content wrap-up: History's 54 topics (lessons + exercises)
- [ ] Domain × grade cluster summaries (parent edition)
- [ ] Evidence/research layer matching os-taxonomy (teaching research)

## Acknowledgments

- Data model and validation script design reference [Marble Skill Taxonomy](https://github.com/withmarbleapp/os-taxonomy) (ODbL 1.0).
- Textbook resources come from the open-source community project [TapXWorld/ChinaTextbook](https://github.com/TapXWorld/ChinaTextbook).
