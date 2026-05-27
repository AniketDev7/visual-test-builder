/**
 * Recorder — the "no codebase access" capture flow.
 *
 * A QA enters a live URL and clicks Record. We launch a real (headed) browser
 * at that URL and inject a listener that watches their clicks, typing, and
 * navigation. For every interaction we synthesize a *resilient* locator from
 * what's visible in the DOM/accessibility tree — role, accessible name,
 * placeholder, label, test-id, visible text — never from source code the QA
 * can't see. The Refiner agent then turns the raw event stream into a clean,
 * labelled Flow (deduped, with suggested assertions).
 *
 * Playwright is imported lazily so the server still builds and runs where
 * browsers aren't installed; in that case the endpoints report "unavailable".
 */
import { Router } from "express";
import { nanoid } from "nanoid";
import type { Locator, Step } from "./flowSchema.js";
import { complete, extractJson, MODELS } from "./ai/client.js";
import { parseSteps } from "./flowSchema.js";

interface RawEvent {
  action: "navigate" | "click" | "fill";
  locator?: Locator;
  url?: string;
  text?: string;
  ts: number;
}

interface Session {
  id: string;
  url: string;
  events: RawEvent[];
  browser?: any;
  status: "recording" | "stopped";
}

const sessions = new Map<string, Session>();

/**
 * Injected into the recorded page. Given a DOM element, it computes the most
 * resilient locator we can — this is the core QA value: stable selectors
 * without ever touching application source. Returned as a string so it can be
 * page.evaluate()'d / addInitScript()'d verbatim.
 */
const RECORDER_BOOTSTRAP = `
(() => {
  function accName(el) {
    return (el.getAttribute('aria-label')
      || el.getAttribute('alt')
      || el.getAttribute('title')
      || (el.textContent || '').trim()).slice(0, 80);
  }
  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const map = { a: 'link', button: 'button', input: 'textbox', select: 'combobox', textarea: 'textbox', h1:'heading', h2:'heading', h3:'heading' };
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button') return 'button';
    }
    return map[tag] || null;
  }
  function bestLocator(el) {
    const testid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa');
    if (testid) return { strategy: 'testid', value: testid };
    const role = roleOf(el);
    const name = accName(el);
    if (role && name) return { strategy: 'role', value: role, name };
    const ph = el.getAttribute('placeholder');
    if (ph) return { strategy: 'placeholder', value: ph };
    const id = el.getAttribute('id');
    if (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) {
      return { strategy: 'label', value: document.querySelector('label[for="' + CSS.escape(id) + '"]').textContent.trim() };
    }
    if (name) return { strategy: 'text', value: name };
    // last resort: a short css path
    if (id) return { strategy: 'css', value: '#' + id };
    return { strategy: 'css', value: el.tagName.toLowerCase() };
  }
  function send(ev) { try { window.__visualflowRecord(JSON.stringify(ev)); } catch (e) {} }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('a,button,[role],input,select,textarea,[onclick]') || e.target;
    send({ action: 'click', locator: bestLocator(el), ts: Date.now() });
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) {
      send({ action: 'fill', locator: bestLocator(el), text: el.value, ts: Date.now() });
    }
  }, true);
})();
`;

export const recorderApi = Router();

recorderApi.post("/start", async (req, res) => {
  const url = String(req.body?.url ?? "").trim();
  if (!url) return res.status(400).json({ error: "url required" });

  const session: Session = { id: nanoid(8), url, events: [{ action: "navigate", url, ts: Date.now() }], status: "recording" };

  try {
    const { chromium } = (await import("playwright")) as any;
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.exposeBinding("__visualflowRecord", (_src: unknown, payload: string) => {
      try {
        session.events.push(JSON.parse(payload));
      } catch {
        /* ignore malformed event */
      }
    });
    await page.addInitScript(RECORDER_BOOTSTRAP);
    await page.goto(url);
    session.browser = browser;
    sessions.set(session.id, session);
    res.json({ sessionId: session.id, status: "recording", mode: "live" });
  } catch (err) {
    // No browser available: still create the session so a QA can hand-add
    // events or drive it from the MCP/Claude side.
    sessions.set(session.id, session);
    res.json({
      sessionId: session.id,
      status: "recording",
      mode: "headless-unavailable",
      note: `Could not launch a browser here (${(err as Error).message}). Run the server on a machine with Playwright browsers installed, or push events via POST /api/recorder/:id/event.`,
    });
  }
});

/** Manually push an event (used by tests, the MCP server, or headless envs). */
recorderApi.post("/:id/event", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no such session" });
  s.events.push({ ts: Date.now(), ...req.body });
  res.json({ count: s.events.length });
});

recorderApi.get("/:id", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no such session" });
  res.json({ id: s.id, url: s.url, status: s.status, events: s.events });
});

recorderApi.post("/:id/stop", async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no such session" });
  s.status = "stopped";
  if (s.browser) await s.browser.close().catch(() => {});
  res.json({ id: s.id, events: s.events });
});

/**
 * Refiner: raw recorded events -> clean Flow steps. The agent dedupes noise,
 * writes friendly labels, and proposes assertions a human would have added.
 */
recorderApi.post("/:id/refine", async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no such session" });
  try {
    const steps = await refineEvents(s.events);
    res.json({ steps, eventCount: s.events.length });
  } catch (err) {
    res.status(502).json({ error: `Refiner failed: ${(err as Error).message}` });
  }
});

const REFINER_SYSTEM = `You are the Refiner agent for VisualFlow.
You receive a raw stream of recorded browser events (navigate/click/fill) with
synthesized locators. Produce a clean array of test steps:
- merge consecutive duplicate events,
- give each step a short human "label",
- after a meaningful action (login, add to cart, submit), insert a sensible
  "assert" step (visible/text/url) that a QA would naturally check.
Use the same step JSON shape as the input. Respond with ONLY a JSON array.`;

async function refineEvents(events: RawEvent[]): Promise<Step[]> {
  const { text } = await complete({
    model: MODELS.author,
    system: REFINER_SYSTEM,
    user: JSON.stringify(events, null, 2),
    mock: () => JSON.stringify(mockRefine(events)),
  });
  const raw = extractJson<unknown[]>(text);
  return parseSteps(raw.map((r) => ({ id: nanoid(8), ...(r as object) })));
}

/** Deterministic refine used when no API key is present. */
function mockRefine(events: RawEvent[]): Array<Omit<Step, "id">> {
  const out: Array<Omit<Step, "id">> = [];
  let last = "";
  for (const e of events) {
    const sig = JSON.stringify([e.action, e.locator, e.url]);
    if (sig === last) continue;
    last = sig;
    if (e.action === "navigate") out.push({ type: "navigate", label: `Go to ${e.url}`, url: e.url });
    else if (e.action === "click")
      out.push({ type: "click", label: `Click ${e.locator?.name ?? e.locator?.value ?? "element"}`, target: e.locator });
    else if (e.action === "fill")
      out.push({ type: "fill", label: `Type into ${e.locator?.value ?? "field"}`, target: e.locator, text: e.text });
  }
  if (out.length)
    out.push({ type: "assert", label: "Page settled after recording", assertion: { kind: "visible", target: { strategy: "role", value: "heading" } } });
  return out;
}
