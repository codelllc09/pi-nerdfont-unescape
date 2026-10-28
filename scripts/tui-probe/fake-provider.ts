import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Registers a local, OpenAI-compatible endpoint as a selectable provider so the
// real TUI can render a deterministic assistant message (see run.sh).
export default function (pi: ExtensionAPI) {
  const port = process.env.TUI_PROBE_PORT || "8787";
  pi.registerProvider("tui-probe", {
    name: "TUI probe (local)",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "not-needed",
    api: "openai-completions",
    models: [
      {
        type: "chat",
        id: "fake-1",
        name: "Probe",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8000,
        maxTokens: 2000,
      },
    ],
  });
}
