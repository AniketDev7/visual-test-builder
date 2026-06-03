/**
 * Healer agent — self-healing selectors.
 *
 * When a step's locator no longer matches (the dev renamed a button, changed a
 * label), a brittle test just fails. The Healer takes the broken locator plus a
 * snapshot of the current accessible elements on the page and proposes the most
 * likely replacement. Runs on a fast model because it fires on every miss.
 */
import { complete, extractJson, MODELS } from "./client.js";
import { LocatorSchema, type Locator } from "../flowSchema.js";

const SYSTEM = `You are the Healer agent for VisualFlow.
A test locator failed to match any element. Given the broken locator and a list
of currently-available elements (role, name, text, testid), choose the single
best replacement locator.

Respond with ONLY one JSON object:
{ "strategy": "role"|"text"|"label"|"placeholder"|"testid"|"css", "value": "...", "name": "..."?, "confidence": 0..1, "reason": "..." }`;

export interface Candidate {
  role?: string;
  name?: string;
  text?: string;
  testid?: string;
}

export interface HealResult {
  locator: Locator;
  confidence: number;
  reason: string;
  live: boolean;
}

function mockHeal(broken: Locator, candidates: Candidate[]): string {
  // Pick the candidate whose name/text is most similar to the broken value.
  const want = (broken.name ?? broken.value).toLowerCase();
  let best: Candidate | undefined;
  let bestScore = -1;
  for (const c of candidates) {
    const hay = `${c.name ?? ""} ${c.text ?? ""}`.toLowerCase();
    const score = hay.includes(want) || want.includes(hay.trim()) ? hay.length : 0;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best?.role) {
    return JSON.stringify({
      strategy: "role",
      value: best.role,
      name: best.name,
      confidence: bestScore > 0 ? 0.78 : 0.4,
      reason: "Closest matching accessible element by name similarity.",
    });
  }
  if (best?.testid) {
    return JSON.stringify({
      strategy: "testid",
      value: best.testid,
      confidence: 0.6,
      reason: "Fell back to a stable test id.",
    });
  }
  return JSON.stringify({ ...broken, confidence: 0.2, reason: "No confident match; kept original." });
}

export async function healLocator(broken: Locator, candidates: Candidate[]): Promise<HealResult> {
  const { text, live } = await complete({
    model: MODELS.healer,
    system: SYSTEM,
    user: `Broken locator:\n${JSON.stringify(broken)}\n\nAvailable elements:\n${JSON.stringify(
      candidates,
      null,
      2
    )}`,
    maxTokens: 512,
    mock: () => mockHeal(broken, candidates),
  });
  const parsed = extractJson<Locator & { confidence?: number; reason?: string }>(text);
  const locator = LocatorSchema.parse({
    strategy: parsed.strategy,
    value: parsed.value,
    name: parsed.name,
  });
  return {
    locator,
    confidence: parsed.confidence ?? 0.5,
    reason: parsed.reason ?? "",
    live,
  };
}
