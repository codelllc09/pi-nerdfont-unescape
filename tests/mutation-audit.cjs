#!/usr/bin/env node
/**
 * mutation-audit.cjs — 用代码审计测试：逐个故意改坏扩展源码（变异），
 * 对应测试必须变红；红不了的测试 = 摆设（从未能证明自己会失败）。
 *
 * 运行: node tests/mutation-audit.cjs   （不改动仓库内源文件，变异体写 /tmp）
 *   --jobs N     并行 worker 数（默认 CPU-1，上限 16）
 *   --only 正则  只跑名字匹配的变异（锚点仍全量校验）
 *   --from N     从第 N 条开始（配合 --only 做断点续跑）
 *   --list       只列出变异名，不执行
 *   --fresh      忽略续跑日志，从头审计
 * 幂等/续跑: 每条变异完成即写入 /tmp/pi-mutation-journal-<源码哈希>.json；
 *   中断后原样重跑会跳过已完成条目（源码或锚点变化则日志自动失效）。
 *   所有中间产物都在 /tmp 且按 pid 命名，重复运行互不干扰。
 * 进度: 每条变异完成即打印 [i/N] 耗时 结果 名称 ETA；锚点过期在开跑前 1 秒内报错。
 * 原则: 测试的对错交给代码——本审计零模型参与，退出码即结论。
 *
 * 判定：
 *   - 无效变异（没杀死任何测试）→ 审计失败
 *   - 从未变红过的测试名 → 审计失败（装饰品）
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = __dirname + "/..";
const SRC = path.join(ROOT, "nerdfont-unescape.ts");
const MUTATED = "/tmp/pi-mutated-ext.ts";
const AUDIT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pi-nf-audit-"));
const AUDIT_CACHE = path.join(AUDIT_DIR, "cmap.json");
const SUITES = {
  1: path.join(ROOT, "tests/test-nerdfont-unescape.cjs"),
  2: path.join(ROOT, "tests/test-tools.cjs"),
};

// 每条变异：锚点（源码中必须恰好出现一次）→ 替换 → 应杀死的测试所在套件
const MUTATIONS = [
  { name: "M1 还原禁用", suites: [1],
    old: "return String.fromCodePoint(cp);", new: "return whole;" },
  { name: "M2 括号形式失效", suites: [1],
    old: "const cp = parseInt(brace ?? plain!, 16);", new: 'const cp = parseInt(plain ?? "10ffff", 16);' },
  { name: "M3 逃生舱失效", suites: [1],
    old: "if (aBrace !== undefined || aPlain !== undefined) {\n        hatched++; // hatch: double backslash → single-backslash literal display\n        return whole.slice(1);\n      }",
    new: "if (aBrace !== undefined || aPlain !== undefined) {\n        return whole;\n      }" },
  { name: "M4 可见替换失效", suites: [1],
    old: "if (isInherentlyInvisible(cp) || notInFonts) {", new: "if (false) {" },
  { name: "M5 补框禁用", suites: [1],
    old: "if (ICON_CONTEXT.test(text)) {", new: "if (false) {" },
  { name: "M7 围栏失效(还原通道)", suites: [1, 2], count: 2,
    old: "const FENCE = /^[ \\t]*(`{3,}|~{3,})/;", new: "const FENCE = /^(?!x)x/;" },
  { name: "M8 行内保护失效", suites: [1, 2],
    old: ".map((seg) => (seg.protected ? seg.text : processSegment(seg.text)))",
    new: ".map((seg) => processSegment(seg.text))" },
  { name: "M9 输入禁用", suites: [1, 2],
    old: 'return { action: "transform", text: out };', new: 'return { action: "continue" };' },
  { name: "M10 流快照禁用", suites: [1],
    old: "streamSeenCps.add(cp);", new: "void cp;" },
  { name: "M11 流比较失效(恒报丢失)", suites: [1, 2],
    old: "(cp) => !finalText.includes(String.fromCodePoint(cp)) && !finalText.includes(visibleMarker(cp)),", new: "() => true," },
  { name: "M12 注入不追加", suites: [2],
    old: "(event.systemPrompt ?? \"\") +", new: '"" +' },
  { name: "M13a 注入无协议名", suites: [2],
    old: "[nerdfont-unescape output protocol]", new: "[protocol]" },
  { name: "M13b 注入无逃生舱说明", suites: [2],
    old: "write a double backslash \\\\uXXXX — the client will not restore it", new: "write a doubled backslash \\\\uXXXX" },
  { name: "M14 lookup 查询失效", suites: [2],
    old: '["-c", NF_LOOKUP_PY, String(params.query), String(params.limit ?? 20)],',
    new: '["-c", NF_LOOKUP_PY, "__nomatch__", String(params.limit ?? 20)],' },
  { name: "M15 lookup 致崩", suites: [2],
    old: 'async execute(_toolCallId, params) {\n      const out = await new Promise<string>((resolve) => {\n        execFile(\n          "python3",\n          ["-c", NF_LOOKUP_PY,',
    new: 'async execute(_toolCallId, params) {\n      throw new Error("mutated");\n      const out = await new Promise<string>((resolve) => {\n        execFile(\n          "python3",\n          ["-c", NF_LOOKUP_PY,' },
  { name: "M16 render 内容失效", suites: [2],
    old: 'child.stdin?.end(params.content ?? "");', new: 'child.stdin?.end("__mutated__");' },
  { name: "M17 通知计数失效", suites: [2],
    old: "(c === 1 ? n : `${n} ×${c}`)", new: "(n)" },
  { name: "M18 流角色检查失效", suites: [2], count: 2,
    old: 'if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return;',
    new: "if (!Array.isArray(msg.content)) return;" },
  { name: "M19 工具注册禁用", suites: [2], count: 2,
    old: "  pi.registerTool({", new: "  if (false) pi.registerTool({" },
  { name: "M20 render 边框失效", suites: [2],
    old: 'params.frame ?? "none"', new: '"none"' },
  { name: "M21 render 写盘失效", suites: [2],
    old: 'params.writePath ?? ""', new: '""' },
  { name: "M22 输入恒转换", suites: [2],
    old: 'if (escaped.length === 0) return { action: "continue" };',
    new: 'if (false) return { action: "continue" };' },
  { name: "M23 输入通知级别翻转", suites: [2],
    old: 'the model receives the escapes`,\n      "warning",',
    new: 'the model receives the escapes`,\n      "info",' },
  { name: "M24 六位码位退回", suites: [1],
    old: "const ONE_PASS = /\\\\{2}u(?:\\{([0-9a-fA-F]{1,6})\\}|([0-9a-fA-F]{4}))|\\\\u(?:\\{([0-9a-fA-F]{1,6})\\}|([0-9a-fA-F]{4}))/g;",
    new: "const ONE_PASS = /\\\\{2}u(?:\\{([0-9a-fA-F]{1,5})\\}|([0-9a-fA-F]{4}))|\\\\u(?:\\{([0-9a-fA-F]{1,5})\\}|([0-9a-fA-F]{4}))/g;" },
  { name: "M26 围栏状态机退回", suites: [1],
    old: "        if (!fenceOpen) {\n          fenceOpen = { ch: run[0], len: run.length }; // opening line may carry an info string (```js)\n        } else if (\n          run[0] === fenceOpen.ch &&\n          run.length >= fenceOpen.len &&\n          /^[ \\t]*$/.test(rest) // closing line must be a pure fence (```x does not close, CommonMark)\n        ) {\n          fenceOpen = null;\n        }",
    new: "        fenceOpen = fenceOpen ? null : { ch: run[0], len: 1 }; void rest; // 任意围栏线翻转" },
  { name: "M27 流跟踪放宽回宽区间", suites: [1],
    old: "if (isAtRisk(cp)) streamSeenCps.add(cp); // narrowed: emoji/plain-astral edits are not transit loss",
    new: "if (cp >= 0xe000 && cp <= 0x10fffd) streamSeenCps.add(cp);" },
  { name: "M28 写盘护栏旁路", suites: [2],
    old: "if (!inside(cwd) && !inside(tmp)) {",
    new: "if (false) {" },
  { name: "M29 render六位退回", suites: [2],
    old: "0 < k - j - 1 <= 6",
    new: "0 < k - j - 1 < 6" },
  { name: "M30 逃生舱落盘旁路", suites: [1],
    old: "if (hatched > 0 || contentChanged) {",
    new: "if (false) {" },
  { name: "M31 流比对回原始文本", suites: [1],
    old: "const finalText = (content as any[])",
    new: "const finalText = (msg.content as any[])" },
  { name: "M32 六位预览裸字退回", suites: [2],
    old: "        elif 0xF0000 <= o <= 0x10FFFD:\n            r.append(BS + \"u{%X}\" % o)  # supplementary PUA must also surface as an escape literal (channel-safe)\n        else:\n            r.append(c)",
    new: "        else:\n            r.append(c)" },
  { name: "M33 非法码位校验退回", suites: [2],
    old: "out.append(chr(v) if v <= 0x10FFFF else \"[U+%X]\" % v)  # beyond the codespace: visible marker, not a crash",
    new: "out.append(chr(v))" },
  { name: "M34 闭合纯度退回", suites: [1],
    old: "run.length >= fenceOpen.len &&\n          /^[ \\t]*$/.test(rest) // closing line must be a pure fence (```x does not close, CommonMark)",
    new: "run.length >= fenceOpen.len && true" },
  { name: "M35 真路径判定退回", suites: [2],
    old: "const realAbs = fsMod.existsSync(abs)\n          ? fsMod.realpathSync(abs)\n          : pathMod.join(fsMod.realpathSync(pathMod.dirname(abs)), pathMod.basename(abs));",
    new: "const realAbs = abs;" },
  { name: "M36 语义标记失效", suites: [1],
    old: "const NF_MARKER = /\\[\\[nf:([a-z0-9_.-]{1,40})\\]\\]/gi;",
    new: "const NF_MARKER = /(?!x)x/gi;" },
  { name: "M38 快速通道退回小写", suites: [1],
    old: "if (!/\\[\\[nf:/i.test(text)) return text;",
    new: 'if (!text.includes("[[nf:")) return text;' },
  { name: "M39 别名表清空", suites: [1],
    old: 'ALIAS = {"git-branch": "branch", "node-js": "nodejs", "node.js": "nodejs", "macos": "apple"}',
    new: "ALIAS = {}" },
  { name: "M40 缓存迁移旁路", suites: [1],
    old: "if (!(g[NF_CACHE] && typeof g[NF_CACHE] === \"object\" && g[NF_CACHE].map instanceof Map)) {",
    new: "if (false) {" },
  { name: "M41 签名失效旁路", suites: [1],
    old: "if (store.sig !== curSig) {",
    new: "if (false) {" },
  { name: "M45 全局签名旁路", suites: [1],
    old: "const curSig = (globalThis as any)[CMAP_SIG] as string | undefined;",
    new: "const curSig: string | undefined = undefined;" },
  { name: "M46 名字长度上限移除", suites: [1],
    old: "const VALID_NAME = /^[a-z0-9_.-]{1,40}$/i; // exactly NF_MARKER's rule: charset + length cap",
    new: "const VALID_NAME = /^[a-z0-9_.-]+$/i;" },
  { name: "M47 宽松扫描收窄", suites: [1],
    old: "const LOOSE_NF = /\\[\\[nf:([^\\[\\]\\n]*)\\]\\]/gi;",
    new: "const LOOSE_NF = /\\[\\[nf:([^\\[\\]\\n]{1,60})\\]\\]/gi;" },
  { name: "M56 空引号补框复活", suites: [1],
    old: "  let filled = 0;\n  const cps: number[] = [];",
    new: "  let filled = 0;\n  const cps: number[] = [];\n  const __n0 = (text.match(/□/g) || []).length; text = text.replace(/''/g, \"'□'\"); filled += (text.match(/□/g) || []).length - __n0;" },
  { name: "M57 未知字体乐观退回", suites: [1],
    old: "const notInFonts = cmap === undefined || !inRanges(cmap, cp);",
    new: "const notInFonts = cmap !== undefined && !inRanges(cmap, cp);" },
  { name: "M64 围栏CR剥离移除", suites: [1],
    old: 'const stripCr = (s: string): string => s.replace(/\\r$/, "");',
    new: 'const stripCr = (s: string): string => s;' },
  { name: "M65 Lua行尾CR容忍移除", suites: [1],
    old: '[ \\t]*\\r?$/; // 4-6 hex',
    new: '[ \\t]*$/; // 4-6 hex' },
  { name: "M66 补框CR位置丢失", suites: [1],
    old: 'const cr = m.endsWith("\\r") ? "\\r" : "";',
    new: 'const cr = "";' },
  { name: "M63 input类型守卫移除", suites: [1],
    old: 'if (typeof text !== "string") return { action: "continue" };',
    new: "if (false) return { action: \"continue\" };" },
  { name: "M62 空提示词兜底移除", suites: [1],
    old: "(event.systemPrompt ?? \"\") +",
    new: "event.systemPrompt +" },
  { name: "M58 码位注释风险门移除", suites: [1],
    old: "if (!isAtRisk(cp)) return m; // e.g. U+0041 'A': a safe codepoint, nothing was dropped",
    new: "void cp;" },
  { name: "M60 合规检查退回全文档", suites: [1],
    old: "if (seg.includes(String.fromCodePoint(cp)) || seg.includes(marker)) return m;",
    new: "if (text.includes(String.fromCodePoint(cp)) || text.includes(marker)) return m;" },
  { name: "M61 标记识别移除", suites: [1],
    old: "const marker = visibleMarker(cp);\n      if (seg.includes(String.fromCodePoint(cp)) || seg.includes(marker)) return m;",
    new: "void cp;\n      if (seg.includes(String.fromCodePoint(cp))) return m;" },
  { name: "M59 码位注释六位退回", suites: [1],
    old: "const LUALINE = /(--[ \\t]*U\\+[0-9A-Fa-f]{4,6})[ \\t]*\\r?$/; // 4-6 hex (PUA-B needs 6); \\r? = CRLF tolerance",
    new: "const LUALINE = /(--[ \\t]*U\\+[0-9A-Fa-f]{4,5})[ \\t]*\\r?$/;" },
  { name: "M48 批量截断为首名", suites: [1],
    old: '`resolve:${uncached.join(",")}`',
    new: '`resolve:${uncached[0]}`' },
  { name: "M49 签名写回错误基准", suites: [1], slow: true,
    old: "store.sig = curSig; // write back the comparison basis (a module-local here re-cleared every message)",
    new: "store.sig = cmapSig;" },
  { name: "M50 热升级恢复旁路", suites: [1], slow: true,
    old: "if (typeof g[CMAP_SIG] !== \"string\") {\n      if (!loadCmapCache()) {\n        buildCmapCache(notify);\n        return;\n      }\n    }\n    checkCmapSignature(notify);",
    new: "if (false) { void g; }\n    void notify;" },
  { name: "M51 reload核验旁路", suites: [1], slow: true, count: 2,
    old: "checkCmapSignature(notify);",
    new: "void notify;" },
  { name: "M52 损坏缓存宽容退回", suites: [1], slow: true,
    old: "if (data.schema !== 2 || !validRanges(data.ranges) || typeof data.sig !== \"string\" || data.sig.length === 0) return false;",
    new: "if (!Array.isArray(data.ranges)) return false;" },
  { name: "M53 模板转义腐坏退回", suites: [1], slow: true,
    old: 'h.update(("%s:%d:%d\\\\n" % (p, st.st_size, st.st_mtime_ns)).encode())',
    new: 'h.update(("%s:%d:%d\\n" % (p, st.st_size, st.st_mtime_ns)).encode())' },
  { name: "M54 并发重建去重旁路", suites: [1], slow: true,
    old: "if (state.building) return;",
    new: "if (false) return;" },
  { name: "M55 签名核验失败静默", suites: [1], slow: true,
    old: "console.error(`[nerdfont-unescape] cmap signature check FAILED: ${reason}`);\n        notify?.(msg, \"warning\");",
    new: "console.error(`[nerdfont-unescape] cmap signature check FAILED: ${reason}`);" },
  { name: "M42 失败缓存永久化", suites: [1],
    old: "const uncached = [...wanted].filter((n) => cache.get(n) == null);",
    new: "const uncached = [...wanted].filter((n) => !cache.has(n));" },
  { name: "M43 非法标记告警移除", suites: [1],
    old: "if (invalid.size > 0) {",
    new: "if (false) {" },
  { name: "M44 vscode 别名反伤回归", suites: [1],
    old: 'ALIAS = {"git-branch": "branch", "node-js": "nodejs", "node.js": "nodejs", "macos": "apple"}',
    new: 'ALIAS = {"git-branch": "branch", "node-js": "nodejs", "node.js": "nodejs", "macos": "apple", "vscode": "visual-studio-code"}' },
  { name: "M37 未知名假解析", suites: [1],
    old: "const raw = cache.get(k);",
    new: "const raw = cache.get(k) ?? 0xe235;" },
  { name: "M67 非图标码位放行", suites: [1],
    old: "cp === null ? null : isAtRisk(cp) ? cp : -cp",
    new: "cp === null ? null : cp" },
  { name: "M68 损坏全局range击穿", suites: [1],
    old: "if (!Array.isArray(range) || range.length !== 2) return false;",
    new: "void range;" },
  { name: "M69 可见标记不算最终存在", suites: [1],
    old: "(cp) => !finalText.includes(String.fromCodePoint(cp)) && !finalText.includes(visibleMarker(cp)),",
    new: "(cp) => !finalText.includes(String.fromCodePoint(cp))," },
  { name: "M70 Emoji宽度退回单列", suites: [2],
    old: 'width = 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1',
    new: 'width = 1' },
  { name: "M71 render CRLF剥离移除", suites: [2],
    old: 'src = [unesc(l[:-1] if l.endswith("\\\\r") else l) for l in content.split("\\\\n")]',
    new: 'src = [unesc(l) for l in content.split("\\\\n")]' },
  { name: "M79 分配表顺序破坏", suites: [1],
    old: '"0-377,37a-37f',
    new: '"377-0,37a-37f' },
  { name: "M80 分配表丢已分配项", suites: [1],
    old: '"0-377,37a-37f',
    new: '"0-40,37a-37f' },
  { name: "M81 不可用误报为未知名", suites: [1],
    old: "const bucket = resolverUnavailable ? unavailable : unresolved;",
    new: "const bucket = unresolved;" },
  { name: "M82 TTC逐face关闭", suites: [1], slow: true,
    old: "                    for face in coll.fonts:\n                        cps.update((face.getBestCmap() or {}).keys())",
    new: "                    for face in coll.fonts:\n                        cps.update((face.getBestCmap() or {}).keys())\n                        face.close()" },
  { name: "M78 自我输出二次处理", suites: [1],
    old: "if (emittedTexts().includes(joinBlocks(msg.content))) return;",
    new: "if (false) return;" },
  { name: "M77 协议注入不幂等", suites: [2],
    old: 'if ((event.systemPrompt ?? "").includes(PROTOCOL_TITLE)) return;',
    new: "if (false) return;" },
  { name: "M73 宽度守卫移除", suites: [2],
    old: "if (params.width !== undefined && (!Number.isInteger(params.width) || params.width < 1 || params.width > 10000)) {",
    new: "if (false) {" },
  { name: "M74 边框守卫移除", suites: [2],
    old: 'if (params.frame !== undefined && !["none", "ascii", "double"].includes(params.frame)) {',
    new: "if (false) {" },
  { name: "M75 writePath接线断开", suites: [2],
    old: 'params.frame ?? "none", params.writePath ?? ""],',
    new: 'params.frame ?? "none", ""],' },
  { name: "M76 族优先级顺序错乱", suites: [2],
    old: 'FAM = ("pl", "linux", "fae", "fa", "oct", "md", "seti", "dev", "cod", "custom", "ie", "weather")',
    new: 'FAM = ("pl", "linux", "fae", "dev", "oct", "md", "seti", "fa", "cod", "custom", "ie", "weather")' },
  { name: "M72 显式终端字体来源失真", suites: [1], slow: true,
    old: 'return found, "explicit"', count: 2,
    new: 'return found, "mutated"' },
  { name: "M73 lookup忽略显式终端字体", suites: [1, 2],
    old: "fonts, font_source = discover_fonts()",
    new: 'fonts, font_source = [], "mutated"' },
];

const src = fs.readFileSync(SRC, "utf8");

(async () => {

// ── CLI ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name, fallback) {
  const k = argv.indexOf(`--${name}`);
  return k >= 0 && argv[k + 1] !== undefined ? argv[k + 1] : fallback;
}
// ── Resource guard ────────────────────────────────────────────
// A parallel audit once pushed a 15 GB workstation into global OOM and took
// the desktop down with it (round 18 postmortem). Parallelism is now capped by
// BOTH cpu count and available memory, children get a V8 heap cap, and every
// child is killed on exit/interrupt so an aborted run leaves nothing behind.
function memAvailableMB() {
  try {
    const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync("/proc/meminfo", "utf8"));
    return m ? Math.floor(Number(m[1]) / 1024) : null;
  } catch {
    return null;
  }
}
const MEM_PER_JOB = 512; // MB: a node child + its python helper, measured generously
const MEM_RESERVE = 2560; // MB kept free for the desktop/browser (the OOM victims)
const cpuCap = Math.max(1, os.cpus().length - 1);
const availMB = memAvailableMB();
const memCap = availMB === null ? cpuCap : Math.max(1, Math.floor((availMB - MEM_RESERVE) / MEM_PER_JOB));
// Default is deliberately ONE worker: the audit is a background verification,
// not an interactive loop, and a single child keeps the footprint ~200-300 MB
// (the OOM postmortem). --jobs opts into parallelism explicitly.
const autoJobs = 1;
const requested = flag("jobs", null);
const JOBS = requested === null ? autoJobs : Math.max(1, Math.min(16, Number(requested) || 1));
const HEAP_CAP = "--max-old-space-size=768";
const onlyRe = flag("only", null) ? new RegExp(flag("only"), "i") : null;
const fromIdx = Number(flag("from", "0")) || 0;
if (argv.includes("--list")) {
  MUTATIONS.forEach((m, i) => console.log(`${String(i + 1).padStart(3)}  ${m.name}`));
  process.exit(0);
}

// ── IDENTITY PREFLIGHT ─────────────────────────────────────────
// 2026-10-29: the regression suite had been overwritten by this very driver, so
// the audit "ran the suite" by spawning a copy of itself — recursively, creating
// thousands of temp dirs until the cgroup killed it. Verify each suite is a
// suite BEFORE spawning anything: cheap, and it makes that failure impossible.
const identityErrors = [];
for (const [id, file] of Object.entries(SUITES)) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    identityErrors.push(`suite ${id} unreadable: ${e.message}`);
    continue;
  }
  if (!text.includes("const t = (name")) identityErrors.push(`suite ${id} has no t() tester: ${file}`);
  if (text.includes("const MUTATIONS")) identityErrors.push(`suite ${id} contains the audit driver (identity swap): ${file}`);
  if (text.includes("runSuiteAsync")) identityErrors.push(`suite ${id} contains runSuiteAsync (self-spawn risk): ${file}`);
}
if (identityErrors.length) {
  identityErrors.forEach((e) => console.error(`✗ ${e}`));
  console.error("审计中止：测试文件身份不对（先跑 npm run guard）");
  process.exit(1);
}

// Sweep leftovers from killed runs of MY OWN prefixes only, so a machine that
// hit an OOM mid-audit does not accumulate thousands of temp dirs.
try {
  const now = Date.now();
  const mine = /^(pi-nf-audit-|pi-mutated-.*\.ts$|pi-mutation-journal-.*\.json)/;
  let swept = 0;
  for (const name of fs.readdirSync("/tmp")) {
    if (!mine.test(name)) continue;
    const full = path.join("/tmp", name);
    try {
      if (now - fs.statSync(full).mtimeMs > 600000) { fs.rmSync(full, { recursive: true, force: true }); swept++; }
    } catch {}
  }
  if (swept > 0) console.log(`清扫过期临时产物 ${swept} 项（>10 分钟前的自有前缀）`);
} catch {}

// ── ANCHOR VALIDATION FIRST ────────────────────────────────────
// A stale anchor used to abort the run AFTER ~20 minutes of unrelated work.
// Validate every anchor before spawning anything: failures surface in ~1s.
const anchorErrors = [];
for (const mu of MUTATIONS) {
  const want = mu.count ?? 1;
  const count = src.split(mu.old).length - 1;
  if (count !== want) anchorErrors.push(`${mu.name}: anchor matched ${count}x (want ${want})`);
  if (mu.old === mu.new) anchorErrors.push(`${mu.name}: old === new (no mutation)`);
}
if (anchorErrors.length) {
  anchorErrors.forEach((e) => console.error(`✗ ${e}`));
  console.error("审计中止：先修锚点（这不是测试失败）");
  process.exit(1);
}

const SELECTED = MUTATIONS.slice(fromIdx).filter((m) => !onlyRe || onlyRe.test(m.name));

// ── Resume journal（幂等续跑）─────────────────────────────────
// Keyed by a hash of the extension source: any code change invalidates the
// whole journal automatically, so a stale entry can never fake a green run.
const crypto = require("crypto");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const SRC_HASH = sha(src);
const JOURNAL = path.join("/tmp", `pi-mutation-journal-${SRC_HASH.slice(0, 12)}.json`);
function loadJournal() {
  if (argv.includes("--fresh")) return { srcHash: SRC_HASH, entries: {} };
  try {
    const j = JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
    if (j.srcHash === SRC_HASH && j.entries) return j;
  } catch {}
  return { srcHash: SRC_HASH, entries: {} };
}
const journal = loadJournal();
function saveJournal() {
  const tmp = `${JOURNAL}.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(journal));
  fs.renameSync(tmp, JOURNAL); // atomic replace: a kill mid-write cannot corrupt it
}
if (!SELECTED.length) {
  console.error("没有匹配的变异");
  process.exit(1);
}

// ── Isolation ──────────────────────────────────────────────────
// Each worker gets its own mutated file and its own cache copy, so concurrent
// mutants can never read each other's extension or poison a shared cache.
function paths(worker) {
  return {
    ext: path.join("/tmp", `pi-mutated-${process.pid}-${worker}.ts`),
    cache: path.join(AUDIT_DIR, `cmap-${process.pid}-${worker}.json`),
  };
}

function runSuiteAsync(id, full, extPath, cachePath, worker) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HEAP_CAP, SUITES[id]], {
      env: { ...process.env, EXT_PATH: extPath, PI_NF_CMAP_CACHE: cachePath, ...(full ? {} : { SKIP_SLOW: "1" }) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // own process group: kill(-pid) reaps python grandchildren too
    });
    const live = new Set();
    LIVE_CHILDREN.add(child);
    child.on("close", () => LIVE_CHILDREN.delete(child));
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("error", (e) => { out += `\nspawn error: ${e.message}\n`; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 240000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const failed = [];
      for (const line of out.split("\n")) {
        const m = line.match(/^  ✗ (.*)$/);
        if (m) failed.push(m[1].split("  ")[0].trim());
      }
      resolve({
        failed,
        crashed: code !== 0 && failed.length === 0,
        tail: out.split("\n").filter(Boolean).slice(-2).join(" | "),
      });
    });
  });
}

const LIVE_CHILDREN = new Set();
function killChildren() {
  for (const c of LIVE_CHILDREN) {
    try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch {} }
  }
  LIVE_CHILDREN.clear();
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { killChildren(); fs.rmSync(AUDIT_DIR, { recursive: true, force: true }); process.exit(130); });
}
process.on("exit", killChildren);

function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

// Baseline: one isolated, valid cache built from the unmutated source.
const warm = runSuiteAsync(1, false, SRC, path.join(AUDIT_DIR, `cmap-warm-${process.pid}.json`), "warm");
const warmR = await warm;
const warmCache = path.join(AUDIT_DIR, `cmap-warm-${process.pid}.json`);
if (warmR.crashed || warmR.failed.length || !fs.existsSync(warmCache)) {
  console.error(`✗ 隔离 cmap 基线构建失败：${warmR.tail || warmR.failed.join(", ") || "(子进程无输出)"}`);
  console.error("  提示：子进程可能被内存上限杀掉 —— 用 scripts/safe-run.sh 包裹，或调低 --jobs。");
  process.exit(1);
}
const auditCacheBaseline = fs.readFileSync(warmCache);

const killedBy = new Map(); // test name -> [mutation names]
const ineffective = [];
const crashedNote = [];

// Idempotent start: sweep leftovers from killed workers (our own prefixes only,
// older than 10 minutes so a concurrent run is never disturbed).
try {
  const now = Date.now();
  for (const f of fs.readdirSync("/tmp")) {
    if (!/^pi-mutated-\d+-\d+\.ts$/.test(f) && !/^pi-mutation-journal-.*\.json\.\d+$/.test(f)) continue;
    const p2 = path.join("/tmp", f);
    try { if (now - fs.statSync(p2).mtimeMs > 600000) fs.rmSync(p2, { force: true }); } catch {}
  }
} catch {}

const resumed = SELECTED.filter((m) => journal.entries[m.name]?.oldHash === sha(m.old).slice(0, 16)).length;
const MIN_AVAIL_MB = 2000;
if (availMB !== null && availMB < MIN_AVAIL_MB && !argv.includes("--force")) {
  console.error(
    `拒绝启动：可用内存仅 ${availMB}MB（阈值 ${MIN_AVAIL_MB}MB）。\n` +
    "关掉浏览器/其他应用后重试，或显式 --force。\n" +
    "（2026-10-29：同样条件下并行的审计触发过全局 OOM，内核杀了 chrome，桌面重启。）",
  );
  process.exit(75);
}

const jobsWhy = requested === null
  ? `CPU 上限 ${cpuCap}${availMB === null ? "" : `，可用内存 ${availMB}MB → 上限 ${memCap}`}`
  : `--jobs 指定（CPU 上限 ${cpuCap}${availMB === null ? "" : `，可用内存 ${availMB}MB`}）`;
console.log(`变异审计：${SELECTED.length}/${MUTATIONS.length} 条，并行 ${JOBS}（${jobsWhy}；子进程堆上限 384MB），锚点全量校验通过`);
if (availMB !== null && availMB < MEM_RESERVE + MEM_PER_JOB * 2) {
  console.log(`⚠ 可用内存仅 ${availMB}MB：单条串行运行，若仍卡顿请先关掉浏览器再跑`);
}
if (resumed) {
  console.log(`断点续跑：${resumed} 条已有结论（源码哈希 ${SRC_HASH.slice(0, 12)}，--fresh 可忽略日志重跑）`);
  console.log(`  剩余 ${SELECTED.length - resumed} 条`);
}
console.log(`预计 ${fmtDur((SELECTED.length - resumed) * 18000 / JOBS)}（单条约 18s；实测会随机器波动）\n`);

const startedAt = Date.now();
let done = 0;

async function runOne(mu, worker) {
  const { ext, cache } = paths(worker);
  const t0 = Date.now();
  const oldHash = sha(mu.old).slice(0, 16);
  const cached = journal.entries[mu.name];
  if (cached && cached.oldHash === oldHash) {
    // Resume: replay the recorded verdict instead of re-running the suites.
    for (const n of cached.failed) {
      if (!killedBy.has(n)) killedBy.set(n, []);
      killedBy.get(n).push(mu.name);
    }
    if (cached.crashed) crashedNote.push(`${mu.name}→journal`);
    if (!cached.failed.length) ineffective.push(mu.name);
    done++;
    const elapsed = Date.now() - startedAt;
    const eta = done ? (elapsed / done) * (SELECTED.length - done) : 0;
    console.log(`[${String(done).padStart(3)}/${SELECTED.length}]  ↺跳过  ${String(cached.failed.length + " 红").padEnd(8)} ${mu.name}   (ETA ${fmtDur(eta)})`);
    return;
  }
  fs.writeFileSync(ext, src.split(mu.old).join(mu.new));
  const killed = new Set();
  let crashed = false;
  try {
    for (const id of mu.suites) {
      fs.writeFileSync(cache, auditCacheBaseline);
      const r = await runSuiteAsync(id, mu.slow === true, ext, cache, worker);
      r.failed.forEach((n) => killed.add(n));
      if (r.crashed) { crashed = true; crashedNote.push(`${mu.name}→套件${id}`); }
    }
  } finally {
    fs.rmSync(ext, { force: true });
    fs.rmSync(cache, { force: true });
  }
  const names = [...killed];
  for (const n of names) {
    if (!killedBy.has(n)) killedBy.set(n, []);
    killedBy.get(n).push(mu.name);
  }
  if (!names.length) ineffective.push(mu.name);
  journal.entries[mu.name] = { oldHash, failed: names, crashed };
  saveJournal(); // resumable from here even if this process is killed next second
  done++;
  const elapsed = Date.now() - startedAt;
  const eta = done ? (elapsed / done) * (SELECTED.length - done) : 0;
  const verdict = names.length ? `${names.length} 红` : crashed ? "套件崩溃" : "0 红 ✗";
  console.log(
    `[${String(done).padStart(3)}/${SELECTED.length}] ${fmtDur(Date.now() - t0).padStart(5)}  ${verdict.padEnd(8)} ${mu.name}` +
    (names.length ? `  ⇒ ${names.join(", ")}` : "") + `   (ETA ${fmtDur(eta)})`,
  );
}

// Bounded worker pool: N concurrent mutations, each fully isolated.
const queue = [...SELECTED];
await Promise.all(
  Array.from({ length: Math.min(JOBS, queue.length) }, async (_, w) => {
    while (queue.length) {
      const mu = queue.shift();
      await runOne(mu, w);
    }
  }),
);

// 汇总：每个测试名都必须被至少一条变异杀死过（全量盘点，不并发——它自身会写共享缓存）
const allTests = new Set();
for (const id of [1, 2]) {
  const cachePath = path.join(AUDIT_DIR, `cmap-inventory-${process.pid}.json`);
  fs.writeFileSync(cachePath, auditCacheBaseline);
  const r = spawnSync("node", [SUITES[id]], {
    env: { ...process.env, PI_NF_CMAP_CACHE: cachePath }, encoding: "utf8", timeout: 240000,
  });
  for (const line of (r.stdout || "").split("\n")) {
    const m = line.match(/^  [✓✗] (.*)$/);
    if (m) allTests.add(m[1].split("  ")[0].trim());
  }
  fs.rmSync(cachePath, { force: true });
}
const fullRun = SELECTED.length === MUTATIONS.length;
// Coverage is only meaningful for a complete run: a filtered run cannot kill
// tests it never exercised (reporting them as decorations would be a lie).
const uncovered = fullRun ? [...allTests].filter((n) => !killedBy.has(n)) : [];

console.log(`\n── 审计结论（总耗时 ${fmtDur(Date.now() - startedAt)}）`);
console.log(
  fullRun
    ? `变异总数 ${SELECTED.length}；覆盖测试 ${killedBy.size}/${allTests.size}`
    : `定向模式：跑 ${SELECTED.length}/${MUTATIONS.length} 条，跳过覆盖判定（全量请去掉 --only/--from）`,
);
if (crashedNote.length) console.log(`套件崩溃（非断言式失败）: ${crashedNote.join(", ")}`);
if (ineffective.length) console.log(`✗ 无效变异: ${ineffective.join(", ")}`);
if (uncovered.length) console.log(`✗ 从未变红（装饰品嫌疑）: ${uncovered.join(", ")}`);
if (!ineffective.length && !uncovered.length && fullRun) console.log("✓ 全部测试都被证明会红，全部变异都杀死了测试");
if (fullRun && !anchorErrors.length && !ineffective.length && !uncovered.length) {
  fs.rmSync(JOURNAL, { force: true }); // complete green run: nothing to resume
} else {
  console.log(`续跑日志: ${JOURNAL}` + (fullRun ? "" : "（定向模式保留，便于多次 --only 累积）"));
}
fs.rmSync(warmCache, { force: true });
fs.rmSync(AUDIT_DIR, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
