# 更新日志

本项目的**数据版本**（`data/*.json` 的 `version` 字段）与**破坏性变更**遵循[语义化版本](https://semver.org/lang/zh-CN/)精神：

- 新增主题/边/课标条目、扩充描述 → **次版本**（v0.2、v0.3…，1.0 首个稳定版）
- 修改 schema 结构（字段增删、枚举变化）→ 升 `schemaVersion` 并在本文档标注 **BREAKING**
- 已发布主题的 `id` 永不修改、永不复用；废弃主题移入 `data/deprecated.json` 而非删除

## [Unreleased]

### M2 viewer MVP 完成（2026-10-20）

- **VIEW-1/2/3 全部落地**：`viewer/` 零构建静态图谱浏览器（D-007），已部署 GitHub Pages：<https://8bitkevin.github.io/china-curriculum-taxonomy/viewer/>
- 图谱浏览：按册分组列表（入度/出度徽章）、年级/领域过滤、搜索、`#id=` 深链；详情含完整先修链/解锁树（每条边附「必需/有益」与理由）、掌握证据、测评问法（孩子姓名自定义替换 `{{name}}`）、课标对齐与教材锚点
- 质量自查页签：指标卡与清单，口径与 `scripts/report.mjs` 一致
- `viewer/logic.js` 纯逻辑层与渲染分离：Node 测试 7 个（环防御、菱形去重、指标口径、过滤、占位符替换），总测试 16 个
- 三个用户故事（家长查卡点 / 开发者浏览子图 / 维护者自查）经真实浏览器逐条验证通过

### M1 质量地基完成（2026-10-20）

- **决策拍板**：D-009 远端仓库（GitHub 公开 `8bitkevin/china-curriculum-taxonomy`）、D-012 高中教材人教 A 版、D-006 教材跟版策略——`textbook.editionYear` 必填字段落地，v0.1 全量标注 2022（2022 课标版印次）
- **TOOL-1 教材基线留档**：`scripts/extract-toc.py`（目录页文本 + 坐标聚类重建）+ `docs/textbook-units/` 数学 23 册单元基线（17 册 PDF 自动提取、6 册扫描版人工基线 `source=manual`，含 PDF SHA-256，`--check` 可复核）
- **TOOL-2 质量报告**：`scripts/report.mjs`——分册/领域/类型分布、边密度、孤岛、assessmentPrompt/课标引用覆盖率、跨年级倒挂边；当前指标全绿
- **DATA-4 废弃主题机制**：`data/deprecated.json` + schema + validate 强制（被废弃 id 不得残留任何引用；replacedBy 必须存活）；负例测试 +2（共 9 个）
- **TOOL-3 CI 与分支保护**：GitHub Actions（validate + test + 报告生成，首跑全绿）；main 保护（required check `validate` + linear history，禁 force push）
- **数据修复**：一年级上「左、右 → 上、下、前、后」补 hard 边，孤岛主题 2 → 0（M1 退出条件达成）
- 新增 [CITATION.cff](CITATION.cff) 学术引用文件

### 变更：项目定位升级为 K12 全学段覆盖（决策 D-011）

覆盖范围从「小学」扩展为「小学 1–6 / 初中 7–9 / 高中 10–12」。现有 1–2 年级数据不受影响。

- `schema/topics.schema.json`：`grade` 上限 6 → 12，`ageRangeStart/End` 上限 18 → 20（向后兼容）
- v1.0 锚点从「全小学数学」改为「数学 K12 全线」；DEV-PLAN 里程碑重排（M3–M4 小学 3–6 年级、M5 初中、M6 高中），新增高中课标条目体系规划（`H` 前缀）与跨学段衔接链验收
- README：定位与 id/课标代码说明更新，教材版本基线表补初中/高中版本
- `scripts/fetch-textbooks.py` 升级为 K12 下载器：一次性拉取远端树、小学/初中/高中三套选版匹配（小学 8 科 / 初中 9 科 / 高中 9 科）、>50MB 分片自动拼接、体育合册与历史册名归一
- 新增待定决策 D-012（高中数学教材 A 版 vs B 版）

### 文档

- 新增 [docs/DEV-PLAN.md](docs/DEV-PLAN.md)：开发需求与计划（三条产品线 / 里程碑 / v1.0 发布标准 / 风险与度量）
- 新增 [docs/DECISIONS.md](docs/DECISIONS.md)：轻量决策记录（已定 D-001~D-008、D-011；待定 D-006 教材跟版、D-009 远端仓库、D-010 产品化方向、D-012 高中教材版本）


## [0.1.0] - 2026-10-20

### 首个版本：第一学段（1–2 年级）数学

- **83 个微主题**（一上 24 / 一下 20 / 二上 22 / 二下 17），以人教版《义务教育教科书·数学》（2022 课标版）单元结构为骨架
- **107 条先修依赖边**（DAG），每条含 hard/soft 强度与理由
- **27 条课标条目**：对齐《义务教育数学课程标准（2022 年版）》第一学段，自建代码体系（`S{学段}.{领域}.{子领域}.{序号}`），codes-only 策略
- 工程基础：JSON Schema、零依赖验证器（引用完整性 / DAG 无环 / 课标 codes-only 不变量 / manifest SHA-256 校验和 / prerequisites 冗余字段一致性）、manifest 构建器、教材 PDF 下载脚本
- 12 册人教版小学数学教材 PDF 已就位于本地 `textbooks/`（不入库），目录文本已核对
