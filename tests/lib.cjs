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
const { spawnSync } = require("child_process");

function piRoot() {
  if (process.env.PI_CODING_AGENT_DIR) {
    const p = process.env.PI_CODING_AGENT_DIR;
    const fs2 = require("fs");
    if (!fs2.existsSync(require("path").join(p, "dist/index.js"))) {
      throw new Error(`PI_CODING_AGENT_DIR (${p}) has no dist/index.js — wrong path?`);
    }
    return p;
  }
  const base = path.join(os.homedir(), ".local/share/pi-node");
  const candidates = [
    path.join(__dirname, "..", "node_modules/@earendil-works/pi-coding-agent"),
    path.join(base, "current/lib/node_modules/@earendil-works/pi-coding-agent"),
  ];
  if (fs.existsSync(base)) {
    const vers = fs.readdirSync(base).filter((d) => /^node-v/.test(d)).sort().reverse();
    for (const v of vers) candidates.push(path.join(base, v, "lib/node_modules/@earendil-works/pi-coding-agent"));
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "dist/index.js"))) return c;
  }
  throw new Error("pi-coding-agent install dir not found; export PI_CODING_AGENT_DIR=/path/to/pi-coding-agent");
}

/** Build a tiny deterministic font so tests never depend on the workstation's
 * active terminal font, filename conventions, or installed Nerd Font version. */
function ensureFixtureFont() {
  // Deterministic by default: a developer's real PI_NF_FONT_PATHS must not
  // silently change the fixtures under test. PI_NF_TEST_REAL_FONTS=1 opts out
  // for manual spot checks against the actual terminal chain.
  if (process.env.PI_NF_TEST_REAL_FONTS === "1" && process.env.PI_NF_FONT_PATHS) return;
  const parent = process.env.PI_NF_CMAP_CACHE
    ? path.dirname(process.env.PI_NF_CMAP_CACHE)
    : fs.mkdtempSync(path.join(os.tmpdir(), "pi-nf-font-fixture-"));
  if (!process.env.PI_NF_CMAP_CACHE && !ensureFixtureFont.cleaned) {
    ensureFixtureFont.cleaned = true;
    process.on("exit", () => { try { fs.rmSync(parent, { recursive: true, force: true }); } catch {} });
  }
  const fontPath = path.join(parent, "fixture-main-v4.ttf");
  const altPath = path.join(parent, "fixture-alt-v4.ttf");
  if (!fs.existsSync(altPath)) {
    const script = String.raw`
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
import sys
entries = {
  0xE235: "dev-python", 0xE0A0: "pl-branch", 0xE0B0: "pl-left-hard-divider", 0xF308: "dev-docker",
  0xE8DA: "dev-vscode", 0xF0399: "md-nodejs", 0xF0627: "md-lambda",
  0xE718: "dev-nodejs", 0xF0805: "md-microsoft-azure", 0xE777: "nf-dev-special"
}
order = [".notdef"] + list(entries.values())
fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap(entries)
glyphs = {}
for name in order:
    pen = TTGlyphPen(None)
    if name != ".notdef":
        pen.moveTo((100, 100)); pen.lineTo((900, 100)); pen.lineTo((900, 900)); pen.lineTo((100, 900)); pen.closePath()
    glyphs[name] = pen.glyph()
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({name: (1000, 0) for name in order})
fb.setupHorizontalHeader(ascent=900, descent=-100)
fb.setupOS2(sTypoAscender=900, sTypoDescender=-100, usWinAscent=900, usWinDescent=100)
fb.setupNameTable({"familyName": "Pi NF Test Fixture", "styleName": "Regular", "uniqueFontIdentifier": "PiNFTestFixture", "fullName": "Pi NF Test Fixture Regular", "psName": "PiNFTestFixture-Regular"})
fb.setupPost(); fb.setupMaxp(); fb.save(sys.argv[1])
`;
    const altScript = String.raw`
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
import sys
# Same codepoint under two competing family names: locks family priority and
# "nf-" prefix stripping without depending on installed fonts.
# E777/E778: family-priority fixture; 0x3B1 (alpha): an ordinary Unicode glyph
# that must NOT be smuggled through the icon protocol (honest-warning regression).
# 0xE777 is also mapped in fixture-main as "nf-dev-special": same codepoint,
# two family names → family priority is observable.
entries = {0xE777: "fa-special", 0x3B1: "alpha"}
order = [".notdef"] + list(entries.values())
fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap(entries)
glyphs = {}
for name in order:
    pen = TTGlyphPen(None)
    if name != ".notdef":
        pen.moveTo((100, 100)); pen.lineTo((900, 100)); pen.lineTo((900, 900)); pen.lineTo((100, 900)); pen.closePath()
    glyphs[name] = pen.glyph()
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({name: (1000, 0) for name in order})
fb.setupHorizontalHeader(ascent=900, descent=-100)
fb.setupOS2(sTypoAscender=900, sTypoDescender=-100, usWinAscent=900, usWinDescent=100)
fb.setupNameTable({"familyName": "Pi NF Test Fixture Alt", "styleName": "Regular", "uniqueFontIdentifier": "PiNFTestFixtureAlt", "fullName": "Pi NF Test Fixture Alt Regular", "psName": "PiNFTestFixtureAlt-Regular"})
fb.setupPost(); fb.setupMaxp(); fb.save(sys.argv[1])
`;
    const r = spawnSync("python3", ["-c", script, fontPath], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`failed to build test font fixture: ${(r.stderr || r.stdout).trim()}`);
    const ra = spawnSync("python3", ["-c", altScript, altPath], { encoding: "utf8" });
    if (ra.status !== 0) throw new Error(`failed to build alt fixture: ${(ra.stderr || ra.stdout).trim()}`);
  }
  // A DIRECTORY: also exercises recursive expansion + multi-font union
  process.env.PI_NF_FONT_PATHS = parent;
}

function extPath() {
  return process.env.EXT_PATH || path.join(__dirname, "..", "nerdfont-unescape.ts");
}

function jitiLoad() {
  ensureFixtureFont();
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
