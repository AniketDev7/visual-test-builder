import type { Flow, RunResult, Step } from "./types";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch("/api/health").then(j<{ ok: boolean; aiLive: boolean }>),
  listFlows: () => fetch("/api/flows").then(j<Flow[]>),
  getFlow: (id: string) => fetch(`/api/flows/${id}`).then(j<Flow>),
  updateFlow: (id: string, patch: Partial<Flow>) =>
    fetch(`/api/flows/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<Flow>),
  createFlow: (name: string, baseUrl?: string) =>
    fetch("/api/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, baseUrl }),
    }).then(j<Flow>),
  code: (id: string) => fetch(`/api/flows/${id}/code`).then((r) => r.text()),
  run: (id: string) => fetch(`/api/flows/${id}/run`, { method: "POST" }).then(j<RunResult>),
  applyFix: (id: string, steps: Step[]) =>
    fetch(`/api/flows/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steps }),
    }).then(j<Flow>),
  author: (instruction: string, flowId: string) =>
    fetch(`/api/flows/${flowId}/ai/author`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction }),
    }).then(j<{ flow: Flow; added: number; live: boolean }>),

  // Recorder
  startRecording: (url: string) =>
    fetch("/api/recorder/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }).then(j<{ sessionId: string; status: string; mode: string; note?: string }>),
  stopRecording: (sessionId: string) =>
    fetch(`/api/recorder/${sessionId}/stop`, { method: "POST" }).then(j<{ id: string; events: unknown[] }>),
  refineRecording: (sessionId: string) =>
    fetch(`/api/recorder/${sessionId}/refine`, { method: "POST" }).then(j<{ steps: Step[]; eventCount: number }>),
};
