/**
 * A thin wrapper over the Anthropic SDK that degrades gracefully.
 *
 * - If ANTHROPIC_API_KEY is set, we make real calls.
 * - If it isn't, we fall back to a deterministic mock so the whole app still
 *   runs in a demo / interview setting without burning tokens or needing a key.
 *
 * Model choice is intentional and shows the "right model for the job" instinct:
 *   - the Author agent reasons hard about intent -> use a frontier model,
 *   - the Healer runs on every flaky selector -> use a fast, cheap model.
 */
import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  author: "claude-opus-4-8",
  analyst: "claude-opus-4-8",
  healer: "claude-haiku-4-5-20251001",
} as const;

const apiKey = process.env.ANTHROPIC_API_KEY;
export const AI_LIVE = Boolean(apiKey);

const client = apiKey ? new Anthropic({ apiKey }) : null;

export interface CompleteOptions {
  model: string;
  system: string;
  user: string;
  /** Used only by the mock fallback to fabricate a believable answer. */
  mock: () => string;
  maxTokens?: number;
}

/**
 * Ask Claude for a completion. Returns the raw text. When no key is present,
 * returns the caller-supplied mock so downstream logic is identical.
 */
export async function complete(opts: CompleteOptions): Promise<{ text: string; live: boolean }> {
  if (!client) {
    return { text: opts.mock(), live: false };
  }
  const resp = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, live: true };
}

/** Pull the first JSON value out of a model response (handles ```json fences). */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in model response");
  // Walk to the matching close bracket to tolerate trailing prose.
  const open = candidate[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === open) depth++;
    else if (candidate[i] === close) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1)) as T;
    }
  }
  throw new Error("Unbalanced JSON in model response");
}
