[English](./README.md) · **简体中文**

# pi-nerdfont-unescape

让 Nerd Font 图标在 pi 的回复里不再丢失。

这些图标是 Unicode 私用区字符，模型的输出流会把它们悄悄吞掉：你要一个 Python 图标，
回来时那个位置是空的——不报错，也没有提示。这个扩展让模型改用普通文本写图标
（`\uE235`），等回复到达时再还原成图标。

## 边界

它没有消除「悄悄丢字」，只是把大部分挡住了，并让剩下的可见。

| 能做到 | 做不到 |
|---|---|
| 模型写转义（`\uE235`），图标就不会被吞，收到后还原成字形 | 模型写裸字符，输出流在消息送达前就删掉——没留下任何可查的痕迹 |
| 画不出来的字符显示成 `□U+XXXX` | 终端实际用的字体不在扩展读到的范围里时，仍可能出现豆腐块——扩展只相信自己读到的字体 |
| 扩展自己看见的丢字（流里有、最终消息里没有）会连码位一起报出来 | 更早发生的丢字没有任何信号 |
| 代码块原样保留 | — |
| 你发出的消息在发送前被转义 | — |

一句话：它只修自己看得见的丢失，并明说自己看不见什么。模型的输出流，它修不了。

还有三点：

- `[[nf:name]]` 仍是 beta，名字只在已装字体里解析。
- 四空格缩进的块不算代码块——它和列表续行无法区分，猜错会静默破坏别处的还原。
- 会话记录里保存的是还原后的真字符（也就是你看到的内容）；模型之后若照抄而不写转义，仍可能被吞。

## 安装

```bash
pi install npm:pi-nerdfont-unescape
```

重启 pi 即可，Linux + fontconfig 下开箱可用。

字形查询与排版渲染需要 `python3` + [fontTools](https://fonttools.readthedocs.io/)
（`pip install fonttools`）。不装也能用，扩展只会在需要时说明哪些查询做不了。

> 尚未发布。首发前请用 `pi install /path/to/pi-nerdfont-unescape`。

本包没有运行时依赖；`typebox` 声明为 *peer*，因为 pi 已经提供。

## 装上之后

| | |
|---|---|
| 按名字要图标 | 写 `[[nf:python]]`，收到回复时变成真图标（*beta：只认本机已装字体*） |
| 粘贴图标 | 发送前自动转义，模型收到的是你真正打的内容，而不是空白 |
| 复制配置片段 | 代码块与行内代码里的转义一律不动，复制出去仍是原样 |
| 缺字看得见 | 画不出来的字符显示成 `□U+E5EE`，而不是空白 |

## 用法

| 想要 | 可以这样说 |
|---|---|
| 列表或标题里的图标 | 「Python 那一项用 `[[nf:python]]`」 |
| 查图标的正确码位 | 「查一下 docker 图标」「U+E0A0 是什么」→ `nerdfont_lookup` |
| 对齐的表格、状态栏、海报 | 「把这段渲染成带框表格」→ `render_preview` |
| Starship 某模块的默认符号 | 「starship nodejs 的符号」→ `nerdfont_lookup` |

`nerdfont_lookup` 读的是本机已装的字体，结果和终端真能画出来的一致；`render_preview`
只做宽度算术（CJK 与 emoji 占两列，私用区占一列）。两者都不猜码位。

## 遇到问题

| 看到 | 原因 | 处理 |
|---|---|---|
| 消息里出现 `□U+E5EE` | 这个码位在终端字体链里没有字形，或者字体链识别不出来 | 装 Nerd Font 并设为终端字体；方框后面就是确切码位 |
| 图标彻底不见了 | 模型写了裸字符，输出流在任何人看到之前就删掉了 | 让它写转义（`\uE235`），或用 `[[nf:name]]` |
| `could not be resolved — font lookup unavailable` | 缺 `python3` 或 fontTools | `pip install fonttools`；不装也行，其它功能照常 |
| 围栏里显示 `\uE235` | 故意的：代码保持字面，便于复制 | 无需处理 |

## 设置

| 变量 | 默认 | 何时需要 |
|---|---|---|
| `PI_NF_FONT_PATHS` | fontconfig 的 `monospace` 链 | macOS、Windows，或终端字体不是 fontconfig 的 `monospace`：指向字体文件或目录（用平台路径分隔符） |
| `PI_NF_CMAP_CACHE` | `~/.cache/pi-nerdfont-unescape/cmap.json` | 想换缓存位置时；随时可删，下次会话重建 |
| `PI_RENDER_ALLOW_ANY` | 未设置 | 允许 `render_preview` 写到工作目录与 `/tmp` 之外 |

## 开发

测试、变异审计、无模型的 TUI 探针，见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 许可证

MIT。使用时请保留版权与许可证声明。
