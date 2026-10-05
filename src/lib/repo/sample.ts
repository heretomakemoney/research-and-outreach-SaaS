// Adds the sample accounts (Upper Hunter fixture + clearly fake accounts) to the database.
// MOCK DATA ONLY: refuses to run unless AI_MODE resolves to mock. Never used by live research.

import "server-only";
import { aiMode } from "../mode";
import type { PostgresRepository } from "./postgres";

export async function addSampleAccounts(repo: PostgresRepository): Promise<number> {
  if (aiMode() !== "mock") throw new Error("Sample accounts can only be added in mock mode (AI_MODE=mock).");
  const { buildSeedData } = await import("../mock/seed");
  return repo.importSample(buildSeedData());
}
