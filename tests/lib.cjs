/**
 * lib.cjs — 测试共享基础设施：定位 pi 安装、加载被测扩展。
 *
 * Portability (GPT review 2026-10-28: tests must not hardcode user/version
 * paths). Resolution order:
 *   1. env PI_CODING_AGENT_DIR (explicit)
 *   2. ~/.local/share/pi-node/current (stable symlink maintained by pi update)
 *   3. node-v* version dirs under pi-node, newest first (phrased to avoid an
 *      early "star slash" comment close — trap-family case #5)
 * All missing → fail loudly, never silently test the wrong target.
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
  throw new Error("pi-coding-agent install dir not found; export PI_CODING_AGENT_DIR=/path/to/pi-coding-agent");
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
