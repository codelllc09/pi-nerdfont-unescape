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
  a = await safeEnd("```\n[[nf:python]]\n```");
  t("围栏内标记不动", a.includes("[[nf:python]]"), JSON.stringify(a));
  notes.length = 0;
  a = await safeEnd("未知 [[nf:zzz_no_such]] 名");
  t("未知名保留+点名", a.includes("[[nf:zzz_no_such]]") && notes.some((n) => n.includes("zzz_no_such")), JSON.stringify(notes));

  console.log("── ⑮ [[nf:]] 健壮性（缓存与语法）");  // 旧版裸 Map 遗留（reload 同进程）→ 必须安全重建而非崩溃（外部评审判例）
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
      fs.writeFileSync(P, JSON.stringify({ fonts: ["fake"], ranges: [[57344, 57344]] })); // 旧格式：只有 ranges 没有 sig
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
      t("旧格式缓存拒收并重建", rejected && ok, `rejected=${rejected}, sig=${typeof globalThis[SIGK]}`);
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
      // orig 无签名（假货/旧格式）时不还原——删除让下一会话重建真值，
      // 防止异步构建竞态把 fake 留在盘上毒害后续运行（第八轮判例）
      const origValid = orig !== null &&/"sig"/.test(orig);
      if (origValid) fs.writeFileSync(P, orig);
      else { try { fs.unlinkSync(P); } catch {} }
    }
  }
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("套件崩溃:", e); process.exit(1); });
