export type NameConflictPlayer = { id: string; name: string; active: boolean };
/** Returned when a new name matches (or nearly matches) an existing league player. */
export type NameConflict = { kind: "exact"; player: NameConflictPlayer } | { kind: "similar"; players: NameConflictPlayer[] };
