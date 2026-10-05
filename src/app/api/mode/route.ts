// GET /api/mode: tells the browser whether the server is in mock mode (free, sample data) or live mode
// (real, paid Anthropic calls). Contains nothing secret.

import { aiMode } from "@/lib/mode";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, mode: aiMode() });
}
