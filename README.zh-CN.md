[English](./README.md) · **简体中文**

# pi-nerdfont-unescape

Pi TUI 里的 Nerd Font 图标：**进去是转义，出来是字形，而且绝不静默丢失。**

模型的输出通道会直接吞掉 Private Use Area 码位——Nerd Font 图标正好住在那儿。
模型写了一个图标，你看到的是一片空白，而且没有任何东西告诉你少了什么。
这个扩展从两头堵这个口子：

- **让模型写 ASCII。** 系统提示要求用转义形式（`\uE235`、`\u{f0805}`），
  这种写法在任何 tokenizer 下都能活；消息落地时扩展把它还原成真字形。
- **代码里保持字面。** 围栏（含 `> ``` ` 引用围栏）与行内代码段里的转义一律不动，
  配置片段复制出去仍然可用。
- **不静默消失。** 没有可渲染字形的字符会变成可见的 `□U+FDD0` 标记，而不是空白。

## 安装

```bash
pi install npm:pi-nerdfont-unescape
```

**没有运行时依赖**：`typebox` 声明为 *peer* 依赖，因为 pi 本来就提供它
（写成普通依赖会装出第二份，pi 启动时就会告警）。Linux + fontconfig 下无需任何配置。字形 ground truth、`nerdfont_lookup` 与
`render_preview` 会调用 `python3` + [fontTools](https://fonttools.readthedocs.io/)；
没装时扩展照常工作，只判定它能判定的部分，并明说哪些查不了——绝不静默。

> 尚未发布到 npm。首次发布前请用：`pi install /path/to/pi-nerdfont-unescape`。

## 它能做什么

| | |
|---|---|
| **转义还原** | `\uXXXX` / `\u{xxxxx}` → 真字形（代码区除外） |
| **代码保护** | 围栏（含引用块里的围栏）与行内代码段；行内按 CommonMark 等长定界符规则，双反引号包裹同样适用 |
| **可见替换** | noncharacter、Tags 区、未分配 BMP、终端字体链里没有的码位——以及字体链无法识别时——显示为 `□U+XXXX` |
| **输入侧转义** | **你发出**的消息里的 at-risk 字符在发送前就被转义，模型收到的是你真正打的内容 |
| **丢字检测** | 流里出现过、最终消息里没有的码位会被点名报告 |
| **`[[nf:name]]` 语义标记**（beta） | 写语义名，扩展拿**你本机实际安装的字体**去解析；查不到就告警，绝不编造 |
| **`nerdfont_lookup`** | 按关键字或码位查本机字形，带家族优先级，内置 starship 默认符号 |
| **`render_preview`** | 等宽网格排版渲染器，带终端宽度算术（CJK/emoji = 2 列，私用区 = 1 列） |

## 配置

| 变量 | 默认值 | 作用 |
|---|---|---|
| `PI_NF_FONT_PATHS` | 未设置——走 fontconfig 有序的 `monospace` 链 | 显式指定字体文件或目录（用平台路径分隔符）。macOS/Windows 或终端字体不是 fontconfig `monospace` 时需要 |
| `PI_NF_CMAP_CACHE` | `~/.cache/pi-nerdfont-unescape/cmap.json`（macOS：`~/Library/Caches/…`，Windows：`%LOCALAPPDATA%\…`） | 字形缓存位置；可以随时删，下次会话自动重建 |
| `PI_RENDER_ALLOW_ANY` | 未设置 | 允许 `render_preview` 写到工作目录与 `/tmp` 之外 |

## 已知边界

这些是**有意的**，写出来让你自己判断。

| 边界 | 原因 |
|---|---|
| **会话存档里存的是还原后的字符** | `message_end` 同时供给显示与存储，扩展 API 没有"只在绘制时替换"的钩子。后果：模型在自己的历史里看到的是真字形——如果它照抄而不是写转义，通道仍可能吞掉。 |
| **裸字符被吞掉时无法检测** | 若字符在到达扩展之前就被通道删除，且文本里没有码位线索，那就没有任何信号可依。空引号对永不猜测：`""` 与"少了一个字符"在比特层面完全相同。 |
| **四空格缩进的代码块不当作代码** | 它与列表续行无法区分，猜错会静默关掉还原。 |
| **`[[nf:]]` 依赖你本机的字体** | 名字只在真实安装的字体里解析；查不到就明说，绝不用相近字形代替。 |
| **只处理 assistant 消息** | 用户消息在发出时已转义；在回来时再处理一次会变成二次处理。 |

## 开发

```bash
npm test                  # 112 条断言，零模型调用，约 20 秒
npm run test:audit        # 86 个变异：证明每条断言都会红
scripts/tui-probe/run.sh  # 真实 TUI + 固定消息，零模型调用
npm run tui:pixel         # 同一个画面，抓成 PNG
```

- **测试自带字体夹具**，结果不依赖你机器上装了什么字体；缺 `python3` 会**大声失败**，不静默跳过。
- **所有套件都跑在 cgroup 上限内**（`scripts/safe-run.sh`：2GB 内存上限，内存不足时拒绝启动）。
  并行审计曾经把桌面拖崩过，所以审计默认单并发，需要时显式 `--jobs N`。
- **变异审计可续跑。** 判定写入 `/tmp/pi-mutation-journal-<源码哈希>.json`；源码一改，日志自动失效，
  续跑不可能报告"过期的绿"。

```bash
npm run test:audit -- --only "M6[0-9]" --jobs 4   # 定向切片
npm run test:audit -- --fresh                     # 忽略续跑日志
npm run test:audit -- --list                      # 只列名字
```

TUI 探针用本地 OpenAI 兼容服务把固定消息喂进真实界面，不涉及模型、不依赖网络。
`scripts/tui-probe/run.sh` 从 tmux 读渲染出的屏幕；`scripts/tui-probe/pixel.sh`
从虚拟 X 屏（Xvfb）抓**像素**——这是唯一能验证"字形真的画出来了"而不只是"码位对了"的办法。
扩展它们时有两个坑：**绝不要在 tmux 命令里重定向 stdout**（pi 检测到非 TTY 会降级成纯文本），
以及在虚拟屏上启动终端前**取消 `WAYLAND_DISPLAY`**。

`DROP_PUA=1 scripts/tui-probe/run.sh scripts/tui-probe/message-drop.txt`
复现起源缺陷：假通道会从输出里删掉私用区字符，于是一屏之内能同时看到三种结局——
协议转义被还原、裸字符无声消失、自带码位线索（`-- U+E0B0`）被补成可见的 `□`。

## 设计取舍

- **用转义，不用裸字形。** Tokenizer 不认识私用区码位，写字符等于掷硬币；ASCII 转义不是。
- **什么都不猜。** 字体状态未知时显示 `□U+XXXX`，而不是挑一个像的字形；信号不存在时保持沉默，
  而不是编一条告警。
- **通道本身在这里修不了。** 这段代码运行在字节到达之后：它把模型编码过的内容重建出来，
  并把重建不了的部分显示出来。

## 许可证

MIT —— 使用时请保留版权与许可证声明。
