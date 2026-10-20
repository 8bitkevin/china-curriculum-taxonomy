#!/usr/bin/env python3
"""TOOL-1 教材基线留档：从教材 PDF 提取结构化单元目录。

输出 docs/textbook-units/{册}.json：单元/章列表（含节）、PDF sha256、
页数、提取日期。作为数据批次的单元锚点基线，供 TOOL-4 改版 diff。

实现说明：PDF 无书签层，采用「目录页文本 + 坐标排序重建阅读顺序」方案
（低年级图画式目录的文本块乱序，按行聚类后可稳定重建）。零 npm 依赖
约束下 PDF 解析走 Python/PyMuPDF，与 fetch-textbooks.py 同栈。

用法：
  python scripts/extract-toc.py            # 提取/更新全部数学册基线
  python scripts/extract-toc.py --check    # 校验现有基线与 PDF sha256 是否一致（不重写）
  python scripts/extract-toc.py 数学一年级上册 [册名...]   # 只处理指定册

扫描版 PDF（无文本层）不自动提取：保留已有人工基线（source: "manual"），
无基线时写出占位（source: "pending"），人工整理后重跑本脚本不会覆盖。
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "textbooks"
OUT_DIR = ROOT / "docs" / "textbook-units"

# 数学主线 23 册（小学 12 + 初中 6 + 高中 5）；本地文件名用中文年级数字
CN_DIGITS = {1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "七", 8: "八", 9: "九"}
MATH_VOLUMES = [
    *(f"数学{CN_DIGITS[g]}年级{v}册" for g in range(1, 7) for v in "上下"),
    *(f"初中数学{CN_DIGITS[g]}年级{v}册" for g in range(7, 10) for v in "上下"),
    "高中数学必修第一册",
    "高中数学必修第二册",
    "高中数学选择性必修第一册",
    "高中数学选择性必修第二册",
    "高中数学选择性必修第三册",
]

CN_NUM = "一二三四五六七八九十百"
CN_DIGIT_TABLE = {c: i for i, c in enumerate("一二三四五六七八九", 1)}
RE_CHAPTER = re.compile(rf"^第([{CN_NUM}]+)章\s*(\S.*)?$")
RE_SECTION = re.compile(r"^(\d{1,2})[.．](\d{1,2})\s*(\S.*)?$")
RE_UNIT_HEAD = re.compile(r"^(\d{1,2})[\s　]+(.+)$")   # 号在标题前：「1 准备课」
RE_PAGE_TAIL = re.compile(r"(?<![0-9.~%％])(\d{1,3})$")   # 行尾页码（允许紧贴标题）
RE_UNIT_TAIL = re.compile(r"[\s　](\d{1,2})$")          # 行尾单元号（页码剥离后）

# 无单元号但收录的条目（综合整理/实践篇）
SPECIAL_UNITS = {"总复习", "数学乐园", "整理和复习"}
# 章内栏目行：不构成单元，跳过
MISC_PREFIXES = ("实验与探究", "阅读与思考", "观察与猜想", "信息技术应用",
                 "数学活动", "小结", "复习题", "探究与发现", "课题学习",
                 "归纳猜想", "数学文化")


def cn2int(s: str) -> int | None:
    """中文数字（≤99）转整数，如 十一 → 11、二十 → 20、六 → 6。"""
    if not s:
        return None
    if s == "十":
        return 10
    if "十" in s:
        a, _, b = s.partition("十")
        hi = CN_DIGIT_TABLE.get(a, 1) if a else 1
        lo = CN_DIGIT_TABLE.get(b, 0) if b else 0
        return hi * 10 + lo
    return CN_DIGIT_TABLE.get(s)


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def norm(text: str) -> str:
    """NFKC 归一（全角数字/标点转半角）+ 压缩空白，保留原标题用字。"""
    return re.sub(r"[\s　]+", " ", unicodedata.normalize("NFKC", text)).strip()


def rebuild_rows(page: "fitz.Page", y_tol: float = 12.0) -> list[list[str]]:
    """行级 span 按 (y 聚类, x 排序) 重建阅读顺序，返回每行的文本片段列表。"""
    lines = []
    for blk in page.get_text("dict")["blocks"]:
        if blk.get("type") != 0:
            continue
        for ln in blk.get("lines", []):
            text = "".join(s["text"] for s in ln["spans"]).strip()
            if text:
                lines.append((ln["bbox"][1], ln["bbox"][0], text))
    lines.sort(key=lambda t: (t[0], t[1]))
    rows: list[tuple[float, list[tuple[float, str]]]] = []
    for y, x, text in lines:
        if rows and abs(y - rows[-1][0]) <= y_tol:
            rows[-1][1].append((x, text))
        else:
            rows.append((y, [(x, text)]))
    return [[t for _, t in sorted(seg)] for _, seg in rows]


def find_toc_pages(doc: "fitz.Document", limit: int = 12) -> list[int]:
    """前 limit 页中定位目录页。

    两种特征命中其一：
    1. 首行含「目录」标题且后续有页码尾随行（多数版本）；
    2. 页码尾随行 ≥5 且带省略引导线或多个章标题行（部分版本「目录」
       标题是艺术字提取不到，如人教 A 版必修第二册）。
    """
    hits = []
    for i in range(min(limit, doc.page_count)):
        rows = rebuild_rows(doc[i])
        if not rows:
            continue
        lines = [norm(" ".join(r)) for r in rows]
        head = lines[0][:6]
        numbered = sum(1 for l in lines if RE_PAGE_TAIL.search(l))
        dots = " ".join(lines).count("…") + " ".join(lines).count("....")
        chapters = sum(1 for l in lines if RE_CHAPTER.match(l))
        # 续页：紧邻已命中页 + 页码行多 + 行短而少（目录排版特征，
        # 排除正文中数字密集的页面）
        lens = [len(l) for l in lines if l]
        avg_len = sum(lens) / len(lens) if lens else 0
        cont = (hits and i == hits[-1] + 1 and numbered >= 3
                and avg_len <= 30 and len(lens) <= 24)
        is_toc = ("目" in head and "录" in head and numbered >= 3) or (
            numbered >= 5 and (dots >= 2 or chapters >= 2)) or cont
        if is_toc:
            hits.append(i)
    return hits


def parse_toc_rows(rows: list[list[str]]) -> list[dict]:
    """把目录页重建行解析为单元/节条目。

    - 章行「第X章 标题 [页码]」→ 单元，index 取中文数字；
    - 节行「1.1 标题 [页码]」→ 归入最近章的 sections；
    - 小学单元行「1 准备课 2」/「认识图形（一）4 34」→ 单元；
    - 长标题折行时号与页码成孤行（如「100 以内的加法 / 2 11 / 和减法(二)」），
      与前后行合并重组；
    - 无号行仅收 SPECIAL_UNITS（总复习/数学乐园等），栏目行全部跳过；
    - 后处理：同号去重（保留首个）+ 单元号回退截断（目录后误入的正文
      短行噪声表现为号突然回退，如 [9] 总复习之后又出现 [2]）。
    """
    texts: list[str] = []
    for seg in rows:
        line = norm(" ".join(seg))
        line = re.sub(r"[…\.]{3,}", " ", line).strip()  # 剥省略引导线
        if line:
            texts.append(line)

    # 孤号折行重组：「标题上段」「号 页码」「标题下段」→「标题 页码 号」
    merged: list[str] = []
    i = 0
    while i < len(texts):
        m = re.fullmatch(r"(\d{1,2})[\s　]+(\d{1,3})", texts[i])
        if (m and merged and not merged[-1][-1:].isdigit()
                and i + 1 < len(texts)
                and not texts[i + 1][-1:].isdigit()
                and not texts[i + 1].startswith(MISC_PREFIXES)
                and not RE_CHAPTER.match(texts[i + 1])):
            merged[-1] = f"{merged[-1]}{texts[i + 1]} {m.group(1)} {m.group(2)}"
            i += 2
            continue
        merged.append(texts[i])
        i += 1

    units: list[dict] = []
    seen_index: set[int] = set()
    max_index = 0
    for line in merged:
        if line.startswith("目"):
            continue
        if line.startswith(MISC_PREFIXES):
            continue
        m = RE_CHAPTER.match(line)
        if m:  # 中学/高中：第X章 标题 [页码]
            title, page = strip_page(m.group(2) or "")
            if title:
                units.append({"index": cn2int(m.group(1)), "title": title,
                              "page": page, "sections": []})
            continue
        m = RE_SECTION.match(line)
        if m and units and "sections" in units[-1]:
            title, page = strip_page(m.group(3) or "")
            units[-1]["sections"].append(
                {"no": f"{m.group(1)}.{m.group(2)}", "title": title, "page": page})
            continue
        # 小学单元行：「1 准备课 2」「认识图形（一）4 34」（标题可为单字：比、圆）
        title, page = strip_page(line)
        m = RE_UNIT_HEAD.match(title)
        if m:
            title, index = m.group(2), int(m.group(1))
        else:
            m2 = RE_UNIT_TAIL.search(title)
            index = int(m2.group(1)) if m2 else None
            if m2:
                title = title[: m2.start()].strip()
        if index is None and title not in SPECIAL_UNITS:
            continue
        if not title:
            continue
        if index is not None:
            if index < max_index:  # 号回退 = 目录已结束，之后的都是噪声
                break
            max_index = index
            if index in seen_index:  # 同号重复（单元内小节误配）保留首个
                continue
            seen_index.add(index)
        units.append({"index": index, "title": title, "page": page})
    for u in units:  # 章可能整章无节（少见），统一结构
        if "sections" in u and not u["sections"]:
            del u["sections"]
    return units


def strip_page(line: str) -> tuple[str, int | None]:
    m = RE_PAGE_TAIL.search(line)
    if m:
        return line[: m.start()].strip(), int(m.group(1))
    return line, None


def extract_volume(stem: str) -> dict | None:
    pdf = PDF_DIR / f"{stem}.pdf"
    if not pdf.exists():
        print(f"  跳过 {stem}：PDF 不存在")
        return None
    doc = fitz.open(pdf)
    has_text = sum(1 for p in doc if p.get_text().strip()) > doc.page_count * 0.5
    meta = {
        "schemaVersion": 1,
        "volume": stem,
        "pdf": {"file": pdf.name, "sha256": sha256_of(pdf),
                "pages": doc.page_count, "hasTextLayer": has_text},
    }
    if not has_text:
        doc.close()
        return {**meta, "source": "pending",
                "note": "扫描版 PDF 无文本层，待人工基线（source=manual）"}
    toc_idx = find_toc_pages(doc)
    rows: list[list[str]] = []
    for i in toc_idx[:3]:  # 目录最多跨 3 页；合并后一次解析避免章/节断链
        rows.extend(rebuild_rows(doc[i]))
    units = parse_toc_rows(rows)
    doc.close()
    # 目录页后可能混入封面折页噪声：去掉过短/重复条目
    seen, cleaned = set(), []
    for u in units:
        key = u["title"]
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(u)
    return {**meta, "source": "pdf-text",
            "extractedAt": datetime.date.today().isoformat(),
            "units": cleaned}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("volumes", nargs="*", help="册名（PDF stem），缺省为全部数学册")
    ap.add_argument("--check", action="store_true",
                    help="只校验现有基线 JSON 与 PDF sha256 是否一致")
    args = ap.parse_args()
    targets = args.volumes or MATH_VOLUMES

    if args.check:
        bad = 0
        for stem in targets:
            jf = OUT_DIR / f"{stem}.json"
            pdf = PDF_DIR / f"{stem}.pdf"
            if not jf.exists() or not pdf.exists():
                print(f"✗ {stem}：基线或 PDF 缺失"); bad += 1; continue
            rec = json.loads(jf.read_text(encoding="utf-8"))
            actual = sha256_of(pdf)
            ok = rec.get("pdf", {}).get("sha256") == actual
            print(f"{'✓' if ok else '✗'} {stem}")
            bad += 0 if ok else 1
        return 1 if bad else 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for stem in targets:
        rec = extract_volume(stem)
        if rec is None:
            continue
        jf = OUT_DIR / f"{stem}.json"
        if rec.get("source") == "pending" and jf.exists():
            prior = json.loads(jf.read_text(encoding="utf-8"))
            if prior.get("source") == "manual":
                # 人工基线优先于占位；仅刷新 PDF 指纹
                prior["pdf"] = rec["pdf"]
                rec = prior
        jf.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8", newline="\n")
        n = len(rec.get("units", []))
        src = rec.get("source")
        print(f"  {stem}: {n} 单元 (source={src})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
