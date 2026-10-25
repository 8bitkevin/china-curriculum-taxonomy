#!/usr/bin/env node
/**
 * dev.mjs — 本地开发服务器（零依赖，Node ≥ 20），一条命令起前后端联调环境：
 *
 *   npm run dev                        # http://127.0.0.1:8787
 *   node scripts/dev.mjs --port 3000 --host 0.0.0.0
 *
 * 前端（静态托管，Cache-Control: no-store，改代码/改数据刷新即得）：
 *   /            → 302 /viewer/
 *   /viewer/*    → viewer/（与 GitHub Pages 路径同构）
 *   其余路径     → 仓库根（data/、schema/、docs/、README…）
 *
 * 后端（只读 API，CORS *；筛选与树计算复用 viewer/logic.js，与页面口径一致）：
 *   GET /api/summary                          版本与计数
 *   GET /api/topics?subject&grade&domain&q&limit&offset
 *   GET /api/topic/:id                        详情 + 先修/解锁邻接与两向树
 *   GET /api/standards?curriculum&code        课标条目（无参数透传整套文档）
 *
 * data/*.json 按 mtime 热缓存：改数据无需重启。
 * 纯函数（mimeOf/safeJoin/topicQueryOf/handleApi）导出供 dev.test.mjs。
 */

import { createServer } from 'node:http';
import {
  createReadStream, readFileSync, statSync,
} from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildIndex, filterTopics, prereqTree, treeStats, unlockTree } from '../viewer/logic.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PORT = 8787;

// ---------- 纯函数（供单测） ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

export function mimeOf(pathname) {
  return MIME[extname(pathname).toLowerCase()] ?? 'application/octet-stream';
}

/** URL 路径 → 仓库内绝对路径；目录穿越（../、编码 ..）返回 null。 */
export function safeJoin(root, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  if (rel.includes('\0')) return null;
  const full = resolve(root, rel.replaceAll('\\', '/').replace(/^\/+/, ''));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

/** /api/topics 查询串 → filterTopics 参数 + 分页（limit 0 = 不限，上限 5000）。 */
export function topicQueryOf(sp) {
  const num = (k) => {
    const n = parseInt(sp.get(k) ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    query: sp.get('q') ?? sp.get('query') ?? '',
    subject: sp.get('subject') ?? '',
    domain: sp.get('domain') ?? '',
    grade: num('grade'),
    limit: Math.min(num('limit'), 5000),
    offset: num('offset'),
  };
}

/**
 * 只读 API 核心：请求 → { status, body, headers }。body 为对象（外层序列化）或 null（204）。
 * deps 注入数据源：{ loadIndex() → { index, doc }, loadStandards() → doc }，测试给内存实现。
 */
export async function handleApi(method, pathname, query, deps) {
  const json = (status, body, headers = {}) => ({ status, body, headers: { ...headers } });

  if (method === 'OPTIONS') return { status: 204, body: null };
  if (method !== 'GET') return json(405, { error: '只读 API，仅支持 GET' });

  if (pathname === '/api/summary') {
    const { index, doc } = deps.loadIndex();
    const std = deps.loadStandards();
    return json(200, {
      version: doc.version,
      schemaVersion: doc.schemaVersion,
      topicCount: index.topics.length,
      edgeCount: index.deps.length,
      hardEdgeCount: index.deps.filter((d) => d.strength === 'hard').length,
      standardCount: std.curricula.reduce((n, c) => n + c.topics.length, 0),
      curriculumCount: std.curricula.length,
      subjects: [...new Set(index.topics.map((t) => t.subject))],
    });
  }

  if (pathname === '/api/topics') {
    const f = topicQueryOf(query);
    const list = filterTopics(deps.loadIndex().index, f);
    const sliced = list.slice(f.offset, f.limit ? f.offset + f.limit : undefined);
    return json(200, {
      total: list.length, offset: f.offset, limit: f.limit || null,
      count: sliced.length, topics: sliced,
    });
  }

  const m = pathname.match(/^\/api\/topic\/(ct_[A-Za-z0-9_]+)$/);
  if (m) {
    const { index } = deps.loadIndex();
    const t = index.byId.get(m[1]);
    if (!t) return json(404, { error: `主题 ${m[1]} 不存在` });
    const pTree = prereqTree(index, t.id);
    const uTree = unlockTree(index, t.id);
    // 边附带对端主题摘要（name/grade 等），消费方无需再 join topics 表
    const peerOf = (id) => {
      const p = index.byId.get(id);
      return p ? { name: p.name, subject: p.subject, grade: p.grade, semester: p.semester } : null;
    };
    return json(200, {
      topic: t,
      prereqs: (index.prereqsOf.get(t.id) ?? []).map((e) => ({ ...e, prerequisite: peerOf(e.prerequisiteId) })),
      unlocks: (index.unlocksOf.get(t.id) ?? []).map((e) => ({ ...e, topic: peerOf(e.topicId) })),
      prereqTree: pTree, prereqStats: treeStats(pTree),
      unlockTree: uTree, unlockStats: treeStats(uTree),
    });
  }

  if (pathname === '/api/standards') {
    const std = deps.loadStandards();
    const slug = query.get('curriculum') ?? query.get('slug');
    const code = query.get('code');
    if (slug) {
      const c = std.curricula.find((x) => x.slug === slug || x.title === slug);
      if (!c) return json(404, { error: `课标套 ${slug} 不存在` });
      return json(200, code ? { ...c, topics: c.topics.filter((e) => e.code === code) } : c);
    }
    if (code) {
      for (const c of std.curricula) {
        const hit = c.topics.find((e) => e.code === code);
        if (hit) return json(200, { curriculum: c.slug, entry: hit });
      }
      return json(404, { error: `课标条目 ${code} 不存在` });
    }
    return json(200, std);
  }

  return json(404, { error: `未知 API 路径 ${pathname}（可用：summary / topics / topic/:id / standards）` });
}

// ---------- 数据源（mtime 热缓存） ----------

export function createDataSources({ root = ROOT } = {}) {
  const fileCache = new Map(); // 绝对路径 → { mtimeMs, value }
  const readJsonCached = (file) => {
    const { mtimeMs } = statSync(file);
    const hit = fileCache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.value;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    fileCache.set(file, { mtimeMs, value });
    return value;
  };

  let indexCache = { key: '', index: null };
  return {
    loadIndex() {
      const topicsFile = join(root, 'data', 'topics.json');
      const depsFile = join(root, 'data', 'dependencies.json');
      const key = `${statSync(topicsFile).mtimeMs}|${statSync(depsFile).mtimeMs}`;
      if (indexCache.key !== key) {
        indexCache = { key, index: buildIndex(readJsonCached(topicsFile), readJsonCached(depsFile)) };
      }
      return { index: indexCache.index, doc: readJsonCached(topicsFile) };
    },
    loadStandards() {
      return readJsonCached(join(root, 'data', 'curriculum-standards.json'));
    },
  };
}

// ---------- 静态服务 ----------

function serveStatic(res, pathname) {
  const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  const fail = (status, text) => {
    res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  };
  const file = safeJoin(ROOT, pathname);
  if (!file) return fail(403, '403 Forbidden（路径越界）');

  let target = file;
  try {
    if (statSync(file).isDirectory()) target = join(file, 'index.html');
    const size = statSync(target).size;
    res.writeHead(200, { ...headers, 'Content-Type': mimeOf(target), 'Content-Length': size });
    createReadStream(target).pipe(res);
  } catch {
    fail(404, `404 Not Found：${pathname}`);
  }
}

// ---------- 入口 ----------

function parseArgs(argv) {
  const out = { port: process.env.PORT ? +process.env.PORT : DEFAULT_PORT, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = +argv[++i];
    else if (a.startsWith('--port=')) out.port = +a.slice(7);
    else if (a === '--host') out.host = argv[++i];
  }
  return out;
}

async function main() {
  const { port, host } = parseArgs(process.argv.slice(2));
  const deps = createDataSources();

  const server = createServer(async (req, res) => {
    const t0 = performance.now();
    const log = (status) => console.log(
      `[${new Date().toLocaleTimeString()}] ${req.method} ${req.url} → ${status} ${(performance.now() - t0).toFixed(0)}ms`);
    try {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname === '/') {
        res.writeHead(302, { Location: '/viewer/' }); res.end(); log(302); return;
      }
      if (u.pathname.startsWith('/api/')) {
        const r = await handleApi(req.method, u.pathname, u.searchParams, deps);
        const headers = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'no-store',
          ...r.headers,
        };
        if (r.body !== null) headers['Content-Type'] = 'application/json; charset=utf-8';
        res.writeHead(r.status, headers);
        res.end(r.body === null ? undefined : JSON.stringify(r.body));
        log(r.status);
        return;
      }
      serveStatic(res, u.pathname);
      log(res.statusCode);
    } catch (err) {
      console.error(`[dev] 未捕获错误 ${req.url}：`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      } else res.end();
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[dev] 端口 ${port} 已被占用（上个 dev server 还开着？），换一个：npm run dev -- --port ${port + 1}`);
      process.exit(1);
    }
    throw err;
  });

  await new Promise((done) => server.listen(port, host, done));
  const base = `http://${host}:${port}`;
  console.log(`
▶ 本地开发服务器已启动（Ctrl+C 停止）
  前端        ${base}/viewer/          （静态 no-store，改代码/数据刷新即得）
  API 概览    ${base}/api/summary
  静态根      ${ROOT}（/data /schema /docs 等相对仓库根）
`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
