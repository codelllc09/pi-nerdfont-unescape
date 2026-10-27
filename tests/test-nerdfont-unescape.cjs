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
const D = "/home/user/.local/share/pi-node/node-v22.23.2-linux-x64/lib/node_modules/@earendil-works/pi-coding-agent";
const { createJiti } = require(D + "/node_modules/jiti/lib/jiti.mjs");
const load = createJiti(__filename, {
  interopDefault: true,
  alias: {
    "@earendil-works/pi-ai": D + "/node_modules/@earendil-works/pi-ai/dist",
    "@earendil-works/pi-coding-agent": D + "/dist/index.js",
    "@earendil-works/pi-tui": D + "/node_modules/@earendil-works/pi-tui/dist/index.js",
  },
});
const mod = load("/home/user/Work/pi-nerdfont-unescape/nerdfont-unescape.ts");

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

  console.log("── ② 字面逃生舱（双反斜杠）");
  a = await end("字面写法 \\\\ue235 不还原");
  t("双反斜杠保持字面", a.includes("\\ue235") && !hasCp(a, 0xe235), JSON.stringify(a));

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
  a = await end("代码span包裹 `''` 不补");
  t("行内段内不补框", a.includes("`''`"), JSON.stringify(a));
  a = await end("围栏内\n```\n''\n```\n");
  t("围栏内不补框", a.includes("''"), JSON.stringify(a));

  console.log("── ⑤ 围栏保护");
  a = await end('外面 \\ue235\n```\nx = "\\ue0b0"\n```\n后 \\uf308');
  t("围栏内保持字面", a.includes('"\\ue0b0"'), JSON.stringify(a));
  t("围栏外还原", hasCp(a, 0xe235) && hasCp(a, 0xf308));

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
  t("transform", ir.action === "transform");
  t("无裸字符", !hasCp(ir.text, 0xe235) && ir.text.includes("\\ue235"), JSON.stringify(ir.text));

  console.log("── ⑧ 流级丢失探测");
  notes.length = 0;
  await h["message_start"]?.({}, {});
  await h["message_update"]({ message: { role: "assistant", content: [{ type: "text", text: "\ue235 在场" }] } }, ctx);
  await h["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: "在场" }] } }, ctx);
  t("丢失被点名", notes.some((n) => n.includes("MISSING")), notes.join("|"));
  notes.length = 0;
  await h["message_start"]?.({}, {});
  await h["message_update"]({ message: { role: "assistant", content: [{ type: "text", text: "稳定 \\ue235" }] } }, ctx);
  await h["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: "稳定 \\ue235" }] } }, ctx);
  t("一致时无误报", !notes.some((n) => n.includes("MISSING")));

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("套件崩溃:", e); process.exit(1); });
