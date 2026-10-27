#!/usr/bin/env node
/**
 * test-nerdfont-unescape.cjs — nerdfont-unescape 全量回归套件
 *
 * 运行: node ~/.pi/agent/extensions/tests/test-nerdfont-unescape.cjs
 * 前置: 需已构建 cmap 缓存（~/.cache/pi-nerdfont-unescape/cmap.json，
 *       session_start 会自动构建；或直接跑本套件前开一次 pi）。
 *
 * ⚠ 本套件防"假绿"备忘（2026-10-27 判例，两条都真实发生过）：
 *   1. JS 正则 \uXXXX 只匹配 4 位十六进制——判断 5 位码位是否在场，
 *      必须用 [...s].some(ch => ch.codePointAt(0) === cp)，别写 /[\uf308]/
 *   2. 输入转义要单反斜杠（源码 "\\ue235"），双反斜杠走字面逃生舱，
 *      测不到保护逻辑——套件里的「逃生舱」用例专门测双反斜杠路径
 *   3. 单测全绿 ≠ 正确：真实消息的 Markdown 形态（双反引号包裹等）
 *      可能绕过保护。重要改动须配合 vision-verify.py 做端到端视觉验证。
 */
const mod = require("./lib.cjs").jitiLoad();

const h = {}; const notes = [];
mod.default({ registerTool: () => {}, on: (e, f) => { h[e] = f; } });
const ctx = { ui: { notify: (m, t) => notes.push(`[${t}] ${m}`) } };
const hasCp = (s, cp) => [...s].some((ch) => ch.codePointAt(0) === cp);
const end = async (text) => {
  await h["message_start"]?.({}, {});
  const r = await h["message_end"]({ message: { role: "assistant", content: [{ type: "text", text }] } }, ctx);
  return r?.message?.content?.[0]?.text ?? text;
};

let pass = 0, fail = 0;
const t = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "  " + detail}`);
  ok ? pass++ : fail++;
};

(async () => {
  await h["session_start"]?.({}, {}); // 载入 cmap

  console.log("── ① 转义还原");
  let a = await end("图标 \\ue235 与 \\u{f0805} Azure");
  t("4位形式还原", hasCp(a, 0xe235));
  t("括号形式还原", hasCp(a, 0xf0805));

  a = await end("PUA-B \\u{100000} 与 \\u{10fffd}");
  // 六位码位在本机字体必无字形 → 走可见替换而非还原（正则六位支持是前提）
  t("六位码位(PUA-B)可见标记", a.includes("□U+100000") && a.includes("□U+10FFFD"), JSON.stringify(a));

  console.log("── ② 字面逃生舱（双反斜杠）");
  a = await end("字面写法 \\\\ue235 不还原");
  // 2026-10-28 外部评审判例：旧断言单/双反斜杠都能过（includes 子串两侧通吃），
  // 且 ?? 回退掩盖了改写被丢弃——收紧为「单在场 + 双绝迹 + 真字符绝迹」
  t("双反斜杠保持字面", a.includes("\\ue235") && !a.includes("\\\\ue235") && !hasCp(a, 0xe235), JSON.stringify(a));

  a = await end("字面 \\\\u{100000} 保持"); // 源码四反斜杠 = 实际双反斜杠（逃生舱入口）
  t("六位逃生舱保持字面", a.includes("\\u{100000}") && !a.includes("\\\\u{100000}") && !a.includes("□U+100000"), JSON.stringify(a));

  console.log("── ③ 不可见码位 → 可见标记");
  a = await end("\\ufdd0 \\u{e0041} \\u0378");
  t("非字符", a.includes("□U+FDD0"), JSON.stringify(a));
  t("Tags(括号形式)", a.includes("□U+E0041"));
  t("未分配BMP", a.includes("□U+0378"));
  a = await end("字体没有的 \\ue5ee");
  t("cmap判定替换", a.includes("□U+E5EE"), JSON.stringify(a));

  console.log("── ④ 补框 + 防误报");
  a = await end("图标是 '' 空引号");
  t("空引号补框", a.includes("'□'"), JSON.stringify(a));
  // 引号对不贴反引号（`x = ''`）：防误报规则 b) 不再独立拦截，
  // 行内段保护与否只剩 protectedRanges 跳过逻辑——这正是要测的东西
  a = await end("图标 `x = ''` 段内不补框 \\ue235 段外");
  t("行内段内不补框", a.includes("`x = ''`"), JSON.stringify(a));
  a = await end("图标\n```\n''\n```\n\\ue235");
  t("围栏内不补框", a.includes("''"), JSON.stringify(a));

  // 2026-10-28 外部评审判例：逃生舱曾改写围栏内代码（复制保真被破坏）
  const fenceHatchIn = "```\nx = \\\\ue235\n```";
  let rFH = await h["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: fenceHatchIn }] } }, ctx);
  const fenceHatchOut = rFH?.message?.content?.[0]?.text ?? fenceHatchIn;
  t("围栏内双反斜杠字节保真", fenceHatchOut === fenceHatchIn, JSON.stringify(fenceHatchOut));

  console.log("── ⑤ 围栏保护");
  a = await end('外面 \\ue235\n```\nx = "\\ue0b0"\n```\n后 \\uf308');
  t("围栏内保持字面", a.includes('"\\ue0b0"'), JSON.stringify(a));
  t("围栏外还原", hasCp(a, 0xe235) && hasCp(a, 0xf308));

  a = await end("```\n内 \\ue0b0\n~~~\n仍内 \\ue0b0\n```\n外 \\ue235");
  t("异种围栏不闭合", (a.match(/\\ue0b0/g) || []).length === 2 && hasCp(a, 0xe235), JSON.stringify(a));

  a = await end("```\n内文 \\ue0b0\n```x\n仍内 \\ue0b0\n```\n外 \\ue235");
  t("非纯围栏行不闭合", a.includes("仍内 \\ue0b0") && !hasCp(a, 0xe0b0) && hasCp(a, 0xe235), JSON.stringify(a));

  console.log("── ⑥ 行内代码段保护（v2 等长定界符）");
  // 回归 2026-10-27: 双反引号包裹形态曾绕过 v1 保护
  a = await end('| `` `symbol = "\\ue0b0"` `` 行内段 |');
  t("双反引号包裹[回归]", a.includes('"\\ue0b0"') && !hasCp(a, 0xe0b0), JSON.stringify(a));
  a = await end("单段 `x \\ue235` 段外 \\ue0a0");
  t("单反引号段", a.includes("`x \\ue235`") && !hasCp(a, 0xe235));
  t("段间还原", hasCp(a, 0xe0a0));
  a = await end("`a \\ue235` 中段 \\uf308 `b \\ue718` 悬挂 ` 尾 \\ue0a0");
  t("同行多段+未闭合", a.includes("`a \\ue235`") && a.includes("`b \\ue718`") && hasCp(a, 0xe0a0));

  console.log("── ⑦ 输入侧自动转义");
  const ir = await h["input"]({ type: "input", text: "看 \ue235 图标", source: "interactive" }, ctx);
  const it7 = ir.text ?? ""; // 防御：transform 失效时逐项变红而非套件崩溃
  t("transform", ir.action === "transform");
  t("无裸字符", ir.action === "transform" && !hasCp(it7, 0xe235) && it7.includes("\\ue235"), JSON.stringify(ir));

  console.log("── ⑧ 流级丢失探测");
  notes.length = 0;
  await h["message_start"]?.({}, {});
  await h["message_update"]({ message: { role: "assistant", content: [{ type: "text", text: "\ue235 在场" }] } }, ctx);
  await h["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: "在场" }] } }, ctx);
  t("丢失被点名", notes.some((n) => n.includes("MISSING")), notes.join("|"));
  notes.length = 0;
  await h["message_start"]?.({}, {});
  // 流与最终消息都真含 at-risk 字符（一致）——此前用纯文本，从没测过比较逻辑
  const stable = "稳定 " + String.fromCodePoint(0xe235) + " 在场";
  await h["message_update"]({ message: { role: "assistant", content: [{ type: "text", text: stable }] } }, ctx);
  await h["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: stable }] } }, ctx);
  t("一致时无误报", !notes.some((n) => n.includes("MISSING")), notes.join("|"));

  notes.length = 0;
  await h["message_start"]?.({}, {});
  const rocket = String.fromCodePoint(0x1f680) + " 起飞";
  await h["message_update"]({ message: { role: "assistant", content: [{ type: "text", text: rocket }] } }, ctx);
  await h["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: "删掉emoji了" }] } }, ctx);
  t("emoji改稿不误报", !notes.some((n) => n.includes("MISSING")), notes.join("|"));

  notes.length = 0;
  await h["message_start"]?.({}, {});
  await h["message_update"]({ message: { role: "assistant", content: [{ type: "text", text: "图 " + String.fromCodePoint(0xe235) }] } }, ctx);
  await h["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: "图 \\ue235" }] } }, ctx);
  const missN = notes.some((n) => n.includes("MISSING"));
  const restoredN = notes.some((n) => n.includes("restored"));
  t("流转义还原不矛盾", restoredN && !missN, JSON.stringify(notes));

  console.log("── ⑭ [[nf:]] 语义标记");
  a = await end("看 [[nf:python]] 图标");
  t("标记解析渲染", !a.includes("[[nf:python]]") && (hasCp(a, 0xe235) || a.includes("□U+E235")), JSON.stringify(a));
  a = await end("```\n[[nf:python]]\n```");
  t("围栏内标记不动", a.includes("[[nf:python]]"), JSON.stringify(a));
  notes.length = 0;
  a = await end("未知 [[nf:zzz_no_such]] 名");
  t("未知名保留+点名", a.includes("[[nf:zzz_no_such]]") && notes.some((n) => n.includes("zzz_no_such")), JSON.stringify(notes));

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("套件崩溃:", e); process.exit(1); });
