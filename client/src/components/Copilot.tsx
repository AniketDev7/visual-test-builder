import { useState } from "react";
import { api } from "../api";
import type { Flow } from "../types";

/** The AI copilot — describe a test in English, the Author agent adds steps. */
export function Copilot({ flow, onFlow }: { flow: Flow; onFlow: (f: Flow) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function send() {
    const instruction = text.trim();
    if (!instruction) return;
    setBusy(true);
    setLog((l) => [...l, `🧑 ${instruction}`]);
    setText("");
    try {
      const { flow: updated, added, live } = await api.author(instruction, flow.id);
      onFlow(updated);
      setLog((l) => [...l, `🤖 Added ${added} step${added === 1 ? "" : "s"}${live ? "" : " (mock)"}.`]);
    } catch (e) {
      setLog((l) => [...l, `⚠️ ${String(e)}`]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel copilot">
      <h2>AI Copilot</h2>
      <div className="chatlog">
        {log.length === 0 && <p className="muted">Try: “log in as admin and verify the dashboard heading shows”.</p>}
        {log.map((line, i) => (
          <div key={i} className="chatline">{line}</div>
        ))}
      </div>
      <div className="composer">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          placeholder="Describe a test step in plain English…"
          rows={2}
        />
        <button className="primary" onClick={send} disabled={busy}>
          {busy ? "Thinking…" : "Author"}
        </button>
      </div>
    </div>
  );
}
