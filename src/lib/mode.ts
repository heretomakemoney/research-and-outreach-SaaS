// AI MODE: "mock" or "live".
//
//   live - the stage routes call Anthropic (paid).
//   mock - the stage routes answer from a saved sample (src/fixtures). The Anthropic client is never
//          created, so no paid call can happen, whatever keys are present.
//
// Which one is used:
//   1. AI_MODE=live | mock, if set (an unrecognised value counts as mock: the safe choice);
//   2. otherwise production builds (Vercel deployments) are live, and everything else
//      (`npm run dev`, tests) is mock.
//
// So local development cannot spend money by accident, and a deployed site behaves exactly as before
// unless you set AI_MODE=mock on it (for example for Vercel Preview deployments).
//
// No server-only imports: used by server code, the layout banner and tests.

export type AiMode = "mock" | "live";

type Env = Record<string, string | undefined>;

export function aiMode(env: Env = process.env): AiMode {
  const explicit = env.AI_MODE?.trim().toLowerCase();
  if (explicit === "live" || explicit === "mock") return explicit;
  if (explicit) return "mock";
  return env.NODE_ENV === "production" ? "live" : "mock";
}

/** How long mock stages pretend to work, so progress screens can be seen. MOCK_DELAY_MS=0 turns it off. */
export function mockDelayMs(env: Env = process.env): number {
  const n = Number(env.MOCK_DELAY_MS);
  if (env.MOCK_DELAY_MS === undefined || env.MOCK_DELAY_MS === "" || !Number.isFinite(n)) return 700;
  return Math.min(10_000, Math.max(0, Math.floor(n)));
}
