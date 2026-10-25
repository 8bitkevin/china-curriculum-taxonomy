#!/usr/bin/env python3
"""fetch-textbooks.py — 从 ChinaTextbook 仓库按需下载小/初/高中教材 PDF。

用途：为 taxonomy 构建提供教材目录校验源。PDF 仅作本地参考，
不入库、不再分发（见 README 版权说明）。

每个学科选定一个主流版本（选取原则见 README「教材版本基线」）：
小学 8 科（数学/语文/英语/科学/道法/音乐/美术/体育）、
初中中考 9 科（语文/道法/历史为统编版，其余人教版）、
高中高考 9 科（语文/历史/思想政治为统编版，数学为人教 A 版，其余人教版）。

远端仓库结构（六三学制）：
    小学/{学科}/{版本}/{册}.pdf
    初中/{学科}/{版本}/{年级}/{册}.pdf
    高中/{学科}/{版本}/{册}.pdf
超过 50MB 的文件被上游拆成 35MB 分片（foo.pdf.1、foo.pdf.2…），
按序拼接即还原（上游 README 明确说明）。

用法：
    python scripts/fetch-textbooks.py            # 下载缺失的教材到 textbooks/
    python scripts/fetch-textbooks.py --toc      # 只提取各册目录文本

需要代理时设置环境变量 http_proxy/https_proxy（本机默认 127.0.0.1:7897）。
可选设置 GITHUB_TOKEN 提升树接口限额（整轮下载只调一次 API）。
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

REPO = "8bitkevin/ChinaTextbook"
BRANCH = "master"
GRADES = ["一", "二", "三", "四", "五", "六"]
JH_GRADES = ["七", "八", "九"]
VOLUMES = ["上", "下"]

# ---------------------------------------------------------------- 选版配置

# 小学：{学科: 远端版本目录}（相对仓库根，不含「小学/」前缀）
PRIMARY = {
    "数学": "数学/人教版",
    "语文": "语文/统编版",
    "道德与法治": "道德与法治/统编版",
    "英语": "英语/人教版（PEP）（三年级起点）（主编：吴欣）",
    "科学": "科学/教科版",
    "音乐": "音乐/人教版（简谱）",
    "美术": "美术/人教版",
    "体育与健康": "体育与健康/人教版",
}

# 初中：{学科: 远端版本目录}（不含「初中/」前缀）
JUNIOR = {
    "语文": "语文/统编版-人民教育出版社",
    "数学": "数学/人教版-人民教育出版社",
    "英语": "英语/人教版-人民教育出版社",
    "物理": "物理/人教版-人民教育出版社",
    "化学": "化学/人教版-人民教育出版社",
    "生物学": "生物学/人教版-人民教育出版社",
    "历史": "历史/统编版-人民教育出版社",
    "道德与法治": "道德与法治/统编版-人民教育出版社",
    "地理": "地理/人教版-人民教育出版社",
}

# 高中：{学科: 远端版本目录前缀}（不含「高中/」前缀）
SENIOR = {
    "语文": "语文/统编版",
    "数学": "数学/人教版（A版）",
    "英语": "英语/人教版",
    "物理": "物理/人教版",
    "化学": "化学/人教版",
    "生物学": "生物学/人教版",
    "历史": "历史/统编版",
    "思想政治": "思想政治/统编版",
    "地理": "地理/人教版",
}

# 初中历史册名含「中国历史 / 世界历史」变体，统一归一到「历史」
JUNIOR_ALIASES = {"历史": ["中国历史", "世界历史", "历史"]}

# 体育与健康（小学）为「1至2年级全一册」式跨年级合册
COMBINED_PAIRS = [("1", "2"), ("3", "4"), ("5", "6")]


# ---------------------------------------------------------------- 远端访问

def api_json(url: str) -> dict:
    headers = {"User-Agent": "taxonomy-builder"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def fetch_tree() -> dict:
    """一次性拉取整棵仓库树，返回 {路径: 字节数}。"""
    url = f"https://api.github.com/repos/{REPO}/git/trees/{BRANCH}?recursive=1"
    data = api_json(url)
    if data.get("truncated"):
        sys.exit("仓库树被截断（超过 API 条目上限），请改用 contents API 方案")
    return {e["path"]: e.get("size", 0) for e in data["tree"] if e["type"] == "blob"}


def raw_url(path: str) -> str:
    return (
        f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/"
        + urllib.parse.quote(path)
    )


def fetch(url: str, dest: str, attempts: int = 3) -> None:
    tmp = dest + ".part"
    for i in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=300) as resp, open(tmp, "wb") as out:
                while chunk := resp.read(1 << 20):
                    out.write(chunk)
            os.replace(tmp, dest)
            return
        except Exception as e:  # noqa: BLE001 — 网络重试
            if os.path.exists(tmp):
                os.remove(tmp)
            if i == attempts:
                raise
            print(f"  ! 第 {i} 次下载失败（{e}），重试…")
            time.sleep(3 * i)


def parts_of(path: str, tree: dict) -> list:
    """逻辑文件的远端分片路径列表：单文件返回 [path]，拆分返回 [path.1, path.2…]。"""
    if path in tree:
        return [path]
    parts, n = [], 1
    while f"{path}.{n}" in tree:
        parts.append(f"{path}.{n}")
        n += 1
    return parts


def download(path: str, dest: str, tree: dict) -> None:
    """下载一个逻辑文件；多于一个分片时按序拼接（上游 50MB 拆分约定）。"""
    parts = parts_of(path, tree)
    if not parts:
        sys.exit(f"远端找不到 {path}")
    if len(parts) == 1:
        fetch(raw_url(parts[0]), dest)
    else:
        chunks = []
        for p in parts:
            tmp = dest + f".chunk{parts.index(p)}"
            fetch(raw_url(p), tmp)
            chunks.append(tmp)
        with open(dest, "wb") as out:
            for c in chunks:
                with open(c, "rb") as f:
                    while chunk := f.read(1 << 20):
                        out.write(chunk)
                os.remove(c)
    print(f"✓ {os.path.basename(dest)} ({os.path.getsize(dest) // 1024 // 1024} MB)")


# ---------------------------------------------------------------- 匹配计划

def match_primary(tree: dict) -> list:
    """小学：{g}年级{v}册 + 体育合册。本地名 {学科}{g}年级{v}册.pdf。
    计划保留完整树路径（小学文件直接位于版本目录下，但以完整路径为准更稳）。"""
    plan = []
    for subject, rel in PRIMARY.items():
        prefix = f"小学/{rel}/"
        paths = [p for p in tree if p.startswith(prefix)]
        for g in GRADES:
            for v in VOLUMES:
                hit = next(
                    (p for p in paths if subject in p and f"{g}年级{v}册" in p), None
                )
                if hit:
                    plan.append((hit, f"{subject}{g}年级{v}册.pdf"))
        if subject == "体育与健康":
            for lo, hi in COMBINED_PAIRS:
                hit = next(
                    (p for p in paths if subject in p and f"{lo}至{hi}年级全一册" in p),
                    None,
                )
                if hit:
                    plan.append((hit, f"{subject}{lo}至{hi}年级全一册.pdf"))
    return plan


def match_junior(tree: dict) -> list:
    """初中：{g}年级{v}册 / {g}年级全一册，历史册名变体归一。本地名 初中{学科}…。
    远端版本目录下还有一层年级子目录，计划必须保留完整树路径。"""
    plan = []
    for subject, rel in JUNIOR.items():
        prefix = f"初中/{rel}/"
        paths = [p for p in tree if p.startswith(prefix)]
        aliases = JUNIOR_ALIASES.get(subject, [subject])
        for g in JH_GRADES:
            for v in VOLUMES + ["全一册"]:
                hit = next(
                    (
                        p
                        for p in paths
                        if os.path.basename(p).startswith("义务教育教科书")
                        and any(a in os.path.basename(p) for a in aliases)
                        and f"{g}年级{v}" in p
                    ),
                    None,
                )
                if hit:
                    suffix = v if v == "全一册" else v + "册"
                    plan.append((hit, f"初中{subject}{g}年级{suffix}.pdf"))
    return plan


def match_senior(tree: dict) -> list:
    """高中：普通高中教科书·{学科}[（A版）]必修/选择性必修 …。
    本地名 高中{学科}{书名}.pdf，去掉空格与「（A版）」。"""
    plan = []
    head = "普通高中教科书·"
    for subject, rel in SENIOR.items():
        prefix = f"高中/{rel}"
        for p in tree:
            if not p.startswith(prefix):
                continue
            base = os.path.basename(p)
            if not base.startswith(head):
                continue  # 跳过「学生读本」等非教科书附件
            title = re.sub(r"\.pdf(\.\d+)?$", "", base[len(head):])
            if not (title.startswith(subject) or title.startswith(f"{subject}（")):
                continue
            clean = title.replace(f"{subject}（A版）", subject).replace(" ", "")
            logical = re.sub(r"\.\d+$", "", p)  # 去掉分片序号，保留 .pdf
            plan.append((logical, f"高中{clean}.pdf"))
    # 分片会展开成多条树路径，按逻辑路径去重
    return list(dict.fromkeys(plan))


# ---------------------------------------------------------------- 主流程

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--toc", action="store_true", help="只提取目录文本")
    args = ap.parse_args()

    root = os.path.join(os.path.dirname(__file__), "..", "textbooks")
    os.makedirs(root, exist_ok=True)

    if args.toc:
        from pypdf import PdfReader

        for fname in sorted(os.listdir(root)):
            if not fname.endswith(".pdf"):
                continue
            path = os.path.join(root, fname)
            reader = PdfReader(path)
            print(f"===== {fname} =====")
            # 目录通常在第 3-6 页（0 基索引 2-5）
            for i in range(2, 7):
                if i >= len(reader.pages):
                    break
                text = (reader.pages[i].extract_text() or "").strip()
                if "目" in text and "录" in text or text:
                    print(f"--- 第{i + 1}页 ---")
                    print(text[:600])
        return

    tree = fetch_tree()
    plan = match_primary(tree) + match_junior(tree) + match_senior(tree)
    total_mb = sum(
        sum(tree.get(f"{p}.{n}", 0) for n in range(1, 10)) or tree.get(p, 0)
        for p, _ in plan
    ) // 1048576
    print(f"共匹配 {len(plan)} 册（约 {total_mb} MB），开始核对本地…")

    done = 0
    for path, local in sorted(plan, key=lambda kv: kv[1]):
        dest = os.path.join(root, local)
        if os.path.exists(dest):
            continue
        download(path, dest, tree)
        done += 1
    print(f"完成：本次新下载 {done} 册，目录 {os.path.abspath(root)}")


if __name__ == "__main__":
    main()
