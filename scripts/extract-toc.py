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

# 全学科卷册注册表（D-015：8 学科 + 数学；mode 决定目录形态解析策略）
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

def _volumes(prefix: str, grades: range, sems="上下") -> list[str]:
    return [f"{prefix}{CN_DIGITS[g]}年级{v}册" for g in grades for v in sems]

# mode: math（第X章/N.M/小学单元行） unit（第X单元|Unit N → 单元，第N课/课题N/编号行 → 节）
#        lesson（第N课 → 单元，框/编号行 → 节）
VOLUME_MODE: dict[str, str] = {}
def _reg(names: list[str], mode: str):
    for n in names:
        VOLUME_MODE[n] = mode

_reg(MATH_VOLUMES, "math")
_reg(_volumes("语文", range(1, 7)), "unit")                                   # 小学语文 统编
_reg(_volumes("初中语文", range(7, 10)), "unit")                               # 初中语文 统编
_reg(["高中语文必修上册", "高中语文必修下册",
       "高中语文选择性必修上册", "高中语文选择性必修中册", "高中语文选择性必修下册"], "unit")
_reg(_volumes("英语", range(3, 7)), "unit")                                    # 小学 PEP（三起）
_reg(_volumes("初中英语", range(7, 9)), "unit")
_reg(["初中英语九年级上册", "初中英语九年级下册"], "unit")  # 新版九年级拆上/下册（D-034；原全一册）
_reg([f"高中英语必修第{n}册" for n in "一二三"] +
     [f"高中英语选择性必修第{n}册" for n in "一二三四"], "unit")
_reg(_volumes("初中物理", range(8, 9)), "math")                                # 人教初中物理：章+节
_reg(["初中物理八年级下册", "初中物理九年级全一册"], "math")
_reg([f"高中物理必修第{n}册" for n in "一二三"] +
     [f"高中物理选择性必修第{n}册" for n in "一二三"], "math")
_reg(_volumes("初中化学", range(9, 10)), "unit")                               # 人教初中化学：单元+课题
_reg(["初中化学九年级下册"], "unit")
_reg([f"高中化学必修第{n}册" for n in "一二"] +   # 人教 2019 高中化学共 5 册（必修 2 + 选必 3）
     ["高中化学选择性必修1化学反应原理", "高中化学选择性必修2物质结构与性质",
      "高中化学选择性必修3有机化学基础"], "math")
_reg(_volumes("初中生物学", range(7, 9)), "unit")                              # 人教初中生物：单元+章
_reg([f"高中生物学必修{n}分子与细胞" if n == "1" else f"高中生物学必修{n}遗传与进化" for n in "12"] +
     ["高中生物学选择性必修1稳态与调节", "高中生物学选择性必修2生物与环境",
      "高中生物学选择性必修3生物技术与工程"], "math")
_reg(_volumes("初中历史", range(7, 10)), "unit")                               # 统编初中历史：单元+课
_reg(["高中历史必修中外历史纲要（上）", "高中历史必修中外历史纲要（下）",
       "高中历史选择性必修1国家制度与社会治理", "高中历史选择性必修2经济与社会生活",
       "高中历史选择性必修3文化交流与传播"], "unit")
_reg(_volumes("初中地理", range(7, 9)), "math")                                # 人教初中地理：章+节
_reg(["高中地理必修第一册", "高中地理必修第二册",
       "高中地理选择性必修1自然地理基础", "高中地理选择性必修2区域发展",
       "高中地理选择性必修3资源、环境与国家安全"], "math")
_reg(_volumes("道德与法治", range(1, 7)), "unit")                              # 统编小学道法：单元
_reg(_volumes("初中道德与法治", range(7, 10)), "unit")                          # 统编初中道法：单元+课
_reg(["高中思想政治必修1中国特色社会主义", "高中思想政治必修2经济与社会",
       "高中思想政治必修3政治与法治", "高中思想政治必修4哲学与文化"], "lesson")
_reg(["高中思想政治选择性必修1当代国际政治与经济", "高中思想政治选择性必修2法律与生活",
       "高中思想政治选择性必修3逻辑与思维"], "unit")

ALL_VOLUMES = list(VOLUME_MODE)

CN_NUM = "一二三四五六七八九十百"
CN_DIGIT_TABLE = {c: i for i, c in enumerate("一二三四五六七八九", 1)}
RE_CHAPTER = re.compile(r"^第([0-9０-９一二三四五六七八九十百]+)\s*章\s*(\S.*)?$")   # 第X章（中/阿数字；生物学新版目录「第1 章」号与章字间有空格）
RE_SECTION = re.compile(r"^(\d{1,2})[.．](\d{1,2})\s*(\S.*)?$")
RE_UNIT_HEAD = re.compile(r"^([0-9０-９]{1,2}|[一二三四五六七八九十]{1,3})[\s　]+(.+)$")  # 号在标题前：「1 准备课」「一 数学游戏」
RE_PAGE_TAIL = re.compile(r"(?<![0-9.~%％])(\d{1,3})$")   # 行尾页码（允许紧贴标题）
RE_UNIT_TAIL = re.compile(r"[\s　](\d{1,2})$")          # 行尾单元号（页码剥离后）
RE_LONE_NUM = re.compile(r"^[一二三四五六七八九十]{1,3}$")  # 独行中文单元号（新版权号列与标题行 y 错位）
RE_NOISE = re.compile(r"仅供个人学习|扫码|APP|下载")      # 平台电子书水印/推广行

# 多学科目录形态（D-015/D-016）
RE_UNIT_CN = re.compile(r"^第([一二三四五六七八九十\d]{1,3})单元\s*(\S.*)?$")   # 第X单元 标题
RE_UNIT_EN = re.compile(r"^(?:\d{1,3}[\s.．]+)?Unit\s*(\d{1,2})(?![\d.．])[\s.．]*(\S.*)?$", re.I)  # [页码] Unit N 标题（紧凑匹配需放宽 \b）
RE_LESSON_CN = re.compile(r"^第\s*([一二三四五六七八九十\d]{1,3})\s*课\s*(\S.*)?$")  # 第N课 标题
RE_TOPIC_CN = re.compile(r"^课题\s*(\d{1,2})[.．:：]?\s*(\S.*)?$")             # 课题N 标题（初中化学）
RE_SECTION_CN = re.compile(r"^第\s*([一二三四五六七八九十\d]{1,3})\s*节\s*(\S.*)?$")  # 第N节 标题（物理/地理）
RE_SECTION_DOT = re.compile(r"^(\d{1,2})[.．]\s*(\S.*)?$")                     # 「1. 质点」（人教高中）
# 小学语文块标题（无「第X单元」编号的单元结构；新版「我上学了」导入单元同收）
RE_BLOCK_UNIT = re.compile(r"^(识字|汉语拼音|课文|我上学了)([（(][一二三四五六][）)])?$")
# 单元模式下作为「节」收录的栏目行（语文/英语教材结构锚点）
RE_SPECIAL_SECTION = re.compile(
    r"^(◎|口语交际|写作|语文园地|快乐读书吧|和大人一起读|名著导读|"
    r"综合性学习|单元学习任务|课外古诗词诵读|Recycle\s*\d.*|"
    r"附录|Appendix.*|Notes|注|生字表|词语表)\S*$|"
    r"^(写作|口语交际|语文园地|快乐读书吧|综合性学习|单元学习任务|名著导读|课外古诗词诵读|Recycle\s*\d.*)$"
)

# 无单元号但收录的条目（综合整理/实践篇；新版主题单元「欢乐购物街」=人民币、
# 「时间在哪里」=时间主题、「数学连环画」=综合实践）
SPECIAL_UNITS = {"总复习", "数学乐园", "整理和复习", "数学游戏", "复习与关联",
                 "欢乐购物街", "时间在哪里", "数学连环画", "年、月、日的秘密",
                 "1亿有多大", "寻找宝藏"}
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


def rows_two_columns(page: "fitz.Page", split: float = 0.5) -> list[list[str]]:
    """双栏目录页：按 split×页宽 竖线拆分左右栏各自重建行（先左栏后右栏顺读）。

    rebuild_rows 会把左右栏同一 y 的文本并成一行（「第五单元·阅读 19 雾在哪里…84」），
    双栏目录必须先拆栏；版心不均分的页面由调用方多试几个 split 取最优。"""
    mid = page.rect.width * split
    left: list[tuple[float, float, str]] = []
    right: list[tuple[float, float, str]] = []
    for blk in page.get_text("dict")["blocks"]:
        if blk.get("type") != 0:
            continue
        for ln in blk.get("lines", []):
            text = "".join(s["text"] for s in ln["spans"]).strip()
            if text:
                (left if ln["bbox"][0] < mid else right).append(
                    (ln["bbox"][1], ln["bbox"][0], text))

    def rows_of(frags: list[tuple[float, float, str]]) -> list[list[str]]:
        frags.sort(key=lambda t: (t[0], t[1]))
        rows: list[tuple[float, list[tuple[float, str]]]] = []
        for y, x, text in frags:
            if rows and abs(y - rows[-1][0]) <= 12:
                rows[-1][1].append((x, text))
            else:
                rows.append((y, [(x, text)]))
        return [[t for _, t in sorted(seg)] for _, seg in rows]

    return rows_of(left) + rows_of(right)


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
        compacts = [re.sub(r"[\s　]+", "", l) for l in lines]
        # 低年级目录逐字空格排版（「第 一 单 元 …」）与双栏页：紧凑行才能匹配单元头
        prose = sum(1 for l in lines
                    if (l.count("。") + l.count("，") + l.count(",")) >= 2 and len(l) >= 10)
        if prose >= 3:  # 正文页（散文行密集）不作为目录
            continue
        head = lines[0][:6]
        numbered = sum(1 for l in lines if RE_PAGE_TAIL.search(l))
        dots = " ".join(lines).count("…") + " ".join(lines).count("....")
        chapters = sum(1 for l in compacts if RE_CHAPTER.match(l))
        # 续页：紧邻已命中页 + 页码行多 + 行短而少（目录排版特征，
        # 排除正文中数字密集的页面）。行长按剥掉点引导线后的正文计
        # （生物学新版目录行点线占比过半，会把 avg_len 撑过 40 误杀尾页）
        lens = [len(re.sub(r"[.…·]{2,}", "", l)) for l in lines if l]
        avg_len = sum(lens) / len(lens) if lens else 0
        cont = (hits and i == hits[-1] + 1 and (numbered >= 2 or chapters >= 1)
                and avg_len <= 40)
        # 英语教材目录页标题为 CONTENTS，页码常成列独立成行：靠 Unit N 行数识别；
        # 双栏合并行一行含两个「第X单元」：按出现次数计数而非锚定匹配；
        # 历史/道法等「第N课」目录同样计数
        unit_rows = sum(len(re.findall(r"第[一二三四五六七八九十\d]{1,3}单元", l))
                        for l in compacts)
        unit_rows += sum(len(re.findall(r"第[一二三四五六七八九十\d]{1,3}课", l))
                         for l in compacts)
        unit_rows += sum(1 for l in compacts if RE_UNIT_EN.match(l))
        is_toc = ("目" in head and "录" in head and (numbered >= 3 or dots >= 2)) or (
            numbered >= 5 and (dots >= 2 or chapters >= 2)) or (
            chapters >= 2 and dots >= 2) or (  # 章行页码紧贴点线无法按页码行计数（生物学新版）
            unit_rows >= 3) or (
            "CONTENTS" in " ".join(lines).upper() and len(lines) >= 6) or cont
        if is_toc:
            hits.append(i)
    return hits


def merge_lone_numerals(merged: list[str]) -> list[str]:
    """新版权号列与标题行 y 基线错位，序号独占一行（「数学游戏 1」「一」「5以内… 12」）。

    独行序号属于其后最近的一个标题行：并入下一行形成「N 标题 页码」。"""
    out: list[str] = []
    i = 0
    while i < len(merged):
        if RE_LONE_NUM.fullmatch(merged[i]) and i + 1 < len(merged):
            out.append(f"{merged[i]} {merged[i + 1]}")
            i += 2
            continue
        out.append(merged[i])
        i += 1
    return out


def parse_toc_rows(rows: list[list[str]], mode: str = "math") -> list[dict]:
    """把目录页重建行解析为单元/节条目。

    mode=math（默认，数学/物理/地理/高中理化生地等）：
    - 章行「第X章 标题 [页码]」→ 单元，index 取中文数字；
    - 节行「1.1 标题」「第N节 标题」「1. 标题」→ 归入最近章的 sections；
    - 小学单元行「1 准备课 2」→ 单元；
    - 长标题折行重组；无号行仅收 SPECIAL_UNITS；同号去重 + 单元号回退截断。

    mode=unit（语文/英语/历史/道法/初中化学/初中生物等）：
    - 「第X单元 标题」「Unit N 标题」→ 单元；
    - 「第N课/课题N/N 标题」→ 归入最近单元的 sections；
    - 栏目行（写作/口语交际/语文园地/Recycle/附录…）→ sections。

    mode=lesson（高中思想政治必修 1-4）：「第N课」→ 单元，其余行归 sections。
    """
    texts: list[str] = []
    for seg in rows:
        line = norm(" ".join(seg))
        line = re.sub(r"[…\.]{3,}", " ", line).strip()  # 剥省略引导线
        if line and not RE_NOISE.search(line):
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
    merged = merge_lone_numerals(merged)  # 新版权号列独行序号并入下一标题行

    if mode in ("unit", "lesson"):
        return parse_unit_lesson_mode(merged, mode)

    # 章标题折行（高中地理：「第一章」与「宇宙中的地球」分行）：并回章行
    i = 0
    while i < len(merged):
        cm = RE_CHAPTER.match(merged[i])
        if cm and not (cm.group(2) or "").strip() and i + 1 < len(merged):
            nt, np_ = strip_page(merged[i + 1])
            if nt and not RE_CHAPTER.match(nt) and not RE_SECTION.match(nt) and not RE_SECTION_DOT.match(nt):
                merged[i] = f"第{cm.group(1)}章 {nt}" + (f" {np_}" if np_ else "")
                del merged[i + 1]
                continue
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
        if m:  # 中学/高中：第X章 标题 [页码]（章号中/阿数字均可）
            title, page = strip_page(m.group(2) or "")
            if title:
                units.append({"index": _unit_index(m.group(1)), "title": title,
                              "page": page, "sections": []})
            continue
        m = RE_SECTION.match(line)
        if m and units and "sections" in units[-1]:
            title, page = strip_page(m.group(3) or "")
            units[-1]["sections"].append(
                {"no": f"{m.group(1)}.{m.group(2)}", "title": title, "page": page})
            continue
        # 「第N节 标题」（人教初中物理/地理）与「N. 标题」（人教高中理科）
        if units and "sections" in units[-1]:
            sm = RE_SECTION_CN.match(re.sub(r"[\s　]+", "", line))
            if sm:
                title, page = strip_page(sm.group(2) or "")
                units[-1]["sections"].append(
                    {"no": f"第{sm.group(1)}节", "title": title, "page": page})
                continue
            sm = RE_SECTION_DOT.match(line)
            if sm:
                title, page = strip_page(sm.group(2) or "")
                units[-1]["sections"].append(
                    {"no": sm.group(1), "title": title, "page": page})
                continue
        # 章结构书（math 模式：章+节）中「N 标题」行是节内小节（生物学新版目录），
        # 不是单元：跳过，防止误判为单元并触发序号回退提前终止目录
        if units and "sections" in units[-1] and RE_UNIT_HEAD.match(line):
            continue
        # 小学单元行：「1 准备课 2」「认识图形（一）4 34」（标题可为单字：比、圆）
        title, page = strip_page(line)
        m = RE_UNIT_HEAD.match(title)
        if m:
            title, index = m.group(2), _unit_index(m.group(1))
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


RE_DOT_PAGE = re.compile(r"[.…·]{2,}(\d{1,3})$")   # 目录点引导线紧贴页码（生物学新版「……39」）

def strip_page(line: str) -> tuple[str, int | None]:
    m = RE_PAGE_TAIL.search(line)
    if m:
        return line[: m.start()].strip(), int(m.group(1))
    m = RE_DOT_PAGE.search(line)  # 点线紧贴页码：连点带页码一起剥离
    if m:
        return line[: m.start()].strip(), int(m.group(1))
    return re.sub(r"[.…·\s]+$", "", line), None  # 无页码行也要剥掉尾部点线残留


def _unit_index(s: str) -> int | None:
    s = s.strip()
    return int(s) if s.isdigit() else cn2int(s)


def _is_pinyin(line: str) -> bool:
    """低年级道法/语文目录每字下印拼音注音行（如「kQi kQi xUn xUn shSng」）。
    特征 = 词内小写后跟大写（拼音声调记法 kQi/shSng）；普通英文标题无此形态。"""
    return bool(re.search(r"\b[a-z]+[A-Z]", line)) and not re.search(r"[\u4e00-\u9fff]", line)


def parse_unit_lesson_mode(merged: list[str], mode: str) -> list[dict]:
    """unit/lesson 形态解析：单元（或课）为骨架，编号行与栏目行归入 sections。"""
    units: list[dict] = []
    block_count: dict[str, int] = {}
    for raw in merged:
        line = raw
        if line.startswith("目") or line.upper().startswith("CONTENTS"):
            continue
        if line.startswith(MISC_PREFIXES) or _is_pinyin(line):
            continue
        # 低年级目录字间留空（「第 一 单 元 我 是 小 学 生 啦」）：去空格后匹配
        compact = re.sub(r"[\s　]+", "", line)
        # 「第一单元」行后独立成行的主题词（新版统编三上起）：并入单元标题
        if (compact in ("阅读", "识字", "汉语拼音", "快乐读书吧") and units
                and units[-1]["title"].startswith("第") and "·" not in units[-1]["title"]):
            units[-1]["title"] = f"{units[-1]['title']}·{compact}"
            continue
        m = RE_UNIT_CN.match(compact)
        if m and mode == "unit":
            idx = _unit_index(m.group(1))
            rest = m.group(2) or ""
            # 初中语文「第一单元 阅读 1 春/朱自清」：单元行混入块名与首课，拆出
            # （仅当块名后还有首课时；新版「第五单元·阅读」的纯主题词保留）
            title, page = strip_page(rest)
            title = title.lstrip("·．.、：:；;，,")  # 新版「第一单元·识字」分隔符
            bm = re.match(r"^(阅读|写作|活动|探究)\s+(.+)$", title)
            first_lesson = None
            if bm:
                first_lesson = bm.group(2)
                title = bm.group(1)
            units.append({"index": idx, "title": (title or f"第{m.group(1)}单元").rstrip("/ ·."),
                          "page": page, "sections": []})
            if first_lesson:
                lt, lp = strip_page(first_lesson)
                units[-1]["sections"].append({"no": None, "title": lt, "page": lp})
            continue
        m = RE_UNIT_EN.match(line)
        if m and mode == "unit":
            title, page = strip_page(m.group(2) or "")
            units.append({"index": int(m.group(1)),
                          "title": title or f"Unit {m.group(1)}", "page": page, "sections": []})
            continue        # 小学语文块标题单元：识字 / 汉语拼音 / 课文（同名单元自动加（二））
        bm = RE_BLOCK_UNIT.match(compact)
        if bm and mode == "unit":
            base = bm.group(1)
            n = block_count.get(base, 0) + 1
            block_count[base] = n
            title = base if n == 1 else f"{base}（{'二三四五六'[n - 2]}）"
            units.append({"index": None, "title": title, "page": None, "sections": []})
            continue
        if mode == "unit":
            # 2024 新版初中英语：单元行「N Title」（无 Unit 前缀，页码在 p.N 独立行）；
            # ASCII 标题判定避免误吞语文/道法的中文编号行
            em = re.match(r"^(\d{1,2})\s+([A-Za-z][A-Za-z0-9 .,'!?&\-:;()]{2,})$", line)
            if em and (not units or units[-1].get("index") != int(em.group(1))):
                units.append({"index": int(em.group(1)), "title": em.group(2).strip(),
                              "page": None, "sections": []})
                continue
        m = RE_LESSON_CN.match(compact)
        if m:
            idx = _unit_index(m.group(1))
            title, page = strip_page(m.group(2) or "")
            title = title.rstrip("/ ·.")  # 「开开心心上学去/2」的页码分隔符残留
            if mode == "lesson":
                units.append({"index": idx,
                              "title": title or f"第{m.group(1)}课", "page": page, "sections": []})
            elif units:
                units[-1]["sections"].append(
                    {"no": f"第{m.group(1)}课", "title": title, "page": page})
            continue
        m = RE_TOPIC_CN.match(line)
        if m and units:
            title, page = strip_page(m.group(2) or "")
            units[-1]["sections"].append(
                {"no": f"课题{m.group(1)}", "title": title, "page": page})
            continue
        # 课文行「1 天地人 6」：按空格重组（低年级逐字空格的还原为正常标题）
        title, page = strip_page(line)
        if not units or not title:
            continue
        if not RE_BLOCK_UNIT.match(compact):
            hm = RE_UNIT_HEAD.match(re.sub(r"([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", r"\1", title))
            if hm and len(hm.group(1)) <= 2 and not hm.group(2).isdigit():
                units[-1]["sections"].append({"no": hm.group(1), "title": hm.group(2), "page": page})
                continue
        m = RE_SECTION_CN.match(compact)
        if m:
            units[-1]["sections"].append({"no": f"第{m.group(1)}节", "title": m.group(2), "page": page})
            continue
        m = RE_SECTION_DOT.match(title)
        if m:
            units[-1]["sections"].append({"no": m.group(1), "title": m.group(2), "page": page})
            continue
        if RE_SPECIAL_SECTION.match(compact):
            t2, p2 = strip_page(compact)  # 压缩空格后页码粘连：剥回页码
            units[-1]["sections"].append({"no": None, "title": t2.lstrip("◎"), "page": p2})
            continue
        # 无编号课文行（新版「我上学了」导入课文等）：带页码即收录为节
        if page is not None and 0 < len(title) <= 30 and not title.isdigit():
            units[-1]["sections"].append({"no": None, "title": title, "page": page})
            continue
        if mode == "unit":
            # 2024 新版初中英语版块行「Listening and Speaking: …」→ 节
            sm = re.match(r"^([A-Z][A-Za-z /&:,'\-]{3,60}: [A-Za-z0-9 .,'!?&\-:;()]+)$", line)
            if sm and units:
                units[-1].setdefault("sections", []).append(
                    {"no": None, "title": sm.group(1).strip(), "page": None})
                continue
    for u in units:
        if not u["sections"]:
            del u["sections"]
    return units


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
    mode = VOLUME_MODE.get(stem, "math")
    units = parse_toc_rows(rows, mode=mode)
    if mode in ("unit", "lesson") and units:
        # 双栏目录自校验：正文行里的「第X单元」标记数多于解析出的单元数 → 拆栏重试
        # （版心不均分：多个分割点试拆，取单元数最多的结果）
        blob = re.sub(r"[\s　]+", "",
                      "".join(doc[i].get_text() for i in toc_idx[:3]))
        expected = len(set(re.findall(r"第[一二三四五六七八九十\d]{1,3}单元", blob)))
        # 新版初中英语：单元行「N Title」同样计入预期（双栏时触发拆栏重试）
        en_expected = sum(1 for r in rows
                          if re.match(r"^\d{1,2}\s+[A-Za-z]", norm(" ".join(r))))
        expected = max(expected, en_expected)
        if 0 < len([u for u in units if u.get("index") is not None]) < expected:
            best = units
            for split in (0.5, 0.42, 0.58):
                rows2: list[list[str]] = []
                for i in toc_idx[:3]:
                    rows2.extend(rows_two_columns(doc[i], split))
                units2 = parse_toc_rows(rows2, mode=mode)
                if len(units2) > len(best):
                    best = units2
            units = best
    doc.close()
    # 目录页后可能混入封面折页噪声：去掉过短/重复条目（同号同名才算重复，
    # 新版「第二/三/四单元·汉语拼音」同题不同号不可去重）
    seen, cleaned = set(), []
    for u in units:
        key = f"i{u['index']}|{u['title']}" if u.get("index") is not None else u["title"]
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(u)
    return {**meta, "source": "pdf-text",
            "extractedAt": datetime.date.today().isoformat(),
            "units": cleaned}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("volumes", nargs="*", help="册名（PDF stem），缺省为全学科卷册")
    ap.add_argument("--check", action="store_true",
                    help="只校验现有基线 JSON 与 PDF sha256 是否一致")
    args = ap.parse_args()
    targets = args.volumes or ALL_VOLUMES

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
        if jf.exists():
            prior = json.loads(jf.read_text(encoding="utf-8"))
            if prior.get("source") == "manual":
                # 人工基线优先于自动提取（含提取质量差而人工接管的情况）；仅刷新 PDF 指纹
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
