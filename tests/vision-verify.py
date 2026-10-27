#!/usr/bin/env python3
r"""vision-verify.py — 视觉端到端验证（本仓库最重要的测试手段）

用法: python3 tests/vision-verify.py <截图.png> [额外提示]

为什么存在：单元测试验证的是"我以为的逻辑"，只有终端里实际渲染出来的
像素才是真相。2026-10-27 判例：v1 行内保护的单测全绿，但真实消息使用
双反引号包裹形态，绕过保护——唯一抓到真相的是视觉模型对截图的描述。
（配套教训：JS 正则 \uXXXX 只吃 4 位十六进制；双反斜杠输入走的是字面
逃生舱路径，测不到保护逻辑——两种"假绿"成因见 test-nerdfont-unescape.cjs）

本脚本的存在前提：**会话主模型是纯文本的**（agent 自己看不了图）。
若会话模型能看图，不要跑本脚本——agent 用 read 工具直接读截图即可
（判断方法零成本：读一张 png，pi 会明说 "Current model does not
support images"；能读就是能看）。

模型配置（按优先级，fork 本仓库请用 ① 或 ② 设置你自己的）：
  ① 环境变量  PI_VISION_MODEL / PI_VISION_BASE_URL / PI_VISION_API_KEY
  ② 配置文件  ~/.config/pi-nerdfont-unescape/vision.json
              {"model": "...", "base_url": "...", "api_key": "..."}
              （任何 OpenAI 兼容端点均可；api_key 也可省略而用环境变量注入）
  ③ 兜底默认  读 Pi 的 ~/.pi/agent/auth.json（zai-coding-cn）+
              coding 端点 + glm-5.3-flash（本机默认，视觉可用且廉价）
候选拒图（参数类 4xx）或空响应时自动降级下一候选，stderr 留痕不静默。

⚠ 视觉验证的输入必须是**截图（像素）**。禁止把会话存档文本、断言输出、
还原后的文本发给视觉模型冒充验证——文本验证不了渲染（v1 判例：存档
文本看着全对，像素上保护已被绕过）。

流程：截图粘贴保存到 /tmp → 本脚本调视觉模型描述 → 与预期比对。
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
    c = {k: c.get(k) for k in ("model", "base_url", "api_key")}
    return c if all(c.values()) else None


def fallback_cfg():
    """④ 本机兜底：pi 凭证 + coding 端点 + 廉价视觉模型。"""
    try:
        key = json.load(open(pi_files("auth.json")))["zai-coding-cn"]["key"]
    except (OSError, ValueError, KeyError):
        return None
    return {"model": "glm-5.3-flash", "base_url": KNOWN_BASE_URLS["zai-coding-cn"], "api_key": key}


def candidate_chain():
    """① env → ② file 逐项覆盖到兜底之上（部分覆盖合法，只设模型也生效），
    纯兜底作为第二候选兜住拒图/空响应。"""
    base = fallback_cfg()
    if not base:
        return []
    merged = dict(base)
    merged.update(env_overrides())
    merged.update(file_cfg() or {})
    if merged == base:
        return [base]
    return [merged, base]


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
