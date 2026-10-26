import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// 负例测试：把仓库复制到临时目录，注入坏数据，断言 validate.mjs 退出码 1
// 且错误信息命中预期的根因（而非仅因校验和不匹配而失败）。

function makeFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'cct-validate-'));
  // viewer 目录必须随行：validate.mjs 复用 viewer/logic.js 的学习内容文件码表（D-030）
  for (const dir of ['data', 'schema', 'scripts', 'viewer']) {
    cpSync(new URL(`../${dir}`, import.meta.url), join(fixture, dir), { recursive: true });
  }
  return fixture;
}

const readJson = (root, name) => JSON.parse(readFileSync(join(root, 'data', name), 'utf8'));
const writeJson = (root, name, doc) => writeFileSync(join(root, 'data', name), `${JSON.stringify(doc, null, 2)}\n`);

/** 重新计算被改动文件的校验和，隔离「根因报错」与「校验和漂移报错」 */
function refreshChecksum(root, name) {
  const manifest = readJson(root, 'manifest.json');
  const bytes = readFileSync(join(root, 'data', name));
  manifest.files[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  writeJson(root, 'manifest.json', manifest);
}

function runValidate(root) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'validate.mjs')], { encoding: 'utf8' });
  assert.ifError(result.error);
  return result;
}

test('健康数据应通过校验', () => {
  const root = makeFixture();
  try {
    const result = runValidate(root);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('依赖边引用未知知识点应被拒绝', () => {
  const root = makeFixture();
  try {
    const deps = readJson(root, 'dependencies.json');
    deps.dependencies.push({ topicId: 'ct_g9z_99', prerequisiteId: 'ct_g1a_01', strength: 'hard', reason: 'fixture' });
    writeJson(root, 'dependencies.json', deps);
    const result = runValidate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /依赖引用未知 topicId ct_g9z_99/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('先修图出现环应被拒绝', () => {
  const root = makeFixture();
  try {
    const deps = readJson(root, 'dependencies.json');
    // 在原为链式的 g1a_05 -> g1a_01 上加反向边制造环
    deps.dependencies.push({ topicId: 'ct_g1a_01', prerequisiteId: 'ct_g1a_05', strength: 'hard', reason: 'fixture 制造环' });
    writeJson(root, 'dependencies.json', deps);
    refreshChecksum(root, 'dependencies.json');
    const result = runValidate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /先修图存在环/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('知识点引用未定义课标条目应被拒绝', () => {
  const root = makeFixture();
  try {
    const topics = readJson(root, 'topics.json');
    topics.topics[0].standards.push('csmath-2022:S9.XX.XX.99');
    writeJson(root, 'topics.json', topics);
    refreshChecksum(root, 'topics.json');
    const result = runValidate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /引用未知课标条目 csmath-2022:S9\.XX\.XX\.99/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('codes-only 课标条目带原文应被拒绝', () => {
  const root = makeFixture();
  try {
    const standards = readJson(root, 'curriculum-standards.json');
    standards.curricula[0].topics[0].data = '内容要求：在实际情境中……（课标原文）';
    writeJson(root, 'curriculum-standards.json', standards);
    refreshChecksum(root, 'curriculum-standards.json');
    const result = runValidate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /codes-only 课标 csmath-2022 在 .* 泄漏了原文/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prerequisites 冗余字段与依赖边不一致应被拒绝', () => {
  const root = makeFixture();
  try {
    const topics = readJson(root, 'topics.json');
    const victim = topics.topics.find(t => t.id === 'ct_g1a_05'); // 有 prerequisites 的知识点
    victim.prerequisites.push('ct_g1b_20');
    writeJson(root, 'topics.json', topics);
    refreshChecksum(root, 'topics.json');
    const result = runValidate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /prerequisites 含未建边/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('assessmentPrompt 缺少 {{name}} 占位符应被拒绝', () => {
  const root = makeFixture();
  try {
    const topics = readJson(root, 'topics.json');
    topics.topics[0].assessmentPrompt = '直接问孩子就算了。';
    writeJson(root, 'topics.json', topics);
    refreshChecksum(root, 'topics.json');
    const result = runValidate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /assessmentPrompt 缺少 \{\{name\}\} 占位符/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('依赖边引用已废弃知识点应被拒绝', () => {
  const root = makeFixture();
  try {
    const dep = readJson(root, 'deprecated.json');
    dep.entries.push({ id: 'ct_g1a_02', reason: 'fixture：模拟已废弃但仍被引用', deprecatedAt: '2026-10-20' });
    dep.entryCount = dep.entries.length;
    writeJson(root, 'deprecated.json', dep);
    refreshChecksum(root, 'deprecated.json');
    const result = runValidate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /依赖边引用已废弃知识点 ct_g1a_02（prerequisiteId）/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('废弃登记的 replacedBy 指向未知知识点应被拒绝', () => {
  const root = makeFixture();
  try {
    const dep = readJson(root, 'deprecated.json');
    dep.entries.push({ id: 'ct_g9z_99', reason: 'fixture：替代目标不存在',
      replacedBy: ['ct_g9z_98'], deprecatedAt: '2026-10-20' });
    dep.entryCount = dep.entries.length;
    writeJson(root, 'deprecated.json', dep);
    refreshChecksum(root, 'deprecated.json');
    const result = runValidate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /replacedBy 指向未知知识点 ct_g9z_98/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
