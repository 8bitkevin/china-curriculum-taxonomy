# 数据字典（Data Model）

三个核心文件 + 一个生成文件构成有向无环图（DAG）。权威定义见 `schema/*.schema.json`（`additionalProperties: false`，未知字段直接报错），本文解释**语义与维护约定**。

## data/topics.json — 微主题（节点）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `ct_g{年级}{a\|b}_{序号}` | `a`=上学期 `b`=下学期；年级 1–6 小学、7–9 初中（7=初一）、10–12 高中（10=高一）；合入 main 后冻结，永不复用 |
| `type` | 枚举 | `CONCEPTUAL` 概念 / `PROCEDURAL` 过程技能 / `REPRESENTATIONAL` 表征（数位、钟面、统计图等符号系统）/ `LANGUAGE` 数学语言 / `META` 思维与方法（推理、有序枚举） |
| `domain` | 枚举 | 2022 课标四大领域：`数与代数` `图形与几何` `统计与概率` `综合与实践` |
| `name` | string | 主题名，尽量沿用教材课时惯用语（如「凑十法：9 加几」） |
| `description` | string | **家长可读**的一段话：学什么 + 为什么重要；不写教学术语堆砌 |
| `grade` / `semester` | 1–12 / `上`\|`下` | K12 学制定位：1–6 小学、7–9 初中、10–12 高中 |
| `ageRangeStart` / `ageRangeEnd` | int | 按入学 6 周岁推算；validate 校验 `grade+4 ≤ start ≤ grade+6` |
| `evidence` | string[] | **可观察**的掌握证据（家长能照着判断），≥1 条 |
| `assessmentPrompt` | string\|null | 口头测评问法，必须含 `{{name}}` 占位符 |
| `standards` | string[] | `csmath-2022:S{学段}.{领域}.{子领域}.{序号}`，指向 curriculum-standards |
| `textbook` | object | `{publisher, grade, volume, unit}`：教材锚点；`grade/volume` 必须与主题 `grade/semester` 一致（validate 强制） |
| `prerequisites` | string[] | **冗余字段，勿手编**：由 `npm run manifest` 从依赖边自动注入，validate 强制与 dependencies.json 一致 |

## data/dependencies.json — 先修边

| 字段 | 说明 |
|---|---|
| `topicId` / `prerequisiteId` | `topicId` **依赖** `prerequisiteId`；反转即「解锁」 |
| `strength` | `hard`：缺了学不动（如凑十法 ← 10 的组成）；`soft`：有助非必需（如图形辨认 ← 分类经验） |
| `reason` | 一句话说清**为什么**需要先学——评审依赖边质量的主要依据 |

维护约定：每个新主题至少考虑一条入边；跨学期纵向链优先；整图必须无环（validate 用 Kahn 拓扑排序强制）。

## data/curriculum-standards.json — 课标条目

- `codesOnlySources: ["csmath-2022"]` → 该来源条目**不得有** `data` 字段（validate 强制，防原文泄漏）
- 条目 `title` 为**自拟概括**（如「10以内数的认识（数数、基数、读写、大小、序数）」），不是课标原文
- 代码由本仓库分配，规则见文件内 `codeScheme.description`；义务教育学段用 `S1`–`S4`（S4=初中第四学段，规划中），高中学段规划为 `H{册}` 前缀（另一套课标：《普通高中课程标准（2017 年版 2020 修订）》）；新增学段时先扩此文件再引用

## data/manifest.json — 清单（生成物，勿手编）

`npm run manifest` 生成：计数、分册分布、三个数据文件的 `bytes` + `sha256`。任何数据改动后必须重跑，否则 validate 报校验和不匹配。

## 校验器覆盖的不变量

`npm run validate` 强制：schema 一致 / 计数一致 / id 唯一 / 边引用可解析且无自环无重复 / 全图无环 / 课标引用可解析 / codes-only / prerequisites 与边一致 / 年级↔学期↔教材↔年龄交叉一致 / assessmentPrompt 含占位符 / manifest 校验和。
