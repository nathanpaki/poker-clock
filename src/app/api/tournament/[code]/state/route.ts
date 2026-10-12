import { NextResponse } from "next/server";
import { normalizeCode } from "@/lib/code";
import { getPublicSnapshot } from "@/server/tournament-state";

export const dynamic = "force-dynamic";

/**
 * Read-only polling endpoint for displays. Returns the authoritative state plus
 * `serverNow` so clients can correct for clock skew. Knowing a code grants
 * viewing only — every write requires a Clerk session and server-side checks.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const snap = await getPublicSnapshot(code);
    if (!snap) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(snap, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 });
  }
}
