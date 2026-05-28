import { useEffect, useState } from "react";
import { api } from "./api";
import type { Flow, Step } from "./types";
import { Recorder } from "./components/Recorder";
import { Copilot } from "./components/Copilot";
import { FlowCanvas } from "./components/FlowCanvas";
import { RunPanel } from "./components/RunPanel";

export function App() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [aiLive, setAiLive] = useState<boolean | null>(null);

  useEffect(() => {
    api.health().then((h) => setAiLive(h.aiLive)).catch(() => setAiLive(false));
    api.listFlows().then((list) => {
      setFlows(list);
      if (list[0]) setFlow(list[0]);
    });
  }, []);

  async function persist(steps: Step[]) {
    if (!flow) return;
    const updated = await api.updateFlow(flow.id, { steps });
    setFlow(updated);
    setFlows((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  }

  async function appendRecorded(steps: Step[]) {
    if (!flow) return;
    await persist([...flow.steps, ...steps]);
  }

  function move(id: string, dir: -1 | 1) {
    if (!flow) return;
    const idx = flow.steps.findIndex((s) => s.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= flow.steps.length) return;
    const steps = [...flow.steps];
    [steps[idx], steps[j]] = [steps[j], steps[idx]];
    persist(steps);
  }

  function remove(id: string) {
    if (!flow) return;
    persist(flow.steps.filter((s) => s.id !== id));
  }

  async function newFlow() {
    const name = window.prompt("Flow name:", "Untitled flow");
    if (!name?.trim()) return;
    const created = await api.createFlow(name.trim());
    setFlows((prev) => [created, ...prev]);
    setFlow(created);
  }

  async function switchFlow(id: string) {
    const target = flows.find((f) => f.id === id);
    if (target) setFlow(target);
  }

  return (
    <div className="app">
      <header>
        <h1>VisualFlow</h1>
        <span className="tagline">AI-augmented visual test builder</span>
        {flows.length > 1 && (
          <select
            className="flow-switcher"
            value={flow?.id ?? ""}
            onChange={(e) => switchFlow(e.target.value)}
          >
            {flows.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
        <button className="new-flow-btn" onClick={newFlow}>＋ New Flow</button>
        <span className={`aibadge ${aiLive ? "live" : "mock"}`}>
          {aiLive == null ? "…" : aiLive ? "AI: live" : "AI: mock"}
        </span>
      </header>

      {!flow ? (
        <p className="loading">Loading flow…</p>
      ) : (
        <main>
          <section className="left">
            <Recorder key={flow.id} onSteps={appendRecorded} defaultUrl={flow.baseUrl ?? ""} />
            <Copilot flow={flow} onFlow={(updated) => {
              setFlow(updated);
              setFlows((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
            }} />
          </section>
          <section className="center">
            <FlowCanvas flow={flow} onMove={move} onDelete={remove} />
          </section>
          <section className="right">
            <RunPanel flow={flow} />
          </section>
        </main>
      )}
    </div>
  );
}
