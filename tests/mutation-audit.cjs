#!/usr/bin/env node
/**
 * mutation-audit.cjs — 用代码审计测试：逐个故意改坏扩展源码（变异），
 * 对应测试必须变红；红不了的测试 = 摆设（从未能证明自己会失败）。
 *
 * 运行: node tests/mutation-audit.cjs   （不改动仓库内源文件，变异体写 /tmp）
 * 原则: 测试的对错交给代码——本审计零模型参与，退出码即结论。
 *
 * 判定：
 *   - 无效变异（没杀死任何测试）→ 审计失败
 *   - 从未变红过的测试名 → 审计失败（装饰品）
 */
const { spawnSync } = require("child_process");
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
  { name: "M6 补框行内保护失效", suites: [1],
    old: "if (protectedRanges.some(([a, b]) => start >= a && start < b)) continue;", new: "if (false) continue;" },
  { name: "M7 围栏失效(还原通道)", suites: [1, 2], count: 2,
    old: "const FENCE = /^[ \\t]*(`{3,}|~{3,})/;", new: "const FENCE = /^(?!x)x/;" },
  { name: "M7b 补框围栏失效", suites: [1],
    old: "const tfm = line.match(/^[ \\t]*(`{3,}|~{3,})/);",
    new: "const tfm: RegExpMatchArray | null = null;" },
  { name: "M8 行内保护失效", suites: [1, 2],
    old: ".map((seg) => (seg.protected ? seg.text : processSegment(seg.text)))",
    new: ".map((seg) => processSegment(seg.text))" },
  { name: "M9 输入禁用", suites: [1, 2],
    old: 'return { action: "transform", text: out };', new: 'return { action: "continue" };' },
  { name: "M10 流快照禁用", suites: [1],
    old: "streamSeenCps.add(cp);", new: "void cp;" },
  { name: "M11 流比较失效(恒报丢失)", suites: [1, 2],
    old: "(cp) => !finalText.includes(String.fromCodePoint(cp)),", new: "() => true," },
  { name: "M12 注入不追加", suites: [2],
    old: "event.systemPrompt +", new: '"" +' },
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
    old: "if (hatched > 0) return { message: { ...msg, content } };",
    new: "if (false) return { message: { ...msg, content } };" },
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
  { name: "M52 旧格式宽容退回", suites: [1], slow: true,
    old: "if (!Array.isArray(data.ranges) || typeof data.sig !== \"string\") return false;",
    new: "if (!Array.isArray(data.ranges)) return false;" },
  { name: "M53 模板转义腐坏退回", suites: [1], slow: true,
    old: 'try: h.update(("%s:%d\\\\n" % (p, os.path.getmtime(p))).encode())',
    new: 'try: h.update(("%s:%d\\n" % (p, os.path.getmtime(p))).encode())' },
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
    old: "const cp = cache.get(k) ?? null;",
    new: "const cp = cache.get(k) ?? 0xe235;" },
];

const src = fs.readFileSync(SRC, "utf8");

function runSuite(id, full, extensionPath = MUTATED) {
  const r = spawnSync("node", [SUITES[id]], {
    env: { ...process.env, EXT_PATH: extensionPath, PI_NF_CMAP_CACHE: AUDIT_CACHE, ...(full ? {} : { SKIP_SLOW: "1" }) },
    encoding: "utf8", timeout: 240000,
  });
  const out = r.stdout || "";
  const failed = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^  ✗ (.*)$/);
    if (m) failed.push(m[1].split("  ")[0].trim());
  }
  const crashed = r.status !== 0 && failed.length === 0;
  return { failed, crashed, tail: out.split("\n").filter(Boolean).slice(-2).join(" | ") };
}

// Build one isolated, valid baseline before mutation runs. Every child receives
// a fresh copy so a killed or crashing mutant cannot poison the next mutation.
const warm = runSuite(1, false, SRC);
if (warm.crashed || warm.failed.length || !fs.existsSync(AUDIT_CACHE)) {
  console.error(`✗ 隔离 cmap 基线构建失败：${warm.tail || warm.failed.join(", ")}`);
  process.exit(1);
}
const auditCacheBaseline = fs.readFileSync(AUDIT_CACHE);

const killedBy = new Map(); // test name -> [mutation names]
const ineffective = [];
const crashedNote = [];

for (const mu of MUTATIONS) {
  const want = mu.count ?? 1;
  const count = src.split(mu.old).length - 1;
  if (count !== want) {
    console.error(`✗ 变异 ${mu.name} 锚点命中 ${count} 次（须恰 ${want} 次），审计中止——锚点过期需更新`);
    process.exit(1);
  }
  fs.writeFileSync(MUTATED, src.split(mu.old).join(mu.new));
  const killed = new Set();
  let crashed = false;
  for (const id of mu.suites) {
    fs.writeFileSync(AUDIT_CACHE, auditCacheBaseline);
    const r = runSuite(id, mu.slow === true); // slow 变异才需要慢测试（真实字体扫描）
    r.failed.forEach((n) => killed.add(n));
    if (r.crashed) { crashed = true; crashedNote.push(`${mu.name}→套件${id}`); }
  }
  const names = [...killed];
  names.sort().forEach((n) => {
    if (!killedBy.has(n)) killedBy.set(n, []);
    killedBy.get(n).push(mu.name);
  });
  console.log(`${names.length || (crashed ? "套件崩溃" : "0")}  ${mu.name}${names.length ? "  ⇒ " + names.join(", ") : ""}`);
  if (!names.length) ineffective.push(mu.name);
}

// 汇总：每个测试名都必须被至少一条变异杀死过
const allTests = new Set();
for (const id of [1, 2]) {
  fs.rmSync(MUTATED, { force: true });
  fs.writeFileSync(AUDIT_CACHE, auditCacheBaseline);
  const r = spawnSync("node", [SUITES[id]], {
    env: { ...process.env, PI_NF_CMAP_CACHE: AUDIT_CACHE }, encoding: "utf8", timeout: 240000,
  }); // 盘点全量
  for (const line of (r.stdout || "").split("\n")) {
    const m = line.match(/^  [✓✗] (.*)$/);
    if (m) allTests.add(m[1].split("  ")[0].trim());
  }
}
const uncovered = [...allTests].filter((n) => !killedBy.has(n));

console.log("\n── 审计结论");
console.log(`变异总数 ${MUTATIONS.length}；覆盖测试 ${killedBy.size}/${allTests.size}`);
if (crashedNote.length) console.log(`套件崩溃（非断言式失败）: ${crashedNote.join(", ")}`);
if (ineffective.length) console.log(`✗ 无效变异: ${ineffective.join(", ")}`);
if (uncovered.length) console.log(`✗ 从未变红（装饰品嫌疑）: ${uncovered.join(", ")}`);
if (!ineffective.length && !uncovered.length) console.log("✓ 全部测试都被证明会红，全部变异都杀死了测试");
fs.rmSync(MUTATED, { force: true });
fs.rmSync(AUDIT_DIR, { recursive: true, force: true });
process.exit(ineffective.length || uncovered.length ? 1 : 0);
