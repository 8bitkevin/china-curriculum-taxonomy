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
RE_CJK_SINGLE = re.compile(r"[\u4e00-\u9fff]")
RE_FOOTER_NUM = re.compile(r"\d{1,3}")
RE_STRIP = re.compile(r"[^\u4e00-\u9fff0-9]+")


def _cn2int(s: str) -> int:
    D = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
         "六": 6, "七": 7, "八": 8, "九": 9}
    if s == "十":
        return 10
    if "十" in s:
        a, _, b = s.partition("十")
        return (D.get(a, 1) if a else 1) * 10 + (D.get(b, 0) if b else 0)
    return D.get(s, 0)


def unit_key(u: str) -> str:
    """锚值归一：「第三单元·阅读」→「3」（与 unit_range 的 str(index) 键对齐），
    英语「Unit 1·Making friends」→「1」；其余（无编号主题单元标题）原样。
    此前汉字序号无法命中阿拉伯数字键，范围守卫退化为全书 (1,10^4)，
    ±3 页约束失效。"""
    s = str(u)
    m = re.fullmatch(r"第([一二三四五六七八九十]+)[单元章](?:[·\s].*)?", s)
    if m:
        n = _cn2int(m.group(1))
        if n:
            return str(n)
    m = re.fullmatch(r"Unit\s*(\d+)(?:[·\s].*)?", s, re.IGNORECASE)
    if m:
        return m.group(1)
    return s


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
            return "初中英语九年级全一册" if vol == "全" else f"初中英语九年级{v}"
        if subject == "物理" and grade == 9:
            return "初中物理九年级全一册"
        return f"初中{subject}{g}年级{v}"
    # 高中：book（validate HS_BOOKS_BY_SUBJECT 口径）+ 去空格 = PDF 文件名
    book = t["textbook"].get("book")
    if book:
        return f"高中{subject}{book}".replace(" ", "")
    return None


def norm_text(s: str) -> str:
    return re.sub(r"[\s　]+", "", unicodedata.normalize("NFKC", s))


def tokens_of(question: str) -> list[str]:
    q = norm_text(question)
    toks = set(RE_NUM.findall(q))
    for run in RE_CJK.findall(q):
        step = 2
        for i in range(0, max(1, len(run) - 1), step):
            toks.add(run[i:i + 2])
    return sorted(t for t in toks if len(t) >= 2)


def label_hint_tokens(label: str) -> list[str]:
    """label 引文挖掘（T-2 二轮救援）：题干之外，label 的「·题源描述」部分常含
    课文原句/题目引文（如「P30·《小公鸡和小鸭子》对话（公鸡弟弟，我到河里捉鱼
    给你吃）」），其 CJK 双字 token 在新版 PDF 中可命中引文页。只挖 CJK、排除
    P 页码数字与「页码待复核」标记，避免数字 token 污染与旧页码假命中。"""
    if not label:
        return []
    s = label.replace("·页码待复核", "")
    if "·" in s:
        s = s.split("·", 1)[1]  # 丢弃「统编版一下 P30」前缀
    s = RE_PAGE.sub(" ", s)
    return tokens_of("".join(RE_CJK.findall(norm_text(s))))


def tokens_for(e: dict, label: str) -> list[str]:
    """题干 token ∪ label 引文 token（题干为空的题也可参与匹配）。"""
    merged = set(tokens_of(e.get("question") or ""))
    merged.update(label_hint_tokens(label))
    return sorted(merged)


def page_texts(pdf: Path) -> list[str]:
    """匹配用页面文本：NFKC 后剔除拼音字母等非 CJK/数字字符。

    新版低年级每字注音，「小鸭子」在原文里是「小xiǎo鸭yā子zi」，保留字母会让
    题干 CJK 双字 token 永远匹配不上（B-NE2 实证：低年级册命中率跌至三成）。"""
    doc = fitz.open(pdf)
    try:
        return [RE_STRIP.sub("", unicodedata.normalize("NFKC", p.get_text()))
                for p in doc]
    finally:
        doc.close()


def _load_etoc():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "etoc", str(ROOT / "scripts" / "extract-toc.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def front_offset(pdf: Path, units: list[dict]) -> int:
    """打印页 = pdf 序号 + 1 - off。

    首选：直读书页脚印刷页码（页面底部 88% 高度以下的孤立数字），取中位数——
    这是纸书页码的权威来源（D-034 B-NE2 实证：语文各册 off 一律 =5）。
    兜底：单元/首节标题在正文首现位置反推。两侧均按 CJK 单字归一——新版低年级
    每字注音会把 CJK 连串打断、语文单元标题含间隔号「·」，原样探测会全部落空。"""
    doc = fitz.open(pdf)
    try:
        offs: list[int] = []
        for i in range(4, len(doc)):
            w = doc[i].get_text("words")
            h = doc[i].rect.height
            nums = [t for x0, y0, x1, y1, t, *_ in w
                    if y0 > h * 0.88 and RE_FOOTER_NUM.fullmatch(t)]
            if len(nums) == 1:
                v = int(nums[0])
                if 0 <= i + 1 - v <= 10:
                    offs.append(i + 1 - v)
            if len(offs) >= 12:
                break
        if len(offs) >= 3:
            return int(statistics.median(offs))
        toc_last = max(_load_etoc().find_toc_pages(doc), default=-1)
        pages = ["".join(RE_CJK_SINGLE.findall(
            unicodedata.normalize("NFKC", p.get_text()))) for p in doc]
    finally:
        doc.close()

    probes: list[tuple[str, int]] = []
    for u in units[:8]:
        if not u.get("page"):
            continue
        s0 = (u.get("sections") or [{}])[0]
        st = "".join(RE_CJK_SINGLE.findall(norm_text(s0.get("title") or "")))
        if s0.get("page") and len(st) >= 4:
            probes.append((st[:6], s0["page"]))
        else:
            t = "".join(RE_CJK_SINGLE.findall(norm_text(u.get("title") or "")))
            if len(t) >= 2:
                probes.append((t[:6], u["page"]))
    fallback: list[int] = []
    for probe, page_no in probes:
        for idx in range(max(2, toc_last + 1), len(pages)):
            if probe in pages[idx]:
                fallback.append(idx + 1 - page_no)
                break
    return int(statistics.median(fallback)) if fallback else 4


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
    # 跨册共享同一 lessons 文件：必须缓存解析结果、收尾统一写盘。
    # 逐册重读并 dirty[lf]=j 会让后一册用磁盘旧状态覆盖前一册的改动，
    # 单次多册调用只有最后一册真正落盘（B-NE2 抽验实证）。
    lesson_cache: dict[Path, dict] = {}
    touched: set[Path] = set()

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
            # 单元页缺 null 时用首节页兜底（低年级目录只有节级页码），
            # 否则范围塌成 (1,1+40)，±3 守卫失效、目录假命中过检
            secs = u.get("sections") or []
            start = (u.get("page") or (secs[0].get("page") if secs else None) or 1)
            nxt = units[i + 1] if i + 1 < len(units) else None
            nxt_secs = (nxt.get("sections") or [{}]) if nxt else [{}]
            nxt_start = (nxt.get("page") if nxt else None) \
                or (nxt_secs[0].get("page") if nxt_secs else None)
            end = (nxt_start - 1) if nxt_start else start + 40
            key = str(u["index"]) if u.get("index") is not None else u["title"]
            unit_range[key] = (start, end)
            # 兼容「第N单元·主题」形式的可读单元值
            if u.get("index") is not None:
                unit_range[f"第{u['index']}单元"] = (start, end)

        n_ok = n_bad = 0
        for lf in sorted(LESSONS_DIR.glob("*.json")):
            j = lesson_cache.setdefault(
                lf, json.loads(lf.read_text(encoding="utf-8")))
            changed = False
            for l in j.get("lessons") or []:
                t = topic_by_id.get(l.get("topicId") or "")
                if not t or stem_of(t) != stem:
                    continue
                lo, hi = unit_range.get(unit_key(t["textbook"]["unit"]), (1, 10**4))
                for e in l.get("exercises") or []:
                    src = e.get("source")
                    label = (src or {}).get("label") or ""
                    m = RE_PAGE.search(label)
                    if not src or not m:
                        stats["noPage"] += 1
                        continue
                    toks = tokens_for(e, label)
                    long_cjk = max((len(x) for x in toks if re.fullmatch(r"[\u4e00-\u9fff]+", x)),
                                   default=0)
                    need = 1 if long_cjk >= 6 else 2
                    best_idx, best_cov = None, 0
                    if toks:
                        for idx, ptxt in enumerate(pages):
                            if idx < off:
                                continue  # 书前页/目录（打印页 <1），防止目录假命中
                            cov = sum(1 for tk in toks if tk in ptxt)
                            if cov > best_cov:
                                best_cov, best_idx = cov, idx
                    printed = best_idx + 1 - off if best_idx is not None else None
                    if toks and printed is not None and best_cov >= need and lo - 3 <= printed <= hi + 3:
                        base = label.replace("·页码待复核", "")
                        src["label"] = base[:m.start()] + f"P{printed}" + base[m.end():]
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
                touched.add(lf)
        print(f"  {stem}: 重定位 {n_ok} / 待复核 {n_bad} (off={off})")

    for lf in sorted(touched):
        lf.write_text(json.dumps(lesson_cache[lf], ensure_ascii=False, indent=1)
                      + "\n", encoding="utf-8")
    MISS_PATH.parent.mkdir(parents=True, exist_ok=True)
    MISS_PATH.write_text(json.dumps(misses, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\n完成：重定位 {stats['relocated']} / 待复核 {stats['miss']} / 无页码标注 {stats['noPage']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
