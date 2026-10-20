// viewer/closure.test.mjs — 传递闭包计算测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrereqClosure, buildUnlockClosure } from './closure.js';

// 菱形 + 分支：a→b→d、a→c→d（a 是 d 的间接先修）
const layout = {
  edges: [
    { a: { id: 'a' }, b: { id: 'b' } },
    { a: { id: 'a' }, b: { id: 'c' } },
    { a: { id: 'b' }, b: { id: 'd' } },
    { a: { id: 'c' }, b: { id: 'd' } },
    { a: { id: 'd' }, b: { id: 'e' } },
    { a: { id: 'x' }, b: { id: 'y' } }, // 独立分支
  ],
};

test('先修闭包：集合、分层与路径边', () => {
  const p = buildPrereqClosure(layout, 'd');
  assert.deepEqual([...p.set].sort(), ['a', 'b', 'c']);
  assert.equal(p.layer.get('b'), 1);
  assert.equal(p.layer.get('a'), 2); // 最短路径经 b 或 c，均为 2
  assert.equal(p.layer.get('c'), 1);
  assert.ok(p.edgeKeys.has('a->b') && p.edgeKeys.has('b->d'));
  assert.ok(!p.edgeKeys.has('d->e') && !p.edgeKeys.has('x->y'));
});

test('解锁闭包：反向，不含无关分支', () => {
  const u = buildUnlockClosure(layout, 'b');
  assert.deepEqual([...u.set].sort(), ['d', 'e']);
  assert.ok(u.edgeKeys.has('b->d') && u.edgeKeys.has('d->e'));
  const u2 = buildUnlockClosure(layout, 'x');
  assert.deepEqual([...u2.set], ['y']);
});

test('叶节点闭包为空', () => {
  const p = buildPrereqClosure(layout, 'a');
  assert.equal(p.set.size, 0);
  const u = buildUnlockClosure(layout, 'e');
  assert.equal(u.set.size, 0);
});
