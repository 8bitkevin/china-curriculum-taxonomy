#!/usr/bin/env python3
"""fetch-textbooks.py — 从 ChinaTextbook 仓库按需下载小学数学人教版教材 PDF。

用途：为 taxonomy 构建提供教材目录校验源。PDF 仅作本地参考，
不入库、不再分发（见 README 版权说明）。

用法：
    python scripts/fetch-textbooks.py            # 下载缺失的教材到 textbooks/
    python scripts/fetch-textbooks.py --toc      # 只提取各册目录文本

需要代理时设置环境变量 http_proxy/https_proxy（默认走 127.0.0.1:7897）。
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

REPO = "8bitkevin/ChinaTextbook"
REMOTE_DIR = "小学/数学/人教版"
GRADES = ["一", "二", "三", "四", "五", "六"]
VOLUMES = ["上", "下"]

# 本地命名规范：数学{年级}年级{册}册.pdf
def local_name(grade: str, volume: str) -> str:
    return f"数学{grade}年级{volume}册.pdf"


def api(path: str) -> list:
    url = (
        "https://api.github.com/repos/" + REPO + "/contents/"
        + urllib.parse.quote(path) + "?ref=master"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "taxonomy-builder"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def encode_url(url: str) -> str:
    # GitHub API 返回的 download_url 未对非 ASCII 与空格编码，补上
    return urllib.parse.quote(url, safe=":/?&=%")


def download(remote_name: str, dest: str) -> None:
    url = None
    for it in api(REMOTE_DIR):
        if it["name"] == remote_name:
            url = encode_url(it["download_url"])
            break
    if url is None:
        sys.exit(f"远端找不到 {remote_name}")
    tmp = dest + ".part"
    with urllib.request.urlopen(url, timeout=300) as resp, open(tmp, "wb") as out:
        while chunk := resp.read(1 << 20):
            out.write(chunk)
    os.replace(tmp, dest)
    print(f"✓ {dest} ({os.path.getsize(dest) // 1024 // 1024} MB)")


def find_remote_names() -> dict:
    """返回 {(grade, volume): 远端文件名}；兼容「 · 」与「·」两种命名。"""
    mapping = {}
    for it in api(REMOTE_DIR):
        name = it["name"]
        if not name.endswith(".pdf"):
            continue
        for g in GRADES:
            for v in VOLUMES:
                if f"数学{g}年级{v}册" in name:
                    mapping[(g, v)] = name
    return mapping


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--toc", action="store_true", help="只提取目录文本")
    args = ap.parse_args()

    root = os.path.join(os.path.dirname(__file__), "..", "textbooks")
    os.makedirs(root, exist_ok=True)
    names = find_remote_names()

    if args.toc:
        from pypdf import PdfReader

        for (g, v), _ in sorted(
            names.items(), key=lambda kv: (GRADES.index(kv[0][0]), VOLUMES.index(kv[0][1]))
        ):
            path = os.path.join(root, local_name(g, v))
            if not os.path.exists(path):
                print(f"— 跳过缺失的 {path}")
                continue
            reader = PdfReader(path)
            print(f"===== {g}年级{v}册 =====")
            # 目录通常在第 3-6 页（0 基索引 2-5）
            for i in range(2, 7):
                if i >= len(reader.pages):
                    break
                text = (reader.pages[i].extract_text() or "").strip()
                if "目" in text and "录" in text or text:
                    print(f"--- 第{i + 1}页 ---")
                    print(text[:600])
        return

    for (g, v), remote in sorted(
        names.items(), key=lambda kv: (GRADES.index(kv[0][0]), VOLUMES.index(kv[0][1]))
    ):
        dest = os.path.join(root, local_name(g, v))
        if os.path.exists(dest):
            print(f"— 已存在 {dest}")
            continue
        download(remote, dest)


if __name__ == "__main__":
    main()
