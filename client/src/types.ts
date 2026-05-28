// Mirror of the server Flow schema (client doesn't need zod validation).
export interface Locator {
  strategy: "role" | "text" | "label" | "placeholder" | "testid" | "css";
  value: string;
  name?: string;
  exact?: boolean;
  nth?: number;
}

export interface Step {
  id: string;
  label?: string;
  type: "navigate" | "click" | "fill" | "assert" | "apiCall" | "loop" | "if";
  url?: string;
  target?: Locator;
  text?: string;
  assertion?: {
    kind: "visible" | "hidden" | "text" | "url" | "count";
    target?: Locator;
    expected?: string | number;
  };
  children?: Step[];
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  baseUrl?: string;
  steps: Step[];
  createdAt: string;
  updatedAt: string;
}

export interface HealSuggestion {
  stepId: string;
  stepLabel?: string;
  oldLocator: Locator;
  suggestion: {
    locator: Locator;
    confidence: number;
    reason: string;
    live: boolean;
  };
}

export interface RunResult {
  status: "passed" | "failed" | "unavailable";
  durationMs: number;
  output: string;
  failedStep?: string;
  generatedCode: string;
  analysis?: string;
  healSuggestion?: HealSuggestion;
}
