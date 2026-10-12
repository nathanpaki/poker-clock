import { NextResponse } from "next/server";
import { AuthzError, requireTournamentPermission } from "@/lib/auth";
import { id as idSchema } from "@/lib/validation";
import { generateTournamentExport } from "@/server/export";
import { audit } from "@/server/tournament-state";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const includeHistory = url.searchParams.get("history") === "1";
  try {
    const ctx = await requireTournamentPermission(parsed.data, "export");
    const file = await generateTournamentExport(ctx.tournament.id, format, includeHistory);
    await audit(db, {
      leagueId: ctx.tournament.leagueId,
      tournamentId: ctx.tournament.id,
      actorUserId: ctx.userId,
      action: "export.download",
      entityType: "tournament",
      entityId: ctx.tournament.id,
      data: { format, includeHistory, filename: file.filename },
    });
    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    console.error(e);
    return NextResponse.json({ error: "Export failed. Try again." }, { status: 500 });
  }
}
