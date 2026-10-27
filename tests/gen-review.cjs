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
const path = require("path");

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
  await handlers["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: endText }] } }, ctx);
};
const lookup = async (q) => (await tools.nerdfont_lookup.execute("t", { query: q })).content[0].text;
const render = async (p) => (await tools.render_preview.execute("t", p)).content[0].text;

// ── 用例清单：kind 决定如何取实际输出；expect 是断言语义（待人工审查的标准答案）──
const CASES = [
  { sec: "① 转义还原", name: "4位形式还原", kind: "end", in: "图标 \\ue235 与 \\u{f0805} Azure",
    expect: "文本含 U+E235 真字符（还原为图标）", mut: "M1" },
  { sec: "① 转义还原", name: "括号形式还原", kind: "end", in: "图标 \\ue235 与 \\u{f0805} Azure",
    expect: "文本含 U+F0805 真字符（增补区括号形式还原）", mut: "M1 M2" },
  { sec: "② 字面逃生舱", name: "双反斜杠保持字面", kind: "end", in: "字面写法 \\\\ue235 不还原",
    expect: "显示为单反斜杠字面 \\ue235，不出现真字符", mut: "M3" },
  { sec: "③ 不可见码位 → 可见标记", name: "非字符", kind: "end", in: "\\ufdd0 \\u{e0041} \\u0378",
    expect: "U+FDD0 → □U+FDD0（可见标记，绝不隐形）", mut: "M4" },
  { sec: "③ 不可见码位 → 可见标记", name: "Tags(括号形式)", kind: "end", in: "\\ufdd0 \\u{e0041} \\u0378",
    expect: "U+E0041 → □U+E0041", mut: "M2 M4" },
  { sec: "③ 不可见码位 → 可见标记", name: "未分配BMP", kind: "end", in: "\\ufdd0 \\u{e0041} \\u0378",
    expect: "U+0378 → □U+0378", mut: "M4" },
  { sec: "③ 不可见码位 → 可见标记", name: "cmap判定替换", kind: "end", in: "\\ue5ee",
    expect: "E5EE 不在本机字体 cmap 并集 → □U+E5EE（字体实况优先于类别判断）", mut: "M4" },
  { sec: "④ 补框 + 防误报", name: "空引号补框", kind: "end", in: "图标是 '' 空引号",
    expect: "图标语境下 '' 是丢字痕迹 → '□'（点名丢失）", mut: "M5" },
  { sec: "④ 补框 + 防误报", name: "行内段内不补框", kind: "end", in: "图标 `x = ''` 段内不补框 \\ue235 段外",
    expect: "`x = ''` 是代码字面量 → 原样保留不补框（复制保真）", mut: "M6" },
  { sec: "④ 补框 + 防误报", name: "围栏内不补框", kind: "end", in: "图标\n```\n''\n```\n\\ue235",
    expect: "围栏内 '' 是代码 → 原样保留", mut: "M7b" },
  { sec: "⑤ 围栏保护", name: "围栏内保持字面", kind: "end", in: '外面 \\ue235\n```\nx = "\\ue0b0"\n```\n后 \\uf308',
    expect: '围栏内 "\\ue0b0" 保持字面（复制保真）', mut: "M7" },
  { sec: "⑤ 围栏保护", name: "围栏外还原", kind: "end", in: '外面 \\ue235\n```\nx = "\\ue0b0"\n```\n后 \\uf308',
    expect: "围栏外 E235、F308 还原为真字符", mut: "M1 M7" },
  { sec: "⑥ 行内代码段保护(v2)", name: "双反引号包裹[回归]", kind: "end", in: '| `` `symbol = "\\ue0b0"` `` 行内段 |',
    expect: 'CommonMark 双反引号包裹内 "\\ue0b0" 保持字面（2026-10-27 视觉验证判例）', mut: "M8" },
  { sec: "⑥ 行内代码段保护(v2)", name: "单反引号段", kind: "end", in: "单段 `x \\ue235` 段外 \\ue0a0",
    expect: "`x \\ue235` 保持字面", mut: "M8" },
  { sec: "⑥ 行内代码段保护(v2)", name: "段间还原", kind: "end", in: "单段 `x \\ue235` 段外 \\ue0a0",
    expect: "段外 E0A0 还原为真字符", mut: "M1 M8" },
  { sec: "⑥ 行内代码段保护(v2)", name: "同行多段+未闭合", kind: "end", in: "`a \\ue235` 中段 \\uf308 `b \\ue718` 悬挂 ` 尾 \\ue0a0",
    expect: "两段字面保留；悬挂反引号不传染；尾 E0A0 还原", mut: "M1 M8" },
  { sec: "⑦ 输入侧自动转义", name: "transform", kind: "input", in: "看 \\ue235 图标",
    expect: "含 at-risk 字符 → action=transform（改写后再发）", mut: "M9" },
  { sec: "⑦ 输入侧自动转义", name: "无裸字符", kind: "input", in: "看 \\ue235 图标",
    expect: "发出文本里只剩 \\ue235 转义，无裸 PUA 字符", mut: "M9" },
  { sec: "⑧ 流级丢失探测", name: "丢失被点名", kind: "stream", in: "update: ⟦E235⟧ 在场 → end: 在场",
    expect: "流里见过、终稿消失 → 通知 MISSING 点名码位", mut: "M10" },
  { sec: "⑧ 流级丢失探测", name: "一致时无误报", kind: "stream", in: "update 与 end 都真含 ⟦E235⟧",
    expect: "流与终稿一致 → 不告警", mut: "M11" },
  { sec: "⑨ nerdfont_lookup", name: "已注册", kind: "reg", in: "—",
    expect: "nerdfont_lookup 与 render_preview 均注册", mut: "M19" },
  { sec: "⑨ nerdfont_lookup", name: "关键词 python → 含 E235 转义", kind: "lookup", in: "python",
    expect: "返回行含 \\uE235（可直接粘贴的转义）", mut: "M14 M15" },
  { sec: "⑨ nerdfont_lookup", name: "族别优先（字形行带族前缀）", kind: "lookup", in: "python",
    expect: "结果行带族前缀（nf-custom- / md- 等，常规字形靠前）", mut: "M14 M15" },
  { sec: "⑨ nerdfont_lookup", name: "码位查询 → E0A0 在场", kind: "lookup", in: "U+E0A0",
    expect: "码位反查返回 pl-branch / e0a0", mut: "M14 M15" },
  { sec: "⑨ nerdfont_lookup", name: "starship 模式 → E718", kind: "lookup", in: "starship nodejs",
    expect: "starship 默认表：nodejs → \\uE718（无需联网）", mut: "M14 M15" },
  { sec: "⑨ nerdfont_lookup", name: "无命中不崩溃（有输出）", kind: "lookup", in: "zzz-no-such-glyph-xyz",
    expect: "无命中时给出提示文本，execute 不抛异常", mut: "M15" },
  { sec: "⑩ render_preview", name: "CJK 宽度算术 + 右补齐", kind: "render", in: "中文 / width=8",
    expect: "中文=4 列，右补 4 空格；审计报告 8 cols", mut: "M16" },
  { sec: "⑩ render_preview", name: "TAB → 点线行", kind: "render", in: "左段⇥右段 / width=20",
    expect: "含 TAB 的行 → 点线对齐行", mut: "M16" },
  { sec: "⑩ render_preview", name: "双边框", kind: "render", in: "标题 / frame=double",
    expect: "╔═╗ 边框渲染", mut: "M20" },
  { sec: "⑩ render_preview", name: "预览含转义字面量", kind: "render", in: "\\ue235 图标 / width=10",
    expect: "预览文本中 PUA 以 \\ue235 字面量呈现（通道安全）", mut: "M16" },
  { sec: "⑩ render_preview", name: "writePath 写出真字符", kind: "render", in: "\\ue235 图标 / writePath",
    expect: "文件内容含 E235 真字符（绕过通道剥离）", mut: "M16 M21" },
  { sec: "⑩ render_preview", name: "写盘回报", kind: "render", in: "同上",
    expect: "输出回报写入路径", mut: "M21" },
  { sec: "⑪ 系统提示注入", name: "追加而非替换", kind: "prompt", in: 'BASE',
    expect: "返回 systemPrompt 以原 BASE 开头（追加协议，不覆盖）", mut: "M12" },
  { sec: "⑪ 系统提示注入", name: "协议块在场", kind: "prompt", in: 'BASE',
    expect: "含「nerdfont-unescape 输出协议」标题", mut: "M13a" },
  { sec: "⑪ 系统提示注入", name: "含逃生舱说明", kind: "prompt", in: 'BASE',
    expect: "含双反斜杠字面展示的说明", mut: "M13b" },
  { sec: "⑫ 输入处理边角", name: "无风险字符 → continue", kind: "input", in: "普通文字",
    expect: "无 at-risk → action=continue（原文直发，零打扰）", mut: "M22" },
  { sec: "⑫ 输入处理边角", name: "增补区 → 括号形式", kind: "input", in: "a⟦F0805⟧⟦E235⟧",
    expect: "增补区字符转义为 \\u{f0805} 括号形式", mut: "M9" },
  { sec: "⑫ 输入处理边角", name: "通知级别 warning", kind: "input", in: "a⟦F0805⟧⟦E235⟧",
    expect: "自动转义时通知级别为 warning", mut: "M23" },
  { sec: "⑬ Markdown 边角", name: "波浪围栏保护", kind: "end", in: "前 \\ue235\n~~~\nx = \"\\ue0b0\"\n~~~\n后 \\uf308",
    expect: "~~~ 围栏与 ``` 同等保护", mut: "M7" },
  { sec: "⑬ Markdown 边角", name: "带语言标注围栏", kind: "end", in: "```js\nicon = \"\\ue718\"\n```\n外 \\ue0a0",
    expect: "```js 信息串不破坏围栏判定", mut: "M7" },
  { sec: "⑬ Markdown 边角", name: "列表+行内段混合", kind: "end", in: "- 列表项 `\\ue235` 与 **粗体** \\ue0a0",
    expect: "列表行的行内段照常保护，段外还原", mut: "M8" },
  { sec: "⑬ Markdown 边角", name: "通知计数 ×2", kind: "end", in: "两个 \\ue235 \\ue0a0",
    expect: "还原通知按码位分组计数（×2）", mut: "M17" },
  { sec: "⑬ Markdown 边角", name: "user 流不触发误报", kind: "stream", in: "user update 含 ⟦E235⟧ → assistant end 不含",
    expect: "user 消息不进丢失快照 → 不误报", mut: "M18" },
];

(async () => {
  await handlers["session_start"]?.({}, {});
  const rows = [];
  let curSec = "";
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
        else await (async () => {
          await handlers["message_start"]?.({}, {});
          await handlers["message_update"]({ message: { role: "user", content: [{ type: "text", text: "\ue235" }] } }, ctx);
          await handlers["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: "回" }] } }, ctx);
        })();
        actual = notes.length ? `通知: ${notes.map(dec).join(" ｜ ")}` : "(无通知)";
      } else if (c.kind === "prompt") {
        const r = await handlers["before_agent_start"]({ systemPrompt: "BASE" }, ctx);
        actual = `前缀: ${JSON.stringify(r.systemPrompt.slice(0, 6))} …协议块摘录: ${esc(r.systemPrompt.slice(r.systemPrompt.indexOf("[nerdfont"), r.systemPrompt.indexOf("[nerdfont") + 60)).replace(/&/g, "&amp;")}…`;
        actual = `前缀: ${JSON.stringify(r.systemPrompt.slice(0, 6))}；含协议标题: ${r.systemPrompt.includes("nerdfont-unescape 输出协议")}；含逃生舱说明: ${r.systemPrompt.includes("双反斜杠")}`;
      } else if (c.kind === "reg") {
        actual = `已注册: ${Object.keys(tools).join(", ")}`;
      } else if (c.kind === "lookup") {
        const out = await lookup(c.in);
        actual = dec(out).split("\n").slice(0, 6).join("\n");
      } else if (c.kind === "render") {
        let out;
        if (c.name.startsWith("CJK")) out = await render({ content: "中文", width: 8 });
        else if (c.name.startsWith("TAB")) out = await render({ content: "左段\t右段", width: 20 });
        else if (c.name === "双边框") out = await render({ content: "标题", frame: "double", width: 10 });
        else if (c.name === "预览含转义字面量") out = await render({ content: "\\ue235 图标", width: 10 });
        else out = await render({ content: "\\ue235 图标", width: 10, writePath: "/tmp/review-render.out" });
        actual = dec(out).split("\n").slice(0, 6).join("\n");
        if (c.name === "writePath 写出真字符") {
          const w = fs.readFileSync("/tmp/review-render.out", "utf8");
          actual += `\n文件原样: ${w.trim()}\n文件解码: ${dec(w).trim()}  (含E235真字符: ${hasCp(w, 0xe235)})`;
        }
      }
    } catch (e) {
      actual = "执行异常: " + String(e);
    }
    if (c.sec !== curSec) { rows.push(`<tr class="sec"><td colspan="5">${esc(c.sec)}</td></tr>`); curSec = c.sec; }
    rows.push(`<tr><td>${esc(c.name)}</td><td class="in">${esc(c.in.replace(/\n/g, "⏎"))}</td><td class="ex">${esc(c.expect)}</td><td class="ac">${esc(actual).replace(/\n/g, "<br>").replace(/^(原样|文件原样|action):/gm, '<span class="raw">$1:</span>')}</td><td class="mut">${esc(c.mut)}</td></tr>`);
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
  const NF_SRC = process.env.PI_NF_FONT || path.join(require("os").homedir(), ".local/share/fonts/NFM.ttf"); // Symbols Nerd Font Mono（PI_NF_FONT 可覆盖）
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
  const fontCss = b64 && b64.length > 100
    ? `@font-face{font-family:"NFIcons";src:url(data:font/woff2;base64,${b64}) format("woff2");font-display:block}`
    : "";
  const html2 = html.replace("/*FONTCSS*/", fontCss);
  fs.writeFileSync(path.join(__dirname, "..", "review.html"), html2);
  console.log(`review.html 生成完毕（${CASES.length} 用例，内嵌 ${cps.length} 个图标字形子集 ${cps.map((c) => "U+" + c.toString(16).toUpperCase()).join(" ")}）`);
})();
