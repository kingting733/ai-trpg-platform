#!/usr/bin/env bash
# Story machine runner: story.md → out/scenario.json, looping writer →
# validator → critic → fixer until the gate passes or MAX_ROUNDS is hit.
#
#   scripts/story-machine/run.sh path/to/story.md [out-dir]
#
# Roles are shell commands that read the prompt on STDIN and print the answer
# on STDOUT, so any CLI works. Defaults assume Claude Code writes and Codex
# reviews; override with env vars, e.g.
#   WRITER_CMD='claude -p --model opus' CRITIC_CMD='claude -p --model sonnet' scripts/story-machine/run.sh story.md
# If your codex build does not read stdin, use: CRITIC_CMD='codex exec --skip-git-repo-check "$(cat)"'
set -euo pipefail

STORY="$(realpath "${1:?用法：run.sh <story.md> [out-dir]}")"
OUT="${2:-$(dirname "$STORY")/out}"
mkdir -p "$OUT"
OUT="$(realpath "$OUT")"  # macOS realpath has no -m, so create first
# npm scripts resolve from the repo root; paths above are absolute so this is safe.
cd "$(dirname "$(realpath "$0")")/../.."
MAX_ROUNDS="${MAX_ROUNDS:-3}"
WRITER_CMD="${WRITER_CMD:-claude -p --output-format text}"
CRITIC_CMD="${CRITIC_CMD:-codex exec --skip-git-repo-check -}"
SM="npm run --silent story-machine --"

mkdir -p "$OUT"
echo "▶ 故事：$STORY"
echo "▶ 輸出：$OUT（最多 $MAX_ROUNDS 輪）"
echo "▶ 作者：$WRITER_CMD"
echo "▶ 評審：$CRITIC_CMD"

prev_json=""
prev_report=""
prev_critic=""

for ((round = 1; round <= MAX_ROUNDS; round++)); do
  echo
  echo "━━━ 第 $round 輪 ━━━"
  P="$OUT/round$round"

  if [[ $round -eq 1 ]]; then
    $SM writer-prompt "$STORY" > "$P.prompt.txt"
  else
    $SM fix-prompt "$STORY" "$prev_json" "$prev_report" "$prev_critic" > "$P.prompt.txt"
  fi

  echo "  ✍  作者產出 JSON…"
  bash -c "$WRITER_CMD" < "$P.prompt.txt" > "$P.raw.txt"
  $SM extract --story "$STORY" < "$P.raw.txt" > "$P.json"

  echo "  🔍 驗證器…"
  set +e
  $SM validate "$P.json" --out "$P.report.json" | tee "$P.report.txt"
  set -e

  echo "  ⚖  評審…"
  $SM critic-prompt "$STORY" "$P.json" "$P.report.json" > "$P.critic-prompt.txt"
  bash -c "$CRITIC_CMD" < "$P.critic-prompt.txt" > "$P.critic.txt" || echo "  ⚠ 評審指令失敗，本輪視為無評審意見"

  if $SM gate "$P.report.json" "$P.critic.txt"; then
    $SM finalize "$P.json" --decisions "$OUT/decisions.md" > "$OUT/scenario.json"
    echo
    echo "🎉 完成：$OUT/scenario.json（第 $round 輪通過）"
    echo "   下一步：打開「建立劇本 → 貼上 JSON」，貼入這個檔案的內容，按匯入。"
    exit 0
  fi

  prev_json="$P.json"
  prev_report="$P.report.json"
  prev_critic="$P.critic.txt"
done

$SM finalize "$prev_json" --decisions "$OUT/decisions.md" > "$OUT/scenario.json"
echo
echo "⚠ 跑滿 $MAX_ROUNDS 輪仍未通過。最後一版已存到 $OUT/scenario.json，"
echo "  請看 $prev_report 和 $prev_critic 決定是手動修還是再跑一次。"
exit 1
