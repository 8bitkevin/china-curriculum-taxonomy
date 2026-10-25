# viewer/vendor — 本地 vendor 的第三方库

零构建约束（GitHub Pages 同构，无打包器）：第三方库直接下载 dist 产物入库，
不引入 npm 依赖与 CDN 运行时依赖。

## dagre.min.js

- **来源**：[`@dagrejs/dagre` 3.1.3](https://www.npmjs.com/package/@dagrejs/dagre)（dagrejs 官方维护组织）的 `dist/dagre.min.js`（IIFE，经典 `<script>` 引入后暴露全局 `dagre`）
- **许可**：MIT（上游 [github.com/dagrejs/dagre](https://github.com/dagrejs/dagre)）
- **用途**：`viewer/pathmap.js` 学习路径图的分层布局 —— Sugiyama 算法（层级分配 network-simplex + 同层排序交叉最小化 + 边路由），DAG 层次布局的行业标准实现；React Flow / Cytoscape 等的自动布局同类引擎
- **升级**：`curl -O https://cdn.jsdelivr.net/npm/@dagrejs/dagre@<ver>/dist/dagre.min.js` 覆盖本文件即可，无其他改动点
