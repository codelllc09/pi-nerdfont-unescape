#!/usr/bin/env python3
r"""vision-verify.py — 视觉端到端验证（本仓库最重要的测试手段）

用法: python3 tests/vision-verify.py <截图.png> [额外提示]

为什么存在：单元测试验证的是"我以为的逻辑"，只有终端里实际渲染出来的
像素才是真相。2026-10-27 判例：v1 行内保护的单测全绿，但真实消息使用
双反引号包裹形态，绕过保护——唯一抓到真相的是视觉模型对截图的描述。
（配套教训：JS 正则 \uXXXX 只吃 4 位十六进制；双反斜杠输入走的是字面
逃生舱路径，测不到保护逻辑——两种"假绿"成因见 test-nerdfont-unescape.cjs）

模型配置（按优先级，fork 本仓库请用 ① 或 ② 设置你自己的）：
  ① 环境变量  PI_VISION_MODEL / PI_VISION_BASE_URL / PI_VISION_API_KEY
  ② 配置文件  ~/.config/pi-nerdfont-unescape/vision.json
              {"model": "...", "base_url": "...", "api_key": "..."}
              （任何 OpenAI 兼容端点均可；api_key 也可省略而用环境变量注入）
  ③ 兜底默认  读 Pi 的 ~/.pi/agent/auth.json（zai-coding-cn）+
              coding 端点 + glm-5.3-flash（本机默认，视觉可用且廉价）

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


def resolve_config():
    cfg = {
        "model": os.environ.get("PI_VISION_MODEL"),
        "base_url": os.environ.get("PI_VISION_BASE_URL"),
        "api_key": os.environ.get("PI_VISION_API_KEY"),
    }
    path = os.path.expanduser("~/.config/pi-nerdfont-unescape/vision.json")
    if os.path.isfile(path):
        try:
            disk = json.load(open(path))
            cfg = {k: cfg[k] or disk.get(k) for k in cfg}
        except (OSError, ValueError) as e:
            print(f"警告: 配置文件 {path} 解析失败({e})，忽略之", file=sys.stderr)
    if not (cfg["model"] and cfg["base_url"] and cfg["api_key"]):
        # 兜底：Pi 自带的凭证与本机默认模型（fork 请用上面两级覆盖）
        auth = json.load(open(os.path.expanduser("~/.pi/agent/auth.json")))
        cfg["model"] = cfg["model"] or "glm-5.3-flash"
        cfg["base_url"] = cfg["base_url"] or "https://open.bigmodel.cn/api/coding/paas/v4"
        cfg["api_key"] = cfg["api_key"] or auth["zai-coding-cn"]["key"]
    return cfg


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    png = sys.argv[1]
    prompt = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_PROMPT
    cfg = resolve_config()
    print(f"[vision] {cfg['model']} @ {cfg['base_url']}", file=sys.stderr)

    img = base64.b64encode(open(png, "rb").read()).decode()
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
    with urllib.request.urlopen(req, timeout=300) as r:
        out = json.load(r)
    c = out["choices"][0]["message"].get("content") or ""
    if isinstance(c, list):
        c = "".join(x.get("text", "") for x in c if isinstance(x, dict))
    if not c.strip():
        print("错误: 模型返回空内容（reasoning 可能耗尽 max_tokens，请调大）", file=sys.stderr)
        return 1
    print(c.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
