// Loads our intelligence files from docs/intelligence/ and turns them into
// the "system prompt" that Claude receives.
//
// The markdown files are sent WORD FOR WORD. Edit a file and the next
// research call behaves differently, with no code change.

import "server-only"; // building this file into browser code is a build error
import fs from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";

const RULES_DIR = path.join(process.cwd(), "docs", "intelligence");

export interface RuleFile {
  name: string;
  text: string;
}

export async function loadRules(fileNames: readonly string[]): Promise<RuleFile[]> {
  return Promise.all(
    fileNames.map(async (name) => ({
      name,
      text: await fs.readFile(path.join(RULES_DIR, name), "utf-8"),
    })),
  );
}

/**
 * System prompt = [stage instructions] + [the rule files].
 * The last block is marked cacheable, so repeat calls re-read it at a
 * fraction of the normal input price (prompt caching).
 */
export function buildSystemPrompt(
  instructions: string,
  rules: RuleFile[],
): Anthropic.TextBlockParam[] {
  const rulesText = rules
    .map((r) => `===== BEGIN ${r.name} =====\n${r.text}\n===== END ${r.name} =====`)
    .join("\n\n");

  return [
    { type: "text", text: instructions },
    {
      type: "text",
      text: `THE INTELLIGENCE RULES\n\n${rulesText}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}
