# 中国 K12 课程知识图谱（China Curriculum Taxonomy）

一个开源的、结构化的中国 **K12（小学、初中、高中）知识图谱**：把课程拆解为细粒度的「微主题」，织成先修依赖图（DAG），并对齐国家课程标准（义务教育课程标准 2022 年版、普通高中课程标准 2017 年版〔2020 修订〕）。数据模型对齐 [Marble Skill Taxonomy (os-taxonomy)](https://github.com/withmarbleapp/os-taxonomy)，内容针对中国课程体系重新构建。

> **当前版本** `v2.0` · **微主题** 1592 · **先修边** 2207 · **课标条目** 532（18 套，codes-only）· **学科** 九科 K12 全学段：数学（23 册）/ 语文（23）/ 英语（20）/ 物理（8）/ 化学（7）/ 生物学（9）/ 历史（11）/ 地理（9）/ 道德与法治·思想政治（25），共 111 册，统编版与人教系教材

## 这是什么

以统编版/人教系教材结构为骨架，将每个单元拆解为可教、可测的微主题（数学/语文为逐课要素级，其他学科为单元主题与核心能力级），九科 K12 全学段 111 册已全覆盖。每个微主题包含：

- **通俗描述** — 家长能看懂的一段话，说明这个主题学什么、为什么重要；
- **掌握证据（evidence）** — 可观察的行为标准，判断孩子是否真的学会；
- **测评问法（assessmentPrompt）** — 一道可直接照着问的口头测评（`{{name}}` 为孩子姓名占位符）；
- **课标对齐** — 对应课标条目代码（义务教育 2022 版 S1–S4；高中 2017 版〔2020 修订〕H 前缀；九科各一套，均 codes-only）；
- **教材定位** — 年级（1–6 小学 / 7–9 初中 / 10–12 高中）、学期、教材版本、所属单元；
- **先修关系** — 学它之前必须/最好先学什么，每条边附一句话理由。

### 微主题示例

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

### 先修依赖示例

```json
{ "topicId": "ct_g1b_03", "prerequisiteId": "ct_g1a_24", "strength": "hard",
  "reason": "退位减法的主算法「想加算减」依赖 20 以内进位加法熟练" }
```

`topicId` **依赖** `prerequisiteId`（先学先修，再学本体）；反转边即得「解锁」方向。

## 目录结构

```
data/
  topics.json                # 微主题（图的节点）
  dependencies.json          # 先修依赖（图的边）
  curriculum-standards.json  # 2022 版课标条目（codes-only）
  manifest.json              # 计数与 SHA-256 校验和
schema/                      # 上述文件的 JSON Schema
scripts/
  validate.mjs               # 零依赖完整性校验（含 DAG 无环检测）
  build-manifest.mjs         # 生成 manifest、注入 prerequisites 冗余字段
  apply-batch.mjs            # 数据批次合并工具（合并→manifest→validate 一键落库）
  report.mjs                 # 质量报告（孤岛/覆盖率/倒挂边，TOOL-2）
  fetch-textbooks.py         # 从 ChinaTextbook 仓库下载教材 PDF（本地校验用）
textbooks/                   # 教材 PDF（.gitignore，不入库）
```

## 使用

纯数据，无任何依赖，加载 JSON 即可：

```js
import topics from './data/topics.json' with { type: 'json' };
import deps from './data/dependencies.json' with { type: 'json' };

const byId = new Map(topics.topics.map(t => [t.id, t]));

// 「凑十法：9 加几」之前孩子需要先掌握什么？
const prereqs = deps.dependencies
  .filter(d => d.topicId === 'ct_g1a_22')
  .map(d => ({ name: byId.get(d.prerequisiteId).name, strength: d.strength }));

// 反过来：学好「10 以内加减法」能解锁什么？
const unlocks = deps.dependencies
  .filter(d => d.prerequisiteId === 'ct_g1a_14')
  .map(d => byId.get(d.topicId).name);
```

校验数据完整性（结构、引用、DAG、校验和）：

```bash
npm run validate
```

修改数据后重新生成 manifest（会自动维护每个主题的 `prerequisites` 冗余字段与校验和）：

```bash
npm run manifest && npm run validate
```

## 在线浏览（viewer）

零构建静态图谱浏览器，已部署在 GitHub Pages：

> **https://8bitkevin.github.io/china-curriculum-taxonomy/viewer/**

功能：

- **图谱浏览**：按册分组的主题列表（含入度/出度），年级/领域过滤 + 搜索；点击任一主题查看完整**先修链**（每条边附「必需/有益」与理由）与**解锁树**、掌握证据、测评问法（可自定义孩子姓名）、课标对齐；`#id=ct_…` 深链可直接分享定位。
- **相关真题**：高中数学主题详情页展示挂靠真题（来自公开题库仓 [china-curriculum-questions](https://github.com/8bitkevin/china-curriculum-questions)，GAOKAO-Bench 数学 2010–2022，Apache-2.0），可展开作答——单选本地判定、填空宽松比对、解答对照自评，公式 LaTeX 实时渲染（CDN 不可用时降级纯文本）；打标覆盖随题库仓推进。
- **3D 全景**：three.js WebGL（本地 vendor，零构建）渲染的深空星系视图——年级沿竖轴向上生长、四大领域成四股螺旋藤蔓；惯性拖拽旋转、滚轮缩放、搜索飞行定位；点选主题后先修闭包橙色分层发光、解锁闭包青色发光、其余暗淡，路径节点浮现中文标签（视觉范式对标 [Marble curriculum](https://withmarble.com/curriculum/)，代码原创）。
- **质量自查**：孤岛主题、测评问法/课标引用覆盖率、跨年级倒挂边等指标卡（口径与 `npm run report` 一致），供维护者批次合入前后对照。

本地运行（零构建，任一静态服务器）：

```bash
python -m http.server 8931
# 打开 http://127.0.0.1:8931/viewer/
```

## id 与代码规则

- **微主题 id**：`ct_g{年级}{a|b}_{序号}`，如 `ct_g1a_22` = 一年级上册第 22 个主题；`a`=上学期，`b`=下学期。年级统一用 1–12：1–6 小学、7–9 初中（7=初一）、10–12 高中（10=高一）。
- **课标代码**：本仓库自建的稳定代码（官方课标无条目编号），格式 `S{学段}.{领域}.{子领域}.{序号}`（义务教育 1–9 年级，S1–S4 对应四个学段）或 `H{册}.{领域}.{序号}`（高中，H1–H5 对应人教 A 版五册，stage=5），如 `S1.NA.NO.06` = 第一学段·数与代数·数与运算·第 6 条。领域代码：`NA` 数与代数、`GS` 图形与几何、`SP` 统计与概率、`IP` 综合与实践。详见 `data/curriculum-standards.json` 的 `codeScheme`。

## 教材版本基线

`scripts/fetch-textbooks.py` 从 [ChinaTextbook](https://github.com/8bitkevin/ChinaTextbook)（[TapXWorld/ChinaTextbook](https://github.com/TapXWorld/ChinaTextbook) 的 fork）按需下载教材 PDF 到 `textbooks/`（gitignore，不入库）。脚本一次仓库树接口调用完成全部匹配（可用 `GITHUB_TOKEN` 环境变量提升 API 限额），并自动按序拼接上游对超过 50MB 文件的 35MB 分片（`foo.pdf.1/.2…`，上游 README 约定）。本地命名带学段前缀：小学无前缀、初中 `初中{学科}…`、高中 `高中{学科}…`。每个学段学科选定一个主流版本：

**小学**

| 学科 | 版本 | 册数 |
|---|---|---:|
| 数学 | 人教版（2022 课标版） | 12（1–6 年级上/下） |
| 语文 | 统编版（全国统一，唯一版本） | 12（1–6 年级上/下） |
| 道德与法治 | 统编版（全国统一，唯一版本） | 12（1–6 年级上/下） |
| 英语 | 人教版（PEP）（三年级起点） | 8（3–6 年级上/下） |
| 科学 | 教科版 | 12（1–6 年级上/下） |
| 音乐 | 人教版（简谱） | 12（1–6 年级上/下） |
| 美术 | 人教版 | 12（1–6 年级上/下） |
| 体育与健康 | 人教版 | 3（1–2 / 3–4 / 5–6 全一册） |

**初中**（7–9 年级，全部从七年级起；物理八年级起、化学九年级起）

| 学科 | 版本 | 册数 |
|---|---|---:|
| 数学 | 人教版 | 6（7–9 年级上/下） |
| 语文 | 统编版 | 6 |
| 英语 | 人教版（新目标） | 5（7–8 年级上/下 + 9 年级全一册） |
| 物理 | 人教版 | 3（8 年级上/下 + 9 年级全一册） |
| 化学 | 人教版 | 2（9 年级） |
| 生物学 | 人教版 | 4（7–8 年级） |
| 历史 / 道德与法治 | 统编版 | 各 6 |
| 地理 | 人教版 | 4（7–8 年级） |

**高中**（10–12 年级，2019 课标版；数学版本已拍板人教 A 版，见 [DECISIONS](docs/DECISIONS.md) D-012）

| 学科 | 版本 | 册数 |
|---|---|---:|
| 数学 | 人教 A 版 | 5（必修一二 + 选择性必修一二三；必修第一册远端为分片，下载时自动拼接） |
| 语文 / 历史 | 统编版 | 5 / 5（语文：必修上下 + 选必上中下；历史：纲要上下 + 选必一二三） |
| 思想政治 | 统编版 | 7（必修 1–4 + 选必 1–3） |
| 英语 | 人教版 | 7（必修一二三 + 选必一二三四） |
| 物理 | 人教版 | 6（必修一二三 + 选必一二三） |
| 化学 / 生物学 / 地理 | 人教版 | 各 5（必修二册 + 选必三册） |

远端仓库还有其他地区版本（北师大版、苏教版、外研社版等）以及「艺术」「书法练习指导」等，全量约 43 GB，本仓库不下载；后续做多版本对齐（见路线图）时再按需补充。

## 数据来源与版权（重要）

- **教材**：单元结构以人教版/统编版教材（2022 课标版等）为骨架整理。教材 PDF 版权属于人民教育出版社等出版社，本仓库**不收录、不再分发**任何教材内容；`textbooks/` 目录已被 gitignore，仅供本地目录核对。
- **课标**：课程标准条目采用 **codes-only** 策略——只存自建代码与自拟极简标题，不收录课标原文。义务教育学段（1–9 年级）以《义务教育课程标准（2022 年版）》为准（[教育部官方发布](http://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html)）；高中学段（10–12 年级）以《普通高中课程标准（2017 年版 2020 修订）》为准。
- **本图谱数据**（微主题名称/描述/证据/测评问法、依赖理由等原创内容）：以 CC BY-SA 4.0 发布，转载需署名并相同方式共享。

## 规划路线

**数学（首个学科，纵向打通 K12）**

- [x] 1–2 年级（第一学段）✅ v0.1
- [x] 3–6 年级（第二、三学段）✅ 2026-10-21
- [x] 初中 7–9 年级（第四学段：实数与代数式、方程与函数、几何证明、统计概率）✅ 2026-10-21
- [x] 高中 10–12 年级（必修/选择性必修：函数、导数、立体几何、解析几何、概率统计）✅ 2026-10-21 → **数学 K12 全线 = v1.0.0**

**其他学科横向铺开（数学 v1.0 之后）**

- [ ] 语文、英语（K12 全学段）
- [ ] 物理、化学（初中起）、生物、历史、地理、道德与法治/思想政治
- [ ] 领域×年级簇摘要（家长版）
- [ ] 与 os-taxonomy 相同的证据/研究层（teaching research）

## 致谢

- 数据模型与验证脚本设计参考 [Marble Skill Taxonomy](https://github.com/withmarbleapp/os-taxonomy)（ODbL 1.0）。
- 教材资源来自开源社区项目 [TapXWorld/ChinaTextbook](https://github.com/TapXWorld/ChinaTextbook)。
