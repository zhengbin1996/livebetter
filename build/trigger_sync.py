"""触发云端 syncIngest 把刚发布的资产搬进云存储。

云函数单次执行有 60 秒上限，而 180+ 个分片一次搬不完，
所以本脚本**反复调用**直到 remaining 归零。

用法（仓库根目录）：
    SYNC_URL=https://xxx.service.tcloudbase.com/syncIngest python build/trigger_sync.py
    ... --force          忽略「同 commit 就跳过」，强制重搬
    ... --restart        丢掉断点进度，从头搬（一般不用）

环境变量
    SYNC_URL     云函数 HTTP 访问服务地址（必填）
    SYNC_TOKEN   与云函数 SYNC_TOKEN 一致时填（可选）
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import DIST, log  # noqa: E402

MAX_ROUNDS = 60


def post(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "htb-sync-trigger"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("SYNC_URL", ""))
    ap.add_argument("--token", default=os.environ.get("SYNC_TOKEN", ""))
    ap.add_argument("--force", action="store_true", default=os.environ.get("SYNC_FORCE") == "1")
    ap.add_argument("--restart", action="store_true")
    args = ap.parse_args()

    if not args.url:
        log("缺少 SYNC_URL（云函数 HTTP 访问服务地址）")
        return 1

    manifest_path = DIST / "manifest.json"
    expect_version = ""
    if manifest_path.exists():
        expect_version = json.loads(manifest_path.read_text(encoding="utf-8")).get("version", "")
    log(f"目标版本 {expect_version or '(未知)'} → {args.url}")

    for i in range(1, MAX_ROUNDS + 1):
        payload = {"token": args.token}
        if args.force and i == 1:
            payload["force"] = True
        if args.restart and i == 1:
            payload["restart"] = True
        elif i > 1:
            payload["continue"] = True

        try:
            res = post(args.url, payload)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            log(f"  [第 {i} 轮] HTTP {e.code}：{body}")
            return 1
        except Exception as e:
            log(f"  [第 {i} 轮] 调用失败：{e}")
            return 1

        if not res.get("ok"):
            log(f"  [第 {i} 轮] 云函数报错：{res.get('error')} {res.get('message', '')}")
            return 1

        if res.get("skipped"):
            log(f"  [第 {i} 轮] 云上已是同一 commit（{res.get('version')}），无需同步")
            return 0

        if res.get("done"):
            failed = res.get("failed") or 0
            status = res.get("syncStatus") or ("partial" if failed else "ok")
            log(
                f"  [第 {i} 轮] 翻转完成：版本 {res.get('version')}，"
                f"分片 {res.get('shards')}，失败 {failed}，状态 {status}"
            )
            if expect_version and res.get("version") != expect_version:
                log(f"  !! 注意：线上版本 {res.get('version')} 与本地构建 {expect_version} 不一致")
            if failed:
                log("  !! 有分片未同步成功，下一次定时任务会自动重试")
                return 0
            return 0

        log(
            f"  [第 {i} 轮] 已上传 {res.get('uploaded')}，累计 {res.get('uploadedTotal')}，"
            f"剩余 {res.get('remaining')}，失败 {res.get('failed')}"
        )
        time.sleep(1)

    log(f"超过 {MAX_ROUNDS} 轮仍未完成，请检查云函数日志")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
