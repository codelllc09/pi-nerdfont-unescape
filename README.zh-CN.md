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
| 可见替换 | **无可渲染字形**的码位（非字符、Tags、未分配 BMP、不在已配置终端字体链、或字体链状态不可用）→ 可见标记 `□U+FDD0`，绝不隐形 |
| 证据性补框 | 文本自带码位（Lua 风格 `-- U+E235` 注释）时尾部补 `□`；空引号对永不触碰（合法空串与丢字产物比特级相同，拒绝猜测） |
| 输入自动转义 | **你发出的消息**里的 at-risk 字符自动转义（输入方向同样被剥）——模型真正收到你贴的内容 |
| 流级丢失探测 | `message_update` 期间出现过、最终消息里消失的码位，点名报告 |
| 字体 ground truth | 终端实际字体/回退链 cmap + 签名失效；Linux 自动读取 fontconfig monospace 链，跨平台可用 `PI_NF_FONT_PATHS` 显式指定 |
| `[[nf:名称]]` 语义标记（beta） | 写 `[[nf:python]]`，扩展按**本机字体**在渲染时解析成图标；未知名可见警告；代码段内保持字面 |
| `nerdfont_lookup` 工具 | 按关键词/码位查本机 Nerd Font 字形，族别优先，内置 starship 默认表 |
| `render_preview` 工具 | 等宽网格排版渲染（CJK/Emoji=2 列、PUA=1 列、点线、边框） |

## 安装

```bash
pi install npm:pi-nerdfont-unescape
```

> 尚未发布——首发前可从本地克隆安装：`pi install /path/to/pi-nerdfont-unescape`。

## 运行与测试依赖

扩展**没有运行时依赖**。`typebox`（pi 本来就提供的 schema 库）声明为 *peer*
依赖，保证运行时只有一份实例——写成普通依赖会装出第二份，pi 启动时就会告警。字形 ground truth（cmap 缓存）、
`nerdfont_lookup` 与 `render_preview` 会调用 `python3` + [fontTools]——缺失时可渲染性判定退化为
类别判断，**可见告警**，绝不静默。测试套件同样依赖。Windows 下未必有名为
`python3` 的命令，需自行暴露（如 `py -3` 做壳）。

Linux 默认读取 fontconfig 排好序的 `monospace` 回退链。macOS、Windows，或
终端自定义字体与 fontconfig 不一致时，请将 `PI_NF_FONT_PATHS` 设为实际主字体
和回退字体文件（也可给目录），多项用平台路径分隔符隔开。无法确认实际字体链
时，扩展会保守显示 `□U+XXXX`，不会再用无关的已安装字体猜测“支持”。

## 测试与视觉验证工作流

`tests/test-nerdfont-unescape.cjs` 与 `test-tools.cjs` 构成全量回归（数量随判例增长），
含全部历史翻车形态。测试会现场生成一个最小确定性字体，不再依赖开发机装了哪些
字体；GitHub CI 同时执行回归与变异审计。

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


`npm run test:audit` 用变异审计证明测试不是摆设：每条变异都必须让某个具体用例变红。
逐条打印耗时与实时 ETA，按 CPU 并行（`--jobs`），每条结论写入
`/tmp/pi-mutation-journal-<源码哈希>.json`——中断后原样重跑即从断点继续；
源码一改日志自动失效，续跑不可能报出过期的绿。

```bash
npm run test:audit -- --only "M6[0-9]" --jobs 4   # 定向切片，几秒出结果
npm run test:audit -- --fresh                     # 忽略日志从头跑
npm run test:audit -- --list                      # 只列变异名
```

所有入口均幂等：临时状态在 `/tmp`，按 pid 或源码哈希命名，进程被 kill 后下次运行自动清扫。

### 无模型 TUI 验收

`scripts/tui-probe/run.sh` 把固定消息渲染进**真实**的 pi TUI 并打印屏幕：
本地 OpenAI 兼容服务（`fake-openai-server.cjs`）回固定文本，`fake-provider.ts`
把它注册成一个 provider，pi 跑在 tmux 里，于是 `tmux capture-pane` 能读到
用户实际看到的画面。

```bash
scripts/tui-probe/run.sh            # 打印渲染结果
CHECK=1 scripts/tui-probe/run.sh    # 对演示消息做断言
```

给要扩展它的人：**绝不要在 tmux 命令里重定向 stdout**——pi 检测到非 TTY 会
静默降级成纯文本。

`scripts/tui-probe/pixel.sh` 再深一层，抓的是**像素**：GNOME Wayland 没有可脚本化
的静默截图（Shell 的 D-Bus 方法自 43 起 AccessDenied，portal 每次弹框），Weston 自带
的 screenshooter 也被拒（`unauthorized`），于是改用 Xvfb——一块虚拟 X 屏幕——在里面
启动你同款的 WezTerm（软件前端、同一份配置与字体），用同一个假模型驱动，再用
ImageMagick 抓屏。真实桌面完全不受影响。

```bash
npm run tui:pixel            # 写出 scripts/tui-probe/out.png
DROP_PUA=1 scripts/tui-probe/run.sh scripts/tui-probe/message-drop.txt
```

第二条命令复现的是**起源缺陷**：`DROP_PUA=1` 让假通道表现得像真实的模型输出管道——
BMP Private Use 字符被静默删除。实测行为：协议写法（`\uE235`）穿过通道并被还原；
裸 PUA 字符消失且扩展读不到任何线索（已记录的盲区）；而自带码位线索的行
（`icon lost -- U+E0B0`）会被补上可见的 `□`。

两个踩过的坑：必须 `env -u WAYLAND_DISPLAY`（否则 WezTerm 会开到真实桌面而不是虚拟
X 屏幕）；必须用 `import -window root -screen`（裸 `-window root` 读的是 root 窗口，
子窗口位置是黑的）。

### 资源护栏（`npm test` 为什么要包一层）

所有套件都经 `scripts/safe-run.sh` 运行：工作负载被放进独立 cgroup，硬上限
`MemoryMax=2G` / `MemorySwapMax=512M`，可用内存低于 2GB 时直接拒绝启动。这不是形式
主义——此前一次并行审计在 15.8GB、已用 21GB swap 的机器上触发了**内核全局 OOM**，
被杀的是浏览器，桌面会话随之崩溃。有了 cgroup 上限，内核只能杀这个工作负载；变异审计
的并行度默认降为 **1**（确需并行再显式 `--jobs N`）。临时 scope 随命令退出销毁，
中断不留残留。

## 边界说明：存档不是 ASCII

`[[nf:]]` 在 `message_end` 解析——这是 pi 扩展唯一的拦截点，而它同时供给
**显示与存储**。因此会话存档里保存的是还原后的真字符。「存档恒 ASCII、
仅在绘制边界转字形」需要 pi 核心支持，当前扩展 API 没有这个钩子。

一个值得知道的后果：存档同时是模型的上下文，所以模型在自己的历史里看到的是
**还原后的字符**。若它照抄而不是写转义形式，通道仍可能把这个字符吞掉——这正是
用户消息要在发送前转义、协议要求模型写转义的原因。已通过读取真实会话文件验证：
还原后的字形、`□U+XXXX` 标记、代码区内的字面转义都与显示完全一致地持久化。

## 设计史（浓缩）

源于 2026-09 通道审计（3310 探针、双向验证）：BMP PUA 必丢；其余 at-risk
区可通过但模型盲发不可靠（PUA 0/3 精度）。2026-10：不可见码位可见替换、
cmap ground truth、输入侧转义、流级探测、CommonMark v2 行内扫描器
（v1 正则被双反引号包裹击败——由视觉验证而非测试发现）。

## 许可证

MIT —— 使用需保留版权与许可声明。
