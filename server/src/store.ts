/**
 * In-memory flow store. Swappable for a real DB later; the API doesn't care.
 * Ships with one seed flow so the canvas isn't empty on first load.
 */
import { nanoid } from "nanoid";
import type { Flow } from "./flowSchema.js";

const flows = new Map<string, Flow>();

function now() {
  return new Date().toISOString();
}

function seed(): Flow {
  return {
    id: nanoid(8),
    name: "My first flow",
    description: "Use the Copilot to describe your test in plain English, or hit Record.",
    baseUrl: "",
    steps: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

const first = seed();
flows.set(first.id, first);

export const store = {
  list(): Flow[] {
    return [...flows.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  get(id: string): Flow | undefined {
    return flows.get(id);
  },
  create(partial: Partial<Flow> & { name: string }): Flow {
    const flow: Flow = {
      id: nanoid(8),
      name: partial.name,
      description: partial.description,
      baseUrl: partial.baseUrl,
      steps: partial.steps ?? [],
      createdAt: now(),
      updatedAt: now(),
    };
    flows.set(flow.id, flow);
    return flow;
  },
  update(id: string, patch: Partial<Flow>): Flow | undefined {
    const existing = flows.get(id);
    if (!existing) return undefined;
    const updated: Flow = { ...existing, ...patch, id, updatedAt: now() };
    flows.set(id, updated);
    return updated;
  },
  remove(id: string): boolean {
    return flows.delete(id);
  },
};
