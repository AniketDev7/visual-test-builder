/**
 * Runner: writes the generated Playwright script to a temp project and executes
 * it, streaming back a structured result. Resilient by design — if Playwright
 * isn't installed in the environment, we report that clearly instead of crashing,
 * so the rest of the product (build, AI, codegen) still demos.
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join, resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlaywright, generatePlaywrightForRun } from "./codegen.js";
import type { Flow, Locator } from "./flowSchema.js";
import type { Candidate } from "./ai/healer.js";

// Specs live inside the project tree so Node's module resolution walks up to
// node_modules/@playwright/test naturally — no NODE_PATH gymnastics needed.
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolvePath(__dirname, "../..");
const runsDir = resolvePath(projectRoot, ".playwright-runs");
const playwrightBin = resolvePath(projectRoot, "node_modules", ".bin", "playwright");

/** Candidates + broken locator captured by the instrumented spec at failure time. */
export interface HealData {
  stepId: string;
  stepLabel?: string;
  brokenLocator: Locator;
  candidates: Candidate[];
}

export interface RunResult {
  status: "passed" | "failed" | "unavailable";
  durationMs: number;
  output: string;
  /** Best-effort label of the step that failed, for the Analyst agent. */
  failedStep?: string;
  generatedCode: string;
  /** Server-internal: populated when a locator failure is caught by the instrumented spec. */
  healData?: HealData;
}

export async function runFlow(flow: Flow): Promise<RunResult> {
  const displayCode = generatePlaywright(flow);
  const started = Date.now();

  let dir: string | undefined;
  try {
    await mkdir(runsDir, { recursive: true });
    dir = await mkdtemp(join(runsDir, "run-"));
    const healDataPath = join(dir, "heal-data.json");
    const runCode = generatePlaywrightForRun(flow, healDataPath);

    await writeFile(join(dir, "flow.spec.ts"), runCode, "utf8");
    await writeFile(
      join(dir, "playwright.config.ts"),
      `import { defineConfig } from '@playwright/test';
export default defineConfig({
  timeout: 30_000,
  use: { ${flow.baseUrl ? `baseURL: ${JSON.stringify(flow.baseUrl)}, ` : ""}headless: true },
  reporter: 'line',
});\n`,
      "utf8"
    );

    const result = await exec(playwrightBin, ["test", "--reporter=line"], dir);

    if (result.code === 127 || /not found|cannot find module|is not recognized/i.test(result.output)) {
      return {
        status: "unavailable",
        durationMs: Date.now() - started,
        output:
          "Playwright is not installed in this environment. The generated test is shown below — install Playwright (`npx playwright install`) to execute it.",
        generatedCode: displayCode,
      };
    }

    // Read heal data written by the instrumented spec on locator failure
    let healData: HealData | undefined;
    if (result.code !== 0) {
      try {
        const raw = await readFile(healDataPath, "utf8");
        healData = JSON.parse(raw) as HealData;
      } catch {
        // No heal data — failure wasn't a locator error (e.g. assertion, navigate)
      }
    }

    return {
      status: result.code === 0 ? "passed" : "failed",
      durationMs: Date.now() - started,
      output: result.output,
      failedStep: result.code === 0 ? undefined : guessFailedStep(runCode, result.output),
      generatedCode: displayCode,
      healData,
    };
  } catch (err) {
    return {
      status: "unavailable",
      durationMs: Date.now() - started,
      output: `Could not execute the test runner: ${(err as Error).message}`,
      generatedCode: displayCode,
    };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The generated code carries `// <label>` comments; map an error back to one. */
function guessFailedStep(code: string, output: string): string | undefined {
  const lines = code.split("\n");
  const errLine = output.match(/flow\.spec\.ts:(\d+)/);
  if (!errLine) return undefined;
  const n = Number(errLine[1]) - 1;
  for (let i = Math.min(n, lines.length - 1); i >= 0; i--) {
    const m = lines[i].match(/^\s*\/\/\s*(.+)$/);
    if (m && !m[1].startsWith("Generated") && !m[1].startsWith("Flow:") && !m[1].startsWith("base URL"))
      return m[1];
  }
  return undefined;
}

function exec(cmd: string, args: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(cmd, args, { cwd, env: process.env });
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("error", (e) => resolve({ code: 127, output: output + "\n" + e.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}
