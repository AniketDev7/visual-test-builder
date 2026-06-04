/**
 * VisualFlow MCP server.
 *
 * This is "option 2": instead of (or alongside) VisualFlow's own AI agents,
 * Claude running inside an IDE becomes the agent. The IDE connects to this MCP
 * server, which exposes VisualFlow as a set of tools. Claude can then:
 *   - start a recording against a live URL,
 *   - refine recorded events into a flow,
 *   - author steps from natural language,
 *   - generate Playwright code, run a flow, and heal broken selectors.
 *
 * It's a thin bridge to the running VisualFlow HTTP server, so all the logic
 * lives in one place and both the web UI and Claude drive the same engine.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.VISUALFLOW_URL ?? "http://localhost:4000";

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "visualflow", version: "0.1.0" });

server.tool(
  "list_flows",
  "List all saved VisualFlow test flows.",
  {},
  async () => ok(await call("/api/flows"))
);

server.tool(
  "author_flow",
  "Turn a plain-English testing instruction into structured, schema-valid test steps. Optionally append them to an existing flow by id.",
  { instruction: z.string(), flowId: z.string().optional() },
  async ({ instruction, flowId }) => {
    const path = flowId ? `/api/flows/${flowId}/ai/author` : "/api/ai/author";
    return ok(await call(path, { method: "POST", body: JSON.stringify({ instruction }) }));
  }
);

server.tool(
  "start_recording",
  "Open a live browser at the given URL and begin recording QA actions (clicks, typing, navigation). No application source code is required.",
  { url: z.string().url() },
  async ({ url }) => ok(await call("/api/recorder/start", { method: "POST", body: JSON.stringify({ url }) }))
);

server.tool(
  "stop_recording",
  "Stop a recording session and return the raw captured events.",
  { sessionId: z.string() },
  async ({ sessionId }) => ok(await call(`/api/recorder/${sessionId}/stop`, { method: "POST" }))
);

server.tool(
  "refine_recording",
  "Convert a recording's raw events into a clean, labelled test flow with suggested assertions.",
  { sessionId: z.string() },
  async ({ sessionId }) => ok(await call(`/api/recorder/${sessionId}/refine`, { method: "POST" }))
);

server.tool(
  "generate_code",
  "Generate the Playwright test source for a saved flow.",
  { flowId: z.string() },
  async ({ flowId }) => ok(await call(`/api/flows/${flowId}/code`))
);

server.tool(
  "run_flow",
  "Run a saved flow with Playwright and return pass/fail, output, and (on failure) an AI root-cause analysis.",
  { flowId: z.string() },
  async ({ flowId }) => ok(await call(`/api/flows/${flowId}/run`, { method: "POST" }))
);

server.tool(
  "heal_selector",
  "Given a broken locator and the elements currently on the page, propose the best replacement locator.",
  {
    broken: z.object({ strategy: z.string(), value: z.string(), name: z.string().optional() }),
    candidates: z.array(z.record(z.unknown())),
  },
  async ({ broken, candidates }) =>
    ok(await call("/api/ai/heal", { method: "POST", body: JSON.stringify({ broken, candidates }) }))
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`VisualFlow MCP server connected (bridging ${BASE})`);
