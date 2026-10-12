/**
 * Public base URL for QR codes. In production we refuse localhost and preview
 * deployment hosts so a printed/displayed QR never points somewhere temporary.
 */
export function isUsablePublicUrl(raw: string | undefined): raw is string {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host)) return false;
  if (host.endsWith(".local")) return false;
  // Vercel preview URLs (project-git-branch-team.vercel.app or hash URLs) are temporary.
  if (host.endsWith(".vercel.app") && process.env.ALLOW_VERCEL_APP_URL !== "true") return false;
  return u.protocol === "https:";
}

export function publicTournamentUrl(code: string): { url: string; ok: boolean } {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  const ok = isUsablePublicUrl(base);
  const origin = ok ? new URL(base!).origin : base ?? "";
  return { url: `${origin}/tournament/${code}`, ok };
}
