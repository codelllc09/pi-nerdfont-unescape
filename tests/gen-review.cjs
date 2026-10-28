#!/usr/bin/env node
/**
 * gen-review.cjs — 生成 review.html：全部用例的标准答案审查页。
 *
 * 运行: node tests/gen-review.cjs && (xdg-open review.html)
 * 用途：人工审查「标准答案」（断言语义）本身是否正确——测试会绿，
 *       但期望错了就全错。实际输出由扩展真实跑出（非手写），
 *       提供 原始/码位解码 双视图，审查不依赖浏览器字体。
 */
const { jitiLoad, extPath } = require("./lib.cjs");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Review generation exercises cache migration, so it must use an isolated
// cache rather than the user's production file.
let ownedCacheDir = null;
if (!process.env.PI_NF_CMAP_CACHE) {
  ownedCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-nf-review-"));
  process.env.PI_NF_CMAP_CACHE = path.join(ownedCacheDir, "cmap.json");
  process.on("exit", () => fs.rmSync(ownedCacheDir, { recursive: true, force: true }));
}

const mod = jitiLoad();
void extPath;
const handlers = {}; const tools = {}; let notes = [];
mod.default({
  registerTool: (t) => { tools[t.name] = t; },
  on: (e, f) => { handlers[e] = f; },
});
const ctx = { ui: { notify: (m, t) => notes.push(`[${t}] ${m}`) } };
const hasCp = (s, cp) => [...String(s)].some((ch) => ch.codePointAt(0) === cp);
const seenCps = new Set(); // 页面实际出现的 at-risk 码位 → 字体子集依据
const track = (s) => { for (const ch of String(s)) { const cp = ch.codePointAt(0); if (atRisk(cp)) seenCps.add(cp); } return s; };
const atRisk = (cp) => (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0x10fffd);
const dec = (s) => [...String(s)].map((ch) => {
  const cp = ch.codePointAt(0);
  return atRisk(cp) ? `⟦U+${cp.toString(16).toUpperCase().padStart(4, "0")}⟧` : ch;
}).join("");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const end = async (text) => {
  await handlers["message_start"]?.({}, {});
  const r = await handlers["message_end"]({ message: { role: "assistant", content: [{ type: "text", text }] } }, ctx);
  return r?.message?.content?.[0]?.text ?? text;
};
const input = (text) => handlers["input"]({ type: "input", text, source: "interactive" }, ctx);
const stream = async (updateTexts, endText) => {
  await handlers["message_start"]?.({}, {});
  for (const t of updateTexts) await handlers["message_update"]({ message: { role: "assistant", content: [{ type: "text", text: t }] } }, ctx);
  const r = await handlers["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: endText }] } }, ctx);
  return r?.message?.content?.[0]?.text ?? endText;
};
const lookup = async (q) => (await tools.nerdfont_lookup.execute("t", { query: q })).content[0].text;
const render = async (p) => (await tools.render_preview.execute("t", p)).content[0].text;

// ── 用例清单：kind 决定如何取实际输出；expect 是断言语义（待人工审查的标准答案）──
const CASES = [
  { sec: "① 转义还原", name: "4位形式还原", kind: "end", in: "图标 \\ue235 与 \\u{f0805} Azure",
    expect: "文本含 U+E235 真字符（还原为图标）", mut: "M1", check: (a)=>/解码:.*⟦U\+E235⟧/.test(a)&&!/□U\+E235/.test(a),
   },
  { sec: "① 转义还原", name: "括号形式还原", kind: "end", in: "图标 \\ue235 与 \\u{f0805} Azure",
    expect: "文本含 U+F0805 真字符（增补区括号形式还原）", mut: "M1 M2", check: (a)=>/解码:.*⟦U\+F0805⟧/.test(a),
   },
  { sec: "① 转义还原", name: "六位码位(PUA-B)可见标记", kind: "end", in: "\\u{100000} 与 \\u{10fffd}",
    expect: "PUA-B 六位转义 → □U+100000 / □U+10FFFD（本机无字形，可见替换）", mut: "M2 M4 M24", check: (a)=>a.includes("□U+100000")&&a.includes("□U+10FFFD"),
   },
  { sec: "①b CRLF 文本", name: "CRLF围栏闭合被识别", kind: "end", in: "前 \ue235\r\n```\r\n-- U+E235\r\n```\r\n后 \ue0b0",
    expect: "围栏闭合（行尾 CR 不算内容）→ 围栏后的转义照常还原", mut: "M64", check: (a)=>a.includes("⟦U+E0B0⟧")&&a.includes("-- U+E235"),
   },
  { sec: "①b CRLF 文本", name: "CRLF下行内补框", kind: "end", in: "图标\r\n-- U+E235\r\n尾 x",
    expect: "补框落在行内（CR 之前），不落到下一行行首", mut: "M65 M66", check: (a)=>a.includes("-- U+E235 □\r\n")&&!a.includes("\r □"),
   },
  { sec: "② 字面逃生舱", name: "双反斜杠保持字面", kind: "end", in: "字面写法 \\\\ue235 不还原",
    expect: "显示为单反斜杠字面 \\ue235，不出现真字符", mut: "M3", check: (a)=>a.includes("写法 \\ue235")&&!a.includes("\\\\ue235"),
   },
  { sec: "② 字面逃生舱", name: "六位逃生舱保持字面", kind: "end", in: "字面 \\\\u{100000} 保持",
    expect: "六位双反斜杠同样字面化", mut: "M3 M24", check: (a)=>a.includes("\\u{100000}")&&!a.includes("□U+100000"),
   },
  { sec: "③ 不可见码位 → 可见标记", name: "非字符", kind: "end", in: "\\ufdd0 \\u{e0041} \\u0378",
    expect: "U+FDD0 → □U+FDD0（可见标记，绝不隐形）", mut: "M4", check: (a)=>a.includes("□U+FDD0"),
   },
  { sec: "③ 不可见码位 → 可见标记", name: "Tags(括号形式)", kind: "end", in: "\\ufdd0 \\u{e0041} \\u0378",
    expect: "U+E0041 → □U+E0041", mut: "M2 M4", check: (a)=>a.includes("□U+E0041"),
   },
  { sec: "③ 不可见码位 → 可见标记", name: "未分配BMP", kind: "end", in: "\\ufdd0 \\u{e0041} \\u0378",
    expect: "U+0378 → □U+0378", mut: "M4", check: (a)=>a.includes("□U+0378"),
   },
  { sec: "③ 不可见码位 → 可见标记", name: "cmap判定替换", kind: "end", in: "\\ue5ee",
    expect: "E5EE 不在本机字体 cmap 并集 → □U+E5EE（环境相关：换字体会翻转，非跨机固定答案）", mut: "M4", check: (a)=>a.includes("□U+E5EE"),
   },
  { sec: "④ 观测层（证据性补框 + 保守降级）", name: "空引号逐字节不变+零通知", kind: "end", in: "icon value = '' 与 \"\"",
    expect: "输出与输入逐字节相等，且不产生任何通知（契约冻结）", mut: "M56", check: (a,n)=>a.includes("原样: icon value")&&!a.includes("□")&&!n,
   },
  { sec: "④ 观测层（证据性补框 + 保守降级）", name: "安全码位不补框+零通知", kind: "end", in: "icon annotation: -- U+0041",
    expect: "U+0041 安全码位：逐字节不变 + 零通知（契约冻结）", mut: "M58", check: (a,n)=>a.includes("-- U+0041")&&!a.includes("□")&&!n,
   },
  { sec: "④ 观测层（证据性补框 + 保守降级）", name: "跨行同码位不压制", kind: "end", in: "present \\ue235\nicon lost: -- U+E235",
    expect: "合规检查限本片段：他处出现的同码位不压制本行丢失证据", mut: "M60", check: (a)=>/-- U\+E235 □/.test(a),
   },
  { sec: "④ 观测层（证据性补框 + 保守降级）", name: "同段同码位仍压制", kind: "end", in: "icon \\ue235 same line: -- U+E235",
    expect: "同段已还原=未丢失，注释不补框", mut: "M60", check: (a)=>!a.includes("□"),
   },
  { sec: "④ 观测层（证据性补框 + 保守降级）", name: "六位码位注释补框", kind: "end", in: "icon lost: -- U+100000",
    expect: "PUA-B 六位码位注释同样补框（4-6 位 + isAtRisk 门）", mut: "M59", check: (a)=>a.includes("-- U+100000 □"),
   },
  { sec: "④ 观测层（证据性补框 + 保守降级）", name: "Lua注释补框(证据性)", kind: "end", in: "icon lost: -- U+E235",
    expect: "文本自带码位=确凿证据 → 尾部补 □", mut: "M5", check: (a)=>a.includes("-- U+E235 □"),
   },
  { sec: "④ 观测层（证据性补框 + 保守降级）", name: "围栏内Lua不补", kind: "end", in: "icon\n```\n-- U+E235\n```\n尾部无转义",
    expect: "代码里的码位注释是字面量，不补", mut: "M7", check: (a)=>a.split("\n").some((l)=>l==="-- U+E235"),
   },
  { sec: "④ 观测层（证据性补框 + 保守降级）", name: "未知字体标记不重复处置", kind: "nf", in: "删缓存后 同段 \\ue235 与 -- U+E235",
    expect: "转义已抵达（□U+E235）→ 非模型丢失，注释不补、不双报", mut: "M61", check: (a,n)=>/□数=1/.test(a)&&!/likely dropped/.test(n),
   },
  { sec: "④ 观测层（证据性补框 + 保守降级）", name: "已知缺字标记不重复处置", kind: "end", in: "icon \\ue5ee same line: -- U+E5EE",
    expect: "已知缺字 → 可见标记即已处置，注释不补框", mut: "M61", check: (a)=>a.includes("□U+E5EE")&&!a.includes("-- U+E5EE □")&&!(a.match(/□(?!U\+)/g)||[]).length
   },
  { sec: "④ 观测层（证据性补框 + 保守降级）", name: "cmap未知保守替换", kind: "nf", in: "删缓存后 \\ue235",
    expect: "字体状态未知=二维表第4行 → □U+E235（拒绝乐观还原）", mut: "M57", check: (a)=>a.includes("□U+E235")&&/保守=true/.test(a),
   },
  { sec: "⑤ 围栏保护", name: "围栏内保持字面", kind: "end", in: '外面 \\ue235\n```\nx = "\\ue0b0"\n```\n后 \\uf308',
    expect: '围栏内 "\\ue0b0" 保持字面（复制保真）', mut: "M7", check: (a)=>a.includes('"\\ue0b0"'),
   },
  { sec: "⑤ 围栏保护", name: "异种围栏不闭合", kind: "end", in: "```\n内 \\ue0b0\n~~~\n仍内 \\ue0b0\n```\n外 \\ue235",
    expect: "~~~ 不能闭合 ``` 围栏", mut: "M26", check: (a)=>{const seg=a.slice(0,a.indexOf("解码: "));return (seg.match(/\\ue0b0/g)||[]).length===2&&/⟦U\+E235⟧/.test(a);}
   },
  { sec: "⑤ 围栏保护", name: "非纯围栏行不闭合", kind: "end", in: "```\n内文 \\ue0b0\n```x\n仍内 \\ue0b0\n```\n外 \\ue235",
    expect: "```x 行不是闭合围栏", mut: "M26 M34", check: (a)=>a.includes("仍内 \\ue0b0")&&/⟦U\+E235⟧/.test(a),
   },
  { sec: "⑤ 围栏保护", name: "围栏外还原", kind: "end", in: '外面 \\ue235\n```\nx = "\\ue0b0"\n```\n后 \\uf308',
    expect: "围栏外 E235、F308 还原为真字符", mut: "M1 M7", check: (a)=>/⟦U\+E235⟧/.test(a)&&/⟦U\+F308⟧/.test(a),
   },
  { sec: "⑥ 行内代码段保护(v2)", name: "双反引号包裹[回归]", kind: "end", in: '| `` `symbol = "\\ue0b0"` `` 行内段 |',
    expect: 'CommonMark 双反引号包裹内 "\\ue0b0" 保持字面（2026-10-27 视觉验证判例）', mut: "M8", check: (a)=>a.includes('"\\ue0b0"'),
   },
  { sec: "⑥ 行内代码段保护(v2)", name: "单反引号段", kind: "end", in: "单段 `x \\ue235` 段外 \\ue0a0",
    expect: "`x \\ue235` 保持字面", mut: "M8", check: (a)=>a.includes("`x \\ue235`"),
   },
  { sec: "⑥ 行内代码段保护(v2)", name: "段间还原", kind: "end", in: "单段 `x \\ue235` 段外 \\ue0a0",
    expect: "段外 E0A0 还原为真字符", mut: "M1 M8", check: (a)=>/⟦U\+E0A0⟧/.test(a),
   },
  { sec: "⑥ 行内代码段保护(v2)", name: "同行多段+未闭合", kind: "end", in: "`a \\ue235` 中段 \\uf308 `b \\ue718` 悬挂 ` 尾 \\ue0a0",
    expect: "两段字面保留；悬挂反引号不传染；尾 E0A0 还原", mut: "M1 M8", check: (a)=>a.includes("`a \\ue235`")&&a.includes("`b \\ue718`")&&/⟦U\+E0A0⟧/.test(a),
   },
  { sec: "⑦ 输入侧自动转义", name: "transform", kind: "input", in: "看 ⟦E235⟧ 图标",
    expect: "含 at-risk 字符 → action=transform（改写后再发）", mut: "M9", check: (a)=>a.includes("action=transform"),
   },
  { sec: "⑦ 输入侧自动转义", name: "无裸字符", kind: "input", in: "看 ⟦E235⟧ 图标",
    expect: "发出文本里只剩 \\ue235 转义，无裸 PUA 字符", mut: "M9", check: (a)=>/原样: 看 \\ue235/.test(a),
   },
  { sec: "⑧ 流级丢失探测", name: "流转义还原不矛盾", kind: "stream", in: "流裸字符 → 终稿转义并还原",
    expect: "同一字符两种形态 → 只报已还原，不报 MISSING", mut: "M31", check: (a,n)=>n.includes("restored")&&!n.includes("MISSING"),
   },
  { sec: "⑧ 流级丢失探测", name: "流可见替换不矛盾", kind: "stream", in: "流裸 E5EE → 终稿转义 → □U+E5EE",
    expect: "可见标记已代表同一码位，不再同时报告 MISSING", mut: "M69", check: (a,n)=>a.includes("□U+E5EE")&&!n.includes("MISSING"),
   },
  { sec: "⑧ 流级丢失探测", name: "emoji改稿不误报", kind: "stream", in: "流 ⟦1F680⟧ → 终稿删掉",
    expect: "emoji 正常改稿不进丢失快照", mut: "M27", check: (a,n)=>!n.includes("MISSING"),
   },
  { sec: "⑧ 流级丢失探测", name: "丢失被点名", kind: "stream", in: "update: ⟦E235⟧ 在场 → end: 在场",
    expect: "流里见过、终稿消失 → 通知 MISSING 点名码位（证据性告警，非确证）", mut: "M10", check: (a,n)=>n.includes("MISSING"),
   },
  { sec: "⑧ 流级丢失探测", name: "一致时无误报", kind: "stream", in: "update 与 end 都真含 ⟦E235⟧",
    expect: "流与终稿一致 → 不告警", mut: "M11", check: (a,n)=>!n.includes("MISSING"),
   },
  { sec: "⑨ nerdfont_lookup", name: "已注册", kind: "reg", in: "—",
    expect: "nerdfont_lookup 与 render_preview 均注册", mut: "M19", check: (a)=>a.includes("nerdfont_lookup")&&a.includes("render_preview"),
   },
  { sec: "⑨ nerdfont_lookup", name: "关键词 python → 含 E235 转义", kind: "lookup", in: "python",
    expect: "返回行含 \\uE235（可直接粘贴的转义）", mut: "M14 M15", check: (a)=>/\\u[eE]235|U\+E235/i.test(a),
   },
  { sec: "⑨ nerdfont_lookup", name: "族别优先（首行即优先族）", kind: "lookup", in: "python",
    expect: "首个字形行即来自优先族（真正断言排序）", mut: "M14 M15", check: (a)=>{const g=a.split("\n").filter((l)=>/U\+[0-9A-F]{4,5}/.test(l));return g.length>0&&/(?:nf-)?(?:md|custom|seti|dev|oct|fae|fa|pl|linux)-[a-z]/.test(g[0]);},
   },
  { sec: "⑨ nerdfont_lookup", name: "码位查询 → E0A0 在场", kind: "lookup", in: "U+E0A0",
    expect: "码位反查返回 pl-branch / e0a0", mut: "M14 M15", check: (a)=>/e0a0|pl-branch/i.test(a),
   },
  { sec: "⑨ nerdfont_lookup", name: "starship 模式 → E718", kind: "lookup", in: "starship nodejs",
    expect: "starship 默认表：nodejs → \\uE718（无需联网）", mut: "M14 M15", check: (a)=>/\\u[eE]718|U\+E718/i.test(a),
   },
  { sec: "⑨ nerdfont_lookup", name: "无命中不崩溃（有输出）", kind: "lookup", in: "zzz-no-such-glyph-xyz",
    expect: "无命中时给出提示文本，execute 不抛异常", mut: "M15", check: (a)=>!a.includes("THROWN")&&a.length>0,
   },
  { sec: "⑩ render_preview", name: "CJK 宽度算术 + 右补齐", kind: "render", in: "中文 / width=8",
    expect: "中文=4 列，右补 4 空格；审计报告 8 cols", mut: "M16", check: (a)=>a.includes("中文    ")&&a.includes("8 cols"),
   },
  { sec: "⑩ render_preview", name: "Emoji按双列计宽", kind: "render", in: "🐍 / width=1",
    expect: "宽 Emoji 按 2 列计数，因此明确报告 2 > 1 溢出", mut: "M70", check: (a)=>a.includes("overflows: 2 > 1"),
   },
  { sec: "⑩ render_preview", name: "render CRLF不计入宽度", kind: "render", in: "A\\r\\nB / width=1 / frame=ascii",
    expect: "行尾 CR 被剥离；A/B 均为 1 列且无溢出", mut: "M71", check: (a)=>!a.includes("overflows")&&!a.includes("\\r")&&a.includes("|A|")&&a.includes("|B|"),
   },
  { sec: "⑩ render_preview", name: "非法宽度可见报错", kind: "render", in: "width=-1",
    expect: "非法宽度不静默回退，返回可见 ERROR", mut: "参数守卫", check: (a)=>a.startsWith("ERROR: width"),
   },
  { sec: "⑩ render_preview", name: "非法边框可见报错", kind: "render", in: "frame=rounded",
    expect: "非法边框不静默当作 ASCII，返回可见 ERROR", mut: "参数守卫", check: (a)=>a.startsWith("ERROR: frame"),
   },
  { sec: "⑩ render_preview", name: "TAB → 点线行", kind: "render", in: "左段⇥右段 / width=20",
    expect: "含 TAB 的行 → 点线对齐行", mut: "M16", check: (a)=>a.includes("…")||/\.{3}/.test(a),
   },
  { sec: "⑩ render_preview", name: "双边框", kind: "render", in: "标题 / frame=double",
    expect: "╔═╗ 边框渲染", mut: "M20", check: (a)=>a.includes("╔")&&a.includes("═"),
   },
  { sec: "⑩ render_preview", name: "预览含转义字面量", kind: "render", in: "\\ue235 图标 / width=10",
    expect: "预览文本中 PUA 以 \\ue235 字面量呈现（通道安全）", mut: "M16", check: (a)=>/\\u[eE]235/.test(a),
   },
  { sec: "⑩ render_preview", name: "writePath 写出真字符", kind: "render", in: "\\ue235 图标 / writePath",
    expect: "文件内容含 E235 真字符（绕过通道剥离）", mut: "M16 M21", check: (a)=>/含E235真字符: true/.test(a),
   },
  { sec: "⑩ render_preview", name: "六位预览转义字面量", kind: "render", in: "\\u{100000}",
    expect: "增补区 PUA 以 \\u{100000} 字面量呈现（通道安全）", mut: "M32", check: (a)=>a.includes("\\u{100000}"),
   },
  { sec: "⑩ render_preview", name: "非法码位短错误", kind: "render", in: "\\u{ffffff}",
    expect: "[U+FFFFFF] 可见标记 + 短错误", mut: "M33", check: (a)=>a.includes("[U+FFFFFF]")&&a.length<400,
   },
  { sec: "⑩ render_preview", name: "符号链接不绕护栏", kind: "render", in: "writePath=/tmp/link→/dev/null",
    expect: "真路径判定：链接先解析再查界", mut: "M28 M35", check: (a)=>a.startsWith("ERROR"),
   },
  { sec: "⑩ render_preview", name: "writePath 护栏", kind: "render", in: "writePath=/etc/x.out",
    expect: "界外路径拒绝 + PI_RENDER_ALLOW_ANY 提示", mut: "M28", check: (a)=>a.startsWith("ERROR")&&a.includes("PI_RENDER_ALLOW_ANY"),
   },
  { sec: "⑩ render_preview", name: "六位转义按图标计宽", kind: "render", in: "\\u{100000} / width=12",
    expect: "六位转义按 1 列图标计宽（pua=1）", mut: "M29", check: (a)=>/pua=1/.test(a),
   },
  { sec: "⑩ render_preview", name: "写盘回报", kind: "render", in: "同上",
    expect: "输出回报写入路径", mut: "M21", check: (a)=>a.includes("/tmp/"),
   },
  { sec: "⑪ 系统提示注入", name: "追加而非替换", kind: "prompt", in: 'BASE',
    expect: "返回 systemPrompt 以原 BASE 开头（追加协议，不覆盖）", mut: "M12", check: (a)=>a.includes('前缀: "BASE'),
   },
  { sec: "⑪ 系统提示注入", name: "协议块在场", kind: "prompt", in: 'BASE',
    expect: "含「nerdfont-unescape 输出协议」标题", mut: "M13a", check: (a)=>a.includes("含协议标题: true"),
   },
  { sec: "⑪ 系统提示注入", name: "含逃生舱说明", kind: "prompt", in: 'BASE',
    expect: "含双反斜杠字面展示的说明", mut: "M13b", check: (a)=>a.includes("含逃生舱说明: true"),
   },
  { sec: "⑫ 输入处理边角", name: "无风险字符 → continue", kind: "input", in: "普通文字",
    expect: "无 at-risk → action=continue（原文直发，零打扰）", mut: "M22", check: (a)=>a.includes("action=continue"),
   },
  { sec: "⑫ 输入处理边角", name: "增补区 → 括号形式", kind: "input", in: "a⟦F0805⟧⟦E235⟧",
    expect: "增补区字符转义为 \\u{f0805} 括号形式", mut: "M9", check: (a)=>a.includes("\\u{f0805}"),
   },
  { sec: "⑫ 输入处理边角", name: "PUA-B → 六位括号形式", kind: "input", in: "b⟦10FFFD⟧c",
    expect: "六位码位输入侧生成 \\u{10fffd}", mut: "M9", check: (a)=>a.includes("\\u{10fffd}"),
   },
  { sec: "⑫ 输入处理边角", name: "通知级别 warning", kind: "input", in: "a⟦F0805⟧⟦E235⟧",
    expect: "自动转义时通知级别为 warning", mut: "M23", check: (a,n)=>n.includes("warning"),
   },
  { sec: "⑭ [[nf:]] 语义标记(beta)", name: "标记解析渲染", kind: "nf", in: "[[nf:python]]",
    expect: "解析为本机字体图标（真字符或可见标记），标记不残留", mut: "M36", check: (a)=>!a.includes("[[nf:python]]")&&(/⟦U\+E235⟧/.test(a)||a.includes("□U+E235")),
   },
  { sec: "⑭ [[nf:]] 语义标记(beta)", name: "大写标记解析", kind: "nf", in: "[[NF:python]]",
    expect: "大小写不敏感（快速通道与正则一致，静默忽略=红线违规）", mut: "M38", check: (a)=>!a.includes("[[NF:python]]")&&(/⟦U\+E235⟧/.test(a)||a.includes("□U+E235")),
   },
  { sec: "⑭ [[nf:]] 语义标记(beta)", name: "git-branch 别名解析", kind: "nf", in: "[[nf:git-branch]]",
    expect: "稳定别名 → branch → E0A0（别名→精确名→子串 三级解析）", mut: "M39", check: (a)=>!a.includes("[[nf:git-branch]]")&&(/⟦U\+E0A0⟧/.test(a)||a.includes("□U+E0A0")),
   },
  { sec: "⑭ [[nf:]] 语义标记(beta)", name: "安全码位同名不吞语义标记", kind: "nf", in: "[[nf:lambda]]",
    expect: "普通 Unicode lambda 不抢占同名 Nerd Font PUA 图标；标记必须落地", mut: "M67", check: (a,n)=>!a.includes("[[nf:lambda]]")&&(/⟦U\+[EF][0-9A-F]{3,5}⟧/.test(a)||/□U\+[EF][0-9A-F]{3,5}/.test(a))&&!n.includes("no such name"),
   },
  { sec: "⑭ [[nf:]] 语义标记(beta)", name: "围栏内标记不动", kind: "nf", in: "```[[nf:python]]```",
    expect: "代码里的标记是要复制的字面量，不解析", mut: "M7", check: (a)=>a.includes("[[nf:python]]"),
   },
  { sec: "⑭ [[nf:]] 语义标记(beta)", name: "未知名保留+点名", kind: "nf", in: "[[nf:zzz_no_such]]",
    expect: "标记保留 + warning 点名（不静默）", mut: "M37", check: (a,n)=>a.includes("[[nf:zzz_no_such]]")&&n.includes("zzz_no_such"),
   },
  { sec: "⑮ [[nf:]] 健壮性", name: "旧Map遗留安全迁移", kind: "nf", in: "遗留裸Map→[[nf:python]]",
    expect: "旧结构安全重建，不崩溃，解析为正确码位", mut: "M40", check: (a)=>/⟦U\+E235⟧/.test(a)&&!/崩溃/.test(a)
   },
  { sec: "⑮ [[nf:]] 健壮性", name: "损坏cmap不击穿消息", kind: "nf", in: "全局 ranges=[null] 后还原 E235",
    expect: "损坏 range 防御性判为无字形，显示 □U+E235，不抛 TypeError", mut: "M68", check: (a)=>a.includes("□U+E235")&&!a.includes("执行异常"),
   },
  { sec: "⑮ [[nf:]] 健壮性", name: "签名变化缓存失效", kind: "nf", in: "投毒缓存→改签名→重解析",
    expect: "cmap 指纹失配 → 缓存整体失效 → 投毒值被纠正", mut: "M41", check: (a)=>a.includes("纠正=true"),
   },
  { sec: "⑮ [[nf:]] 健壮性", name: "失败缓存不永久", kind: "nf", in: "python→null 后重试",
    expect: "null 不跨消息缓存，下条消息重试成功", mut: "M42", check: (a)=>a.includes("解析=true"),
   },
  { sec: "⑮ [[nf:]] 健壮性", name: "非法标记保留+点名", kind: "nf", in: "[[nf:bad name]] [[nf:名称]]",
    expect: "语法非法的标记保留原文 + warning 点名（静默=红线违规）", mut: "M43", check: (a,n)=>a.includes("[[nf:bad name]]")&&n.includes("invalid marker syntax"),
   },
  { sec: "⑮ [[nf:]] 健壮性", name: "vscode 子串解析", kind: "nf", in: "[[nf:vscode]]",
    expect: "别名删除后子串命中（别名反伤判例）", mut: "M44", check: (a)=>!a.includes("[[nf:")&&(/⟦U\+E8DA⟧/.test(a)||a.includes("□U+E8DA")),
   },
  { sec: "⑮ [[nf:]] 健壮性", name: "node.js 别名可达", kind: "nf", in: "[[nf:node.js]]",
    expect: "正则允许 . 后别名可达", mut: "M39", check: (a)=>!a.includes("[[nf:")&&(/⟦U\+F0399⟧/.test(a)||a.includes("□U+F0399")),
   },
  { sec: "⑯ reload 与批量", name: "reload签名保持+变更恢复", kind: "nf", in: "签名仅存全局（reload 模拟）",
    expect: "同签名投毒沿用；签名变更后投毒被纠正（cmapSig 全局化）", mut: "M41 M45", check: (a)=>a.includes("保持=true")&&a.includes("纠正=true"),
   },
  { sec: "⑯ reload 与批量", name: "空名与超长名告警", kind: "nf", in: "[[nf:]] 41字 65字",
    expect: "空名/超长名都进语法告警（外壳匹配不限长 + 同规则校验）", mut: "M46 M47", check: (a,n)=>n.includes("invalid marker syntax")&&n.includes("[[nf:]]"),
   },
  { sec: "⑯ reload 与批量", name: "双未缓存名批量解析", kind: "nf", in: "[[nf:python]] 和 [[nf:docker]]",
    expect: "一次批量调用解析全部未缓存名", mut: "M48", check: (a)=>!a.includes("[[nf:")&&(/⟦U\+E235⟧/.test(a)||a.includes("□U+E235"))&&(/⟦U\+F308⟧/.test(a)||a.includes("□U+F308")),
   },
  { sec: "⑰⑱ 迁移与核验", name: "热升级签名迁移", kind: "nf", in: "有 STORE 无 SIG（第五轮现场）",
    expect: "有共享 cmap 但无全局签名时，从有效磁盘缓存恢复签名", mut: "M50", check: (a)=>a.includes("签名恢复: OK")&&/⟦U\+E235⟧/.test(a)
   },
  { sec: "⑰⑱ 迁移与核验", name: "纠正后签名稳定", kind: "nf", in: "变更→纠正→再解析",
    expect: "store.sig 写回比对基准，后续消息不再重复清缓存", mut: "M49", check: (a)=>a.includes("稳定=true"),
   },
  { sec: "⑰⑱ 迁移与核验", name: "121/200字名告警", kind: "nf", in: "121 字与 200 字名",
    expect: "超长名同样点名（LOOSE 不限长）", mut: "M47", check: (a,n)=>n.includes("c".repeat(121))&&n.includes("d".repeat(200)),
   },
  { sec: "⑱ 磁盘迁移与真实核验", name: "损坏磁盘缓存拒收并重建", kind: "nf", in: "schema=2 但 ranges=[null]",
    expect: "结构损坏的缓存不载入共享 cmap，并在后台重建", mut: "M52 M53", check: (a)=>/拒收=true/.test(a)&&/重建=true/.test(a),
   },
  { sec: "⑱ 磁盘迁移与真实核验", name: "并发重建去重", kind: "nf", in: "连续三次 session_start",
    expect: "只有一次 cmap 构建完成记录，不发生扫描风暴", mut: "M54", check: (a)=>/去重=true/.test(a),
   },
  { sec: "⑱ 磁盘迁移与真实核验", name: "reload真实签名核验", kind: "nf", in: "篡改全局签名后 reload",
    expect: "主动计算真实字体签名并重建，签名恢复为真值", mut: "M51", check: (a)=>/签名已恢复=true/.test(a),
   },
  { sec: "⑱ 磁盘迁移与真实核验", name: "签名核验失败留痕", kind: "nf", in: "临时令 python3 不可达",
    expect: "warning 明确说明签名核验失败，不静默降级", mut: "M55", check: (a)=>a.includes("font signature check failed"),
   },
  { sec: "⑬ Markdown 边角", name: "波浪围栏保护", kind: "end", in: "前 \\ue235\n~~~\nx = \"\\ue0b0\"\n~~~\n后 \\uf308",
    expect: "~~~ 围栏与 ``` 同等保护", mut: "M7", check: (a)=>{const seg=a.slice(0,a.indexOf("解码: "));return (seg.match(/\\ue0b0/g)||[]).length===1&&/⟦U\+E235⟧/.test(a)&&/⟦U\+F308⟧/.test(a);}
   },
  { sec: "⑬ Markdown 边角", name: "带语言标注围栏", kind: "end", in: "```js\nicon = \"\\ue718\"\n```\n外 \\ue0a0",
    expect: "```js 信息串不破坏围栏判定", mut: "M7", check: (a)=>a.includes('"\\ue718"')&&/⟦U\+E0A0⟧/.test(a),
   },
  { sec: "⑬ Markdown 边角", name: "列表+行内段混合", kind: "end", in: "- 列表项 `\\ue235` 与 **粗体** \\ue0a0",
    expect: "列表行的行内段照常保护，段外还原", mut: "M8", check: (a)=>a.includes("`\\ue235`")&&/⟦U\+E0A0⟧/.test(a),
   },
  { sec: "⑬ Markdown 边角", name: "通知计数 ×2", kind: "end", in: "两个 \\ue235 \\ue0a0",
    expect: "还原通知按码位分组计数（×2）", mut: "M17", check: (a,n)=>n.includes("×2"),
   },
  { sec: "⑬ Markdown 边角", name: "user 流不触发误报", kind: "stream", in: "user update 含 ⟦E235⟧ → assistant end 不含",
    expect: "user 消息不进丢失快照 → 不误报", mut: "M18", check: (a,n)=>!n.includes("MISSING"),
   },
];

(async () => {
  await handlers["session_start"]?.({}, {});
  for (let i = 0; i < 40 && !globalThis[Symbol.for("pi.nerdfontUnescape.cmap")]; i++) {
    await new Promise((r) => setTimeout(r, 3000));
  }
  const rows = [];
  let curSec = "";
  let assertPass = 0, assertFail = 0; const failNames = [];
  for (const c of CASES) {
    notes = [];
    let actual = "";
    try {
      if (c.kind === "end") {
        const out = await end(c.in.replace(/\\n/g, "\n"));
        track(out); notes.forEach((n) => track(n));
        actual = `原样: ${out}` + `\n解码: ${dec(out)}` + (notes.length ? `\n通知: ${notes.map(dec).join(" ｜ ")}` : "");
      } else if (c.kind === "input") {
        const raw = c.in.includes("⟦") ? c.in.replace(/⟦([0-9A-F]+)⟧/g, (_, h) => String.fromCodePoint(parseInt(h, 16))) : c.in;
        const ir = await input(raw);
        track(ir.text ?? ""); notes.forEach((n) => track(n));
        actual = `action=${ir.action}` + `\n原样: ${ir.text ?? "(原文直发)"}` + (ir.text ? `\n解码: ${dec(ir.text)}` : "") + (notes.length ? `\n通知: ${notes.map(dec).join(" ｜ ")}` : "");
      } else if (c.kind === "stream") {
        if (c.name === "丢失被点名") await stream(["\ue235 在场"], "在场");
        else if (c.name === "一致时无误报") { const s = "稳定 \ue235 在场"; await stream([s], s); }
        else if (c.name === "流转义还原不矛盾") await stream([String.fromCodePoint(0xe235) + " 图"], "图 \\ue235");
        else if (c.name === "流可见替换不矛盾") {
          // E5EE is absent from the fixture chain → the escaped form lands as a
          // visible marker; the stream saw the raw char, which is the SAME
          // codepoint in another shape (no MISSING contradiction).
          const finalText = await stream([String.fromCodePoint(0xe5ee) + " 图"], "图 \\ue5ee");
          actual = `终稿: ${dec(finalText)}　` + (notes.length ? `通知: ${notes.map(dec).join(" ｜ ")}` : "(无通知)");
          c.checked = true;
        }
        else if (c.name === "emoji改稿不误报") await stream([String.fromCodePoint(0x1f680) + " 起飞"], "删掉了");
        else await (async () => {
          await handlers["message_start"]?.({}, {});
          await handlers["message_update"]({ message: { role: "user", content: [{ type: "text", text: "\ue235" }] } }, ctx);
          await handlers["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: "回" }] } }, ctx);
        })();
        if (!c.checked) actual = notes.length ? `通知: ${notes.map(dec).join(" ｜ ")}` : "(无通知)";
      } else if (c.kind === "nf") {
        let src = c.in;
        if (c.name === "旧Map遗留安全迁移") { globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")] = new Map([["python", 0xe0a0]]); src = "[[nf:python]]"; }
        else if (c.name === "非法标记保留+点名") src = "[[nf:bad name]] 与 [[nf:名称]]";
        else if (c.name === "未知字体标记不重复处置") {
          const CSTK = Symbol.for("pi.nerdfontUnescape.cmap");
          const saved = globalThis[CSTK];
          delete globalThis[CSTK];
          notes.length = 0;
          const out9 = await end("icon \\ue235 same line: -- U+E235");
          globalThis[CSTK] = saved;
          src = null;
          actual = `□数=${(out9.match(/□/g) || []).length} 解码: ${dec(out9)}`;
        }
        else if (c.name === "cmap未知保守替换") {
          const CSTK = Symbol.for("pi.nerdfontUnescape.cmap");
          const saved = globalThis[CSTK];
          delete globalThis[CSTK];
          const out9 = await end("\\ue235 字体未知");
          globalThis[CSTK] = saved;
          src = null;
          actual = `原样: ${out9}\n(保守=${out9.includes("□U+E235")})`;
        }
        else if (c.name === "空名与超长名告警") src = "[[nf:]] 与 [[nf:" + "a".repeat(41) + "]] 与 [[nf:" + "b".repeat(65) + "]]";
        else if (c.name === "双未缓存名批量解析") {
          const st = globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")];
          st.map.delete("python"); st.map.delete("docker");
          src = "[[nf:python]] 和 [[nf:docker]] 双名";
        }
        else if (c.name === "签名变化缓存失效") {
          const SIGK = Symbol.for("pi.nerdfontUnescape.cmapSig");
          const savedSig = globalThis[SIGK];
          await end("[[nf:git-branch]]"); // 预热
          const st = globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")];
          st.map.set("git-branch", 0xe235); // 投毒（同签名）
          const poisoned = await end("[[nf:git-branch]]");
          globalThis[SIGK] = "__review_changed__";
          const cured = await end("[[nf:git-branch]]");
          globalThis[SIGK] = savedSig; // 场景隔离：恢复全局签名，不污染后续场景
          src = null;
          actual = `投毒沿用: ${dec(poisoned)}\n变更后: ${dec(cured)}\n(纠正=${hasCp(cured, 0xe0a0) && !hasCp(cured, 0xe235)})`;
        }
        else if (c.name === "reload签名保持+变更恢复") {
          const SIGK = Symbol.for("pi.nerdfontUnescape.cmapSig");
          const savedSig = globalThis[SIGK];
          await end("[[nf:python]]");
          const st = globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")];
          globalThis[SIGK] = st.sig; // reload 模拟：签名仅存全局
          st.map.set("python", 0xe0a0); // 投毒
          const keep = await end("[[nf:python]]");
          globalThis[SIGK] = "__reload_changed__";
          const cured = await end("[[nf:python]]");
          globalThis[SIGK] = savedSig; // 恢复现场
          src = null;
          actual = `同签名投毒: ${dec(keep)}\n变更后: ${dec(cured)}\n(保持=${hasCp(keep, 0xe0a0)}, 纠正=${hasCp(cured, 0xe235)})`;
        }
        else if (c.name === "失败缓存不永久") {
          await end("[[nf:python]]");
          globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")].map.set("python", null);
          src = null;
          const retried = await end("[[nf:python]]");
          actual = `null 后重试: ${dec(retried)}\n(解析=${!retried.includes("[[nf:python]]")})`;
        }
        else if (c.name === "热升级签名迁移") {
          const SIGK = Symbol.for("pi.nerdfontUnescape.cmapSig");
          const ASYNCK = Symbol.for("pi.nerdfontUnescape.cmapAsyncState");
          for (let i = 0; i < 200 && (globalThis[ASYNCK]?.checking || globalThis[ASYNCK]?.building); i++) {
            await new Promise((r) => setTimeout(r, 100));
          }
          const saved = globalThis[SIGK];
          delete globalThis[SIGK];
          globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")] = { sig: "round5-sig", map: new Map([["python", null]]) };
          await handlers["session_start"]?.({}, ctx);
          let rec = typeof globalThis[SIGK] === "string";
          for (let i = 0; i < 5 && !rec; i++) { await new Promise((r) => setTimeout(r, 3000)); rec = typeof globalThis[SIGK] === "string"; }
          const out9 = await end("[[nf:python]]");
          globalThis[SIGK] = saved;
          src = null;
          actual = `签名恢复: ${rec ? "OK" : "FAIL"}\n解析: ${dec(out9)}`;
        }
        else if (c.name === "纠正后签名稳定") {
          const SIGK = Symbol.for("pi.nerdfontUnescape.cmapSig");
          const saved = globalThis[SIGK];
          await end("[[nf:python]]");
          globalThis[SIGK] = "__v8__";
          await end("[[nf:python]]");
          const s1 = globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")].sig;
          await end("[[nf:python]]");
          const s2 = globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")].sig;
          globalThis[SIGK] = saved;
          src = null;
          actual = `纠正后: ${s1} → 下条: ${s2}\n(稳定=${s1 === s2 && s1 === "__v8__"})`;
        }
        else if (c.name === "121/200字名告警") {
          notes.length = 0;
          src = "[[nf:" + "c".repeat(121) + "]] 与 [[nf:" + "d".repeat(200) + "]]";
          const out9 = await end(src);
          void out9;
          src = null;
          const warning = notes.find((n) => n.includes("invalid marker syntax")) ?? "";
          actual = `121字点名=${warning.includes("c".repeat(121))}\n200字点名=${warning.includes("d".repeat(200))}`;
        }
        else if (c.name === "损坏cmap不击穿消息") {
          // Inject a structurally corrupt shared cmap, then restore it: the
          // message pipeline must degrade to □U+XXXX, never throw.
          const CSTK = Symbol.for("pi.nerdfontUnescape.cmap");
          const saved = globalThis[CSTK];
          globalThis[CSTK] = [null];
          try {
            src = "转义 \\ue235 结束";
          } finally {
            // restore after the shared end() runs below
            setTimeout(() => { globalThis[CSTK] = saved; }, 0);
          }
        }
        else if (c.name === "损坏磁盘缓存拒收并重建" || c.name === "旧格式缓存拒收并重建" || c.name === "并发重建去重") {
          const CSTK = Symbol.for("pi.nerdfontUnescape.cmap");
          const SIGK = Symbol.for("pi.nerdfontUnescape.cmapSig");
          const ASYNCK = Symbol.for("pi.nerdfontUnescape.cmapAsyncState");
          const cachePath = process.env.PI_NF_CMAP_CACHE;
          fs.writeFileSync(
            cachePath,
            c.name === "损坏磁盘缓存拒收并重建"
              ? JSON.stringify({ schema: 2, fonts: 1, ranges: [null], sig: "fake" }) // valid JSON, structurally corrupt
              : JSON.stringify({ fonts: ["fake"], ranges: [[57344, 57344]] }), // legacy shape (no schema/sig)
          );
          delete globalThis[CSTK]; delete globalThis[SIGK];
          globalThis[ASYNCK] = { checking: false, building: false };
          const logs = [];
          const realError = console.error;
          console.error = (...args) => { logs.push(args.map(String).join(" ")); };
          try {
            await handlers["session_start"]?.({}, ctx);
            const rejected = globalThis[CSTK] === undefined;
            await handlers["session_start"]?.({}, ctx);
            await handlers["session_start"]?.({}, ctx);
            for (let i = 0; i < 40 && typeof globalThis[SIGK] !== "string"; i++) await new Promise((r) => setTimeout(r, 3000));
            await new Promise((r) => setTimeout(r, 3000));
            const builds = logs.filter((s) => s.includes("cmap cache:")).length;
            actual = c.name === "损坏磁盘缓存拒收并重建" || c.name === "旧格式缓存拒收并重建"
              ? `旧格式拒收=${rejected}\n签名重建=${typeof globalThis[SIGK] === "string"}`
              : `构建完成次数=${builds}\n(去重=${builds === 1})`;
          } finally {
            console.error = realError;
          }
          src = null;
        }
        else if (c.name === "reload真实签名核验") {
          const SIGK = Symbol.for("pi.nerdfontUnescape.cmapSig");
          globalThis[SIGK] = "__review_tampered__";
          for (let i = 0; i < 40 && globalThis[SIGK] === "__review_tampered__"; i++) {
            await handlers["session_start"]?.({}, ctx);
            await new Promise((r) => setTimeout(r, 3000));
          }
          actual = `签名已恢复=${typeof globalThis[SIGK] === "string" && globalThis[SIGK] !== "__review_tampered__"}`;
          src = null;
        }
        else if (c.name === "签名核验失败留痕") {
          notes.length = 0;
          const savedPath = process.env.PATH;
          // This case simulates a missing python3 by emptying PATH. The extension
          // reports that on stderr by design, which would otherwise look like a
          // real failure in this report's output — label it instead of hiding it.
          const realErr = console.error;
          console.error = (...args) => {
            const line = args.map(String).join(" ");
            if (line.includes("[nerdfont-unescape]")) realErr(`    (模拟用例预期 stderr) ${line}`);
            else realErr(...args);
          };
          try {
            process.env.PATH = "";
            await handlers["session_start"]?.({}, ctx);
            for (let i = 0; i < 20 && !notes.some((n) => n.includes("font signature check failed")); i++) await new Promise((r) => setTimeout(r, 100));
          } finally {
            process.env.PATH = savedPath;
            console.error = realErr;
          }
          actual = notes.find((n) => n.includes("font signature check failed")) ?? "(无告警)";
          src = null;
        }
        else if (c.in.includes("```")) src = "```\n[[nf:python]]\n```";
        if (src !== null) {
          notes.length = 0;
          const out = await end(src);
          track(out);
          actual = `原样: ${out}` + `\n解码: ${dec(out)}` + (notes.length ? `\n通知: ${notes.map(dec).join(" ｜ ")}` : "");
        }
      } else if (c.kind === "prompt") {
        const r = await handlers["before_agent_start"]({ systemPrompt: "BASE" }, ctx);
        actual = `前缀: ${JSON.stringify(r.systemPrompt.slice(0, 6))} …协议块摘录: ${esc(r.systemPrompt.slice(r.systemPrompt.indexOf("[nerdfont"), r.systemPrompt.indexOf("[nerdfont") + 60)).replace(/&/g, "&amp;")}…`;
        actual = `前缀: ${JSON.stringify(r.systemPrompt.slice(0, 6))}；含协议标题: ${r.systemPrompt.includes("nerdfont-unescape output protocol")}；含逃生舱说明: ${r.systemPrompt.includes("double backslash")}`;
      } else if (c.kind === "reg") {
        actual = `已注册: ${Object.keys(tools).join(", ")}`;
      } else if (c.kind === "lookup") {
        const out = await lookup(c.in);
        actual = dec(out).split("\n").slice(0, 6).join("\n");
      } else if (c.kind === "render") {
        let out;
        // Scenario-driven first: every row's own `in` spec ("<content> / width=N
        // [/ frame=x]") must actually reach the renderer. Name-matched fallbacks
        // ran the wrong layout for newly added rows and their checks caught it
        // (round-12 lesson, inverted) — parameterize, do not special-case.
        const mIn = c.in.match(/^(.*?)\s*\/\s*width=(-?\d+)(?:\s*\/\s*frame=(\w+))?\s*$/);
        const mPlainFrame = c.in.match(/\/\s*frame=(\w+)\s*$/);
        if (mIn) {
          const content = mIn[1].replace(/\\r\\n/g, "\r\n").replace(/⇥/g, "\t");
          const width = Number(mIn[2]);
          const frame = mIn[3] ?? mPlainFrame?.[1] ?? (c.name === "双边框" ? "double" : undefined);
          out = await render({ content, width, ...(frame ? { frame } : {}) });
        } else if ((c.mW = c.in.match(/^width=(-?\d+)$/))) {
          out = await render({ content: "x", width: Number(c.mW[1]) });
        } else if ((c.mF = c.in.match(/^frame=(\w+)$/))) {
          out = await render({ content: "x", width: 4, frame: c.mF[1] });
        } else if (mPlainFrame && !mIn) {
          // "<content> / frame=x" without an explicit width
          out = await render({ content: c.in.replace(/\s*\/\s*frame=\w+\s*$/, "").trim(), frame: mPlainFrame[1] });
        } else if (c.name === "写盘回报" || c.name === "writePath 写出真字符") {
          out = await render({ content: "\\ue235 图标", width: 10, writePath: "/tmp/review-render.out" });
        } else if (c.name === "writePath 护栏") out = await render({ content: "x", writePath: "/etc/pi-render-guard-test.out" });
        else if (c.name === "符号链接不绕护栏") {
          const fs = require("fs"); const link = "/tmp/review-guard-link";
          try { fs.unlinkSync(link); } catch {}
          fs.symlinkSync("/dev/null", link);
          out = await render({ content: "y", writePath: link });
          fs.unlinkSync(link);
        }
        else if (c.name === "预览含转义字面量") out = await render({ content: "\\ue235 图标", width: 10 });
        else if (c.name === "六位转义按图标计宽") out = await render({ content: "\\u{100000} 六位", width: 12 });
        else if (c.name === "六位预览转义字面量") out = await render({ content: "\\u{100000} x", width: 10 });
        else out = await render({ content: "\\u{ffffff} z", width: 10 });
        actual = dec(out).split("\n").slice(0, 6).join("\n");
        actual = dec(out).split("\n").slice(0, 6).join("\n");
        if (c.name === "writePath 写出真字符") {
          const w = fs.readFileSync("/tmp/review-render.out", "utf8");
          actual += `\n文件原样: ${w.trim()}\n文件解码: ${dec(w).trim()}  (含E235真字符: ${hasCp(w, 0xe235)})`;
        }
      }
    } catch (e) {
      actual = "执行异常: " + String(e);
    }
    let verdict = "(无断言)";
    if (c.check) {
      let ok;
      try { ok = !!c.check(String(actual), notes.join(";")); } catch (e) { ok = false; }
      if (!ok && process.env.DBG_CHECK) console.error("[DBG]", c.name, "| n=", JSON.stringify(notes.join(";")).slice(0, 300), "| a=", JSON.stringify(String(actual)).slice(0, 150));
      verdict = ok ? "✓断言" : "✗断言失败";
      if (ok) assertPass++; else { assertFail++; failNames.push(c.name); }
    }
    if (c.sec !== curSec) { rows.push(`<tr class="sec"><td colspan="5">${esc(c.sec)}</td></tr>`); curSec = c.sec; }
    rows.push(`<tr><td>${esc(c.name)}</td><td class="in">${esc(c.in.replace(/\n/g, "⏎"))}</td><td class="ex">${esc(c.expect)}</td><td class="ac">${esc(actual).replace(/\n/g, "<br>").replace(/^(原样|文件原样|action):/gm, '<span class="raw">$1:</span>')}</td><td class="mut">${esc(c.mut)}<br>${verdict}</td></tr>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>pi-nerdfont-unescape 标准答案审查</title><style>
/*FONTCSS*/
body{background:#14161a;color:#d5d9e0;font:14px/1.6 "NFIcons","JetBrainsMono Nerd Font Mono","Symbols Nerd Font Mono",monospace;margin:2rem}
.raw{color:#7fd0a0}
h1{font-size:1.3rem} .sub{color:#8a93a5;margin-bottom:1.5rem}
table{border-collapse:collapse;width:100%}
td,th{border:1px solid #2a2f3a;padding:6px 10px;vertical-align:top;text-align:left}
th{background:#1b1f27;color:#aeb7c7}
tr.sec td{background:#1b1f27;font-weight:700;color:#9fc2e8}
.in,.ac{font-family:"NFIcons",ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}
.ex{color:#cfe3cf}.mut{color:#e8b96f;white-space:nowrap}
</style></head><body>
<h1>pi-nerdfont-unescape — 全部 ${CASES.length} 用例的「标准答案」审查</h1>
<div class="sub">实际输出由扩展真实执行生成（非手写）；⟦U+XXXX⟧ 为 PUA 字符的码位解码视图。
请审第 3 列：期望本身是否正确。第 5 列 = 变异审计中杀死该用例的变异（证明它会红）。</div>
<table><tr><th>用例</th><th>输入</th><th>标准答案（断言语义）</th><th>实际输出</th><th>证明会红</th></tr>
${rows.join("\n")}
</table></body></html>`;
  // ── 字体子集内嵌：浏览器（尤其沙箱）未必能用系统 Nerd Font，这里把
  //    页面实际用到的图标字形子集成 woff2 base64 塞进 @font-face，百分百离线可渲染
  const NF_SRC = process.env.PI_NF_FONT || path.join(os.homedir(), ".local/share/fonts/NFM.ttf"); // Symbols Nerd Font Mono（PI_NF_FONT 可覆盖）
  const cps = [...seenCps].sort((a, b) => a - b);
  const uni = cps.map((c) => c.toString(16)).join(",") || "e235";
  const woff2 = require("child_process").spawnSync(
    "python3", ["-c",
      `import sys, base64; from fontTools.subset import main as ss;
args=["pyftsubset","${NF_SRC}","--unicodes=${uni}","--flavor=woff2","--output-file=/tmp/nf-subset.woff2"];
sys.argv=args; ss(); print(base64.b64encode(open("/tmp/nf-subset.woff2","rb").read()).decode())`],
    { encoding: "utf8", timeout: 60000 },
  );
  const b64 = (woff2.stdout || "").trim().split("\n").pop();
  // A missing/unreadable font used to yield an empty @font-face while the summary
  // still claimed the glyphs were embedded — the page then shows tofu and is
  // useless for visual review, silently. Say it, and fail the exit code.
  const subOk = !!(b64 && b64.length > 100);
  const fontCss = subOk
    ? `@font-face{font-family:"NFIcons";src:url(data:font/woff2;base64,${b64}) format("woff2");font-display:block}`
    : "";
  if (!subOk) {
    const why = String((woff2.stderr || woff2.error || "no output")).trim().split("\n").pop();
    console.error(`✗ 未能内嵌图标字体：${why}`);
    console.error(`  源字体不存在或无权限：${NF_SRC}`);
    console.error("  页面里的图标会显示成豆腐块，不能用于视觉/像素审查。用 PI_NF_FONT 指向可用的 Nerd Font。");
    process.exitCode = 1;
  }
  const html2 = html.replace("/*FONTCSS*/", fontCss);
  const reviewOut = process.env.PI_NF_REVIEW_OUT || path.join(__dirname, "..", "review.html");
  fs.writeFileSync(reviewOut, html2);
  if (assertFail > 0) {
    console.error(`断言失败 ${assertFail}/${CASES.length}: ${failNames.join(", ")}`);
    process.exitCode = 1;
  }
  console.log(`${path.basename(reviewOut)} 生成完毕（${CASES.length} 用例，断言 ${assertPass}/${CASES.length} 通过，${
    subOk ? `内嵌 ${cps.length} 个图标字形子集 ${cps.map((c) => "U+" + c.toString(16).toUpperCase()).join(" ")}` : "未内嵌图标字体（图标会显示为豆腐块）"
  }）`);
})();
