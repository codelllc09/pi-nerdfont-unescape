#!/usr/bin/env node
/**
 * test-tools.cjs — 工具层 + 提示注入 + 输入/Markdown 边角回归
 *
 * 运行: node tests/test-tools.cjs   （nerdfont_lookup 首跑需扫字体，稍慢）
 * 与 test-nerdfont-unescape.cjs 互补：那边测消息管线，这边测工具与事件契约。
 * 本文件自证了陷阱第 3 判例（见「增补区 → 括号形式」用例注释）：JS 字符串
 * 字面量的 \uXXXX 也只吃 4 位——不止正则，fromCodePoint 才是唯一正解。
 */
// 工具与 cmap 同源依赖：python3 + fontTools。缺失即失败——静默跳过等于假绿
{
  // Hermetic cache, suite1's pattern verbatim: create only when the caller
  // (mutation auditor) hasn't provided a reusable one; always clean up.
  const path = require("path");
  const os = require("os");
  const fs = require("fs");
  if (!process.env.PI_NF_CMAP_CACHE) {
    const owned = fs.mkdtempSync(path.join(os.tmpdir(), "pi-nf-suite2-"));
    process.env.PI_NF_CMAP_CACHE = path.join(owned, "cmap.json");
    process.on("exit", () => fs.rmSync(owned, { recursive: true, force: true }));
  }
}
{
  const { spawnSync } = require("child_process");
  const r = spawnSync("python3", ["-c", "import fontTools"], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error("本套件需要 python3 与 fontTools（pip install fonttools）。缺失即失败，不静默跳过。");
    process.exit(1);
  }
}
const mod = require("./lib.cjs").jitiLoad();

const handlers = {}; const tools = {}; const notes = [];
mod.default({
  registerTool: (t) => { tools[t.name] = t; },
  on: (e, f) => { handlers[e] = f; },
});
const ctx = { ui: { notify: (m, t) => notes.push({ m, t }) } };
const hasCp = (s, cp) => [...s].some((ch) => ch.codePointAt(0) === cp);
let pass = 0, fail = 0;
const t = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "  " + detail}`);
  ok ? pass++ : fail++;
};
const run = (f) => f().catch((e) => { console.error("崩溃:", e); process.exit(1); });

run(async () => {
  // cmap readiness: suite2 historically never called session_start and rode
  // the OPTIMISTIC restore path with cmap undefined — the conservative
  // font-unknown rule (□U+XXXX) exposed it. Start + wait like suite1.
  await handlers["session_start"]?.({}, ctx);
  // build timeout is 120s — wait up to 150s (cold machines / CI)
  for (let i = 0; i < 50 && !globalThis[Symbol.for("pi.nerdfontUnescape.cmap")]; i++) {
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("── ⑨ nerdfont_lookup 工具");
  {
    // Family priority is a deterministic contract: with two fixture fonts
    // naming the same codepoint, "fa-special" must rank before
    // "nf-dev-special" (nf- prefix stripped, fa before dev in FAM).
    // Exercises the merged famrank (two divergent copies once shadowed
    // each other — review round 16).
    const rows = await (async () => {
      try {
        const r = await tools.nerdfont_lookup.execute("t", { query: "U+E777", limit: 5 });
        return String(r.content[0].text);
      } catch (e) {
        return "THROWN: " + String(e);
      }
    })();
    const iFa = rows.indexOf("fa-special");
    const iDev = rows.indexOf("nf-dev-special");
    t("族别优先（fa 先于 dev，nf- 前缀剥离）", iFa >= 0 && iDev >= 0 && iFa < iDev, rows.split("\n").slice(0, 4).join(" | "));
  }
  t("已注册", !!tools.nerdfont_lookup && !!tools.render_preview, Object.keys(tools).join(","));
  if (tools.nerdfont_lookup) {
    const call = async (query, limit) => {
      try {
        const r = await tools.nerdfont_lookup.execute("t", { query, ...(limit ? { limit } : {}) });
        return r.content[0].text;
      } catch (e) {
        return "THROWN: " + String(e); // 变异/回归致崩必须可见地进入断言
      }
    };
    let out = await call("python");
    t("关键词 python → 含 E235 转义", /\\u[eE]235|U\+E235/i.test(out), JSON.stringify(out.slice(0, 120)));
    // 断言收紧到「首个字形行」的族前缀——既防无命中提示喂绿（提示含 python/branch
    // 字样），也真正断言优先排序结果（首个字形来自优先族）
    const glyphRows = out.split("\n").filter((l) => /U\+[0-9A-F]{4,5}/.test(l));
    t(
      "族别优先（首行即优先族）",
      glyphRows.length > 0 && /(?:nf-)?(?:md|custom|seti|dev|oct|fae|fa|pl|linux)-[a-z]/.test(glyphRows[0]),
      JSON.stringify((glyphRows[0] || out).slice(0, 120)),
    );
    out = await call("U+E0A0");
    t("码位查询 → E0A0 在场", /e0a0|pl-branch/i.test(out), JSON.stringify(out.slice(0, 120)));
    out = await call("starship nodejs");
    t("starship 模式 → E718", /\\u[eE]718|U\+E718/i.test(out), JSON.stringify(out.slice(0, 200)));
    try {
      out = await call("zzz-no-such-glyph-xyz", 5);
      t("无命中不崩溃（有输出）", typeof out === "string" && out.length > 0 && !String(out).startsWith("THROWN"), JSON.stringify(String(out).slice(0, 80)));
    } catch (e) {
      t("无命中不崩溃（有输出）", false, "execute 抛出: " + String(e));
    }
  }

  console.log("── ⑩ render_preview 工具");
  if (tools.render_preview) {
    const render = async (params) => {
      const r = await tools.render_preview.execute("t", params);
      return r.content[0].text;
    };
    let out = await render({ content: "中文", width: 8 });
    // CJK=2 列：2 字 = 4 列，宽 8 → 右补 4 空格（左对齐）
    t("CJK 宽度算术 + 右补齐", out.split("\n")[1] === "中文    " && out.includes("8 cols"), JSON.stringify(out));
    out = await render({ content: "🐍", width: 1, frame: "ascii" });
    t("Emoji按双列计宽", out.includes("overflows: 2 > 1") && !out.includes("all rows = 1 cols"), JSON.stringify(out));
    out = await render({ content: "A\r\nB", width: 1, frame: "ascii" });
    t("render CRLF不计入宽度", !out.includes("\r") && !out.includes("overflows") && out.includes("|A|\n|B|"), JSON.stringify(out));
    out = await render({ content: "x", width: -1, frame: "ascii" });
    t("非法宽度可见报错", out.startsWith("ERROR: width"), JSON.stringify(out));
    out = await render({ content: "x", frame: "rounded" });
    t("非法边框可见报错", out.startsWith("ERROR: frame"), JSON.stringify(out));
    out = await render({ content: "左段\t右段", width: 20 });
    t("TAB → 点线行", out.includes("…") || out.includes("·") || /\.{3}/.test(out), JSON.stringify(out.slice(0, 150)));
    out = await render({ content: "标题", frame: "double", width: 10 });
    t("双边框", out.includes("╔") && out.includes("═"), JSON.stringify(out.slice(0, 100)));
    // PUA 以转义字面量呈现（通道安全），真字符版写文件
    const tmp = "/tmp/test-render-preview.out";
    out = await render({ content: "\\ue235 图标", width: 10, writePath: tmp });
    t("预览含转义字面量", out.includes("\\ue235") || /\\u[eE]235/.test(out), JSON.stringify(out.slice(0, 150)));
    const written = require("fs").readFileSync(tmp, "utf8");
    t("writePath 写出真字符", hasCp(written, 0xe235), JSON.stringify(written.slice(0, 40)));
    t("写盘回报", out.includes(tmp), "");
    out = await render({ content: "x", writePath: "/etc/pi-render-guard-test.out" });
    t("writePath 护栏", out.startsWith("ERROR:") && out.includes("PI_RENDER_ALLOW_ANY"), JSON.stringify(String(out).slice(0, 90)));
    out = await render({ content: "\\u{100000} 六位", width: 12 });
    t("六位转义按图标计宽", /pua=1/.test(out), JSON.stringify(out.slice(0, 140)));
    // 2026-10-28 外部评审判例：增补区曾以裸字符返回，重新暴露给通道剥离
    t("六位预览转义字面量", out.includes("\\u{100000}") && ![...out].some((c) => c.codePointAt(0) === 0x100000), JSON.stringify(out.split("\n").slice(0, 2)));
    // 非法码位：可见标记 + 短错误（曾 chr 崩溃并把整段内嵌脚本泄进输出）
    out = await render({ content: "\\u{ffffff} z", width: 10 });
    t("非法码位短错误", out.includes("[U+FFFFFF]") && out.length < 400, `len=${out.length}`);
    // 符号链接绕护栏（/tmp 内链接指向界外目标）
    {
      const fs = require("fs");
      const link = "/tmp/pi-guard-link-test";
      try { fs.unlinkSync(link); } catch {}
      fs.symlinkSync("/dev/null", link);
      const r5 = await render({ content: "y", writePath: link });
      t("符号链接不绕护栏", r5.startsWith("ERROR"), JSON.stringify(r5.slice(0, 60)));
      fs.unlinkSync(link);
    }
  }


  console.log("── ⑪ 系统提示注入（before_agent_start）");
  {
    // pi may fire this hook more than once (relay/compaction); a doubled
    // protocol wastes context and repeats instructions (round 17).
    const r1 = await handlers["before_agent_start"]({ systemPrompt: "BASE" }, ctx);
    const r2 = await handlers["before_agent_start"]({ systemPrompt: r1.systemPrompt }, ctx);
    const count = (t) => (t ?? "").split("[nerdfont-unescape output protocol]").length - 1;
    t("协议注入幂等（二次不叠加）", count(r1.systemPrompt) === 1 && r2 === undefined, `first=${count(r1.systemPrompt)}, second=${r2 === undefined ? "untouched" : count(r2.systemPrompt)}`);
  }
  const r = await handlers["before_agent_start"]({ systemPrompt: "BASE" }, ctx);
  t("追加而非替换", r.systemPrompt.startsWith("BASE"));
  t("协议块在场", r.systemPrompt.includes("nerdfont-unescape output protocol") && r.systemPrompt.includes("\\uXXXX"));
  t("含逃生舱说明", r.systemPrompt.includes("double backslash"));

  console.log("── ⑫ 输入处理边角");
  let ir = await handlers["input"]({ type: "input", text: "普通文字", source: "interactive" }, ctx);
  t("无风险字符 → continue", ir.action === "continue", JSON.stringify(ir));
  // ⚠ 陷阱第三次判例：源码里 "\uf0805" = U+F080 + 字面"5"，必须 fromCodePoint
  const astral = "a" + String.fromCodePoint(0xf0805) + String.fromCodePoint(0xe235);
  ir = await handlers["input"]({ type: "input", text: astral, source: "interactive" }, ctx);
  const it = ir.text ?? ""; // 防御：transform 失效时逐项变红而非套件崩溃
  t("增补区 → 括号形式", ir.action === "transform" && it.includes("\\u{f0805}"), JSON.stringify(ir));
  t("通知级别 warning", notes.length > 0 && notes[notes.length - 1].t === "warning", JSON.stringify(notes.at(-1)));

  const six = "b" + String.fromCodePoint(0x10fffd) + "c";
  ir = await handlers["input"]({ type: "input", text: six, source: "interactive" }, ctx);
  t("PUA-B → 六位括号形式", ir.action === "transform" && (ir.text ?? "").includes("\\u{10fffd}"), JSON.stringify(ir));

  console.log("── ⑬ Markdown 边角（message_end）");
  const end = async (text) => {
    await handlers["message_start"]?.({}, {});
    const r = await handlers["message_end"]({ message: { role: "assistant", content: [{ type: "text", text }] } }, ctx);
    return r?.message?.content?.[0]?.text ?? text;
  };
  let a = await end("前 \\ue235\n~~~\nx = \"\\ue0b0\"\n~~~\n后 \\uf308");
  t("波浪围栏保护", a.includes('"\\ue0b0"') && hasCp(a, 0xe235) && hasCp(a, 0xf308), JSON.stringify(a));
  a = await end("```js\nicon = \"\\ue718\"\n```\n外 \\ue0a0");
  t("带语言标注围栏", a.includes('"\\ue718"') && hasCp(a, 0xe0a0), JSON.stringify(a));
  a = await end("- 列表项 `\\ue235` 与 **粗体** \\ue0a0");
  t("列表+行内段混合", a.includes("`\\ue235`") && hasCp(a, 0xe0a0), JSON.stringify(a));
  notes.length = 0;
  a = await end("两个 \\ue235 \\ue0a0");
  t("通知计数 ×2", notes.some((n) => n.m.includes("×2")), JSON.stringify(notes.map((n) => n.m)));
  // 流级探测：user 消息不进快照
  await handlers["message_start"]?.({}, {});
  await handlers["message_update"]({ message: { role: "user", content: [{ type: "text", text: "\ue235" }] } }, ctx);
  await handlers["message_end"]({ message: { role: "assistant", content: [{ type: "text", text: "回" }] } }, ctx);
  t("user 流不触发误报", !notes.some((n) => n.m.includes("MISSING")), JSON.stringify(notes.map((n) => n.m)));

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
});
