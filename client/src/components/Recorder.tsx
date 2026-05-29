import { useState } from "react";
import { api } from "../api";
import type { Step } from "../types";

/**
 * Option 1 from the product brief: a QA pastes a live URL and clicks Record.
 * The browser opens, they perform their steps, and the agent writes the test.
 * No application source code is required.
 */
export function Recorder({ onSteps, defaultUrl = "" }: { onSteps: (steps: Step[]) => void; defaultUrl?: string }) {
  const [url, setUrl] = useState(defaultUrl);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.startRecording(url);
      setSessionId(r.sessionId);
      if (r.mode !== "live") setNote(r.note ?? "Recording in headless-unavailable mode.");
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!sessionId) return;
    setBusy(true);
    try {
      await api.stopRecording(sessionId);
      const { steps, eventCount } = await api.refineRecording(sessionId);
      onSteps(steps);
      setNote(`Refined ${eventCount} recorded events into ${steps.length} steps.`);
      setSessionId(null);
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel recorder">
      <h2>① Record</h2>
      <p className="muted">Enter any live URL — no codebase access needed.</p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!sessionId} placeholder="https://your-app.com" />
      {!sessionId ? (
        <button className="primary" onClick={start} disabled={busy || !url}>
          {busy ? "Launching…" : "● Record"}
        </button>
      ) : (
        <button className="recording" onClick={stop} disabled={busy}>
          {busy ? "Refining…" : "■ Stop & Generate"}
        </button>
      )}
      {sessionId && <p className="muted live-dot">Recording session {sessionId} — interact in the launched browser.</p>}
      {note && <p className="note">{note}</p>}
    </div>
  );
}
