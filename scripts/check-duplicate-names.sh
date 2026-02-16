#!/usr/bin/env bash
# 检测并去重 songs.json / songs_fiona.json 中的重名歌曲（调用 Python 脚本）
# 用法: ./scripts/check-duplicate-names.sh
#       ./scripts/check-duplicate-names.sh songs.json
#       ./scripts/check-duplicate-names.sh fiona/songs_fiona.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/check-duplicate-names.py" "$@"
