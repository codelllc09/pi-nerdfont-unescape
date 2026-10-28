[English](./README.md) · **简体中文**

# pi-nerdfont-unescape

让 LLM 的 Nerd Font 图标输出在 Pi TUI 里**无损且可观测**——不让任何字符静默消失。

LLM 的 tokenizer 不认识私有区码位（Nerd Font 图标全在此区）。模型试图输出
它们时，字符被通道无痕丢弃——你看不到任何东西，甚至不知道少了东西。
本扩展从两个方向绞杀这种静默失败：

- **协议（软约束）**：系统提示附录要求模型把图标写成 ASCII 转义
  （`\uE235`、`\u{f0805}`）——转义任何 tokenizer 都认识，消息落定时
  扩展还原成真字形
- **护栏（硬兜底）**：无论模型怎么做，都不会静默失败

## 功能矩阵

| 功能 | 行为 |
|---|---|
| 转义还原 | `\uXXXX` / `\u{xxxxx}` → 真字形（代码段之外） |
| 代码段保护 | 围栏块**和**行内段（CommonMark 等长定界符，含双反引号包裹）内的转义保持字面——配置文件复制粘贴保真 |
| 可见替换 | **无可渲染字形**的码位（非字符、Tags、未分配 BMP、不在本机字体 cmap 并集、或 cmap 本身不可用）→ 可见标记 `□U+FDD0`，绝不隐形 |
| 证据性补框 | 文本自带码位（Lua 风格 `-- U+E235` 注释）时尾部补 `□`；空引号对永不触碰（合法空串与丢字产物比特级相同，拒绝猜测） |
| 输入自动转义 | **你发出的消息**里的 at-risk 字符自动转义（输入方向同样被剥）——模型真正收到你贴的内容 |
| 流级丢失探测 | `message_update` 期间出现过、最终消息里消失的码位，点名报告 |
| 字体 ground truth | 全部已装字体 cmap 并集缓存 + 签名失效；Linux / macOS / Windows 路径 |
| `[[nf:名称]]` 语义标记（beta） | 写 `[[nf:python]]`，扩展按**本机字体**在渲染时解析成图标；未知名可见警告；代码段内保持字面 |
| `nerdfont_lookup` 工具 | 按关键词/码位查本机 Nerd Font 字形，族别优先，内置 starship 默认表 |
| `render_preview` 工具 | 等宽网格排版渲染（CJK=2 列、PUA=1 列、点线、边框） |

## 安装

```bash
pi install npm:pi-nerdfont-unescape
```

## 运行与测试依赖

扩展本体运行时零依赖，但字形 ground truth（cmap 缓存）、`nerdfont_lookup`
与 `render_preview` 会调用 `python3` + [fontTools]——缺失时可渲染性判定退化为
类别判断，**可见告警**，绝不静默。测试套件同样依赖。Windows 下未必有名为
`python3` 的命令，需自行暴露（如 `py -3` 做壳）。

## 测试与视觉验证工作流

`tests/test-nerdfont-unescape.cjs` —— 与 test-tools.cjs 构成全量回归（数量随判例增长），含全部历史翻车形态。

**渲染正确性的最终裁决权在像素**：单测会假绿（套件头注释记录了两种
成因）。重要改动后：真实输出一条含目标形态的消息 → 截图 → 让视觉
模型审计**像素**——禁止把提取出的/还原后的文本发给它冒充验证，文本
验证不了渲染。该工作流抓到过 12 项绿灯单测漏掉的真 bug。

会话模型本身能看图 → agent 直接 read 截图即可，不跑脚本（判断零成本：
试着 read 一张 png，pi 会明说模型支不支持图片）。否则跑
`python3 tests/vision-verify.py <截图>`。视觉模型**不写死**——解析顺序：
`PI_VISION_MODEL` / `PI_VISION_BASE_URL` / `PI_VISION_API_KEY` 环境变量 →
`~/.config/pi-nerdfont-unescape/vision.json` → 兜底默认（`glm-5.3-flash`，
pi 自带凭证）。任何 OpenAI 兼容端点均可，fork 请用前两级设置自己的模型。

## 边界说明：存档不是 ASCII

`[[nf:]]` 在 `message_end` 解析——这是 pi 扩展唯一的拦截点，而它同时供给
**显示与存储**。因此会话存档里保存的是还原后的真字符。「存档恒 ASCII、
仅在绘制边界转字形」需要 pi 核心支持，当前扩展 API 没有这个钩子。

## 设计史（浓缩）

源于 2026-09 通道审计（3310 探针、双向验证）：BMP PUA 必丢；其余 at-risk
区可通过但模型盲发不可靠（PUA 0/3 精度）。2026-10：不可见码位可见替换、
cmap ground truth、输入侧转义、流级探测、CommonMark v2 行内扫描器
（v1 正则被双反引号包裹击败——由视觉验证而非测试发现）。

## 许可证

MIT —— 使用需保留版权与许可声明。
