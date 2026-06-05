/**
 * The Flow Schema is the single source of truth for VisualFlow.
 *
 * Everything orbits this document:
 *   - the drag-and-drop canvas EDITS it,
 *   - the codegen COMPILES it into a Playwright script,
 *   - the AI agents READ and WRITE it (author new steps, heal selectors).
 *
 * Keeping the schema strict and typed is what lets a non-coder build a
 * complex end-to-end test safely: the GUI can only ever produce a valid flow.
 */
import { z } from "zod";

/** A locator strategy. We keep selectors structured (not raw strings) so the
 *  Healer agent can reason about and rewrite them when the UI changes. */
export const LocatorSchema = z.object({
  /** How we find the element. `role`/`text`/`label` are resilient; `css` is escape-hatch. */
  strategy: z.enum(["role", "text", "label", "placeholder", "testid", "css"]),
  value: z.string().min(1),
  /** Optional accessible-name filter when strategy is "role". */
  name: z.string().optional(),
  /** When true, the name/text must match exactly (not as a substring). Prevents strict-mode violations. */
  exact: z.boolean().optional(),
  /** 0-based index when multiple elements match — 0 = .first(), 1 = .nth(1), etc. */
  nth: z.number().int().nonnegative().optional(),
});
export type Locator = z.infer<typeof LocatorSchema>;

/** An assertion the test should check. */
export const AssertionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("visible"), target: LocatorSchema }),
  z.object({ kind: z.literal("hidden"), target: LocatorSchema }),
  z.object({ kind: z.literal("text"), target: LocatorSchema, expected: z.string() }),
  z.object({ kind: z.literal("url"), expected: z.string() }),
  z.object({ kind: z.literal("count"), target: LocatorSchema, expected: z.number().int().nonnegative() }),
]);
export type Assertion = z.infer<typeof AssertionSchema>;

// Steps can nest (loops, conditionals), so the schema is recursive. zod needs a
// lazy reference and an explicit type to model that.
export interface Step {
  id: string;
  /** Human-friendly label shown on the canvas card. */
  label?: string;
  type:
    | "navigate"
    | "click"
    | "fill"
    | "assert"
    | "apiCall"
    | "loop"
    | "if";
  // --- per-type params (only the relevant ones are set) ---
  url?: string;
  target?: Locator;
  text?: string;
  assertion?: Assertion;
  api?: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    url: string;
    body?: unknown;
    expectStatus?: number;
  };
  /** loop: data-driven iteration over rows; `as` binds each row to a variable. */
  loop?: {
    source: "dataset" | "range";
    dataset?: Record<string, unknown>[];
    count?: number;
    as: string;
  };
  /** if: a simple condition based on element presence. */
  condition?: { target: Locator; present: boolean };
  /** child steps for loop / if blocks. */
  children?: Step[];
}

export const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string().regex(/^[^\r\n]*$/).optional(),
    type: z.enum(["navigate", "click", "fill", "assert", "apiCall", "loop", "if"]),
    url: z.string().optional(),
    target: LocatorSchema.optional(),
    text: z.string().optional(),
    assertion: AssertionSchema.optional(),
    api: z
      .object({
        method: z.enum(["GET", "POST", "PUT", "DELETE"]),
        url: z.string(),
        body: z.unknown().optional(),
        expectStatus: z.number().int().optional(),
      })
      .optional(),
    loop: z
      .object({
        source: z.enum(["dataset", "range"]),
        dataset: z.array(z.record(z.unknown())).optional(),
        count: z.number().int().positive().optional(),
        as: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/, "must be a valid JS identifier"),
      })
      .optional(),
    condition: z.object({ target: LocatorSchema, present: z.boolean() }).optional(),
    children: z.array(StepSchema).optional(),
  })
);

export const FlowSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Base URL the flow runs against. */
  baseUrl: z.string().optional(),
  steps: z.array(StepSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Flow = z.infer<typeof FlowSchema>;

/** Parse + validate an untrusted object (e.g. AI output) into a Flow's steps. */
export function parseSteps(input: unknown): Step[] {
  return z.array(StepSchema).parse(input);
}
