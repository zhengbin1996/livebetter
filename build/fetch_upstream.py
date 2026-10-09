"""拉取上游 HowToLiveBetter 的最新内容到 upstream/。

为什么不让 Actions 直接 git clone：
    只需要一份只读快照，tarball 比整仓 clone 快得多（没有历史）。
    而且**先把 commit sha 定下来，再按这个 sha 下载**，
    避免「版本号取自 API、内容取自 tarball」两边对不上的竞态。

用法（仓库根目录）：
    python build/fetch_upstream.py                 # 拉 main 最新
    python build/fetch_upstream.py --ref <sha>     # 拉指定 commit
    python build/fetch_upstream.py --repo a/b --ref main
"""

from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import UPSTREAM, log  # noqa: E402

DEFAULT_REPO = "eternity4719/HowToLiveBetter"
UA = {"User-Agent": "htb-build", "Accept": "application/vnd.github+json"}


def api_json(url: str, token: str = "") -> dict:
    headers = dict(UA)
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def resolve_ref(repo: str, ref: str, token: str) -> tuple[str, str, str]:
    """把 ref（分支名 / sha）解析成 (sha, iso_date, subject)。"""
    if len(ref) == 40 and all(c in "0123456789abcdef" for c in ref.lower()):
        d = api_json(f"https://api.github.com/repos/{repo}/commits/{ref}", token)
    else:
        d = api_json(f"https://api.github.com/repos/{repo}/commits/{ref}", token)
    return d["sha"], d["commit"]["committer"]["date"], d["commit"]["message"].splitlines()[0]


def download_tarball(repo: str, sha: str) -> Path:
    url = f"https://codeload.github.com/{repo}/tar.gz/{sha}"
    log(f"  下载 {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "htb-build"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    log(f"  收到 {len(raw) / 1024 / 1024:.1f} MB")

    tmp = UPSTREAM.parent / "_upstream_tmp"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)

    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tf:
        # 防路径穿越
        members = [m for m in tf.getmembers() if not m.name.startswith("/") and ".." not in m.name]
        tf.extractall(tmp, members=members)

    tops = [p for p in tmp.iterdir() if p.is_dir()]
    if len(tops) != 1:
        raise RuntimeError(f"tarball 顶层目录不是 1 个：{[p.name for p in tops]}")

    if UPSTREAM.exists():
        shutil.rmtree(UPSTREAM)
    shutil.move(str(tops[0]), str(UPSTREAM))
    shutil.rmtree(tmp, ignore_errors=True)
    return UPSTREAM


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=os.environ.get("UPSTREAM_REPO", DEFAULT_REPO))
    ap.add_argument("--ref", default=os.environ.get("UPSTREAM_REF", "main"))
    ap.add_argument("--token", default=os.environ.get("GITHUB_TOKEN", ""))
    args = ap.parse_args()

    log(f"[fetch] {args.repo}@{args.ref}")
    try:
        sha, date, subject = resolve_ref(args.repo, args.ref, args.token)
    except Exception as e:
        log(f"  !! 解析 commit 失败：{e}")
        return 1
    log(f"  commit {sha[:7]}（{date}）{subject}")

    # 已经是同一份就不重复下载
    cache = UPSTREAM / ".commit.json"
    if cache.exists() and UPSTREAM.joinpath("book").exists():
        try:
            if json.loads(cache.read_text(encoding="utf-8")).get("sha") == sha:
                log("  已是最新，跳过下载")
                return 0
        except Exception:
            pass

    try:
        download_tarball(args.repo, sha)
    except Exception as e:
        log(f"  !! 下载失败：{e}")
        return 1

    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(
        json.dumps({"sha": sha, "date": date, "subject": subject}, ensure_ascii=False),
        encoding="utf-8",
    )
    log(f"  完成 → {UPSTREAM}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
