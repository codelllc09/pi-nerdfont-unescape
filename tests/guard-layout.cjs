#!/usr/bin/env node
/**
 * guard-layout.cjs — 结构守卫：确认每个测试文件"是它自己"。
 *
 * 判例（2026-10-29）：一次脚本化编辑把变异审计的内容整体写进了回归套件，
 * 于是 `npm test` 实际在跑审计，而且递归 spawn 自己——表现为"零输出卡死"
 * 和异常内存占用，排查了很久。这类事故的特征是文件身份错乱，所以这里用
 * 各自独有/绝不共有的标记做双向断言：既查"该有的在"，也查"不该有的不在"。
 *
 * 运行: node tests/guard-layout.cjs   （毫秒级，无子进程，无网络）
 */
const fs = require("fs");
const path = require("path");

// GUARD_DIR exists so this guard can be tested against a deliberately
// mismatched copy (a guard that cannot fail is decoration).
const DIR = process.env.GUARD_DIR || __dirname;
const T = (p) => fs.readFileSync(path.join(DIR, p), "utf8");
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) fail++;
};

const suite = T("test-nerdfont-unescape.cjs");
const tools = T("test-tools.cjs");
const audit = T("mutation-audit.cjs");
const review = T("gen-review.cjs");

// 1) 身份标记：每个文件都有自己独有的头部与结构
// Discriminators must be code, not prose: the audit legitimately mentions
// "const t = (name" inside its own identity preflight (a string literal), so a
// naive substring rule false-positives on itself (round 19).
const SUITE_CODE = 'require("./lib.cjs").jitiLoad()'; // only the suites load the extension like this
const AUDIT_CODE = "const MUTATIONS = ["; // only the audit declares the table
check("套件是回归套件", suite.includes("test-nerdfont-unescape.cjs — ") && suite.includes(SUITE_CODE), "缺套件头部或 lib 加载");
check("套件不包含审计驱动", !suite.includes(AUDIT_CODE) && !suite.includes("function runSuiteAsync"), "套件里出现了审计代码");
check("审计是变异审计", audit.includes("mutation-audit.cjs — ") && audit.includes(AUDIT_CODE), "缺审计头部或 MUTATIONS");
check("审计不包含回归套件", !audit.includes(SUITE_CODE), "审计里出现了套件代码");
check("工具套件是它自己", tools.includes("test-tools.cjs — ") && tools.includes(SUITE_CODE), "缺工具套件头部");
check("审查页生成器是它自己", review.includes("gen-review.cjs") && review.includes("const CASES"), "缺 gen-review 结构");

// 2) 互不相同的关切点必须各在一处（防止"复制粘贴式孪生"）
check("MUTATIONS 仅存在于审计", (suite.match(/const MUTATIONS/g) || []).length === 0);
check("t() 断言器存在于两个套件", [suite, tools].every((s) => s.includes("const t = (name")));

// 3) 每份测试文件恰好一个 shebang 且在首行
for (const [name, text] of Object.entries({ suite, tools, audit, review })) {
  const lines = text.split("\n");
  const shebangs = lines.filter((l) => l.startsWith("#!")).length;
  check(`${name}: 单个 shebang 且在首行`, shebangs === 1 && lines[0].startsWith("#!"), `shebangs=${shebangs}`);
}

// 4) 测试基建自身的可移植性（终极 review 判例 2026-10-29）
//    这两处缺陷在发布前真实存在过：硬编码 "<pi>/node_modules/jiti/..." 在
//    `npm install` 的提升布局下直接崩；把官方配置变量 PI_CODING_AGENT_DIR 当
//    安装目录用会让任何按文档设置它的用户跑不了测试。断言看**代码**，注释里
//    提到这些名字是允许的（第一版守卫被自己的注释绊倒——陷阱 #8）。
//    自证方式：复制 tests/ 到临时目录、注入缺陷，用 GUARD_DIR 指向副本，必须变红。
const libCode = T("lib.cjs").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("lib: 依赖经 Node 解析而非硬编码嵌套路径", !/path\.join\(\s*D\s*,\s*"node_modules\//.test(libCode));
check("lib: 安装目录只认 PI_NF_PI_ROOT（不劫持官方变量）",
  libCode.includes("PI_NF_PI_ROOT") && !libCode.includes("PI_CODING_AGENT_DIR"));
check("lib: 导出 resolveEntry 供套件复用", /module\.exports\s*=\s*\{[^}]*resolveEntry/.test(libCode));

// 5) 临时目录清扫（为什么在守卫里：它测的是测试基建，扩展变异杀不死，
//    放进套件里就会被审计标成"装饰品"）。两条断言方向相反，缺一不可：
//    只删不作为 → 第一条红；连新鲜的也删 → 第二条红。
{
  const os = require("os");
  const pth = require("path");
  const { sweepStaleTempDirs } = require("./lib.cjs");
  const stale = fs.mkdtempSync(pth.join(os.tmpdir(), "pi-nf-test-"));
  const fresh = fs.mkdtempSync(pth.join(os.tmpdir(), "pi-nf-test-"));
  const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
  fs.utimesSync(stale, threeHoursAgo, threeHoursAgo);
  sweepStaleTempDirs();
  check("清扫删除过期临时目录（SIGKILL 残留）", !fs.existsSync(stale));
  check("清扫保留新鲜临时目录（不动在跑的任务）", fs.existsSync(fresh));
  fs.rmSync(fresh, { recursive: true, force: true });
}

// 6) 视觉验证脚本的默认提示词必须完整：它曾在一处编辑中被截断成从半句开始，
//    模型于是跳过第 1 项（"该显示图标的地方确实是图标"）——最关键的判断。
//    静态检查，因为它测的是随包发布的文本，不是扩展行为。
{
  const py = fs.readFileSync(path.join(DIR, "vision-verify.py"), "utf8");
  const m = py.match(/DEFAULT_PROMPT = \(([\s\S]*?)\n\)/);
  const body = m ? m[1] : "";
  check("vision-verify 默认提示词完整（含 1) 与 2)）", /1\)[\s\S]*2\)/.test(body) && body.includes("豆腐块"));
}

console.log(fail ? `\n✗ 结构守卫失败 ${fail} 项` : "\n✓ 结构守卫通过（文件身份与结构完整）");
process.exit(fail ? 1 : 0);
