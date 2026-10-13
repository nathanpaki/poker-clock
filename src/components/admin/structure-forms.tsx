"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createStructure, deleteStructure, setDefaultStructure, updateStructure } from "@/actions/structures";
import { Button, Field, Input } from "@/components/ui";
import { Feedback, useAction } from "@/components/ui/use-action";
import type { LevelInput } from "@/lib/validation";
import { exportStructure, StructureEditor } from "./structure-editor";

export function SavedStructureForm({
  leagueId,
  structure,
  initialLevels,
}: {
  leagueId: string;
  structure?: { id: string; name: string; description: string | null; isDefault: boolean };
  initialLevels: LevelInput[];
}) {
  const router = useRouter();
  const { exec, pending, error, message } = useAction();
  const [name, setName] = useState(structure?.name ?? "");
  const [description, setDescription] = useState(structure?.description ?? "");
  const [makeDefault, setMakeDefault] = useState(false);
  const isNew = !structure;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Friday 20-minute" required /></Field>
        <Field label="Notes (optional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Starting stack, who it's for…" /></Field>
      </div>
      {isNew && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="h-4 w-4 accent-amber" />Use this for new tournaments by default</label>
      )}
      <StructureEditor
        initial={initialLevels}
        exportName={name || "blinds"}
        saving={pending}
        saveLabel={isNew ? "Create structure" : "Save structure"}
        onImportedName={(n) => !name && setName(n)}
        onSave={(levels, markSaved) => {
          if (!name.trim()) return exec(async () => ({ ok: false as const, error: "Give the structure a name first." }), { refresh: false });
          if (isNew)
            exec(() => createStructure({ leagueId, name, description, levels, makeDefault }), {
              refresh: false,
              onSuccess: () => {
                markSaved();
                router.push(`/admin/leagues/${leagueId}/structures`);
                router.refresh();
              },
            });
          else exec(() => updateStructure({ leagueId, structureId: structure.id, name, description, levels }), { success: "Saved. Tournaments created from now on get these blinds; existing tournaments keep theirs.", onSuccess: markSaved });
        }}
      />
      <Feedback error={error} message={message} />
    </div>
  );
}

export function StructureRowActions({
  leagueId,
  structure,
}: {
  leagueId: string;
  structure: { id: string; name: string; description: string | null; isDefault: boolean; levels: LevelInput[] };
}) {
  const { exec, pending, error } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        <Button variant="ghost" disabled={pending} onClick={() => exec(() => setDefaultStructure({ leagueId, structureId: structure.isDefault ? null : structure.id }))}>
          {structure.isDefault ? "Unset default" : "Make default"}
        </Button>
        <Button variant="ghost" onClick={() => exportStructure(structure.name, structure.levels, "csv")}>CSV</Button>
        <Button variant="ghost" onClick={() => exportStructure(structure.name, structure.levels, "json")}>JSON</Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            const n = prompt("Name for the copy:", `${structure.name} (copy)`);
            if (n) exec(() => createStructure({ leagueId, name: n, description: structure.description ?? undefined, levels: structure.levels }));
          }}
        >
          Duplicate
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => confirm(`Delete "${structure.name}"? Tournaments that already use these blinds keep them.`) && exec(() => deleteStructure({ leagueId, structureId: structure.id }))}
        >
          Delete
        </Button>
      </div>
      <Feedback error={error} />
    </div>
  );
}
