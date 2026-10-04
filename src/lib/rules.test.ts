// Proves the intelligence files are loaded from disk at RUN TIME and sent
// word for word, and that no copy of their text is hard-coded in our prompts.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PIPELINE } from "./config.ts";
import { EMAIL_INSTRUCTIONS } from "./prompts/email.ts";
import { DISCOVER_INSTRUCTIONS, FOLLOWUP_INSTRUCTIONS } from "./prompts/research.ts";
import { SYNTHESIZE_INSTRUCTIONS } from "./prompts/synthesize.ts";
import { buildSystemPrompt, loadRules } from "./rules.ts";

const dir = path.join(process.cwd(), "docs", "intelligence");
const read = (name: string) => fs.readFileSync(path.join(dir, name), "utf-8");

test("each stage receives exactly the intelligence files it was assigned", () => {
  assert.deepEqual([...PIPELINE.discover.rulesFiles], ["01_RESEARCH_RULES.md", "02_TELTONIKA_RELEVANCE.md"]);
  assert.deepEqual([...PIPELINE.followup.rulesFiles], ["01_RESEARCH_RULES.md", "02_TELTONIKA_RELEVANCE.md"]);
  assert.deepEqual([...PIPELINE.synthesize.rulesFiles], ["01_RESEARCH_RULES.md", "02_TELTONIKA_RELEVANCE.md", "03_SALES_TRIGGERS.md"]);
  assert.deepEqual([...PIPELINE.email.rulesFiles], ["04_OUTREACH_RULES.md", "05_OUTREACH_EXAMPLES.md"]);
  for (const stage of Object.values(PIPELINE)) {
    assert.ok(!stage.rulesFiles.some((f) => f.startsWith("06_")), "the learning rules are never sent at runtime");
  }
});

test("the files are read from disk and sent word for word", async () => {
  for (const stage of Object.values(PIPELINE)) {
    const rules = await loadRules(stage.rulesFiles);
    const system = buildSystemPrompt("INSTRUCTIONS", rules);
    for (const r of rules) {
      assert.equal(r.text, read(r.name));
      assert.ok(system[1].text.includes(r.text), `${r.name} is included unchanged`);
    }
    assert.deepEqual(system[1].cache_control, { type: "ephemeral" }, "the rules block is the cacheable part");
    assert.equal(system[0].text, "INSTRUCTIONS");
  }
});

test("editing a rules file changes the next call, with no code change", async () => {
  const original = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
  try {
    fs.mkdirSync(path.join(tmp, "docs", "intelligence"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "docs", "intelligence", "01_RESEARCH_RULES.md"), "VERSION ONE");
    process.chdir(tmp);
    assert.equal((await loadRules(["01_RESEARCH_RULES.md"]))[0].text, "VERSION ONE");
    fs.writeFileSync(path.join(tmp, "docs", "intelligence", "01_RESEARCH_RULES.md"), "VERSION TWO");
    assert.equal((await loadRules(["01_RESEARCH_RULES.md"]))[0].text, "VERSION TWO");
  } finally {
    process.chdir(original);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("our stage instructions do not contain copies of the intelligence files", () => {
  const prompts = [DISCOVER_INSTRUCTIONS, FOLLOWUP_INSTRUCTIONS, SYNTHESIZE_INSTRUCTIONS, EMAIL_INSTRUCTIONS].map((p) =>
    p.replace(/\s+/g, " "),
  );
  let checked = 0;
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    for (const line of read(name).split("\n")) {
      const clean = line.replace(/\s+/g, " ").trim();
      if (clean.length < 50) continue;
      checked++;
      for (const prompt of prompts) assert.ok(!prompt.includes(clean), `hard-coded copy of a line from ${name}: ${clean.slice(0, 60)}`);
    }
  }
  assert.ok(checked > 50, "the scan really looked at the files");
});
