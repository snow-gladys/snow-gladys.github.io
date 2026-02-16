#!/usr/bin/env python3
"""
检测 songs.json / songs_fiona.json 中的重名歌曲；
确认后只保留每首重名的第一项（name + bvid），写回原文件。

用法:
  python scripts/check-duplicate-names.py
  python scripts/check-duplicate-names.py songs.json
  python scripts/check-duplicate-names.py fiona/songs_fiona.json
"""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DEFAULT_JSON = os.path.join(ROOT_DIR, "songs.json")


def main():
    songs_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON
    if not os.path.isabs(songs_path):
        songs_path = os.path.join(ROOT_DIR, songs_path)

    if not os.path.isfile(songs_path):
        print(f"错误: 文件不存在 {songs_path}", file=sys.stderr)
        sys.exit(1)

    with open(songs_path, "r", encoding="utf-8") as f:
        songs = json.load(f)

    if not isinstance(songs, list):
        print("错误: JSON 应为数组", file=sys.stderr)
        sys.exit(1)

    # 按 name 统计：name -> [ (index, bvid), ... ]
    by_name = {}
    for i, item in enumerate(songs):
        name = (item.get("name") or "").strip()
        bvid = (item.get("bvid") or "").strip()
        if name not in by_name:
            by_name[name] = []
        by_name[name].append((i, bvid))

    dupes = {k: v for k, v in by_name.items() if len(v) > 1}
    if not dupes:
        print("✓ 未发现重名歌曲。")
        sys.exit(0)

    print("发现重名歌曲：")
    for name, occurrences in sorted(dupes.items()):
        count = len(occurrences)
        print(f'  - "{name}" (出现 {count} 次)')
        for _idx, bvid in occurrences:
            print(f"      bvid: {bvid}")

    print()
    try:
        input("按回车确认去重（只保留每首重名的第一项，将直接修改文件）：")
    except EOFError:
        print("未确认，已退出。", file=sys.stderr)
        sys.exit(1)

    # 保留“第一次出现”的 name：顺序即原数组顺序，每个 name 只取第一次
    seen_names = set()
    new_songs = []
    for item in songs:
        name = (item.get("name") or "").strip()
        if name in seen_names:
            continue
        seen_names.add(name)
        new_songs.append({"name": name, "bvid": (item.get("bvid") or "").strip()})

    with open(songs_path, "w", encoding="utf-8") as f:
        json.dump(new_songs, f, ensure_ascii=False, indent=2)

    removed = len(songs) - len(new_songs)
    print(f"已去重并写回 {songs_path}，共移除 {removed} 条重复项。")


if __name__ == "__main__":
    main()
