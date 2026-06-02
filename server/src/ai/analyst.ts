/**
 * Analyst agent — turns a raw test failure into a human explanation.
 *
 * Manual testers don't read stack traces. The Analyst reads the failing step,
 * the error output, and the flow context, then explains the likely root cause
 * in plain language and suggests a next action (heal, fix data, real bug).
 */
import { complete, MODELS } from "./client.js";
import type { Flow } from "../flowSchema.js";

const SYSTEM = `You are the Analyst agent for VisualFlow.
Given a failing test step and its error output, explain in plain language what
went wrong and what the QA should do next. Be concise (2-4 sentences). Classify
the cause as one of: "selector", "timing", "assertion", "data", "real-bug",
"environment". Start your reply with "Cause: <category>".`;

export interface AnalysisResult {
  text: string;
  live: boolean;
}

function mockAnalysis(error: string): string {
  const e = error.toLowerCase();
  if (e.includes("locator") || e.includes("selector") || e.includes("not found")) {
    return "Cause: selector\nThe element the step targets could not be found on the page. The UI likely changed (a label or button was renamed). Try running the Healer on this step to suggest an updated locator.";
  }
  if (e.includes("timeout") || e.includes("exceeded")) {
    return "Cause: timing\nThe step timed out waiting for the page. The app may be slow to load or the element appears only after an async action. Add a preceding assertion that the page is ready, or increase the wait.";
  }
  if (e.includes("expect") || e.includes("tohavetext") || e.includes("tobevisible")) {
    return "Cause: assertion\nThe page loaded but the expected value didn't match. Confirm the expected text/state in the assertion is still correct — this may be a genuine regression worth filing.";
  }
  return "Cause: environment\nThe test failed before exercising app logic. Check that the base URL is reachable and the test environment is up.";
}

export async function analyzeFailure(
  flow: Flow,
  stepLabel: string,
  errorOutput: string
): Promise<AnalysisResult> {
  const { text, live } = await complete({
    model: MODELS.analyst,
    system: SYSTEM,
    user: `Flow: ${flow.name}\nFailing step: ${stepLabel}\n\nError output:\n${errorOutput.slice(0, 4000)}`,
    maxTokens: 512,
    mock: () => mockAnalysis(errorOutput),
  });
  return { text, live };
}
