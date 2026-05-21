import { Router } from "express";
import { nanoid } from "nanoid";
import { store } from "./store.js";
import { FlowSchema, parseSteps } from "./flowSchema.js";
import type { Locator } from "./flowSchema.js";
import { generatePlaywright } from "./codegen.js";
import { runFlow } from "./runner.js";
import { authorSteps } from "./ai/author.js";
import { healLocator } from "./ai/healer.js";
import type { HealResult } from "./ai/healer.js";
import { analyzeFailure } from "./ai/analyst.js";
import { AI_LIVE } from "./ai/client.js";

interface HealSuggestion {
  stepId: string;
  stepLabel?: string;
  oldLocator: Locator;
  suggestion: HealResult;
}

export const api = Router();

api.get("/health", (_req, res) => {
  res.json({ ok: true, aiLive: AI_LIVE });
});

// --- Flow CRUD -----------------------------------------------------------
api.get("/flows", (_req, res) => res.json(store.list()));

api.get("/flows/:id", (req, res) => {
  const flow = store.get(req.params.id);
  if (!flow) return res.status(404).json({ error: "not found" });
  res.json(flow);
});

api.post("/flows", (req, res) => {
  const name = String(req.body?.name ?? "Untitled flow");
  res.status(201).json(store.create({ name, baseUrl: req.body?.baseUrl }));
});

api.put("/flows/:id", (req, res) => {
  const parsed = FlowSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const updated = store.update(req.params.id, parsed.data);
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

api.delete("/flows/:id", (req, res) => {
  res.json({ deleted: store.remove(req.params.id) });
});

// --- Codegen + run -------------------------------------------------------
api.get("/flows/:id/code", (req, res) => {
  const flow = store.get(req.params.id);
  if (!flow) return res.status(404).json({ error: "not found" });
  res.type("text/plain").send(generatePlaywright(flow));
});

api.post("/flows/:id/run", async (req, res) => {
  const flow = store.get(req.params.id);
  if (!flow) return res.status(404).json({ error: "not found" });
  const result = await runFlow(flow);

  // Analyst explains why the test failed.
  let analysis: string | undefined;
  if (result.status === "failed") {
    const { text } = await analyzeFailure(flow, result.failedStep ?? "(unknown step)", result.output);
    analysis = text;
  }

  // Healer suggests a replacement locator when the instrumented spec captured a failure.
  let healSuggestion: HealSuggestion | undefined;
  if (result.status === "failed" && result.healData) {
    try {
      const suggestion = await healLocator(result.healData.brokenLocator, result.healData.candidates);
      healSuggestion = {
        stepId: result.healData.stepId,
        stepLabel: result.healData.stepLabel,
        oldLocator: result.healData.brokenLocator,
        suggestion,
      };
    } catch {
      // Healer failure is non-fatal — client just won't see a suggestion
    }
  }

  // Strip server-internal healData before sending to the client
  const { healData: _ignored, ...clientResult } = result;
  res.json({ ...clientResult, analysis, healSuggestion });
});

// --- AI agents -----------------------------------------------------------
api.post("/ai/author", async (req, res) => {
  const instruction = String(req.body?.instruction ?? "").trim();
  if (!instruction) return res.status(400).json({ error: "instruction required" });
  try {
    const result = await authorSteps(instruction);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Author agent failed: ${(err as Error).message}` });
  }
});

/** Append authored steps directly into a flow. */
api.post("/flows/:id/ai/author", async (req, res) => {
  const flow = store.get(req.params.id);
  if (!flow) return res.status(404).json({ error: "not found" });
  const instruction = String(req.body?.instruction ?? "").trim();
  if (!instruction) return res.status(400).json({ error: "instruction required" });
  try {
    const { steps, live } = await authorSteps(instruction);
    const updated = store.update(flow.id, { steps: [...flow.steps, ...steps] });
    res.json({ flow: updated, added: steps.length, live });
  } catch (err) {
    res.status(502).json({ error: `Author agent failed: ${(err as Error).message}` });
  }
});

api.post("/ai/heal", async (req, res) => {
  try {
    const { broken, candidates } = req.body ?? {};
    const result = await healLocator(broken, candidates ?? []);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Healer agent failed: ${(err as Error).message}` });
  }
});

// Validate an arbitrary step batch (used by the canvas before saving).
api.post("/validate/steps", (req, res) => {
  try {
    const steps = parseSteps((req.body?.steps ?? []).map((s: object) => ({ id: nanoid(8), ...s })));
    res.json({ valid: true, steps });
  } catch (err) {
    res.status(400).json({ valid: false, error: (err as Error).message });
  }
});
