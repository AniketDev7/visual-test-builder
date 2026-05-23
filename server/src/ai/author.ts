/**
 * Author agent — turns a plain-English instruction into validated flow steps.
 *
 * "Log in as admin, go to the dashboard, and check the revenue widget shows a value"
 *   -> [navigate, fill, fill, click, assert, ...]
 *
 * This is the barrier-lowering promise of the product: a manual tester describes
 * intent, the agent emits structured steps that the canvas can render and the
 * codegen can compile. We validate the model output against the Flow schema, so
 * a hallucinated/invalid step is rejected rather than silently shipped.
 */
import { nanoid } from "nanoid";
import { complete, extractJson, MODELS } from "./client.js";
import { parseSteps, type Step } from "../flowSchema.js";

const SYSTEM = `You are the Author agent for VisualFlow, a visual test builder.
Convert the user's plain-English testing intent into an array of test steps.

Each step is a JSON object. Allowed "type" values and their fields:
- navigate: { url }
- click:    { target }
- fill:     { target, text }
- assert:   { assertion }
- apiCall:  { api: { method, url, body?, expectStatus? } }
- loop:     { loop: { source: "dataset"|"range", count?: (integer ≥ 1), dataset?, as }, children: [...] }
- if:       { condition: { target, present }, children: [...] }

IMPORTANT: Never include "id" on any step — ids are injected automatically.
For loop steps with source "range", count must be a positive integer (≥ 1). Default to 3 if unknown.

A "target" is a locator: { strategy: "role"|"text"|"label"|"placeholder"|"testid"|"css", value, name?, exact?: boolean, nth?: number }.
Prefer resilient locators (role/label/text) over css.
When asserting a heading by name, always set exact: true to prevent substring matches (e.g. "Blog" matching "Archived Blogs").
When the user says "first X" or there may be multiple matching elements, set nth: 0 to target the first one (nth: 1 for second, etc.).
An "assertion" is one of:
  { kind: "visible"|"hidden", target }
  { kind: "text", target, expected }
  { kind: "url", expected }
  { kind: "count", target, expected }

Always set a short human-readable "label" on each step.
Respond with ONLY a JSON array of steps. No prose.`;

function mockSteps(instruction: string): string {
  // A believable, schema-valid flow so the UI works without an API key.
  const lower = instruction.toLowerCase();
  const steps: Omit<Step, "id">[] = [
    { type: "navigate", label: "Open the app", url: "/" },
  ];
  if (lower.includes("log in") || lower.includes("login") || lower.includes("sign in")) {
    steps.push(
      { type: "fill", label: "Enter username", target: { strategy: "label", value: "Username" }, text: "admin" },
      { type: "fill", label: "Enter password", target: { strategy: "label", value: "Password" }, text: "demo-password" },
      { type: "click", label: "Submit login", target: { strategy: "role", value: "button", name: "Sign in" } }
    );
  }
  steps.push({
    type: "assert",
    label: "Verify we landed",
    assertion: { kind: "visible", target: { strategy: "role", value: "heading" } },
  });
  return JSON.stringify(steps);
}

export interface AuthorResult {
  steps: Step[];
  live: boolean;
}

/** Recursively injects missing ids and clamps invalid loop counts throughout the tree. */
function injectIds(raw: unknown[]): unknown[] {
  return raw.map((s) => {
    const step: Record<string, unknown> = { id: nanoid(8), ...(s as Record<string, unknown>) };
    if (Array.isArray(step["children"])) {
      step["children"] = injectIds(step["children"] as unknown[]);
    }
    if (step["loop"] && typeof (step["loop"] as Record<string, unknown>)["count"] === "number") {
      const loop = step["loop"] as Record<string, unknown>;
      if ((loop["count"] as number) < 1) loop["count"] = 1;
    }
    return step;
  });
}

export async function authorSteps(instruction: string): Promise<AuthorResult> {
  const { text, live } = await complete({
    model: MODELS.author,
    system: SYSTEM,
    user: instruction,
    mock: () => mockSteps(instruction),
  });
  const raw = extractJson<unknown[]>(text);
  const steps = parseSteps(injectIds(raw));
  return { steps, live };
}
