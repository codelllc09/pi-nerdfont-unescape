#!/usr/bin/env node
// Serves ONE canned assistant message over an OpenAI-compatible endpoint so a
// real pi TUI can be driven with zero model calls and zero cost.
const http = require("http");
const fs = require("fs");
const path = require("path");

const file = process.argv[2] || path.join(__dirname, "message.txt");
// The message keeps its escapes as TEXT: that is the input the extension under
// test must post-process (a real model writes exactly this shape).
let CONTENT = fs.readFileSync(file, "utf8").replace(/\n$/, "");
// DROP_PUA=1 makes this server behave like the real model channel: BMP Private
// Use characters are silently REMOVED from the output (not mis-rendered). That
// is the defect this extension exists for, so the probe can reproduce it:
//   * protocol-compliant output (ASCII escapes) survives untouched;
//   * a raw PUA character vanishes and the extension cannot see it at all.
if (process.env.DROP_PUA === "1") {
  const before = CONTENT.length;
  CONTENT = CONTENT.replace(/[\uE000-\uF8FF]/g, "");
  console.error(`tui-probe: channel dropped ${before - CONTENT.length} PUA char(s)`);
}
const PORT = Number(process.env.TUI_PROBE_PORT || 8787);

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (!req.url.includes("chat/completions")) return void res.writeHead(404).end("no");
      const chunk = (delta, finish = null) =>
        res.write(`data: ${JSON.stringify({
          id: "tui-probe", object: "chat.completion.chunk", created: 0, model: "fake-1",
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      chunk({ role: "assistant", content: "" });
      for (let i = 0; i < CONTENT.length; i += 40) chunk({ content: CONTENT.slice(i, i + 40) });
      chunk({}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
    });
  })
  .listen(PORT, "127.0.0.1", () => console.error(`tui-probe fake model on 127.0.0.1:${PORT}`));
