#!/usr/bin/env bash
# run.sh — render one canned message in the REAL pi TUI and print the screen.
#
# Why this shape:
#   * no model calls: a local OpenAI-compatible server answers with a fixed
#     assistant message, registered as a provider by fake-provider.ts;
#   * real TUI: pi runs inside tmux (a real TTY) and we read the rendered screen
#     with `tmux capture-pane`, so what we check is what the user sees;
#   * DO NOT redirect stdout inside the tmux command: pi would see a non-TTY and
#     silently fall back to plain text mode (that mistake cost two attempts).
#
# Usage: scripts/tui-probe/run.sh [message.txt]
#   COLS/ROWS  pane size (default 100x46)
#   WAIT       seconds to let the turn finish (default 14)
#   KEEP=1     leave the tmux session alive for manual poking
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MSG=${1:-$ROOT/scripts/tui-probe/message.txt}
PORT=${TUI_PROBE_PORT:-8787}
SESSION="tui-probe-$$"
export TUI_PROBE_PORT=$PORT

cleanup() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null || true
}
trap cleanup EXIT
[ "${KEEP:-0}" = "1" ] && trap - EXIT

tmux kill-session -t "$SESSION" 2>/dev/null || true
node "$ROOT/scripts/tui-probe/fake-openai-server.cjs" "$MSG" 2>/tmp/tui-probe-server.err &
SRV=$!
sleep 1

# stderr goes to a file (diagnostics); stdout must stay on the pane's TTY.
tmux new-session -d -s "$SESSION" -x "${COLS:-100}" -y "${ROWS:-46}" \
  "export TERM=xterm-256color TUI_PROBE_PORT=$PORT; cd /tmp && \
   pi --extension '$ROOT/scripts/tui-probe/fake-provider.ts' \
      --provider tui-probe --model fake-1 \
      --no-mcp --no-skills --no-context-files --no-session --no-tools render \
      2>/tmp/tui-probe-pi.err"

sleep "${WAIT:-14}"
CAP=$(tmux capture-pane -p -t "$SESSION" -S -200)
printf '%s\n' "$CAP"

# CHECK=1 turns the probe into an acceptance gate for the demo message:
# restored icons are invisible as codepoints, so we assert on what must stay
# LITERAL (fences, inline span, unknown marker) plus the visible substitution.
if [ "${CHECK:-0}" = "1" ]; then
  fail=0
  want() { if printf '%s' "$CAP" | grep -qF -- "$1"; then echo "  ✓ $2"; else echo "  ✗ $2  (missing: $1)"; fail=1; fi; }
  deny() { if printf '%s' "$CAP" | grep -qF -- "$1"; then echo "  ✗ $2  (found: $1)"; fail=1; else echo "  ✓ $2"; fi; }
  want "□U+E5EE" "缺字显示为可见替换标记"
  want "icon = \uE235" "围栏内保持字面"
  want "quoted = \uE235" "引用围栏内保持字面"
  want "行内 \uE235" "行内代码段保持字面"
  want "[[nf:nope]]" "未知标记保留并点名"
  deny "[[nf:python]]" "已知标记已被解析"
  want '字面 \ue235' "逃生舱显示为单反斜杠（正好一个反斜杠）"
  deny '字面 \\ue235' "逃生舱不是两个反斜杠"
  [ "$fail" = 0 ] && echo "TUI 验收：通过" || { echo "TUI 验收：失败"; exit 1; }
fi

if [ "${KEEP:-0}" = "1" ]; then
  echo "--- kept session $SESSION (tmux attach -t $SESSION) ---"
else
  echo "--- pi stderr (tail) ---" >&2
  tail -5 /tmp/tui-probe-pi.err >&2 || true
fi
