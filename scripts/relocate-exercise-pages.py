#!/usr/bin/env python3
"""relocate-exercise-pages.py — D-034 教材题册页重定位。

教材换版后，练习题 source.label 的页码仍指向旧版。本脚本在**新版 PDF** 全文
检索每道教材题（kind=textbook/variant）题干的特征 token，命中则把 label 的
「P旧页」改写为「P新页」；未命中追加「·页码待复核」并记入
.scratch/relocate-misses.json 供人工批次复核。

匹配策略（高精度优先）：
  1. 题干抽 token：数字/分数 + CJK 连续串滑窗（容忍新版措辞微调）；
  2. 新版 PDF 各页（归一化文本）取 token 覆盖最多的页；
  3. 命中要求：覆盖 ≥2 个 token（存在 ≥6 字纯 CJK 串时放宽为 1）；
  4. 命中页换算打印页（用目录单元起始页校准书前偏移），且落在该题所属
     新版单元页码范围 ±3 内。

用法：
  python scripts/relocate-exercise-pages.py            # remap-2026.json 全部登记册
  python scripts/relocate-exercise-pages.py 册名...    # 只处理指定册
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import unicodedata
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
NEW_DIR = ROOT / "textbooks"
REMAP_PATH = ROOT / "docs" / "textbook-units" / "remap-2026.json"
LESSONS_DIR = ROOT / "data" / "lessons"
MISS_PATH = ROOT / ".scratch" / "relocate-misses.json"

CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
RE_PAGE = re.compile(r"P(\d+)")
RE_NUM = re.compile(r"\d+(?:\.\d+)?(?:/[1-9]\d*)?")
RE_CJK = re.compile(r"[\u4e00-\u9fff]{2,}")


def stem_of(t: dict) -> str | None:
    """(学科, 年级, 上/下学期) → 本地卷册 stem（与 apply-textbook-remap.mjs 同口径）。"""
    subject, grade, vol = t["subject"], t["grade"], t["textbook"]["volume"]
    v = f"{vol}册"
    g = CN[grade] if grade <= 9 else str(grade)
    if grade <= 6:
        if subject == "思想政治":
            return None
        return f"{subject}{g}年级{v}"
    if grade <= 9:
        if subject == "英语" and grade == 9:
            return "初中英语九年级全一册"
        if subject == "物理" and grade == 9:
            return "初中物理九年级全一册"
        return f"初中{subject}{g}年级{v}"
    return None


def norm_text(s: str) -> str:
    return re.sub(r"[\s　]+", "", unicodedata.normalize("NFKC", s))


def tokens_of(question: str) -> list[str]:
    q = norm_text(question)
    toks = set(RE_NUM.findall(q))
    for run in RE_CJK.findall(q):
        step = 2
        for i in range(0, max(1, len(run) - 1), step):
            toks.add(run[i:i + step])
    return sorted(t for t in toks if len(t) >= 2)


def page_texts(pdf: Path) -> list[str]:
    doc = fitz.open(pdf)
    try:
        return [norm_text(p.get_text()) for p in doc]
    finally:
        doc.close()


def front_offset(pdf: Path, units: list[dict]) -> int:
    """打印页 = pdf 序号 + 1 - off；用各单元标题在正文中的位置校准 off（取中位数）。"""
    pages = page_texts(pdf)
    offs: list[int] = []
    for u in units[:8]:
        title = norm_text(u["title"])
        if len(title) < 4:
            continue
        probe = title[:6]
        for idx in range(2, len(pages)):
            if probe in pages[idx]:
                if u.get("page"):
                    offs.append(idx + 1 - u["page"])
                break
    return int(statistics.median(offs)) if offs else 4


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("volumes", nargs="*", help="册名，缺省为 remap-2026.json 全部登记册")
    args = ap.parse_args()

    remap = json.loads(REMAP_PATH.read_text(encoding="utf-8"))
    stems = args.volumes or [k for k in remap if not k.startswith("_")]
    topics = json.loads((ROOT / "data" / "topics.json").read_text(encoding="utf-8"))
    topic_by_id = {t["id"]: t for t in topics["topics"]}

    stats = {"relocated": 0, "miss": 0, "noPage": 0}
    misses: list[dict] = []
    dirty: dict[Path, dict] = {}

    for stem in stems:
        new_pdf = NEW_DIR / f"{stem}.pdf"
        base_path = ROOT / "docs" / "textbook-units" / f"{stem}.json"
        if not new_pdf.exists() or not base_path.exists():
            print(f"  跳过 {stem}：新版 PDF 或基线缺失")
            continue
        base = json.loads(base_path.read_text(encoding="utf-8"))
        units = base.get("units") or []
        pages = page_texts(new_pdf)
        off = front_offset(new_pdf, units)

        unit_range: dict[str, tuple[int, int]] = {}
        for i, u in enumerate(units):
            start = u.get("page") or 1
            nxt = units[i + 1].get("page") if i + 1 < len(units) else None
            end = (nxt - 1) if nxt else start + 40
            key = str(u["index"]) if u.get("index") is not None else u["title"]
            unit_range[key] = (start, end)

        n_ok = n_bad = 0
        for lf in sorted(LESSONS_DIR.glob("*.json")):
            j = json.loads(lf.read_text(encoding="utf-8"))
            changed = False
            for l in j.get("lessons") or []:
                t = topic_by_id.get(l.get("topicId") or "")
                if not t or t["grade"] > 9 or stem_of(t) != stem:
                    continue
                lo, hi = unit_range.get(str(t["textbook"]["unit"]), (1, 10**4))
                for e in l.get("exercises") or []:
                    src = e.get("source")
                    label = (src or {}).get("label") or ""
                    m = RE_PAGE.search(label)
                    if not src or not m:
                        stats["noPage"] += 1
                        continue
                    toks = tokens_of(e.get("question") or "")
                    long_cjk = max((len(x) for x in toks if re.fullmatch(r"[\u4e00-\u9fff]+", x)),
                                   default=0)
                    need = 1 if long_cjk >= 6 else 2
                    best_idx, best_cov = None, 0
                    if toks:
                        for idx, ptxt in enumerate(pages):
                            cov = sum(1 for tk in toks if tk in ptxt)
                            if cov > best_cov:
                                best_cov, best_idx = cov, idx
                    printed = best_idx + 1 - off if best_idx is not None else None
                    if toks and printed is not None and best_cov >= need and lo - 3 <= printed <= hi + 3:
                        src["label"] = label[:m.start()] + f"P{printed}" + label[m.end():]
                        stats["relocated"] += 1
                        n_ok += 1
                    else:
                        stats["miss"] += 1
                        n_bad += 1
                        if "页码待复核" not in label:
                            src["label"] = label + "·页码待复核"
                        misses.append({"stem": stem, "topicId": l["topicId"], "label": label,
                                       "why": f"覆盖{best_cov}/{len(toks)} 命中页{printed} 范围[{lo},{hi}]"})
                    changed = True
            if changed:
                dirty[lf] = j
        print(f"  {stem}: 重定位 {n_ok} / 待复核 {n_bad} (off={off})")

    for lf, j in dirty.items():
        lf.write_text(json.dumps(j, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    MISS_PATH.parent.mkdir(parents=True, exist_ok=True)
    MISS_PATH.write_text(json.dumps(misses, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\n完成：重定位 {stats['relocated']} / 待复核 {stats['miss']} / 无页码标注 {stats['noPage']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
