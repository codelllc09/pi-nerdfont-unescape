#!/usr/bin/env bash
# pixel.sh — capture REAL PIXELS of the pi TUI without touching the desktop.
#
# Why not just "take a screenshot":
#   * GNOME/Wayland: org.gnome.Shell.Screenshot is AccessDenied since 43, and the
#     xdg-desktop-portal alternative pops a permission dialog every time;
#   * weston's own screenshooter is refused too ("Output capture error:
#     unauthorized" — libweston has no config knob for it);
#   * so we use Xvfb: an in-memory X server, the *same* terminal the user runs
#     (WezTerm, software front end), and ImageMagick's `import -window root`.
# Nothing appears on the real desktop and no dialog is involved.
#
# Requirements: Xvfb (xorg-x11-server-Xvfb) and ImageMagick (`import`).
#
# Usage: scripts/tui-probe/pixel.sh [message.txt]
#   OUT=/tmp/shot.png   where to copy the PNG (default scripts/tui-probe/out.png)
#   WIDTH/HEIGHT        headless output size (default 1400x900)
#   WAIT                seconds before the capture (default 16)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MSG=${1:-$ROOT/scripts/tui-probe/message.txt}
OUT=${OUT:-$ROOT/scripts/tui-probe/out.png}
PORT=${TUI_PROBE_PORT:-8787}
WIDTH=${WIDTH:-1500}
HEIGHT=${HEIGHT:-1150}
WORK=$(mktemp -d /tmp/tui-pixel-XXXXXX)

command -v Xvfb >/dev/null || { echo "需要 Xvfb：sudo dnf install -y xorg-x11-server-Xvfb" >&2; exit 2; }
command -v import >/dev/null || { echo "需要 ImageMagick 的 import" >&2; exit 2; }

cleanup() {
  tmux kill-session -t "pix-$$" 2>/dev/null || true
  [ -n "${WEZ:-}" ] && kill "$WEZ" 2>/dev/null || true
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null || true
  [ -n "${WPID:-}" ] && kill "$WPID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
export TUI_PROBE_PORT=$PORT

DISPLAY_NUM=${DISPLAY_NUM:-99}
node "$ROOT/scripts/tui-probe/fake-openai-server.cjs" "$MSG" 2>"$WORK/server.err" & SRV=$!
Xvfb ":$DISPLAY_NUM" -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp >"$WORK/xvfb.log" 2>&1 & WPID=$!
sleep 2

# Same terminal, same config as the user's session (WezTerm reads the user's
# config, so fonts and fallbacks match); software rendering because the virtual
# display has no GPU. `pi` gets a real TTY inside it.
# WAYLAND_DISPLAY must go: otherwise WezTerm prefers Wayland and the window
# lands on the user's real desktop instead of the virtual X screen (that is not
# hypothetical — it happened once). --noprofile/--norc keeps the user's shell
# rc noise out of the capture.
env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 DISPLAY=":$DISPLAY_NUM" \
  wezterm --config 'front_end="Software"' --config "initial_cols=160" --config "initial_rows=46" \
  start --always-new-process -- bash --noprofile --norc -c "cd /tmp && pi \
      --extension '$ROOT/scripts/tui-probe/fake-provider.ts' \
      --provider tui-probe --model fake-1 --no-mcp --no-skills --no-context-files \
      --no-session --no-tools render" >"$WORK/wez.log" 2>&1 & WEZ=$!

sleep "${WAIT:-16}"
SHOT="$WORK/shot.png"
# -screen captures what is displayed (a plain `-window root` reads the root
# window contents, which is black where child windows are).
DISPLAY=":$DISPLAY_NUM" timeout 20 import -window root -screen "$SHOT" >"$WORK/import.log" 2>&1 || true
if [ ! -s "$SHOT" ]; then
  echo "✗ 没拿到截图；日志：" >&2
  tail -5 "$WORK/xvfb.log" "$WORK/wez.log" "$WORK/import.log" 2>/dev/null >&2
  exit 1
fi
mkdir -p "$(dirname "$OUT")"
# Trim the black surround so the PNG is the terminal window, not the whole screen.
magick "$SHOT" -trim +repage "$OUT" 2>/dev/null || cp "$SHOT" "$OUT"
echo "PNG: $OUT ($(du -h "$OUT" | cut -f1), $(python3 - <<PY
import struct
d=open("$OUT","rb").read(33)
w,h=struct.unpack(">II", d[16:24])
print(f"{w}x{h}")
PY
))"
