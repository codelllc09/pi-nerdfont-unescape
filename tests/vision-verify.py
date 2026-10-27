#!/usr/bin/env python3
"""vision-verify.py — 视觉端到端验证（本仓库最重要的测试手段）

用法: python3 vision-verify.py <截图.png> [额外提示]

为什么存在：单元测试验证的是"我以为的逻辑"，只有终端里实际渲染出来的
像素才是真相。2026-10-27 判例：v1 行内保护的单测全绿，但真实消息使用
双反引号包裹形态，绕过保护——唯一抓到真相的是视觉模型对截图的描述。
（配套教训：JS 正则 \uXXXX 只吃 4 位十六进制；双反斜杠输入走的是字面
逃生舱路径，测不到保护逻辑——两种"假绿"成因见 test-nerdfont-unescape.cjs）

流程：截图粘贴保存到 /tmp → 本脚本调 glm-4.6v 描述 → 与预期比对。
密钥读 pi 的 auth.json（zai-coding-cn）。
"""
import base64
import json
import sys
import urllib.request

DEFAULT_PROMPT = (
    "终端 TUI 截图。请：1) 精确转录含图标、□、\\uXXXX 转义字面量、"
    "□U+XXXX 标记的行；2) 指出异常：豆腐块、意外空白、不该还原却被还原的"
    "位置、该显示图标却显示转义文本的位置、对齐错位。没有异常请明说。"
)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    png = sys.argv[1]
    prompt = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_PROMPT
    key = json.load(open("/home/user/.pi/agent/auth.json"))["zai-coding-cn"]["key"]
    img = base64.b64encode(open(png, "rb").read()).decode()
    body = json.dumps({
        "model": "glm-4.6v",
        "max_tokens": 1800,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img}"}},
        ]}],
    }).encode()
    req = urllib.request.Request(
        "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        out = json.load(r)
    c = out["choices"][0]["message"].get("content") or ""
    if isinstance(c, list):
        c = "".join(x.get("text", "") for x in c if isinstance(x, dict))
    print(c.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
