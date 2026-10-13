import { describe, expect, it } from "vitest";
import { findNameMatches, hasNameContent, namesAreSimilar, normalizeName } from "@/lib/names";

describe("player name matching", () => {
  it("treats case, punctuation and spacing as the same name", () => {
    for (const n of ["Hank S.", "hank s", "  HANK   S ", "Hank-S"]) expect(normalizeName(n)).toBe(n === "Hank-S" ? "hanks" : "hank s");
    expect(normalizeName("José O'Neil")).toBe("josé oneil");
    expect(hasNameContent("!!!")).toBe(false);
  });

  it("flags likely duplicates", () => {
    const sim = (a: string, b: string) => namesAreSimilar(normalizeName(a), normalizeName(b));
    expect(sim("Jon", "John")).toBe(true);
    expect(sim("Katie", "Kate")).toBe(true);
    expect(sim("Jon Smith", "John Smith")).toBe(true);
    expect(sim("Hank", "Hank S")).toBe(true);
    expect(sim("Christopher", "Cristopher")).toBe(true);
  });

  it("leaves clearly different people alone", () => {
    const sim = (a: string, b: string) => namesAreSimilar(normalizeName(a), normalizeName(b));
    expect(sim("Mike R", "Mike T")).toBe(false); // the usual way to tell two Mikes apart
    expect(sim("Mike R.", "Mike T.")).toBe(false);
    expect(sim("Ana", "Sam")).toBe(false);
    expect(sim("Rosa", "Nia")).toBe(false);
    expect(sim("Hank", "Hank")).toBe(false); // identical is "exact", not "similar"
  });

  it("finds exact and similar matches, excluding a given record", () => {
    const players = ["John", "Hank S.", "Mike R", "Lou"].map((displayName, i) => ({ id: String(i), displayName, nameKey: normalizeName(displayName) }));
    expect(findNameMatches("hank s", players).exact?.displayName).toBe("Hank S.");
    expect(findNameMatches("Jon", players).similar.map((p) => p.displayName)).toEqual(["John"]);
    expect(findNameMatches("Mike T", players)).toEqual({ exact: null, similar: [] });
    expect(findNameMatches("Hank S.", players, "1").exact).toBeNull(); // renaming yourself isn't a conflict
  });
});
