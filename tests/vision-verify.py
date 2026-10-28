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
    "终端 TUI 截图。请：1) 精确转录含图标、□、\\uXXXX 转义字面量、"
    "□U+XXXX 标记的行；2) 指出异常：豆腐块、意外空白、不该还原却被还原的"
    "位置、该显示图标却显示转义文本的位置、对齐错位。没有异常请明说。"
)


KNOWN_BASE_URLS = {"zai-coding-cn": "https://open.bigmodel.cn/api/coding/paas/v4"}


def pi_files(rel):
    return os.path.expanduser(os.path.join("~/.pi/agent", rel))


def env_overrides():
    """部分覆盖合法：只设模型也生效，缺的件由兜底补齐（而非整体丢弃）。"""
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
        print(f"警告: 配置文件 {path} 解析失败({e})，忽略之", file=sys.stderr)
        return None
    # 部分配置合法：有的键就返回，缺的由 env/兜底补
    return {k: v for k, v in ((k, c.get(k)) for k in ("model", "base_url", "api_key")) if v}


def fallback_cfg():
    """④ 本机兜底：pi 凭证 + coding 端点 + 廉价视觉模型。"""
    try:
        key = json.load(open(pi_files("auth.json")))["zai-coding-cn"]["key"]
    except (OSError, ValueError, KeyError):
        return None
    return {"model": "glm-5.3-flash", "base_url": KNOWN_BASE_URLS["zai-coding-cn"], "api_key": key}


def candidate_chain():
    """合并顺序：② file 先铺底，① env 后覆盖（env 胜出，与文档一致）；
    部分覆盖合法（只设模型也生效）；本机无兜底凭证时，
    env/file 拼齐三件套照样可用。纯兜底仅作拒图/空响应的第二候选。"""
    merged = {}
    merged.update(file_cfg() or {})
    merged.update(env_overrides())
    # 部分覆盖：缺的键由兜底补齐（兜底不得反向覆盖 env/file）
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
    # 机器第二兜底：flash 系 reasoning 间歇性耗尽 max_tokens（多轮实测），
    # 同端点挂 4.6v 兜底避免单点
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
        print("错误: 找不到任何可用的视觉模型配置（见文件头注释的 ①② 两级）", file=sys.stderr)
        return 1

    c = None
    for cfg in chain:
        print(f"[vision] 尝试 {cfg['model']} @ {cfg['base_url']}", file=sys.stderr)
        body = json.dumps({
            "model": cfg["model"],
            "max_tokens": 2000,  # flash 系会先花 token 于 reasoning，留足余量
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
            # 参数类拒绝（如 glm-5.3 不吃图）→ 降级下一候选，非静默
            if e.code == 400 and ("image" in detail.lower() or "type" in detail.lower() or "参数" in detail):
                print(f"[vision] {cfg['model']} 拒图，降级: {detail[:120]}", file=sys.stderr)
                continue
            print(f"错误: {cfg['model']} HTTP {e.code}: {detail[:300]}", file=sys.stderr)
            return 1
        c = out["choices"][0]["message"].get("content") or ""
        if isinstance(c, list):
            c = "".join(x.get("text", "") for x in c if isinstance(x, dict))
        if not c.strip():
            # 空内容多为 reasoning 耗尽 max_tokens——换下一候选而非静默
            print(f"[vision] {cfg['model']} 返回空内容，降级", file=sys.stderr)
            c = None
            continue
        break
    if not c or not c.strip():
        print("错误: 链上全部候选失败（空内容或拒图）", file=sys.stderr)
        return 1
    print(c.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
