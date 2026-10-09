"""把 dist/ 里的分片按 Release 资产命名规则摊平到 release/。

命名规则：路径里的 `/` 换成 `__`，扩展名保留。
    book/01.json            → book__01.json
    docs/verify/d-abc.json  → docs__verify__d-abc.json
    清单本身                 → manifest.json

**为什么要有这一步**：syncIngest 云函数是按 manifest 里 shard.path 反推资产名的
（`assetName()`）。让工作流也走同一份 manifest 来命名、并顺手复核 sha256，
命名规则就不会两头各写一遍、然后悄悄漂移。

用法（仓库根目录）：
    python build/stage_release.py            # dist/ → release/
    python build/stage_release.py --check    # 只校验，不落盘
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import DIST, ROOT, log, sha256_file  # noqa: E402

RELEASE = ROOT / "release"


def asset_name(rel_path: str) -> str:
    return rel_path.replace("/", "__")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写 release/")
    args = ap.parse_args()

    manifest_path = DIST / "manifest.json"
    if not manifest_path.exists():
        log(f"找不到 {manifest_path}，先跑 build/parse.py")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    shards = manifest.get("shards") or []
    log(f"分片 {len(shards)} 个，版本 {manifest.get('version')}")

    if not args.check:
        if RELEASE.exists():
            shutil.rmtree(RELEASE)
        RELEASE.mkdir(parents=True)

    total = 0
    bad = 0
    seen = {}
    for s in shards:
        rel = s["path"]
        src = DIST / rel
        if not src.exists():
            log(f"  缺失：{rel}")
            bad += 1
            continue

        got = sha256_file(src)
        if s.get("sha256") and got != s["sha256"]:
            log(f"  sha256 不符：{rel}")
            bad += 1
            continue

        name = asset_name(rel)
        if name in seen:
            log(f"  资产名撞车：{name}（{seen[name]} 与 {rel}）")
            bad += 1
            continue
        seen[name] = rel

        total += src.stat().st_size
        if not args.check:
            (RELEASE / name).write_bytes(src.read_bytes())

    if not args.check:
        (RELEASE / "manifest.json").write_bytes(manifest_path.read_bytes())

    log(f"资产 {len(seen)} 个，共 {total / 1024:.1f} KB" + ("（--check 未写盘）" if args.check else f" → {RELEASE}"))
    if bad:
        log(f"{bad} 个分片有问题")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
