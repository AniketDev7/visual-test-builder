import express from "express";
import cors from "cors";
import { api } from "./routes.js";
import { recorderApi } from "./recorder.js";
import { AI_LIVE } from "./ai/client.js";

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" }));

app.use("/api", api);
app.use("/api/recorder", recorderApi);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`VisualFlow server on http://localhost:${port}`);
  console.log(`AI: ${AI_LIVE ? "LIVE (Anthropic key detected)" : "MOCK (no ANTHROPIC_API_KEY — using deterministic fallback)"}`);
});
