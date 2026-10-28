/**
 * lib.cjs — 测试共享基础设施：定位 pi 安装、加载被测扩展。
 *
 * Portability (GPT review 2026-10-28: tests must not hardcode user/version
 * paths). Resolution order:
 *   1. env PI_NF_PI_ROOT (explicit) — NOT PI_CODING_AGENT_DIR: that name is
 *      pi's documented CONFIG dir (~/.pi/agent), so reusing it made the suite
 *      abort for anyone who follows the docs (final review, 2026-10-29)
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
  if (process.env.PI_NF_PI_ROOT) {
    const p = process.env.PI_NF_PI_ROOT;
    const fs2 = require("fs");
    if (!fs2.existsSync(require("path").join(p, "dist/index.js"))) {
      throw new Error(`PI_NF_PI_ROOT (${p}) has no dist/index.js — wrong path?`);
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
  throw new Error("pi-coding-agent install dir not found; export PI_NF_PI_ROOT=/path/to/pi-coding-agent");
}

/** Build a tiny deterministic font so tests never depend on the workstation's
 * active terminal font, filename conventions, or installed Nerd Font version. */
function ensureTestCache() {
  // NEVER touch the production cache from a test or an ad-hoc probe: a probe
  // without PI_NF_CMAP_CACHE once rebuilt the user's real cmap.json from the
  // 2-font fixture, silently shrinking it from 932 ranges to 11 (round 19).
  // PI_NF_TEST_USE_REAL_CACHE=1 is the deliberate escape hatch.
  if (process.env.PI_NF_TEST_USE_REAL_CACHE === "1") return;
  if (process.env.PI_NF_CMAP_CACHE) return; // explicit isolated path already
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-nf-testcache-"));
  process.env.PI_NF_CMAP_CACHE = path.join(dir, "cmap.json");
  process.on("exit", () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
}

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
  const fontPath = path.join(parent, "fixture-main-v5.ttf");
  const altPath = path.join(parent, "fixture-alt-v5.ttf");
  if (!fs.existsSync(altPath) || !fs.existsSync(path.join(parent, "fixture-coll-v5.ttc"))) {
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
    // A real TTC: its faces SHARE one file handle, which is exactly the shape
    // that broke (closing a face killed the rest). Face 0 owns E900, face 1 E901.
    const ttcScript = String.raw`
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTCollection, TTFont
import os, sys, tempfile

def build(path, cp, name):
    order = [".notdef", name]
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({cp: name})
    glyphs = {}
    for g in order:
        pen = TTGlyphPen(None)
        if g != ".notdef":
            pen.moveTo((100, 100)); pen.lineTo((900, 100)); pen.lineTo((900, 900)); pen.lineTo((100, 900)); pen.closePath()
        glyphs[g] = pen.glyph()
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({g: (1000, 0) for g in order})
    fb.setupHorizontalHeader(ascent=900, descent=-100)
    fb.setupOS2(sTypoAscender=900, sTypoDescender=-100, usWinAscent=900, usWinDescent=100)
    fb.setupNameTable({"familyName": "Pi TTC " + name, "styleName": "Regular", "uniqueFontIdentifier": "PiTTC" + name, "fullName": "Pi TTC " + name, "psName": "PiTTC-" + name})
    fb.setupPost(); fb.setupMaxp(); fb.save(path)

d = tempfile.mkdtemp()
a, b = os.path.join(d, "f1.ttf"), os.path.join(d, "f2.ttf")
build(a, 0xE900, "ttc-face0"); build(b, 0xE901, "ttc-face1")
coll = TTCollection(); coll.fonts = [TTFont(a), TTFont(b)]; coll.save(sys.argv[1])
`;
    const rtc = spawnSync("python3", ["-c", ttcScript, path.join(parent, "fixture-coll-v5.ttc")], { encoding: "utf8" });
    if (rtc.status !== 0) throw new Error(`failed to build ttc fixture: ${(rtc.stderr || rtc.stdout).trim()}`);
  }
  // A DIRECTORY: also exercises recursive expansion + multi-font union
  process.env.PI_NF_FONT_PATHS = parent;
}

function extPath() {
  return process.env.EXT_PATH || path.join(__dirname, "..", "nerdfont-unescape.ts");
}

/**
 * Resolve a package entry the portable way: ask Node, from several anchors.
 *
 * Hardcoding `path.join(D, "node_modules/jiti/lib/jiti.mjs")` assumed the local
 * pi layout (deps nested under the pi package). `npm install` hoists deps to the
 * project root instead, so a clean clone failed with
 *   Cannot find module '.../pi-coding-agent/node_modules/jiti/lib/jiti.mjs'
 * — i.e. the package's own CI would have gone red on its first push
 * (final review, 2026-10-29). Anchors: this file, the pi install, the project.
 */
function resolveEntry(id, D) {
  const { createRequire } = require("module");
  const anchors = [
    path.join(__dirname, "noop.js"),
    path.join(path.dirname(__dirname), "noop.js"),
    path.join(D, "noop.js"),
  ];
  for (const a of anchors) {
    try {
      return createRequire(a).resolve(id);
    } catch {}
  }
  return null;
}

function jitiLoad() {
  ensureTestCache();
  ensureFixtureFont();
  const D = piRoot();
  const jitiEntry = resolveEntry("jiti", D);
  if (!jitiEntry) {
    throw new Error("jiti not found — npm install (the pi package depends on it) or set PI_NF_PI_ROOT");
  }
  const { createJiti } = require(jitiEntry);
  // Alias only what actually resolves. A path that does not exist here means a
  // different install layout, not a bug; unresolved ids fall through to jiti's
  // normal resolution instead of pointing at a missing file.
  const alias = {};
  for (const id of ["typebox", "@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-tui"]) {
    const hit = resolveEntry(id, D);
    if (hit) alias[id] = hit;
  }
  const load = createJiti(__filename, { interopDefault: true, alias });
  return load(extPath());
}

module.exports = { piRoot, extPath, jitiLoad, resolveEntry };
