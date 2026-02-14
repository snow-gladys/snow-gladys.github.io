#!/usr/bin/env bash
# 检测 songs.json 中是否有重名歌曲
# 用法: ./scripts/check-duplicate-names.sh  或  ./scripts/check-duplicate-names.sh path/to/songs.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SONGS_JSON="${1:-$ROOT_DIR/songs.json}"

if [[ ! -f "$SONGS_JSON" ]]; then
  echo "错误: 文件不存在 $SONGS_JSON"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "错误: 需要安装 jq 才能解析 JSON。"
  echo "  macOS: brew install jq"
  echo "  Ubuntu: sudo apt install jq"
  exit 1
fi

# 取出所有 name，排序后统计出现次数，找出出现多于 1 次的（支持名称中含空格）
dupes=$(jq -r '.[].name' "$SONGS_JSON" | sort | uniq -c | awk '$1 > 1 {$1=""; print substr($0,2)}')

if [[ -z "$dupes" ]]; then
  echo "✓ 未发现重名歌曲。"
  exit 0
fi

echo "发现重名歌曲："
echo "$dupes" | while read -r name; do
  count=$(jq -r --arg n "$name" '[.[] | select(.name == $n)] | length' "$SONGS_JSON")
  echo "  - \"$name\" (出现 ${count} 次)"
  jq -r --arg n "$name" '.[] | select(.name == $n) | "      bvid: \(.bvid)"' "$SONGS_JSON"
done
exit 1
