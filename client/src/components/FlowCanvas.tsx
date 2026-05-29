import type { Flow, Step } from "../types";

const ICONS: Record<Step["type"], string> = {
  navigate: "🌐",
  click: "👆",
  fill: "⌨️",
  assert: "✓",
  apiCall: "🔌",
  loop: "🔁",
  if: "❓",
};

function describe(step: Step): string {
  switch (step.type) {
    case "navigate":
      return step.url ?? "";
    case "click":
    case "fill":
      return locator(step) + (step.text ? ` ← "${step.text}"` : "");
    case "assert":
      return step.assertion ? `${step.assertion.kind} ${step.assertion.expected ?? ""}`.trim() : "";
    default:
      return "";
  }
}

function locator(step: Step): string {
  const t = step.target;
  if (!t) return "";
  return t.name ? `${t.strategy}:${t.value}[${t.name}]` : `${t.strategy}:${t.value}`;
}

/** The visual flow — a vertical sequence of step cards a QA can read at a glance. */
export function FlowCanvas({ flow, onMove, onDelete }: {
  flow: Flow;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="panel canvas">
      <h2>Flow · {flow.name}</h2>
      {flow.steps.length === 0 && <p className="muted">No steps yet. Record a session or ask the Copilot.</p>}
      <ol className="steps">
        {flow.steps.map((step, i) => (
          <li key={step.id} className={`stepcard type-${step.type}`}>
            <span className="icon">{ICONS[step.type]}</span>
            <div className="stepbody">
              <div className="steplabel">{step.label ?? step.type}</div>
              <div className="stepdetail">{describe(step)}</div>
            </div>
            <div className="stepactions">
              <button title="up" disabled={i === 0} onClick={() => onMove(step.id, -1)}>↑</button>
              <button title="down" disabled={i === flow.steps.length - 1} onClick={() => onMove(step.id, 1)}>↓</button>
              <button title="delete" onClick={() => onDelete(step.id)}>✕</button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
