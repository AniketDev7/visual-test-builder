import { useState } from "react";
import { api } from "../api";
import type { Flow, HealSuggestion, Locator, RunResult } from "../types";

function formatLocator(l: Locator): string {
  return l.name ? `${l.strategy}:${l.value}[${l.name}]` : `${l.strategy}:${l.value}`;
}

function HealCard({
  heal,
  flow,
  onApplied,
}: {
  heal: HealSuggestion;
  flow: Flow;
  onApplied: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  async function apply() {
    setApplying(true);
    try {
      const updatedSteps = flow.steps.map((s) =>
        s.id === heal.stepId ? { ...s, target: heal.suggestion.locator } : s
      );
      await api.applyFix(flow.id, updatedSteps);
      onApplied();
    } finally {
      setApplying(false);
    }
  }

  const pct = Math.round(heal.suggestion.confidence * 100);
  const confClass = pct >= 70 ? "high" : pct >= 40 ? "mid" : "low";

  return (
    <div className="heal-card">
      <div className="heal-header">
        <span className="heal-title">⚡ Healer suggestion</span>
        <span className={`conf-badge conf-${confClass}`}>{pct}% confident</span>
      </div>
      <div className="heal-locators">
        <div className="locator-row old">
          <span className="loc-label">Old</span>
          <code>{formatLocator(heal.oldLocator)}</code>
        </div>
        <div className="locator-row new">
          <span className="loc-label">New</span>
          <code>{formatLocator(heal.suggestion.locator)}</code>
        </div>
      </div>
      {heal.suggestion.reason && (
        <p className="heal-reason">{heal.suggestion.reason}</p>
      )}
      <div className="heal-actions">
        <button className="primary" onClick={apply} disabled={applying}>
          {applying ? "Applying…" : "Apply & Re-run"}
        </button>
        <button onClick={() => setDismissed(true)}>Dismiss</button>
      </div>
    </div>
  );
}

/** Run the flow and show pass/fail; on failure, the Analyst agent's plain-language reason
 *  and the Healer agent's locator suggestion with one-click apply + auto re-run. */
export function RunPanel({ flow }: { flow: Flow }) {
  const [result, setResult] = useState<RunResult | null>(null);
  const [code, setCode] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"result" | "code">("code");

  async function run() {
    setBusy(true);
    try {
      const r = await api.run(flow.id);
      setResult(r);
      setCode(r.generatedCode);
      setTab("result");
    } catch (e) {
      setResult({ status: "unavailable", durationMs: 0, output: String(e), generatedCode: code });
    } finally {
      setBusy(false);
    }
  }

  async function showCode() {
    setCode(await api.code(flow.id));
    setTab("code");
  }

  const badge =
    result?.status === "passed" ? "ok" : result?.status === "failed" ? "fail" : result ? "warn" : "";

  return (
    <div className="panel runpanel">
      <div className="runhead">
        <h2>Run & Code</h2>
        <div>
          <button onClick={showCode}>View code</button>
          <button className="primary" onClick={run} disabled={busy}>
            {busy ? "Running…" : "▶ Run"}
          </button>
        </div>
      </div>

      {result && (
        <div className={`status ${badge}`}>
          {result.status.toUpperCase()} · {result.durationMs} ms
        </div>
      )}

      <div className="tabs">
        <button className={tab === "code" ? "active" : ""} onClick={() => setTab("code")}>Generated Playwright</button>
        <button className={tab === "result" ? "active" : ""} onClick={() => setTab("result")} disabled={!result}>Output</button>
      </div>

      {tab === "code" && <pre className="code">{code || "Click “View code” to generate the Playwright script."}</pre>}
      {tab === "result" && result && (
        <div>
          {result.healSuggestion && (
            <HealCard heal={result.healSuggestion} flow={flow} onApplied={run} />
          )}
          {result.analysis && (
            <div className="analysis">
              <strong>🔎 Analyst</strong>
              <p>{result.analysis}</p>
            </div>
          )}
          <pre className="code">{result.output}</pre>
        </div>
      )}
    </div>
  );
}
