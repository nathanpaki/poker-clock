/**
 * Import/export of blind structures. Runs in the browser and on the server.
 *
 * CSV (opens in Excel / Google Sheets):
 *   type,small_blind,big_blind,ante,minutes
 *   level,100,200,0,20
 *   break,,,,10
 *
 * JSON: { "name": "...", "levels": [{ "kind": "level", "smallBlind": 100, "bigBlind": 200, "ante": 0, "durationMin": 20 }] }
 *
 * Imports are forgiving: common header names (SB, Big Blind, Duration, Length…),
 * a missing type column (rows with no blinds are breaks), "20:00" or "20 min"
 * durations, thousands separators, semicolon delimiters, and a UTF-8 BOM.
 */

export type FileLevel = { kind: "level" | "break"; smallBlind: number; bigBlind: number; ante: number; durationMin: number };
export type ParseResult = { ok: true; name?: string; levels: FileLevel[]; warnings: string[] } | { ok: false; error: string };

const HEADERS: Record<keyof Omit<FileLevel, "kind"> | "kind", string[]> = {
  kind: ["type", "kind", "level type", "row type"],
  smallBlind: ["small blind", "small_blind", "smallblind", "sb", "small"],
  bigBlind: ["big blind", "big_blind", "bigblind", "bb", "big"],
  ante: ["ante", "antes", "bb ante", "big blind ante"],
  durationMin: ["minutes", "minute", "mins", "min", "duration", "duration (min)", "duration_min", "durationmin", "length", "time"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.replace(/[,\s']/g, "").replace(/^\$/, "");
  if (s === "" || s === "-") return null;
  // 1k / 1.5k shorthand
  const k = /^(\d+(?:\.\d+)?)k$/i.exec(s);
  if (k) return Math.round(Number(k[1]) * 1000);
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function parseMinutes(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const mmss = /^(\d+):(\d{1,2})$/.exec(s); // 20:00 → 20, 7:30 → 7.5
  if (mmss) return Number(mmss[1]) + Number(mmss[2]) / 60;
  const num = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes)?$/.exec(s);
  if (num) return Number(num[1]);
  return NaN;
}

export function parseBlindFile(text: string, filename = ""): ParseResult {
  const body = text.replace(/^\uFEFF/, "").trim();
  if (!body) return { ok: false, error: "The file is empty." };
  if (filename.toLowerCase().endsWith(".json") || body.startsWith("{") || body.startsWith("[")) return parseJson(body);
  return parseCsv(body);
}

function parseJson(body: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, error: "That JSON file couldn't be read. Check it isn't cut off or edited by hand incorrectly." };
  }
  const obj = Array.isArray(data) ? { levels: data } : (data as { name?: unknown; levels?: unknown });
  if (!obj || !Array.isArray(obj.levels)) return { ok: false, error: 'The JSON needs a "levels" list.' };
  const levels: FileLevel[] = [];
  for (const [i, raw] of (obj.levels as Record<string, unknown>[]).entries()) {
    const kindRaw = String(raw.kind ?? raw.type ?? "").toLowerCase();
    const sb = Number(raw.smallBlind ?? raw.small_blind ?? raw.sb ?? 0);
    const bb = Number(raw.bigBlind ?? raw.big_blind ?? raw.bb ?? 0);
    const ante = Number(raw.ante ?? 0);
    const minutes = raw.durationMin ?? raw.minutes ?? (raw.durationSec !== undefined ? Number(raw.durationSec) / 60 : undefined);
    const kind: FileLevel["kind"] = kindRaw === "break" || (!kindRaw && !sb && !bb) ? "break" : "level";
    const row = check(kind, sb, bb, ante, Number(minutes), i + 1);
    if (typeof row === "string") return { ok: false, error: row };
    levels.push(row);
  }
  return finish(levels, typeof obj.name === "string" ? obj.name : undefined, []);
}

function parseCsv(body: string): ParseResult {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const header = splitCsvLine(lines[0], delim).map(norm);
  const col = (key: keyof typeof HEADERS) => header.findIndex((h) => HEADERS[key].includes(h));
  const idx = { kind: col("kind"), smallBlind: col("smallBlind"), bigBlind: col("bigBlind"), ante: col("ante"), durationMin: col("durationMin") };
  if (idx.bigBlind < 0 || idx.durationMin < 0)
    return { ok: false, error: `The first row must be column headings including a big blind and a minutes column. Found: ${header.join(", ") || "nothing"}.` };

  const warnings: string[] = [];
  const levels: FileLevel[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r], delim);
    if (cells.every((c) => !c)) continue;
    const typeCell = idx.kind >= 0 ? norm(cells[idx.kind] ?? "") : "";
    const sb = parseNumber(cells[idx.smallBlind]);
    const bb = parseNumber(cells[idx.bigBlind]);
    const ante = idx.ante >= 0 ? parseNumber(cells[idx.ante]) : 0;
    const minutes = parseMinutes(cells[idx.durationMin]);
    const isBreak = typeCell.includes("break") || (!typeCell && !bb && !sb);
    let smallBlind = sb ?? 0;
    if (!isBreak && idx.smallBlind < 0) {
      smallBlind = Math.floor((bb ?? 0) / 2);
      if (r === 1) warnings.push("No small blind column, so small blinds were set to half the big blind.");
    }
    const row = check(isBreak ? "break" : "level", smallBlind, bb ?? 0, ante ?? 0, minutes ?? NaN, r + 1);
    if (typeof row === "string") return { ok: false, error: row };
    levels.push(row);
  }
  return finish(levels, undefined, warnings);
}

function check(kind: FileLevel["kind"], sb: number, bb: number, ante: number, minutes: number, row: number): FileLevel | string {
  const where = `Row ${row}`;
  if (!Number.isFinite(minutes) || minutes < 0.5 || minutes > 600) return `${where}: minutes must be between 0.5 and 600.`;
  if (kind === "break") return { kind, smallBlind: 0, bigBlind: 0, ante: 0, durationMin: Math.round(minutes * 100) / 100 };
  for (const [label, v] of [["small blind", sb], ["big blind", bb], ["ante", ante]] as const)
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) return `${where}: ${label} must be a whole number.`;
  if (bb <= 0) return `${where}: big blind must be more than 0.`;
  if (bb < sb) return `${where}: big blind (${bb}) is smaller than the small blind (${sb}).`;
  return { kind, smallBlind: sb, bigBlind: bb, ante, durationMin: Math.round(minutes * 100) / 100 };
}

function finish(levels: FileLevel[], name: string | undefined, warnings: string[]): ParseResult {
  if (!levels.length) return { ok: false, error: "No levels found in the file." };
  if (!levels.some((l) => l.kind === "level")) return { ok: false, error: "The file only has breaks. Add at least one blind level." };
  if (levels.length > 200) return { ok: false, error: "That's more than 200 levels." };
  return { ok: true, name, levels, warnings };
}

export function blindsToCsv(levels: FileLevel[]): string {
  const rows = ["type,small_blind,big_blind,ante,minutes"];
  for (const l of levels) rows.push(l.kind === "break" ? `break,,,,${l.durationMin}` : `level,${l.smallBlind},${l.bigBlind},${l.ante},${l.durationMin}`);
  return rows.join("\r\n") + "\r\n";
}

export function blindsToJson(name: string, levels: FileLevel[]): string {
  return JSON.stringify({ format: "poker-clock-blinds", version: 1, name, levels }, null, 2) + "\n";
}

/** "12 levels, 2 breaks · 4h 40m" */
export function summarizeStructure(levels: FileLevel[]): string {
  const lv = levels.filter((l) => l.kind === "level").length;
  const br = levels.length - lv;
  const mins = Math.round(levels.reduce((a, l) => a + l.durationMin, 0));
  const h = Math.floor(mins / 60);
  return `${lv} level${lv === 1 ? "" : "s"}${br ? `, ${br} break${br === 1 ? "" : "s"}` : ""} · ${h ? `${h}h ` : ""}${String(mins % 60).padStart(h ? 2 : 1, "0")}m`;
}
