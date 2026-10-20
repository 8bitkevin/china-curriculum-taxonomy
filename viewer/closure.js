// viewer/closure.js — 传递闭包计算（3D 路径高亮用，纯函数可测）。
// 返回 { set, layer, edgeKeys }：
//   set      闭包内全部节点 id（不含选中根）
//   layer    节点 → 距根的最短跳数（直接先修/直接被解锁 = 1）
//   edgeKeys 遍历经过的边 'a->b'（a=先修端, b=后学端），用于路径描线

function closure(edges, adjOf, rootId) {
  const set = new Set();
  const layer = new Map();
  const edgeKeys = new Set();
  let frontier = [rootId];
  let depth = 0;
  const seen = new Set([rootId]);
  while (frontier.length) {
    depth++;
    const next = [];
    for (const id of frontier) {
      for (const e of adjOf(id)) {
        edgeKeys.add(`${e.a.id}->${e.b.id}`);
        const other = e.a.id === id ? e.b.id : e.a.id;
        if (!seen.has(other)) {
          seen.add(other);
          set.add(other);
          layer.set(other, depth);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return { set, layer, edgeKeys };
}

/** 先修闭包：root 之前需要掌握的一切（沿 prerequisite 方向）。 */
export function buildPrereqClosure(layout, rootId) {
  const adj = new Map(); // topicId -> 以其为 topicId 端的边
  for (const e of layout.edges) {
    if (!adj.has(e.b.id)) adj.set(e.b.id, []);
    adj.get(e.b.id).push(e);
  }
  return closure(layout.edges, (id) => adj.get(id) ?? [], rootId);
}

/** 解锁闭包：掌握 root 之后被打通的一切（反向）。 */
export function buildUnlockClosure(layout, rootId) {
  const adj = new Map(); // prerequisiteId -> 以其为先修端的边
  for (const e of layout.edges) {
    if (!adj.has(e.a.id)) adj.set(e.a.id, []);
    adj.get(e.a.id).push(e);
  }
  return closure(layout.edges, (id) => adj.get(id) ?? [], rootId);
}
