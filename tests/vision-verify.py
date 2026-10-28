#!/usr/bin/env python3
r"""vision-verify.py — vision end-to-end verification (this repo's decisive test)

Usage: python3 tests/vision-verify.py <screenshot.png> [extra prompt]

Why it exists: unit tests verify the logic you THOUGHT of; only the pixels
actually rendered in the terminal are the truth. 2026-10-27 precedent: the
v1 inline protection suite was all green, yet a real message using
double-backtick wrapping bypassed it — the only thing that caught the truth
was a vision model describing the screenshot. (Companion lessons: JS regex
\uXXXX takes exactly 4 hex digits; a double-backslash input rides the
literal hatch and tests nothing — both fake-green modes are documented in
test-nerdfont-unescape.cjs.)

Prerequisite: the session model must be text-only (the agent itself cannot
see images). If the session model CAN see images, do not run this script —
the agent reads the screenshot directly (probing is free: read a png and
pi will state plainly whether images are supported).

Model config (priority order; forks should use (1) or (2)):
  1. env vars   PI_VISION_MODEL / PI_VISION_BASE_URL / PI_VISION_API_KEY
  2. config     ~/.config/pi-nerdfont-unescape/vision.json
                {"model": ..., "base_url": ..., "api_key": ...}
                (any OpenAI-compatible endpoint; partial keys are legal and
                merge over the fallback)
  3. fallback   Pi's own credentials (zai-coding-cn) + glm-5.3-flash, with
                glm-4.6v as a same-endpoint second candidate (flash's
                reasoning tokens intermittently exhaust max_tokens).
A rejected image or an empty response demotes to the next candidate,
leaving a trace on stderr — never silent.

Red line: vision checks take PIXELS (screenshots) as input. Feeding
extracted/restored text proves nothing about rendering (v1 precedent:
the archived text looked perfect while the pixels showed the bypass).
"""
import base64
import json
import os
import sys
import urllib.request

DEFAULT_PROMPT = (
    # Default prompt intentionally Chinese: tuned for zh screenshots of this workflow.
    "□U+XXXX 标记的行；2) 指出异常：豆腐块、意外空白、不该还原却被还原的"
    "位置、该显示图标却显示转义文本的位置、对齐错位。没有异常请明说。"
)


KNOWN_BASE_URLS = {"zai-coding-cn": "https://open.bigmodel.cn/api/coding/paas/v4"}


def pi_files(rel):
    return os.path.expanduser(os.path.join("~/.pi/agent", rel))


def env_overrides():
    """Partial overrides are legal: setting only the model works; missing keys come from the fallback."""
    return {k: v for k, v in {
        "model": os.environ.get("PI_VISION_MODEL"),
        "base_url": os.environ.get("PI_VISION_BASE_URL"),
        "api_key": os.environ.get("PI_VISION_API_KEY"),
    }.items() if v}


def file_cfg():
    path = os.path.expanduser("~/.config/pi-nerdfont-unescape/vision.json")
    if not os.path.isfile(path):
        return None
    try:
        c = json.load(open(path))
    except (OSError, ValueError) as e:
        print(f"warning: config file {path} failed to parse ({e}); ignoring it", file=sys.stderr)
        return None
    # Partial configs are legal: return the keys present; env/fallback fills the rest
    return {k: v for k, v in ((k, c.get(k)) for k in ("model", "base_url", "api_key")) if v}


def fallback_cfg():
    """(3) Local fallback: Pi credentials + coding endpoint + a cheap vision model."""
    try:
        key = json.load(open(pi_files("auth.json")))["zai-coding-cn"]["key"]
    except (OSError, ValueError, KeyError):
        return None
    return {"model": "glm-5.3-flash", "base_url": KNOWN_BASE_URLS["zai-coding-cn"], "api_key": key}


def candidate_chain():
    """Merge order: (2) file lays the base, (1) env overrides (env wins, as documented);
    partial overrides are legal; with no local fallback, env/file keys alone can
    still form a complete triple. The pure fallback is only the reject/empty-response second candidate."""
    merged = {}
    merged.update(file_cfg() or {})
    merged.update(env_overrides())
    # Partial override: missing keys come from the fallback (never the reverse)
    base = fallback_cfg()
    if base:
        for k, v in base.items():
            merged.setdefault(k, v)
    chain = []
    KEYS = ("model", "base_url", "api_key")
    if all(merged.get(k) for k in KEYS):
        chain.append(merged)
    if base and base.get("model") != merged.get("model"):
        chain.append(base)
    # Machine second candidate: flash-family reasoning intermittently exhausts
    # max_tokens (observed across rounds) — same-endpoint 4.6v avoids a single point of failure
    if base:
        backup = dict(base, model="glm-4.6v")
        if backup["model"] != merged.get("model"):
            chain.append(backup)
    return chain


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    png = sys.argv[1]
    prompt = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_PROMPT
    img = base64.b64encode(open(png, "rb").read()).decode()
    chain = candidate_chain()
    if not chain:
        print("error: no usable vision model config (see levels 1-2 in the header)", file=sys.stderr)
        return 1

    c = None
    for cfg in chain:
        print(f"[vision] trying {cfg['model']} @ {cfg['base_url']}", file=sys.stderr)
        body = json.dumps({
            "model": cfg["model"],
            "max_tokens": 2000,  # flash models burn tokens on reasoning first — leave headroom
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img}"}},
            ]}],
        }).encode()
        req = urllib.request.Request(
            cfg["base_url"].rstrip("/") + "/chat/completions",
            data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {cfg['api_key']}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                out = json.load(r)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            # Parameter-class rejection (e.g. glm-5.3 refusing images) → demote to the next candidate, never silent
            if e.code == 400 and ("image" in detail.lower() or "type" in detail.lower() or "\u53c2\u6570" in detail):
                print(f"[vision] {cfg['model']} rejected the image, demoting: {detail[:120]}", file=sys.stderr)
                continue
            print(f"error: {cfg['model']} HTTP {e.code}: {detail[:300]}", file=sys.stderr)
            return 1
        c = out["choices"][0]["message"].get("content") or ""
        if isinstance(c, list):
            c = "".join(x.get("text", "") for x in c if isinstance(x, dict))
        if not c.strip():
            # Empty content usually means reasoning exhausted max_tokens — try the next candidate, not silence
            print(f"[vision] {cfg['model']} returned empty content, demoting", file=sys.stderr)
            c = None
            continue
        break
    if not c or not c.strip():
        print("error: every candidate on the chain failed (empty or image-rejected)", file=sys.stderr)
        return 1
    print(c.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
