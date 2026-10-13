import { z } from "zod";
import { isValidTimeZone } from "./format";

export const id = z.string().uuid("Invalid ID.");
export const name = z.string().trim().min(1, "Name is required.").max(120);
export const timezone = z.string().refine(isValidTimeZone, "Unknown time zone.");

export const levelInput = z
  .object({
    kind: z.enum(["level", "break"]),
    smallBlind: z.coerce.number().int().min(0).max(100_000_000).default(0),
    bigBlind: z.coerce.number().int().min(0).max(100_000_000).default(0),
    ante: z.coerce.number().int().min(0).max(100_000_000).default(0),
    durationMin: z.coerce.number().min(0.5, "Levels must be at least 30 seconds.").max(600),
  })
  .refine((l) => l.kind === "break" || (l.bigBlind > 0 && l.bigBlind >= l.smallBlind), "Big blind must be at least the small blind.");

export const structureInput = z.array(levelInput).min(1, "Add at least one level.").max(200);
export type LevelInput = z.infer<typeof levelInput>;

const DEFAULT_ROWS: ([number, number] | "break")[] = [
  [25, 50], [50, 100], [75, 150], [100, 200], "break", [150, 300], [200, 400], [300, 600], [400, 800], "break",
  [500, 1000], [600, 1200], [800, 1600], [1000, 2000], [1500, 3000], [2000, 4000],
];
export const DEFAULT_STRUCTURE: LevelInput[] = DEFAULT_ROWS.map((x): LevelInput =>
  x === "break"
    ? { kind: "break" as const, smallBlind: 0, bigBlind: 0, ante: 0, durationMin: 10 }
    : { kind: "level" as const, smallBlind: x[0], bigBlind: x[1], ante: 0, durationMin: 20 },
);

/** Optional integer form field: "" or missing → undefined. */
export const optionalInt = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().int().min(min).max(max).optional());

/** Optional UUID form field: "" or missing → undefined. */
export const optionalId = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().uuid("Invalid ID.").optional());

/** "YYYY-MM-DDTHH:mm" from a datetime-local input; interpreted in the venue's time zone. */
export const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Pick a date and time.");
