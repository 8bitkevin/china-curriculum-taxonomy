#!/usr/bin/env python3
"""fetch-textbooks-smartedu.py — 从国家中小学智慧教育平台下载电子教材（D-034 教材源切换）。

替代 fetch-textbooks.py（ChinaTextbook fork 源，已停更于 2025-10）成为教材基线的
权威来源：平台书目即全国当前在用教材（含「根据2022年版课程标准修订」新教材），
PDF 免登录直链，附完整 tag 元数据（学段/学科/版本/年级/册次）。

链路：
  ① 目录版本  https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/resources/tch_material/version/data_version.json
  ② 书目分片  {urls 逗号分隔}.json → 资源条目（global_title + tag_list + id）
  ③ 资源详情  https://s-file-1.ykt.cbern.com.cn/zxx/ndrv2/resources/tch_material/details/{id}.json
  ④ PDF 直链  ti_items[flag=source,format=pdf].ti_storages[0]（r1/r2/r3-ndr 私有 CDN 均可匿名下载）

用法：
  python scripts/fetch-textbooks-smartedu.py --list      # 解析映射，打印匹配报告（不下载）
  python scripts/fetch-textbooks-smartedu.py             # 下载全部已匹配且本地缺失/变更的册
  python scripts/fetch-textbooks-smartedu.py 数学一年级上册 [册名...]   # 只处理指定册
  python scripts/fetch-textbooks-smartedu.py --verify    # 逐册读版权页，验证版次年

下载结果写入 textbooks/{本地册名}.pdf（与 extract-toc.py 的卷册注册表同名），
映射报告与验证结果存 .scratch/smartedu-report.json 供后续数据层重映射使用。
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent import futures
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "textbooks"
REPORT_PATH = ROOT / ".scratch" / "smartedu-report.json"
CATALOG_CACHE = ROOT / ".scratch" / "smartedu-catalog.json"

VERSION_URL = ("https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/resources/"
               "tch_material/version/data_version.json")
DETAIL_URL = "https://s-file-1.ykt.cbern.com.cn/zxx/ndrv2/resources/tch_material/details/{id}.json"
NEW_EDITION_MARK = "根据2022年版课程标准修订"

CN_DIGITS = {1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六",
             7: "七", 8: "八", 9: "九"}

# ---------------------------------------------------------------------------
# 卷册注册表：本地册名（stem）→（学段, 学科 tag, 年级, 册次）
# 与 extract-toc.py 的 ALL_VOLUMES、README「教材版本基线」保持同一口径；
# 版本 tag 候选与标题限定词在 SUBJECT_CFG 中按（学段, 学科）给出。
# 高中 50 册为 2019 版现行教材，本脚本不管（D-006 印次跟版另行处理）。

def _vols(prefix: str, grades: range, sems="上下") -> list[str]:
    return [f"{prefix}{CN_DIGITS[g]}年级{v}册" for g in grades for v in sems]

VOLUME_STAGE: dict[str, tuple[str, str, int | str, str]] = {}
def _reg(stem: str, stage: str, subject: str, grade, vol: str):
    VOLUME_STAGE[stem] = (stage, subject, grade, vol)

for g in range(1, 7):
    for v in "上下":
        _reg(f"数学{CN_DIGITS[g]}年级{v}册", "小学", "数学", g, f"{v}册")
        _reg(f"语文{CN_DIGITS[g]}年级{v}册", "小学", "语文", g, f"{v}册")
        _reg(f"道德与法治{CN_DIGITS[g]}年级{v}册", "小学", "道德与法治", g, f"{v}册")
        _reg(f"科学{CN_DIGITS[g]}年级{v}册", "小学", "科学", g, f"{v}册")
        _reg(f"音乐{CN_DIGITS[g]}年级{v}册", "小学", "音乐", g, f"{v}册")
        _reg(f"美术{CN_DIGITS[g]}年级{v}册", "小学", "美术", g, f"{v}册")
for g in range(3, 7):
    for v in "上下":
        _reg(f"英语{CN_DIGITS[g]}年级{v}册", "小学", "英语", g, f"{v}册")
for g in range(1, 7):  # 新版体育与健康改为逐年级全一册（旧版为 1-2/3-4/5-6 跨段）
    _reg(f"体育与健康{CN_DIGITS[g]}年级全一册", "小学", "体育与健康", g, "全一册")

for g in range(7, 10):
    for v in "上下":
        _reg(f"初中数学{CN_DIGITS[g]}年级{v}册", "初中", "数学", g, f"{v}册")
        _reg(f"初中语文{CN_DIGITS[g]}年级{v}册", "初中", "语文", g, f"{v}册")
        _reg(f"初中历史{CN_DIGITS[g]}年级{v}册", "初中", "历史", g, f"{v}册")
        _reg(f"初中道德与法治{CN_DIGITS[g]}年级{v}册", "初中", "道德与法治", g, f"{v}册")
for g in range(7, 9):  # 地理/生物学只到八年级
    for v in "上下":
        _reg(f"初中地理{CN_DIGITS[g]}年级{v}册", "初中", "地理", g, f"{v}册")
        _reg(f"初中生物学{CN_DIGITS[g]}年级{v}册", "初中", "生物学", g, f"{v}册")
_reg("初中英语七年级上册", "初中", "英语", 7, "上册")
_reg("初中英语七年级下册", "初中", "英语", 7, "下册")
_reg("初中英语八年级上册", "初中", "英语", 8, "上册")
_reg("初中英语八年级下册", "初中", "英语", 8, "下册")
_reg("初中英语九年级上册", "初中", "英语", 9, "上册")   # 新版九年级拆为上/下册（原全一册）
_reg("初中英语九年级下册", "初中", "英语", 9, "下册")
_reg("初中物理八年级上册", "初中", "物理", 8, "上册")
_reg("初中物理八年级下册", "初中", "物理", 8, "下册")
_reg("初中物理九年级全一册", "初中", "物理", 9, "全一册")
_reg("初中化学九年级上册", "初中", "化学", 9, "上册")
_reg("初中化学九年级下册", "初中", "化学", 9, "下册")

ALL_VOLUMES = list(VOLUME_STAGE)

# （学段, 学科）→ 平台 subject tag 候选 + 版本 tag 候选 + 标题限定词
SUBJECT_CFG: dict[tuple[str, str], dict] = {
    ("小学", "数学"): {"versions": ["人教版"]},
    ("小学", "语文"): {"versions": ["统编版"]},
    ("小学", "道德与法治"): {"versions": ["统编版"]},
    ("小学", "英语"): {"versions": ["人教版（主编：吴欣）"]},
    ("小学", "科学"): {"versions": ["教科版"]},
    ("小学", "音乐"): {"subjects": ["艺术·音乐"], "versions": ["人教版（简谱）"]},
    ("小学", "美术"): {"subjects": ["艺术·美术"], "versions": ["人教版"]},
    ("小学", "体育与健康"): {"versions": ["人教版"], "subjects": ["体育与健康"]},
    ("初中", "数学"): {"versions": ["人教版"]},
    ("初中", "语文"): {"versions": ["统编版"]},
    ("初中", "英语"): {"versions": ["人教版"]},
    ("初中", "物理"): {"versions": ["人教版"]},
    ("初中", "化学"): {"versions": ["人教版"]},
    ("初中", "生物学"): {"versions": ["人教版"]},
    ("初中", "历史"): {"versions": ["统编版"]},
    ("初中", "地理"): {"versions": ["人教版"]},
    ("初中", "道德与法治"): {"versions": ["统编版"]},
}

# 平台上「未出版/未上线」的册次（2026-10 时点：2027 春季启用的下册尚未上线）
EXPECTED_UNPUBLISHED = {
    *(f"{s}{CN_DIGITS[g]}年级下册" for s in ("数学", "语文", "道德与法治", "科学", "音乐", "美术")
      for g in (4, 5, 6)),
    "英语六年级下册",
    "英语五年级下册",  # PEP 五下平台暂未上传（其他版本已有）
    *(f"初中{s}九年级下册" for s in ("数学", "语文", "历史", "道德与法治", "英语")),
}

# ---------------------------------------------------------------------------

# CDN 有风控：需完整浏览器头 + 退避重试 + 限速（D-034 实测裸 UA 会被 403）
_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Referer": "https://basic.smartedu.cn/",
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

# 登录凭证（可选）：环境变量 SMARTEDU_TOKEN 或 .scratch/smartedu-token.txt
# （值为 basic.smartedu.cn 的 UC_TOKEN cookie，gitignored 不入库；走 X-ND-AUTH 认证通道）
TOKEN_PATH = ROOT / ".scratch" / "smartedu-token.txt"


def _normalize_token(raw: str) -> str:
    """凭证归一：UC_TOKEN cookie 的 base64 JSON 或其内层 access_token 均可。

    实测（D-034）：X-ND-AUTH 接受 JSON 内层的 access_token（112 位 hex），
    完整 cookie 值本身会被 401 拒绝。粘贴截断时 access_token 段通常仍完整。"""
    import base64
    import re as _re
    raw = raw.strip()
    if raw.startswith("eyJ"):
        pad = raw + "=" * ((4 - len(raw) % 4) % 4)
        try:
            txt = base64.b64decode(pad).decode("utf-8", errors="ignore")
            mt = _re.search(r'"access_token":"([0-9A-Fa-f]+)"', txt)
            if mt:
                return mt.group(1)
        except Exception:  # noqa: BLE001 — 解不开就按原样使用
            pass
    return raw


def _build_headers() -> dict[str, str]:
    import os
    h = dict(_HEADERS)
    tok = os.environ.get("SMARTEDU_TOKEN")
    if not tok and TOKEN_PATH.exists():
        tok = TOKEN_PATH.read_text(encoding="utf-8").strip()
    if tok:
        h["X-ND-AUTH"] = _normalize_token(tok)
    return h


def _sleep_backoff(attempt: int) -> None:
    time.sleep((2, 5, 10, 20)[min(attempt, 3)])


def _sleep_waf(attempt: int) -> None:
    """CDN 风控（403）专用长退避：短重试只会持续触发拦截。"""
    time.sleep((30, 60, 120, 300)[min(attempt, 3)])


def http_get_json(url: str, timeout: int = 60):
    """GET JSON；对 403/429/5xx 与网络错误做指数退避重试。"""
    last: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=_build_headers())
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (403, 429) or e.code >= 500:
                _sleep_waf(attempt)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
            _sleep_backoff(attempt)
    raise last  # type: ignore[misc]


def load_catalog() -> list[dict]:
    """拉取全部书目分片（带本地缓存；模块版本变化时自动失效）。"""
    ver = http_get_json(VERSION_URL)
    if CATALOG_CACHE.exists():
        cached = json.loads(CATALOG_CACHE.read_text(encoding="utf-8"))
        if cached.get("module_version") == ver.get("module_version"):
            return cached["items"]
    items: list[dict] = []
    for url in str(ver["urls"]).split(","):
        part = http_get_json(url.strip())
        items.extend(part if isinstance(part, list) else part.get("items", []))
    CATALOG_CACHE.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_CACHE.write_text(json.dumps(
        {"module_version": ver.get("module_version"), "items": items},
        ensure_ascii=False), encoding="utf-8")
    return items


def title_of(item: dict) -> str:
    t = item.get("title")
    if isinstance(t, str) and t:
        return t
    gt = item.get("global_title") or {}
    return gt.get("zh-CN") or ""


def tags_of(item: dict) -> list[str]:
    return [t.get("tag_name", "") for t in (item.get("tag_list") or [])]


def resolve_stem(stem: str, catalog: list[dict]) -> dict:
    """本地册名 → 平台资源（新版义务教材限定）。"""
    stage, subject, grade, vol = VOLUME_STAGE[stem]
    cfg = SUBJECT_CFG[(stage, subject)]
    subject_names = cfg.get("subjects", [subject])
    grade_cn = CN_DIGITS[grade] if isinstance(grade, int) else None
    cands = []
    for it in catalog:
        title = title_of(it)
        if NEW_EDITION_MARK not in title:
            continue
        if "教师用书" in title or "图册" in title:
            continue
        tags = tags_of(it)
        if "教师用书" in tags:
            continue
        if stage not in tags or "（五•四学制）" in title:
            continue
        if not any(s in tags for s in subject_names):
            continue
        vers = cfg["versions"]
        if vers and not any(v in tags for v in vers):
            continue
        if grade_cn and f"{grade_cn}年级" not in title:  # 整词匹配，避免「全一册」误含「一」
            continue
        if vol == "全一册":
            if "全一册" not in title:
                continue
        else:
            if vol not in title:
                continue
        cands.append(it)
    if not cands:
        return {"stem": stem, "status": "missing",
                "reason": "平台上无匹配的新版资源（未出版或 tag/标题不匹配）"}
    if len(cands) > 1:
        # 同名去重：保留 update_time 最新
        cands.sort(key=lambda x: x.get("update_time") or "", reverse=True)
    best = cands[0]
    return {"stem": stem, "status": "matched",
            "id": best["id"], "title": title_of(best),
            "tags": tags_of(best), "candidates": len(cands)}


def pdf_urls_of(res_id: str) -> list[str]:
    """返回 PDF 分片直链：-private 链（走 X-ND-AUTH 认证）优先，非 private 匿名链兜底。"""
    detail = http_get_json(DETAIL_URL.format(id=res_id))
    urls: list[str] = []
    for ti in detail.get("ti_items") or []:
        if ti.get("ti_file_flag") == "source" and ti.get("ti_format") == "pdf":
            urls.extend(s for s in (ti.get("ti_storages") or []) if s)
    out = list(urls)
    out.extend(u.replace("-ndr-private.", "-ndr.") for u in urls)
    return out


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path) -> None:
    # 直链路径含中文书名，需百分号编码（保留已编码的 % 序列）
    url = urllib.parse.quote(url, safe=":/?&=%#")
    tmp = dest.with_suffix(dest.suffix + ".part")
    last: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=_build_headers())
            with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            head = tmp.open("rb").read(5)
            if not head.startswith(b"%PDF-"):
                tmp.unlink(missing_ok=True)
                raise RuntimeError(f"内容不是 PDF（文件头 {head!r}）")
            tmp.rename(dest)
            return
        except RuntimeError:
            raise
        except Exception as e:  # noqa: BLE001 — 网络/风控错误退避重试
            last = e
            tmp.unlink(missing_ok=True)
            if isinstance(e, urllib.error.HTTPError) and e.code not in (403, 429) and e.code < 500:
                raise
            if isinstance(e, urllib.error.HTTPError) and e.code in (403, 429):
                _sleep_waf(attempt)
            else:
                _sleep_backoff(attempt)
    raise last  # type: ignore[misc]


def copyright_year(pdf: Path) -> str:
    """读版权页（前 6 页）抓「20XX年X月第1版」版次。"""
    import fitz
    doc = fitz.open(pdf)
    try:
        text = "".join(doc[i].get_text() for i in range(min(6, doc.page_count)))
    finally:
        doc.close()
    text = re.sub(r"\s+", "", text)
    years = re.findall(r"(20\d{2})年\d{1,2}月第1版", text)
    return years[0] if years else ""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("volumes", nargs="*", help="册名（PDF stem），缺省为义务段全册")
    ap.add_argument("--list", action="store_true", help="只解析映射并打印报告")
    ap.add_argument("--verify", action="store_true", help="只验证本地 PDF 版权页版次")
    ap.add_argument("--force", action="store_true", help="本地已有也重新下载")
    args = ap.parse_args()
    targets = args.volumes or ALL_VOLUMES
    for t in targets:
        if t not in VOLUME_STAGE:
            print(f"✗ 未知册名：{t}")
            return 2

    if args.verify:
        bad = 0
        for stem in targets:
            pdf = PDF_DIR / f"{stem}.pdf"
            if not pdf.exists():
                print(f"  {stem}: PDF 缺失"); bad += 1; continue
            year = copyright_year(pdf)
            print(f"  {stem}: 版次 {year or '?'}")
            bad += 0 if year else 1
        return 1 if bad else 0

    catalog = load_catalog()
    print(f"书目资源总数：{len(catalog)}")
    report: dict = {}
    if REPORT_PATH.exists():
        report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))

    n_match = n_missing = n_dl = n_skip = n_err = 0
    work: list[tuple[str, Path, dict]] = []
    for stem in targets:
        res = resolve_stem(stem, catalog)
        report[stem] = res
        if res["status"] != "matched":
            n_missing += 1
            tag = "（预期内未上线）" if stem in EXPECTED_UNPUBLISHED else "（意外缺失，需人工排查）"
            print(f"  ✗ {stem} 未匹配 {tag}")
            continue
        n_match += 1
        if args.list:
            print(f"  ✓ {stem} ← {res['title']}  (候选 {res['candidates']})")
            continue
        pdf = PDF_DIR / f"{stem}.pdf"
        if pdf.exists() and not args.force:
            n_skip += 1
            continue
        work.append((stem, pdf, res))

    def fetch_one(item: tuple[str, Path, dict]):
        """单册：详情 → 逐镜像下载 → 指纹与版权页。线程池内并发执行。"""
        stem, pdf, res = item
        time.sleep(0.8)  # 错峰
        try:
            urls = pdf_urls_of(res["id"])
        except Exception as e:  # noqa: BLE001
            res["status"] = "error"
            res["error"] = str(e)
            return stem, "error", f"详情获取失败 {e}"
        if not urls:
            res["status"] = "no_pdf"
            return stem, "error", "详情中无 PDF 分片"
        random.shuffle(urls)  # 镜像随机轮换，避免并发全部压在同一 CDN 节点
        last: Exception | None = None
        for url in urls:  # 逐镜像尝试
            try:
                download(url, pdf)
                res["sha256"] = sha256_of(pdf)
                res["copyrightYear"] = copyright_year(pdf)
                res["fetchedAt"] = datetime.date.today().isoformat()
                return stem, "ok", f"{res['copyrightYear'] or '版次?'} sha={res['sha256'][:12]}…"
            except Exception as e:  # noqa: BLE001
                last = e
                if "不是 PDF" in str(e):
                    break
        res["status"] = "error"
        res["error"] = str(last)
        return stem, "error", f"下载失败 {last}"

    if work:
        with futures.ThreadPoolExecutor(max_workers=2) as pool:
            for fut in futures.as_completed([pool.submit(fetch_one, it) for it in work]):
                stem, st, msg = fut.result()
                if st == "ok":
                    n_dl += 1
                    print(f"  ↓ {stem}: {msg}", flush=True)
                else:
                    n_err += 1
                    print(f"  ✗ {stem}: {msg}", flush=True)

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n",
                           encoding="utf-8")
    mode = "list" if args.list else "download"
    print(f"完成（{mode}）：匹配 {n_match} / 缺失 {n_missing}"
          + (f" / 下载 {n_dl} / 跳过 {n_skip} / 失败 {n_err}" if mode == "download" else ""))
    return 1 if n_err else 0


if __name__ == "__main__":
    sys.exit(main())
