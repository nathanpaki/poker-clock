import JSZip from "jszip";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { tournaments } from "@/db/schema";
import { AuthzError, requireLeagueAdmin } from "@/lib/auth";
import { formatInZone } from "@/lib/format";
import { id as idSchema } from "@/lib/validation";
import { generateTournamentExport } from "@/server/export";
import { audit } from "@/server/tournament-state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bulk export for league admins: one file per session, bundled in a ZIP. */
export async function GET(req: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const leagueId = idSchema.safeParse((await params).leagueId);
  if (!leagueId.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(req.url);
  const q = z
    .object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      ids: z.string().optional(),
      format: z.enum(["csv", "xlsx"]).default("csv"),
      history: z.enum(["0", "1"]).default("0"),
    })
    .safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });

  try {
    const { userId } = await requireLeagueAdmin(leagueId.data);
    const ids = q.data.ids?.split(",").filter(Boolean) ?? [];
    if (ids.some((x) => !idSchema.safeParse(x).success)) return NextResponse.json({ error: "Invalid tournament list" }, { status: 400 });
    const to = q.data.to ? new Date(q.data.to.getTime() + 86_399_999) : undefined;
    // Always constrained to THIS league — foreign IDs simply don't match.
    const list = await db
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(
        and(
          eq(tournaments.leagueId, leagueId.data),
          ids.length ? inArray(tournaments.id, ids) : undefined,
          q.data.from ? gte(tournaments.scheduledAt, q.data.from) : undefined,
          to ? lte(tournaments.scheduledAt, to) : undefined,
        ),
      )
      .orderBy(asc(tournaments.scheduledAt))
      .limit(200);
    if (!list.length) return NextResponse.json({ error: "No tournaments match those filters." }, { status: 404 });

    const zip = new JSZip();
    const names = new Set<string>();
    for (const t of list) {
      const f = await generateTournamentExport(t.id, q.data.format, q.data.history === "1");
      let name = f.filename;
      for (let i = 2; names.has(name); i++) name = f.filename.replace(/(\.\w+)$/, `-${i}$1`);
      names.add(name);
      zip.file(name, f.body);
    }
    const body = await zip.generateAsync({ type: "arraybuffer" });
    const stamp = formatInZone(new Date(), "UTC", false).slice(0, 10);
    await audit(db, { leagueId: leagueId.data, actorUserId: userId, action: "export.bulk_download", entityType: "league", entityId: leagueId.data, data: { count: list.length, format: q.data.format, tournamentIds: list.map((t) => t.id) } });
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="league-export_${stamp}.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    console.error(e);
    return NextResponse.json({ error: "Export failed. Try again." }, { status: 500 });
  }
}
