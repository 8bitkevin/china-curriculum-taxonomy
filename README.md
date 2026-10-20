# 中国小学课程知识图谱（China Curriculum Taxonomy）

一个开源的、结构化的中国小学**知识图谱**：把课程拆解为细粒度的「微主题」，织成先修依赖图（DAG），并对齐《义务教育数学课程标准（2022 年版）》。数据模型对齐 [Marble Skill Taxonomy (os-taxonomy)](https://github.com/withmarbleapp/os-taxonomy)，内容针对中国课程体系重新构建。

> **当前版本** `v0.1` · **微主题** 83 · **先修边** 107 · **课标条目** 27 · **学科** 数学（1–2 年级，人教版）

## 这是什么

以人教版《义务教育教科书·数学》教材结构为骨架，将每个单元拆解为 2–5 个可教、可测的微主题。每个微主题包含：

- **通俗描述** — 家长能看懂的一段话，说明这个主题学什么、为什么重要；
- **掌握证据（evidence）** — 可观察的行为标准，判断孩子是否真的学会；
- **测评问法（assessmentPrompt）** — 一道可直接照着问的口头测评（`{{name}}` 为孩子姓名占位符）；
- **课标对齐** — 对应 2022 版课标条目代码；
- **教材定位** — 年级、学期、教材版本、所属单元；
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
  "textbook": { "publisher": "人教版", "grade": 1, "volume": "上", "unit": 8 }
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

## id 与代码规则

- **微主题 id**：`ct_g{年级}{a|b}_{序号}`，如 `ct_g1a_22` = 一年级上册第 22 个主题；`a`=上学期，`b`=下学期。
- **课标代码**：本仓库自建的稳定代码（官方课标无条目编号），格式 `S{学段}.{领域}.{子领域}.{序号}`，如 `S1.NA.NO.06` = 第一学段·数与代数·数与运算·第 6 条。领域代码：`NA` 数与代数、`GS` 图形与几何、`SP` 统计与概率、`IP` 综合与实践。详见 `data/curriculum-standards.json` 的 `codeScheme`。

## 数据来源与版权（重要）

- **教材**：单元结构以[《义务教育教科书·数学》人教版](https://github.com/TapXWorld/ChinaTextbook)（2022 课标版）为骨架整理。教材 PDF 版权属于人民教育出版社等出版社，本仓库**不收录、不再分发**任何教材内容；`textbooks/` 目录已被 gitignore，仅供本地目录核对。
- **课标**：《义务教育数学课程标准（2022 年版）》条目采用 **codes-only** 策略——只存自建代码与自拟极简标题，不收录课标原文，使用时请以[教育部官方发布](http://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html)为准。
- **本图谱数据**（微主题名称/描述/证据/测评问法、依赖理由等原创内容）：以 CC BY-SA 4.0 发布，转载需署名并相同方式共享。

## 规划路线

- [ ] 数学 3–6 年级（第二、三学段：万以内加减法笔算、多位数乘除法、分数小数、比与比例、简易方程、图形面积体积、统计概率等）
- [ ] 语文（拼音、识字写字、阅读、表达）
- [ ] 英语、科学、道德与法治等学科
- [ ] 领域×年级簇摘要（家长版）
- [ ] 与 os-taxonomy 相同的证据/研究层（teaching research）

## 致谢

- 数据模型与验证脚本设计参考 [Marble Skill Taxonomy](https://github.com/withmarbleapp/os-taxonomy)（ODbL 1.0）。
- 教材资源来自开源社区项目 [TapXWorld/ChinaTextbook](https://github.com/TapXWorld/ChinaTextbook)。
