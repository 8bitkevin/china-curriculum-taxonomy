# 更新日志

本项目的**数据版本**（`data/*.json` 的 `version` 字段）与**破坏性变更**遵循[语义化版本](https://semver.org/lang/zh-CN/)精神：

- 新增主题/边/课标条目、扩充描述 → **次版本**（v0.2、v0.3…，1.0 首个稳定版）
- 修改 schema 结构（字段增删、枚举变化）→ 升 `schemaVersion` 并在本文档标注 **BREAKING**
- 已发布主题的 `id` 永不修改、永不复用；废弃主题移入 `data/deprecated.json` 而非删除

## [Unreleased]

### M3 + M4 完成：小学数学 3–6 年级全线入库（2026-10-21）

- **8 册 227 个微主题 + 403 条先修边**（三上 32 / 三下 28 / 四上 30 / 四下 31 / 五上 26 / 五下 26 / 六上 27 / 六下 27），累计 **310 主题 / 511 边**，v0.10.0
- **课标全量补齐**：csmath-2022 补 S2/S3/S4 共 98 条、新增普通高中课标 hsmath-2017（H{册} 前缀，stage=5）54 条，课标条目累计 180，codes-only 不变量保持
- **schema 演进**（非破坏性）：`stage` 上限 4→5；`textbook` 增加可选 `book` 字段（高中册名）；validate 增加高中 book 受控校验
- **新增批次工具** `scripts/apply-batch.mjs`：片段合并 → manifest 重建 → validate 一键落库（D-008 流程机械化）
- 版次拍板（D-014）：小学 3–6 年级 editionYear=2022（2022 年 8 月第 2 版）；初中=2012、高中=2019 待后续批次落地，见 [docs/DATA-BACKFILL-PLAN.md](docs/DATA-BACKFILL-PLAN.md)
- 机器校验全绿（孤岛 0 / assessmentPrompt 100% / 课标引用 100% / 倒挂 0）；人工抽读复核待办（CONTRIBUTING 复核约定）

### 重写：「3D 全景」升级为 three.js WebGL 渲染（决策 D-013）

对标 [withmarble.com/curriculum](https://withmarble.com/curriculum/) 的深空星系观感（其页面源码不开源，仓库仅开放数据；本实现为原创代码复刻其视觉范式）：

- `viewer/vendor/three.min.js`（r128，MIT，本地 vendor 单文件）——零构建、无 npm 依赖原则不变
- 布局改为**纺锤螺旋星系**：Y 轴 = 年级向上生长（地面年级刻度环），四大领域按方位角成四股藤蔓缓慢扭转，半径随年级张开；节点尺寸幂律分布（多数小、枢纽大）
- 深空氛围：#0a0e14 背景 + FogExp2 指数雾 + 700 颗背景星尘（两层视差）+ 极淡星尘网连线
- 交互升级：惯性拖拽旋转（速度阻尼）、闲置自转、点击后相机飞行聚焦、raycaster 拾取（深度遮挡正确）
- 选中叙事保留并增强：先修闭包橙色分层发光 + 解锁闭包青色发光 + 路径节点中文标签（屏幕投影 DOM）+ 大数字详情卡 + 脉动选中环

### 新增：「3D 全景」页签——纯手写 Canvas 伪 3D，零依赖（2026-10-20）

对标并增强 [Marble curriculum](https://withmarble.com/curriculum/) 的 3D 可视化：

- 语义化 3D 布局：X 轴 = 年级/学期推进，Z 轴 = 四大领域泳道，Y 轴 = 先修链深度（最长路径分层）；弱力导向微调避免重叠，节点大小映射连接度
- 交互：拖拽旋转 / 滚轮缩放 / 点击拾取（PointerEvent + click 双兜底）/ 搜索回车飞行定位 / Esc 取消 / 复位视角
- 点选任意主题：先修闭包按 BFS 层级渐变橙色发光、解锁闭包青色发光、其余雾化暗淡——一眼看清「为了学它，先要会什么；学好它，将来解锁什么」
- 实线 = hard 依赖、虚线 = soft 依赖；距离雾化 + 标签距离 LOD（近处全亮、远景淡出）+ 标签贪心防碰撞
- 入场逐年级浮现动画 + 闲置自动缓旋；详情卡（描述 / 先修与解锁计数）一键跳回图谱浏览并带 hash 深链
- 新增 `viewer/closure.js`（BFS 传递闭包，含环防御）及单元测试

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
