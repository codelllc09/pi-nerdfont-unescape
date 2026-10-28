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
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// Tests must never touch the user's production cache. The mutation auditor may
// provide a reusable isolated cache; direct runs get their own temporary one.
let ownedCacheDir = null;
if (!process.env.PI_NF_CMAP_CACHE) {
  ownedCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-nf-test-"));
  process.env.PI_NF_CMAP_CACHE = path.join(ownedCacheDir, "cmap.json");
  process.on("exit", () => fs.rmSync(ownedCacheDir, { recursive: true, force: true }));
}

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
  // cmap 就绪等待：磁盘缓存无效时构建是异步的，早期用例（③可见替换）
  // 依赖 cmap 在场——不等待会环境性假红（第八轮判例）
  for (let i = 0; i < 40 && !globalThis[Symbol.for("pi.nerdfontUnescape.cmap")]; i++) {
    await new Promise((r) => setTimeout(r, 3000));
  }


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

  console.log("── ④ 观测层（证据性补框 + 保守降级）");
  {
    const noTouch = "icon value = '' 和 \"\" 与 ` ` 保持原样";
    const before = notes.length;
    a = await end(noTouch);
    t("空引号逐字节不变+零通知", a === noTouch && notes.length === before, JSON.stringify(a));
  }
  {
    const safeCp = "icon annotation: -- U+0041";
    const before2 = notes.length;
    a = await end(safeCp);
    t("安全码位不补框+零通知", a === safeCp && notes.length === before2, JSON.stringify(a));
  }
  a = await end("present \\ue235\nicon lost: -- U+E235");
  t("跨行同码位不压制", (a.split("\n")[1] ?? "").includes("-- U+E235 □"), JSON.stringify(a));
  a = await end("icon \\ue235 same line: -- U+E235");
  t("同段同码位仍压制", !a.includes("□"), JSON.stringify(a));
  // 可见替代标记=已处置：转义已抵达、仅字体状态未知，不是模型丢失（第十一轮外部评审）
  {
    const CSTK3 = Symbol.for("pi.nerdfontUnescape.cmap");
    const saved3 = globalThis[CSTK3];
    delete globalThis[CSTK3];
    notes.length = 0;
    a = await end("icon \\ue235 same line: -- U+E235");
    globalThis[CSTK3] = saved3;
    t("未知字体标记不重复处置", (a.match(/□/g) ?? []).length === 1 && !notes.some((n) => n.includes("likely dropped")), JSON.stringify(a) + "|" + notes.join(";"));
  }
  a = await end("icon \\ue5ee same line: -- U+E5EE");
  t("已知缺字标记不重复处置", (a.match(/□/g) ?? []).length === 1 && !a.includes("-- U+E5EE □"), JSON.stringify(a));
  a = await end("icon lost: -- U+100000");
  t("六位码位注释补框", a.includes("-- U+100000 □"), JSON.stringify(a));
  a = await end("icon lost: -- U+E235");
  t("Lua注释补框(证据性)", a.includes("-- U+E235 □"), JSON.stringify(a));
  // 输入不含该码位的其他形态——合规检查不能代偿，围栏保护独立受审
  a = await end("icon\n```\n-- U+E235\n```\n尾部无转义");
  t("围栏内Lua不补", (a.split("\n")[2] ?? "") === "-- U+E235", JSON.stringify(a));
  {
    const CSTK = Symbol.for("pi.nerdfontUnescape.cmap");
    const savedCmap = globalThis[CSTK];
    delete globalThis[CSTK];
    a = await end("\\ue235 字体未知");
    globalThis[CSTK] = savedCmap; // 恢复现场
    t("cmap未知保守替换", a.includes("□U+E235") && !hasCp(a, 0xe235), JSON.stringify(a));
  }

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

  // 2026-10-29 strict review: a missing-font substitution is still the same
  // codepoint in a visible form; it must not also be reported as transit loss.
  {
    const CMAP = Symbol.for("pi.nerdfontUnescape.cmap");
    const saved = globalThis[CMAP];
    globalThis[CMAP] = [];
    notes.length = 0;
    await h["message_start"]?.({}, {});
    await h["message_update"]({ message: { role: "assistant", content: [{ type: "text", text: String.fromCodePoint(0xe5ee) }] } }, ctx);
    const markerEnd = await h["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: "\\ue5ee" }] } }, ctx);
    globalThis[CMAP] = saved;
    const markerText = markerEnd?.message?.content?.[0]?.text ?? "";
    t("流可见替换不矛盾", markerText.includes("□U+E5EE") && !notes.some((n) => n.includes("MISSING")), JSON.stringify(notes));
  }

  // 变异下解析可能崩溃——本段一律走防御式 end，失败归因到具体用例而非套件崩溃
  const safeEnd = async (t) => {
    try {
      return await end(t);
    } catch (e) {
      return "崩溃: " + String(e);
    }
  };
  console.log("── ⑭ [[nf:]] 语义标记");
  a = await safeEnd("看 [[nf:python]] 图标");
  t("标记解析渲染", !a.includes("[[nf:python]]") && (hasCp(a, 0xe235) || a.includes("□U+E235")), JSON.stringify(a));
  // 2026-10-28 外部评审判例：快速通道曾只认小写 → [[NF:]] 被静默忽略（红线违规）
  a = await safeEnd("大写 [[NF:python]] 标记");
  t("大写标记解析", !a.includes("[[NF:python]]") && (hasCp(a, 0xe235) || a.includes("□U+E235")), JSON.stringify(a));
  a = await safeEnd("分支 [[nf:git-branch]] 图标");
  t("git-branch 别名解析", !a.includes("[[nf:git-branch]]") && (hasCp(a, 0xe0a0) || a.includes("□U+E0A0")), JSON.stringify(a));
  // A Nerd Font also contains ordinary Unicode glyph names such as lambda.
  // The semantic protocol must select the PUA icon, never silently keep the marker.
  notes.length = 0;
  a = await safeEnd("函数 [[nf:lambda]] 图标");
  const hasPua = [...a].some((ch) => {
    const cp = ch.codePointAt(0);
    return (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0x10fffd);
  });
  t("安全码位同名不吞语义标记", !a.includes("[[nf:lambda]]") && (hasPua || /□U\+[0-9A-F]{4,6}/.test(a)) && !notes.some((n) => n.includes("no such name")), JSON.stringify(a) + "|" + JSON.stringify(notes));
  a = await safeEnd("```\n[[nf:python]]\n```");
  t("围栏内标记不动", a.includes("[[nf:python]]"), JSON.stringify(a));
  notes.length = 0;
  a = await safeEnd("未知 [[nf:zzz_no_such]] 名");
  t("未知名保留+点名", a.includes("[[nf:zzz_no_such]]") && notes.some((n) => n.includes("zzz_no_such")), JSON.stringify(notes));

  console.log("── ⑮ [[nf:]] 健壮性（缓存与语法）");
  {
    notes.length = 0;
    a = await end("[[nf:alpha]] 与 [[nf:special]]");
    const w = notes.find((n) => n.includes("alpha")) ?? "";
    t(
      "非图标同名不吞标记",
      a.includes("[[nf:alpha]]") && w.includes("U+03B1") && !w.includes("no such name"),
      JSON.stringify({ text: a, warn: w.slice(0, 120) }),
    );
  }  // 旧版裸 Map 遗留（reload 同进程）→ 必须安全重建而非崩溃（外部评审判例）
  {
    const CMAP = Symbol.for("pi.nerdfontUnescape.cmap");
    const saved = globalThis[CMAP];
    globalThis[CMAP] = [null]; // valid JSON shape at the outer level, corrupt range entry
    const corrupt = await safeEnd("损坏缓存 \\ue235");
    globalThis[CMAP] = saved;
    t("损坏cmap不击穿消息", !corrupt.startsWith("崩溃:") && corrupt.includes("□U+E235"), JSON.stringify(corrupt));
  }
  globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")] = new Map([["python", 0xe0a0]]);
  let mig = "(未跑)";
  try {
    await h["message_start"]?.({}, {});
    const r = await h["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: "[[nf:python]]" }] } }, ctx);
    mig = r?.message?.content?.[0]?.text ?? "";
  } catch (e) {
    mig = "崩溃: " + String(e);
  }
  t("旧Map遗留安全迁移", !mig.startsWith("崩溃") && hasCp(mig, 0xe235) && !hasCp(mig, 0xe0a0), JSON.stringify(mig));

  // 签名失效：篡改同签名缓存生效 → 改签名后必须重新解析
  const store = globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")];
  await safeEnd("预热 [[nf:git-branch]]");
  store.map.set("git-branch", 0xe235); // 投毒（同签名，应被沿用）
  let p = await safeEnd("投毒 [[nf:git-branch]]");
  const poisonHonored = hasCp(p, 0xe235);
  store.sig = "__bogus__"; // 签名失配 → 整体失效 → 重新解析回真值
  p = await safeEnd("失效 [[nf:git-branch]]");
  t("签名变化缓存失效", poisonHonored && hasCp(p, 0xe0a0) && !hasCp(p, 0xe235), JSON.stringify(p));

  // null 不跨消息缓存：失败后重试应成功
  await safeEnd("预热2 [[nf:python]]");
  // 只投毒 null、不动签名：null 重试是唯一路径（改签名会走失效分支把 null 清掉，
  // 在带正常签名的环境里曾把变异喂绿——外部评审判例）
  const st2 = globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")];
  st2.map.set("python", null);
  a = await safeEnd("重试 [[nf:python]]");
  t("失败缓存不永久", !a.includes("[[nf:python]]") && hasCp(a, 0xe235), JSON.stringify(a));

  // 非法语法标记：保留原文 + 可见告警（静默=红线违规）
  notes.length = 0;
  const inv = "[[nf:bad name]] 与 [[nf:名称]]";
  await h["message_start"]?.({}, {});
  const rInv = await h["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: inv }] } }, ctx);
  const invOut = rInv?.message?.content?.[0]?.text ?? inv;
  t("非法标记保留+点名", invOut === inv && notes.some((n) => n.includes("invalid marker syntax") && n.includes("bad name")), JSON.stringify(notes));

  // vscode 走子串（别名反伤判例）
  const resolved = (x, cp) => !x.startsWith("崩溃:") && !x.includes("[[nf:") && (hasCp(x, cp) || x.includes(`□U+${cp.toString(16).toUpperCase()}`));
  a = await safeEnd("[[nf:vscode]] 编辑器");
  t("vscode 子串解析", resolved(a, 0xe8da), JSON.stringify(a));
  a = await safeEnd("[[nf:node.js]] 运行时");
  t("node.js 别名可达", resolved(a, 0xf0399), JSON.stringify(a));

  console.log("── ⑯ reload 与批量（第六轮外部评审）");
  {
    const SYM = Symbol.for("pi.nerdfontUnescape.nfCache");
    const SIG = Symbol.for("pi.nerdfontUnescape.cmapSig");
    await safeEnd("[[nf:python]]");
    const st = globalThis[SYM];
    globalThis[SIG] = st.sig; // 模拟 reload：签名仅存全局
    st.map.set("python", 0xe0a0); // 投毒
    let o = await safeEnd("[[nf:python]]");
    const keep = hasCp(o, 0xe0a0) && !hasCp(o, 0xe235);
    globalThis[SIG] = "__font_changed__"; // 字体集变更
    o = await safeEnd("[[nf:python]]");
    t("reload签名保持+变更恢复", keep && hasCp(o, 0xe235) && !hasCp(o, 0xe0a0), JSON.stringify(o));
  }
  notes.length = 0;
  await safeEnd("[[nf:]] 与 [[nf:" + "a".repeat(41) + "]] 与 [[nf:" + "b".repeat(65) + "]]");
  const n41 = "a".repeat(41), n65 = "b".repeat(65);
  const warnMsg = notes.find((n) => n.includes("invalid marker syntax")) ?? "";
  t("空名与超长名告警", warnMsg.includes("[[nf:]]") && warnMsg.includes(n41) && warnMsg.includes(n65), JSON.stringify(notes));
  {
    const st = globalThis[Symbol.for("pi.nerdfontUnescape.nfCache")];
    st.map.delete("python"); st.map.delete("docker"); // 强制走批量路径
    a = await safeEnd("[[nf:python]] 和 [[nf:docker]] 双名");
    t("双未缓存名批量解析", !a.startsWith("崩溃:") && (hasCp(a, 0xe235) || a.includes("□U+E235")) && (hasCp(a, 0xf308) || a.includes("□U+F308")), JSON.stringify(a));
  }

  console.log("── ⑰ 热升级与断言收紧（第七轮外部评审）");
  if (process.env.SKIP_SLOW) {
    console.log("  (慢段跳过：SKIP_SLOW)");
  } else {
    const SYM2 = Symbol.for("pi.nerdfontUnescape.nfCache");
    const SIG2 = Symbol.for("pi.nerdfontUnescape.cmapSig");
    const ASYNC2 = Symbol.for("pi.nerdfontUnescape.cmapAsyncState");
    await safeEnd("[[nf:python]]");
    for (let i = 0; i < 200 && (globalThis[ASYNC2]?.checking || globalThis[ASYNC2]?.building); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const realSig = globalThis[SIG2];
    delete globalThis[SIG2]; // 模拟第五轮版本：有 STORE 无 SIG
    globalThis[SYM2] = { sig: "round5-sig", map: new Map([["python", null]]) };
    await h["session_start"]?.({}, ctx); // 热升级路径：应从磁盘恢复签名
    let recovered = typeof globalThis[SIG2] === "string";
    for (let i = 0; i < 5 && !recovered; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      recovered = typeof globalThis[SIG2] === "string";
    }
    a = await safeEnd("[[nf:python]]");
    t("热升级签名迁移", recovered && !a.includes("[[nf:python]]") && !a.startsWith("崩溃:"), `recovered=${recovered}`);
    globalThis[SIG2] = "brand-new";
    await safeEnd("[[nf:python]]");
    const sigAfterFix = globalThis[SYM2].sig;
    await safeEnd("[[nf:python]]");
    t("纠正后签名稳定", sigAfterFix === "brand-new" && globalThis[SYM2].sig === "brand-new", `${sigAfterFix}→${globalThis[SYM2].sig}`);
    globalThis[SIG2] = realSig; // 恢复现场
  }
  notes.length = 0;
  await safeEnd("[[nf:" + "c".repeat(121) + "]] 与 [[nf:" + "d".repeat(200) + "]]");
  {
    const warn2 = notes.find((n) => n.includes("invalid marker syntax")) ?? "";
    t("121/200字名告警", warn2.includes("c".repeat(121)) && warn2.includes("d".repeat(200)), JSON.stringify(notes).slice(0, 80));
  }

  console.log("── ⑱ 磁盘迁移与真实核验（第八轮）");
  if (process.env.SKIP_SLOW) {
    console.log("  (慢段跳过：SKIP_SLOW)");
  } else {
    {
    const CSTK = Symbol.for("pi.nerdfontUnescape.cmap");
    const SIGK = Symbol.for("pi.nerdfontUnescape.cmapSig");
    const ASYNCK = Symbol.for("pi.nerdfontUnescape.cmapAsyncState");
    const P = process.env.PI_NF_CMAP_CACHE;
    const orig = fs.existsSync(P) ? fs.readFileSync(P, "utf8") : null;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const realError = console.error;
    try {
      fs.writeFileSync(P, JSON.stringify({ schema: 2, fonts: 1, ranges: [null], sig: "fake" })); // syntactically valid JSON, structurally corrupt ranges
      delete globalThis[CSTK]; delete globalThis[SIGK];
      globalThis[ASYNCK] = { checking: false, building: false };
      const buildLogs = [];
      console.error = (...args) => { buildLogs.push(args.map(String).join(" ")); };
      await h["session_start"]?.({}, ctx);
      const rejected = globalThis[CSTK] === undefined;
      await h["session_start"]?.({}, ctx);
      await h["session_start"]?.({}, ctx);
      let ok = false, buildFailed = false;
      for (let i = 0; i < 40 && !ok && !buildFailed; i++) {
        ok = typeof globalThis[SIGK] === "string";
        buildFailed = notes.some((n) => n.includes("cmap 不可用"));
        if (!ok && !buildFailed) await wait(3000);
      }
      if (ok) await wait(3000); // Let concurrently started mutant builds finish logging.
      console.error = realError;
      const builds = buildLogs.filter((s) => s.includes("cmap cache:")).length;
      t("损坏磁盘缓存拒收并重建", rejected && ok, `rejected=${rejected}, sig=${typeof globalThis[SIGK]}`);
      {
        // The rebuild above is a real build, so the on-disk metadata is
        // mutation-reachable (source label, fixture union).
        const meta = JSON.parse(fs.readFileSync(P, "utf8"));
        const hasAlt = (meta.ranges || []).some(([lo, hi]) => lo <= 0xe777 && 0xe777 <= hi);
        t("重建缓存记录字体链来源", meta.schema === 2 && meta.source === "explicit" && meta.fonts >= 2 && hasAlt, JSON.stringify(meta).slice(0, 160));
      }
      t("并发重建去重", builds === 1, `builds=${builds}`);
      globalThis[SIGK] = "__tampered__"; // 篡改 → reload 必须靠真实字体签名核验纠正
      let fixed = false;
      for (let i = 0; i < 40 && !fixed; i++) {
        await h["session_start"]?.({}, ctx);
        await wait(3000);
        fixed = typeof globalThis[SIGK] === "string" && globalThis[SIGK] !== "__tampered__";
      }
      t("reload真实签名核验", fixed, `sig=${String(globalThis[SIGK]).slice(0, 10)}`);
      notes.length = 0;
      const savedPath = process.env.PATH;
      try {
        process.env.PATH = "";
        await h["session_start"]?.({}, ctx);
        for (let i = 0; i < 20 && !notes.some((n) => n.includes("font signature check failed")); i++) await wait(100);
      } finally {
        process.env.PATH = savedPath;
      }
      t("签名核验失败留痕", notes.some((n) => n.includes("font signature check failed") && n.includes("[warning]")), JSON.stringify(notes));
    } finally {
      // Restore console.error even when the rebuild or assertion setup throws.
      if (typeof realError === "function") console.error = realError;
      // When orig is fake/legacy, do not restore it; deleting lets the next
      // session rebuild truth instead of racing an async build back to poison.
      // 防止异步构建竞态把 fake 留在盘上毒害后续运行（第八轮判例）
      const origValid = orig !== null &&/"sig"/.test(orig);
      if (origValid) fs.writeFileSync(P, orig);
      else { try { fs.unlinkSync(P); } catch {} }
    }
  }
  }

  console.log("── ⑲ 自评加固");
  {
    const rp = await h["before_agent_start"]?.({}, ctx);
    t("缺systemPrompt不产生undefined", typeof rp?.systemPrompt === "string" && !rp.systemPrompt.startsWith("undefined") && rp.systemPrompt.includes("nerdfont-unescape output protocol"), JSON.stringify(rp?.systemPrompt?.slice(0, 24)));
  }

  console.log("── ⑳ 自评十四轮");
  {
    let ir2 = "(异常)";
    try { ir2 = await h["input"]({ type: "input", text: undefined, source: "interactive" }, ctx); } catch (e) { ir2 = "异常: " + e.message; }
    t("input非字符串不阻断", typeof ir2 === "object" && ir2.action === "continue", JSON.stringify(String(ir2)));
  }
  {
    // 奇数反引号前的反斜杠语义冻结：\\\ue235（3bs+文本）→ 前导 \ 原样 + 后对字面化 = \\ue235（2bs+文本）
    const odd = "\\\\" + "\\u" + "e235";
    a = await end("奇 " + odd + " 数");
    t("三反斜杠确定性处理", a.includes("\\\\ue235") && !a.includes("\\\\\\ue235") && !hasCp(a, 0xe235), JSON.stringify(a));
  }

  console.log("── ㉓ 内置 BMP 分配表不变量");
  {
    // The table decides "is this BMP codepoint assigned?" — a bad regeneration
    // would mark real characters as invisible and substitute them with □ (a
    // visible but WRONG result). Verify structure, then cross-check against the
    // local Python's unicodedata when it is at least as new as the table.
    const srcPath = process.env.EXT_PATH || path.join(__dirname, "..", "nerdfont-unescape.ts");
    const raw = /const ASSIGNED_BMP_RAW = "([^"]+)"/.exec(fs.readFileSync(srcPath, "utf8"))?.[1] ?? "";
    const ranges = raw.split(",").filter(Boolean).map((x) => {
      const [a, b] = x.split("-");
      return [parseInt(a, 16), parseInt(b ?? a, 16)];
    });
    const sorted = ranges.every(([a, b], i) => a <= b && (i === 0 || a > ranges[i - 1][1]));
    const inBmp = ranges.every(([a, b]) => a >= 0 && b <= 0xffff);
    const noSurrogates = !ranges.some(([a, b]) => b >= 0xd800 && a <= 0xdfff);
    t("分配表结构合法（有序/不重叠/BMP内/排除代理区）", ranges.length > 300 && sorted && inBmp && noSurrogates, `n=${ranges.length}`);
    const has = (cp) => ranges.some(([a, b]) => cp >= a && cp <= b);
    t("分配表抽样正确（A/中文/韩文不在表中=未分配区）", has(0x41) && has(0x4e00) && has(0xac00) && !has(0x0378) && !has(0xe0000), "");
    const py = spawnSync("python3", ["-c", `
import sys, unicodedata
if tuple(int(x) for x in unicodedata.unidata_version.split(".")) < (16, 0):
    print("SKIP", unicodedata.unidata_version); raise SystemExit
raw = sys.stdin.read().strip()
rs = []
for part in raw.split(","):
    a, _, b = part.partition("-")
    rs.append((int(a, 16), int(b or a, 16)))
def has(cp):
    lo, hi = 0, len(rs) - 1
    while lo <= hi:
        m = (lo + hi) // 2
        x, y = rs[m]
        if cp < x: hi = m - 1
        elif cp > y: lo = m + 1
        else: return True
    return False
bad = [cp for cp in range(0x10000)
       if not (0xd800 <= cp <= 0xdfff) and has(cp) != (unicodedata.category(chr(cp)) != "Cn")]
print("MISMATCH", len(bad), ["%04X" % c for c in bad[:8]] if bad else "OK")
`], { input: raw, encoding: "utf8" });
    const out = String(py.stdout || "").trim();
    if (out.startsWith("SKIP")) {
      console.log(`  (Unicode 交叉校验跳过：本地 unicodedata ${out.slice(5)} < 16.0)`);
    } else {
      t("分配表与本地 Unicode 一致", /OK$/.test(out), out.slice(0, 120));
    }
  }

  console.log("── ㉒ 重复处理幂等（双重注册 / reload 残留）");
  {
    // The hatch form `\\ue235` displays as a single-backslash literal; feeding
    // that output back through the pipeline used to restore it into a glyph and
    // corrupt the deliberate literal (round 17).
    const bs = "\\";
    const first = await end("字面 " + bs + bs + "ue235 与真 " + bs + "u" + "e0b0");
    const second = await end(first);
    const third = await end(second);
    t("二次处理不腐蚀字面量", second === first && third === first, JSON.stringify(second));
    t("首轮仍正常还原", hasCp(first, 0xe0b0) && first.includes(bs + "ue235"), JSON.stringify(first));
  }

  console.log("── ㉑ CRLF 文本（Windows/剪贴板粘贴）");
  {
    const esc = (h) => "\\" + "u" + h; // build escapes by concatenation: dodges JS literal escapes
    const crlf = "前 " + esc("e235") + "\r\n```\r\n-- U+E235\r\n```\r\n后 " + esc("e0b0");
    a = await end(crlf);
    // fence body stays literal text "-- U+E235"; the escape AFTER the fence must restore
    t("CRLF围栏闭合被识别", hasCp(a, 0xe0b0) && a.includes("-- U+E235"), JSON.stringify(a.slice(0, 70)));
  }
  {
    a = await end("\u56fe\u6807\r\n-- U+E235\r\n\u5c3e x");
    t("CRLF下行内补框", a.includes("-- U+E235 \u25a1\r\n") && !a.includes("\r \u25a1"), JSON.stringify(a));
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("套件崩溃:", e); process.exit(1); });
