"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, Input, Select } from "@/components/ui";
import { blindsToCsv, blindsToJson, parseBlindFile, summarizeStructure } from "@/lib/blind-file";
import { slugify } from "@/lib/format";
import type { LevelInput } from "@/lib/validation";

export type SavedStructureLite = { id: string; name: string; levels: LevelInput[]; isDefault: boolean };

export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportStructure(name: string, levels: LevelInput[], format: "csv" | "json") {
  const base = slugify(name || "blinds");
  if (format === "csv") downloadText(`${base}.csv`, blindsToCsv(levels), "text/csv;charset=utf-8");
  else downloadText(`${base}.json`, blindsToJson(name, levels), "application/json");
}

/**
 * Edits a list of levels in the browser. Nothing is saved until the parent's
 * onSave runs. Import and "Load saved" only replace what's in the editor.
 */
export function StructureEditor({
  initial,
  exportName,
  onSave,
  saving,
  saveLabel = "Save structure",
  currentIndex = -1,
  saved = [],
  footer,
  onImportedName,
}: {
  initial: LevelInput[];
  exportName: string;
  /** Call markSaved() only after the server confirms the save. */
  onSave: (levels: LevelInput[], markSaved: () => void) => void;
  saving: boolean;
  saveLabel?: string;
  currentIndex?: number;
  saved?: SavedStructureLite[];
  footer?: ReactNode;
  onImportedName?: (name: string) => void;
}) {
  const [levels, setLevels] = useState<LevelInput[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const replace = (next: LevelInput[], text: string) => {
    if (dirty && !confirm("Replace the levels you've edited but not saved?")) return;
    setLevels(next);
    setDirty(true);
    setNote({ tone: "ok", text });
  };
  const change = (next: LevelInput[]) => {
    setLevels(next);
    setDirty(true);
    setNote(null);
  };
  const up = (i: number, patch: Partial<LevelInput>) => change(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= levels.length) return;
    const next = [...levels];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };
  const addLevel = () => {
    const last = [...levels].reverse().find((l) => l.kind === "level");
    change([...levels, { kind: "level", smallBlind: (last?.smallBlind ?? 50) * 2, bigBlind: (last?.bigBlind ?? 100) * 2, ante: last?.ante ? last.ante * 2 : 0, durationMin: last?.durationMin ?? 20 }]);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 512 * 1024) return setNote({ tone: "error", text: "That file is too big for a blind structure." });
    const r = parseBlindFile(await file.text(), file.name);
    if (fileRef.current) fileRef.current.value = "";
    if (!r.ok) return setNote({ tone: "error", text: `Couldn't import ${file.name}: ${r.error}` });
    replace(r.levels, [`Imported ${summarizeStructure(r.levels)} from ${file.name}.`, ...r.warnings, `Review it, then ${saveLabel.toLowerCase()}.`].join(" "));
    if (r.name) onImportedName?.(r.name);
  };

  let n = 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,.json,.txt,text/csv,application/json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button onClick={() => fileRef.current?.click()}>Import file…</Button>
        <Button onClick={() => exportStructure(exportName, levels, "csv")}>Download CSV</Button>
        <Button onClick={() => exportStructure(exportName, levels, "json")}>Download JSON</Button>
        {saved.length > 0 && (
          <Select
            className="w-auto min-w-52"
            value=""
            aria-label="Load a saved structure"
            onChange={(e) => {
              const s = saved.find((x) => x.id === e.target.value);
              if (s) replace(s.levels, `Loaded "${s.name}". Review it, then ${saveLabel.toLowerCase()}.`);
            }}
          >
            <option value="">Load saved structure…</option>
            {saved.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isDefault ? " (default)" : ""}
              </option>
            ))}
          </Select>
        )}
        <span className="ml-auto text-sm text-mist">{summarizeStructure(levels)}</span>
      </div>
      {note && <p role={note.tone === "error" ? "alert" : "status"} className={`text-sm ${note.tone === "error" ? "text-danger" : "text-emerald-400"}`}>{note.text}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="text-left text-xs text-mist">
            <tr><th className="py-1 font-normal">#</th><th className="font-normal">Type</th><th className="font-normal">Small blind</th><th className="font-normal">Big blind</th><th className="font-normal">Ante</th><th className="font-normal">Minutes</th><th /></tr>
          </thead>
          <tbody>
            {levels.map((l, i) => {
              const label = l.kind === "level" ? String(++n) : "Break";
              return (
                <tr key={i} className={`border-t border-line ${i === currentIndex ? "bg-amber/10" : ""}`}>
                  <td className="py-1.5 pr-2 font-display text-lg">{label}</td>
                  <td className="pr-2">
                    <Select className="w-28" value={l.kind} onChange={(e) => up(i, { kind: e.target.value as LevelInput["kind"] })} aria-label={`Row ${i + 1} type`}>
                      <option value="level">Level</option>
                      <option value="break">Break</option>
                    </Select>
                  </td>
                  {(["smallBlind", "bigBlind", "ante"] as const).map((k) => (
                    <td key={k} className="pr-2">
                      <Input type="number" min={0} disabled={l.kind === "break"} value={l.kind === "break" ? "" : l[k]} onChange={(e) => up(i, { [k]: Number(e.target.value) })} aria-label={`Row ${i + 1} ${k}`} />
                    </td>
                  ))}
                  <td className="pr-2"><Input type="number" min={0.5} step={0.5} value={l.durationMin} onChange={(e) => up(i, { durationMin: Number(e.target.value) })} aria-label={`Row ${i + 1} minutes`} /></td>
                  <td className="whitespace-nowrap">
                    <Button variant="ghost" onClick={() => move(i, -1)} aria-label={`Move row ${i + 1} up`}>↑</Button>
                    <Button variant="ghost" onClick={() => move(i, 1)} aria-label={`Move row ${i + 1} down`}>↓</Button>
                    <Button variant="ghost" onClick={() => change(levels.filter((_, j) => j !== i))} aria-label={`Remove row ${i + 1}`}>✕</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={addLevel}>Add level</Button>
        <Button onClick={() => change([...levels, { kind: "break", smallBlind: 0, bigBlind: 0, ante: 0, durationMin: 10 }])}>Add break</Button>
        <span className="flex-1" />
        {dirty && <span className="text-sm text-amber">Unsaved changes</span>}
        <Button
          variant="primary"
          disabled={saving}
          onClick={() => onSave(levels, () => setDirty(false))}
        >
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
      {footer}
    </div>
  );
}
