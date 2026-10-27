/**
 * lib.cjs — 测试共享基础设施：定位 pi 安装、加载被测扩展。
 *
 * 可移植性（GPT 评审 2026-10-28 判例：测试不得硬编码用户名/版本路径）：
 *   ① env PI_CODING_AGENT_DIR 显式指定
 *   ② ~/.local/share/pi-node/current（pi update 维护的稳定符号链接）
 *   ③ ~/.local/share/pi-node 下 node-v 开头的版本目录降序扫描（写法避开
 *      注释内 “星号斜杠” 提前闭合——陷阱家族 #5 判例）
 *   全部落空 → 明确报错退出，绝不静默跑错对象
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

function piRoot() {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
  const base = path.join(os.homedir(), ".local/share/pi-node");
  const candidates = [path.join(base, "current/lib/node_modules/@earendil-works/pi-coding-agent")];
  if (fs.existsSync(base)) {
    const vers = fs.readdirSync(base).filter((d) => /^node-v/.test(d)).sort().reverse();
    for (const v of vers) candidates.push(path.join(base, v, "lib/node_modules/@earendil-works/pi-coding-agent"));
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "dist/index.js"))) return c;
  }
  throw new Error("pi-coding-agent 安装目录未找到；请 export PI_CODING_AGENT_DIR=/path/to/pi-coding-agent");
}

function extPath() {
  return process.env.EXT_PATH || path.join(__dirname, "..", "nerdfont-unescape.ts");
}

function jitiLoad() {
  const D = piRoot();
  const { createJiti } = require(path.join(D, "node_modules/jiti/lib/jiti.mjs"));
  const load = createJiti(__filename, {
    interopDefault: true,
    alias: {
      "@earendil-works/pi-ai": path.join(D, "node_modules/@earendil-works/pi-ai/dist"),
      "@earendil-works/pi-coding-agent": path.join(D, "dist/index.js"),
      "@earendil-works/pi-tui": path.join(D, "node_modules/@earendil-works/pi-tui/dist/index.js"),
      typebox: path.join(D, "node_modules/typebox/build/index.mjs"),
    },
  });
  return load(extPath());
}

module.exports = { piRoot, extPath, jitiLoad };
