# 路线图

> 里程碑、需求与验收标准的权威文档是 [docs/DEV-PLAN.md](docs/DEV-PLAN.md)；已定/待定决策见 [docs/DECISIONS.md](docs/DECISIONS.md)。本文件保留技术 backlog 细目，与 DEV-PLAN 的需求编号对应。

按价值与依赖关系排序的迭代计划。每项一个 PR 或一串 PR，完成后在 CHANGELOG 记录。

## 近期（数据横向扩展）

- [ ] **数学 3–4 年级（第二学段）**：万以内加减法笔算、多位数乘一位数/两位数、除数一位数的除法、分数初步、小数初步、面积、年月日、复式统计表等（教材 PDF 已在本地）
- [ ] **数学 5–6 年级（第三学段）**：小数乘除、分数四则、比、圆、圆柱圆锥、百分数、负数、简易方程、统计与可能性
- [ ] **废弃主题机制**：`data/deprecated.json`（id、原因、替代 id），保证引用方平滑迁移

## 中期（质量与工具）

- [ ] **质量报告脚本** `scripts/report.mjs`：分册/领域/类型分布、边密度、孤岛主题（入度出度均为 0）、assessmentPrompt 覆盖率，输出 Markdown 供 PR 附带
- [ ] **目录提取正式化** `scripts/extract-toc.mjs`：从 PDF 提取结构化单元目录 JSON 存 `docs/textbook-units/`，作为「教材基线」留档（记录每册 PDF 的 SHA-256），供后续教材改版时 diff
- [ ] **CI（GitHub Actions）**：push/PR 自动跑 `npm run validate && npm test`；main 分支保护
- [ ] **负例测试扩充**：环注入、跨年级倒挂边（先修年级高于本体年级）告警等

## 远期（广度与生态）

- [ ] **语文**（拼音/识字/阅读/表达，注意与数学不同的「域」划分）、**英语**、**科学**、**道德与法治**
- [ ] **领域簇摘要** `data/clusters.json`（家长版一段话，对齐 os-taxonomy clusters）
- [ ] **教学研究层** `data/teaching-research.json`（对齐 os-taxonomy 的 research 模型）
- [ ] **多教材版本对齐**：北师大版、苏教版的单元映射（同一微主题多教材锚点）
- [ ] **交互式可视化**：3D 先修图 / 单元视图

## 关键待决策（需要明确后才能动工）

1. **教材版本基线**：2024 年秋起一年级启用新修订教材（结构与 2022 课标版略有差异）。当前基线 = 已下载的 2022 课标版 PDF。决策项：跟进新版（重做 1 年级数据）vs 保持现基线并在数据中标注教材印次。倾向：**按学期逐步跟进新版**，`textbook` 字段加 `editionYear`。
2. **远端仓库**：GitHub 仓库（建议名 `china-curriculum-taxonomy`，公开），owner 与可见性待定。
3. **许可核验**：发布 1.0 前请法律视角复核 LICENSE 分层（ODbL 数据库层 + CC BY-SA 内容层）是否与预期商用场景一致。
