# 数据字典（Data Model）

三个核心文件 + 一个可选内容层 + 一个生成文件构成有向无环图（DAG）。权威定义见 `schema/*.schema.json`（`additionalProperties: false`，未知字段直接报错），本文解释**语义与维护约定**。

## data/topics.json — 知识点（节点）

> 术语（D-029）：面向用户一律称「知识点」；字段名 `topic*` 与 id 前缀 `ct_` 为机器名，冻结不改。历史文档中的「微主题」= 同一概念旧称。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `ct_{学科代码}_g{年级}{a\|b}_{序号}` | 多学科口径（D-016，schema v2）：学科代码 yw 语文 / yy 英语 / wl 物理 / hx 化学 / sw 生物学 / ls 历史 / dl 地理 / zz 道法与政治；**数学沿用 v1.0 无前缀历史格式**（id 冻结不改）。`a`=上学期 `b`=下学期；年级 1–6 小学、7–9 初中（7=初一）、10–12 高中（10=高一）；合入 main 后冻结，永不复用 |
| `type` | 枚举 | `CONCEPTUAL` 概念 / `PROCEDURAL` 过程技能 / `REPRESENTATIONAL` 表征（数位、钟面、统计图等符号系统）/ `LANGUAGE` 数学语言 / `META` 思维与方法（推理、有序枚举） |
| `domain` | 按学科受控枚举 | 由 validate 的 `DOMAIN_BY_SUBJECT` 按学科校验（D-016，schema v2；各科领域表见 SUBJECTS-BACKFILL-PLAN §2）。数学为 2022 课标四大领域：`数与代数` `图形与几何` `统计与概率` `综合与实践` |
| `name` | string | 知识点名，尽量沿用教材课时惯用语（如「凑十法：9 加几」） |
| `description` | string | **家长可读**的一段话：学什么 + 为什么重要；不写教学术语堆砌 |
| `grade` / `semester` | 1–12 / `上`\|`下` | K12 学制定位：1–6 小学、7–9 初中、10–12 高中 |
| `ageRangeStart` / `ageRangeEnd` | int | 按入学 6 周岁推算；validate 校验 `grade+4 ≤ start ≤ grade+6` |
| `evidence` | string[] | **可观察**的掌握证据（家长能照着判断），≥1 条 |
| `assessmentPrompt` | string\|null | 口头测评问法，必须含 `{{name}}` 占位符 |
| `standards` | string[] | `{来源}:{代码}`，指向 curriculum-standards；来源共 18 套（九科各一套，D-016）：义务教育 2022 为 `cs{学科}-2022`（数学 `csmath-2022`，代码 `S{学段}.{领域}.{子领域}.{序号}`）、高中 2017 为 `hs{学科}-2017`（数学代码 `H{册}.{领域}.{序号}`） |
| `textbook` | object | `{publisher, grade, volume, unit, editionYear}`：教材锚点；`grade/volume` 必须与知识点 `grade/semester` 一致（validate 强制）；`editionYear` 为教材版次年（如 2022 = 2022 课标版首印），跟版重校时更新（D-006） |
| `prerequisites` | string[] | **冗余字段，勿手编**：由 `npm run manifest` 从依赖边自动注入，validate 强制与 dependencies.json 一致 |

## data/dependencies.json — 先修边

| 字段 | 说明 |
|---|---|
| `topicId` / `prerequisiteId` | `topicId` **依赖** `prerequisiteId`；反转即「解锁」 |
| `strength` | `hard`：缺了学不动（如凑十法 ← 10 的组成）；`soft`：有助非必需（如图形辨认 ← 分类经验） |
| `reason` | 一句话说清**为什么**需要先学——评审依赖边质量的主要依据 |

维护约定：每个新知识点至少考虑一条入边；跨学期纵向链优先；整图必须无环（validate 用 Kahn 拓扑排序强制）。

## data/curriculum-standards.json — 课标条目

- `codesOnlySources` 含全部 18 套来源（`csmath-2022`、`cschinese-2022` … `hs{学科}-2017`）→ 这些来源的条目**不得有** `data` 字段（validate 强制，防原文泄漏）
- 条目 `title` 为**自拟概括**（如「10以内数的认识（数数、基数、读写、大小、序数）」），不是课标原文
- 代码由本仓库分配，规则见文件内 `codeScheme.description`；义务教育学段用 `S1`–`S4`（S4=初中第四学段），高中学段用 `H{册}` 前缀（另一套课标：《普通高中课程标准（2017 年版 2020 修订）》）；新增学段时先扩此文件再引用

## data/lessons/ — 学习内容层（D-030 建层 / D-031 原则修订 + 练习层，可选、渐进覆盖）

按学科一个文件：`data/lessons/{学科码}.json`（数学 math / 语文 yw / 英语 yy / 物理 wl / 化学 hx / 生物学 sw / 历史 ls / 地理 dl / 道法 zz / 思政 sxzz；码表权威在 `viewer/logic.js` `LESSON_FILE_CODE`）。未覆盖的学科可以没有文件，viewer 显示「建设中」空态。

| 字段 | 说明 |
|---|---|
| `subject` / `version` / `lessonCount` | 学科（与文件名码对应）；版本随 topics.json 走（validate 强制一致）；计数声明 |
| `lessons[].topicId` | 对应 topics.json 的知识点 id（validate 强制存在、学科匹配、不重复） |
| `lessons[].summary` | 一句话核心（抽屉顶部高亮条） |
| `lessons[].explanation` | 讲解正文，每段一个自然段，≥1 段 |
| `lessons[].methods` | 可选：`{name, steps[], tip?}` 方法步骤 |
| `lessons[].examples` | 可选：`{question, solution, difficulty(1-3), pitfall?}` 讲解性例题，**必带解答** |
| `lessons[].mistakes` | 可选：易错提醒 |
| `lessons[].source` | 可选（D-031）：`{unit, sections?, pages[起,止], alignedAt}` 教材对齐标记，unit 必须与 `topic.textbook.unit` 一致（validate 强制） |
| `lessons[].exercises` | 可选（D-031）：`{kind: textbook/variant/extension, question, options?, answer, solution, difficulty(1-3), source?{label}}` 练习题；有练习时 ≥3 题（小学低段）/ ≥4 题（其余）且教材题 ≥50%，kind=textbook/variant 必带 source.label（validate 强制） |

内容原则（D-031，修订 D-030 纯原创条款）：教材是权威与基础——讲解必须覆盖对应教材单元的核心知识（定义/法则/术语/方法与教材对齐）再通俗化加深；练习教材题优先（题型与数据保留、题干规范重写、标注册·页·题号）+ 变式 + 扩展。边界不变：教材 PDF 仅本地参考（D-004）、不整段照抄原文、课文/语篇原文（语文英语）不收录。数据懒加载：viewer 首次打开某学科知识点时才 fetch 对应文件。

## data/manifest.json — 清单（生成物，勿手编）

`npm run manifest` 生成：计数（含 `lessons` 与 `coverage.lessonCoverage`）、分册分布、各数据文件（含 `lessons/*.json`）的 `bytes` + `sha256`。任何数据改动后必须重跑，否则 validate 报校验和不匹配。

## 校验器覆盖的不变量

`npm run validate` 强制：schema 一致 / 计数一致 / id 唯一 / 边引用可解析且无自环无重复 / 全图无环 / 课标引用可解析 / codes-only / prerequisites 与边一致 / 年级↔学期↔教材↔年龄交叉一致 / assessmentPrompt 含占位符 / lessons schema+引用+学科+版本+不重复 / manifest 校验和 / lessons 练习配比与教材对齐标记（D-031）。
