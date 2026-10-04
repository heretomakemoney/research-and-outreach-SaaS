// The ONE place that chooses which retriever the research stages use.
// To try an external search provider later: write a new file that implements
// EvidenceRetriever and return it here.

import { anthropicWebTools } from "./anthropicWebTools";
import type { EvidenceRetriever } from "./types";

export function getRetriever(): EvidenceRetriever {
  return anthropicWebTools;
}
