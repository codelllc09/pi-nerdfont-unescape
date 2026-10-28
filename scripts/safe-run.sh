#!/usr/bin/env bash
# safe-run.sh — run a heavy local workload inside a hard memory budget so the
# desktop (chrome / gnome-shell) can never be the OOM victim.
#
# Postmortem (2026-10-29 02:04): a parallel mutation audit on a 15.8 GB box that
# already had ~21 GB in swap triggered a *global* OOM. The kernel picked chrome
# (oom_score_adj=300), gnome-shell went down with it, and the desktop restarted.
# Nothing about the audit was "wrong" — it just had no memory ceiling.
#
# Usage:  scripts/safe-run.sh <command...>
# Env:    PI_TEST_MEM_MAX   cgroup memory ceiling (default 2G)
#         PI_TEST_SWAP_MAX  swap ceiling            (default 512M)
#         PI_MIN_AVAIL_MB   refuse to start below this free RAM (default 2000)
#         PI_FORCE=1        skip the pre-flight check
set -euo pipefail

MEM_MAX="${PI_TEST_MEM_MAX:-2G}"
SWAP_MAX="${PI_TEST_SWAP_MAX:-512M}"
MIN_AVAIL_MB="${PI_MIN_AVAIL_MB:-2000}"

avail_mb=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo)
if [ "${PI_FORCE:-0}" != "1" ] && [ -n "${avail_mb:-}" ] && [ "$avail_mb" -lt "$MIN_AVAIL_MB" ]; then
  cat >&2 <<MSG
refusing to start: only ${avail_mb}MB RAM available (need ${MIN_AVAIL_MB}MB).
Close a browser tab / app and retry, or set PI_FORCE=1 to override.
This guard exists because a run under memory pressure once OOM-killed chrome
and took the whole desktop down.
MSG
  exit 75
fi

# `is-system-running` says "degraded" on otherwise healthy desktops; probing the
# user manager's environment is the reliable test for a usable scope.
if command -v systemd-run >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  # --scope: same terminal, but the workload lives in its own cgroup with a hard
  # ceiling; MemoryOOMGroup kills the whole scope instead of picking a stranger.
  exec systemd-run --user --scope --quiet \
    -p MemoryMax="$MEM_MAX" \
    -p MemorySwapMax="$SWAP_MAX" \
    -p IOWeight=50 \
    -- "$@"
fi

# Fallback (no user manager): a best-effort address-space cap.
echo "safe-run: systemd user scope unavailable, applying address-space cap" >&2
# Best effort without cgroups: cap virtual memory (~1.5 GiB per node child) and
# disable core dumps so a runaway cannot fill swap either.
ulimit -v $((1536 * 1024)) 2>/dev/null || true
ulimit -c 0 2>/dev/null || true
exec "$@"
