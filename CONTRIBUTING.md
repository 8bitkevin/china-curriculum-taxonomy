# 贡献指南

本仓库的核心资产是**数据**，代码只是围绕数据的校验与构建工具。贡献以数据为主，流程设计围绕「数据改动可审、可回溯、可验证」。

## 分支与提交

- 从 `main` 切出特性分支：`feat/math-grade3`、`fix/deps-g2a`、`docs/roadmap` 等
- 提交信息用约定式提交：`feat(scope): 说明` / `fix(scope): 说明` / `docs: …` / `chore: …`
  - scope 建议：`data`（数据内容）、`deps`（依赖边）、`standards`（课标对齐）、`tooling`（脚本）、`schema`（结构变更，慎重）
- 一次 PR 只做一类变更（例如「新增三年级上册微主题」与「修订二年级依赖边」分开提）

## 数据改动的标准流程

任何改动 `data/` 的 PR 必须按此顺序，CI 会强制校验：

```bash
# 1. 修改 data/topics.json / dependencies.json / curriculum-standards.json
# 2. 重新生成 manifest（自动维护 prerequisites 冗余字段与校验和）
npm run manifest
# 3. 本地验证必须全绿再提交
npm run validate && npm test
```

> 忘记跑 `npm run manifest` 时，validate 会报「校验和不匹配」并提示。

## 新增一批微主题（例如一个新学期）的检查清单

1. **教材核对**：`python scripts/fetch-textbooks.py` 下载对应教材，用 `--toc` 提取目录，逐单元核对；
2. **id 分配**：`ct_g{年级}{a|b}_{序号}`，新学期从 `01` 重新编号；id 一经合入 `main` 即冻结，不可复用；
3. **字段完整**：每个主题必须有通俗 `description`、≥1 条 `evidence`、带 `{{name}}` 的 `assessmentPrompt`、课标 `standards`（不确定时宁可留空数组并在 PR 里说明）、`textbook` 定位；
4. **依赖边**：新主题至少考虑一条入边（它建立在什么之上）；跨学期的纵向链（如「凑十法 → 两位数进位口算 → 竖式进位」）是本数据集的核心价值，优先补全；
5. **课标对齐**：新学段需要新条目时，先在 `curriculum-standards.json` 增补条目（自拟短标题，禁止抄课标原文），再在主题里引用；
6. **自检**：`npm run validate` 全绿；抽查 3–5 个新主题的 description/assessmentPrompt 通读是否家长可读。

## 质量红线

- ❌ 不复制教材原文、课标原文（codes-only）
- ❌ 不提交任何教材 PDF / 扫描件（`textbooks/` 已 gitignore）
- ❌ 不引入新的运行时依赖（校验工具保持零依赖 Node ≥ 20）
- ❌ 不手工编辑 `data/manifest.json`（由 `npm run manifest` 生成）
- ❌ 不修改已发布的 `schemaVersion` 兼容语义（结构变更需先在 ISSUE/PR 讨论并升版本号）

## AI 生成数据的复核约定

本数据集的主题内容为 AI 辅助生成，合并前的最低复核要求：

- 每批（一册教材）至少人工通读 20% 主题的 `description` 与 `assessmentPrompt`；
- 重点复核三类高风险内容：**依赖边的教学法正确性**、**evidence 的可观察性**（家长能照着判断）、**与教材单元的对应关系**；
- 发现系统性偏差（如描述口吻不一致、证据太抽象）应整批返工，不逐条打补丁。
