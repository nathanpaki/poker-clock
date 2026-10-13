"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { blindStructures } from "@/db/schema";
import { run, UserError } from "@/lib/action-result";
import { requireLeagueAdmin, requireTournamentPermission } from "@/lib/auth";
import { id, name, structureInput } from "@/lib/validation";
import { tournamentLevels } from "@/server/tournament-create";
import { audit, isUniqueViolation } from "@/server/tournament-state";

/**
 * Saved blind structures belong to one league and are managed by league admins.
 * Every query is scoped by BOTH the structure id and the league id.
 */

const structureName = name.refine((n) => n.length <= 80, "Keep the name under 80 characters.");
const description = z.string().trim().max(300).optional().transform((s) => (s ? s : null));

const paths = (leagueId: string) => {
  revalidatePath(`/admin/leagues/${leagueId}/structures`);
  revalidatePath(`/admin/leagues/${leagueId}`);
};

async function clearDefault(tx: Tx, leagueId: string, except?: string) {
  await tx
    .update(blindStructures)
    .set({ isDefault: false })
    .where(and(eq(blindStructures.leagueId, leagueId), eq(blindStructures.isDefault, true), except ? ne(blindStructures.id, except) : undefined));
}

const nameTaken = (e: unknown, n: string) => {
  if (isUniqueViolation(e)) return new UserError(`A structure named "${n}" already exists in this league. Pick another name.`);
  return e;
};

export async function createStructure(input: { leagueId: string; name: string; description?: string; levels: z.input<typeof structureInput>; makeDefault?: boolean }) {
  return run(async () => {
    const v = z.object({ leagueId: id, name: structureName, description, levels: structureInput, makeDefault: z.boolean().default(false) }).parse(input);
    if (!v.levels.some((l) => l.kind === "level")) throw new UserError("Add at least one blind level.");
    const { userId } = await requireLeagueAdmin(v.leagueId);
    const created = await db
      .transaction(async (tx) => {
        if (v.makeDefault) await clearDefault(tx, v.leagueId);
        const [s] = await tx
          .insert(blindStructures)
          .values({ leagueId: v.leagueId, name: v.name, description: v.description, levels: v.levels, isDefault: v.makeDefault, createdBy: userId })
          .returning({ id: blindStructures.id });
        await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "structure.create", entityType: "blind_structure", entityId: s.id, data: { name: v.name, levels: v.levels.length } });
        return s;
      })
      .catch((e) => {
        throw nameTaken(e, v.name);
      });
    paths(v.leagueId);
    return { structureId: created.id };
  });
}

export async function updateStructure(input: { leagueId: string; structureId: string; name: string; description?: string; levels: z.input<typeof structureInput> }) {
  return run(async () => {
    const v = z.object({ leagueId: id, structureId: id, name: structureName, description, levels: structureInput }).parse(input);
    if (!v.levels.some((l) => l.kind === "level")) throw new UserError("Add at least one blind level.");
    const { userId } = await requireLeagueAdmin(v.leagueId);
    await db
      .transaction(async (tx) => {
        const res = await tx
          .update(blindStructures)
          .set({ name: v.name, description: v.description, levels: v.levels, updatedAt: new Date() })
          .where(and(eq(blindStructures.id, v.structureId), eq(blindStructures.leagueId, v.leagueId)))
          .returning({ id: blindStructures.id });
        if (!res.length) throw new UserError("Structure not found.");
        await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "structure.update", entityType: "blind_structure", entityId: v.structureId, data: { name: v.name, levels: v.levels.length } });
      })
      .catch((e) => {
        throw nameTaken(e, v.name);
      });
    paths(v.leagueId);
  });
}

/** Safe: tournaments hold their own copy of the levels, so deleting a structure changes no tournament. */
export async function deleteStructure(input: { leagueId: string; structureId: string }) {
  return run(async () => {
    const v = z.object({ leagueId: id, structureId: id }).parse(input);
    const { userId } = await requireLeagueAdmin(v.leagueId);
    await db.transaction(async (tx) => {
      const res = await tx
        .delete(blindStructures)
        .where(and(eq(blindStructures.id, v.structureId), eq(blindStructures.leagueId, v.leagueId)))
        .returning({ name: blindStructures.name, levels: blindStructures.levels });
      if (!res.length) throw new UserError("Structure not found.");
      // Keep the levels in the audit log so a deleted structure can be recreated.
      await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "structure.delete", entityType: "blind_structure", entityId: v.structureId, data: res[0] });
    });
    paths(v.leagueId);
  });
}

export async function setDefaultStructure(input: { leagueId: string; structureId: string | null }) {
  return run(async () => {
    const v = z.object({ leagueId: id, structureId: id.nullable() }).parse(input);
    const { userId } = await requireLeagueAdmin(v.leagueId);
    await db.transaction(async (tx) => {
      await clearDefault(tx, v.leagueId, v.structureId ?? undefined);
      if (v.structureId) {
        const res = await tx
          .update(blindStructures)
          .set({ isDefault: true })
          .where(and(eq(blindStructures.id, v.structureId), eq(blindStructures.leagueId, v.leagueId)))
          .returning({ id: blindStructures.id });
        if (!res.length) throw new UserError("Structure not found.");
      }
      await audit(tx, { leagueId: v.leagueId, actorUserId: userId, action: "structure.set_default", entityType: "blind_structure", entityId: v.structureId });
    });
    paths(v.leagueId);
  });
}

/** Save a tournament's CURRENT blinds (from the database, not the browser) as a league structure. */
export async function saveTournamentAsStructure(input: { tournamentId: string; name: string; makeDefault?: boolean }) {
  return run(async () => {
    const v = z.object({ tournamentId: id, name: structureName, makeDefault: z.boolean().default(false) }).parse(input);
    const ctx = await requireTournamentPermission(v.tournamentId, "manage");
    const leagueId = ctx.tournament.leagueId;
    const created = await db
      .transaction(async (tx) => {
        const levels = await tournamentLevels(tx, v.tournamentId);
        if (!levels.length) throw new UserError("This tournament has no blind levels to save.");
        if (v.makeDefault) await clearDefault(tx, leagueId);
        const [s] = await tx
          .insert(blindStructures)
          .values({ leagueId, name: v.name, levels, isDefault: v.makeDefault, createdBy: ctx.userId, description: `Saved from ${ctx.tournament.name}` })
          .returning({ id: blindStructures.id });
        await audit(tx, { leagueId, tournamentId: v.tournamentId, actorUserId: ctx.userId, action: "structure.create_from_tournament", entityType: "blind_structure", entityId: s.id, data: { name: v.name } });
        return s;
      })
      .catch((e) => {
        throw nameTaken(e, v.name);
      });
    paths(leagueId);
    return { structureId: created.id };
  });
}
