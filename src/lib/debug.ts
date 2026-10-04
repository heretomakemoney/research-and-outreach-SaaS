// Development helper: keep the raw output of each stage in ./debug/ (git-ignored)
// so we can inspect exactly what Claude returned and turn real responses into
// test fixtures later. The product never reads these files. The API key is not
// part of any response, so it is never written here.
//
// Off on hosting platforms with read-only disks: a failed write is only a warning.

import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

export async function saveDebugCopy(stage: string, companyName: string, payload: unknown): Promise<void> {
  if (process.env.SAVE_DEBUG_RUNS !== "true") return;
  try {
    const dir = path.join(process.cwd(), "debug");
    await fs.mkdir(dir, { recursive: true });
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(path.join(dir, `${stamp}-${stage}-${slug}.json`), JSON.stringify(payload, null, 2));
  } catch (error) {
    console.warn("Could not write debug copy:", error);
  }
}
