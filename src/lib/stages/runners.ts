// Chooses the stage runners: LIVE (calls Anthropic, paid) or MOCK (saved sample, free).
// See src/lib/mode.ts for how the mode is decided.
//
// The mock code is loaded only in mock mode, and the live code only in live mode.
// This is the only live-side file that knows the mock code exists.

import "server-only";
import { aiMode } from "../mode";
import type { EmailRequest, runEmailStage } from "./email";
import type { runResearchStage } from "./research";
import type { runSynthesizeStage } from "./synthesize";

export interface Runners {
  mode: "mock" | "live";
  research: typeof runResearchStage;
  synthesize: typeof runSynthesizeStage;
  email: (req: EmailRequest) => ReturnType<typeof runEmailStage>;
}

export async function getRunners(): Promise<Runners> {
  if (aiMode() === "mock") {
    const mock = await import("../mock/stages");
    return { mode: "mock", research: mock.mockResearchStage, synthesize: mock.mockSynthesizeStage, email: mock.mockEmailStage };
  }
  const [research, synthesize, email] = await Promise.all([import("./research"), import("./synthesize"), import("./email")]);
  return { mode: "live", research: research.runResearchStage, synthesize: synthesize.runSynthesizeStage, email: email.runEmailStage };
}
