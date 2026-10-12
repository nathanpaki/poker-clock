import "server-only";
import QRCode from "qrcode";
import { publicTournamentUrl } from "@/lib/app-url";

/** Returns null when NEXT_PUBLIC_APP_URL isn't a real public URL — we'd rather show no QR than a broken one. */
export async function tournamentQrSvg(code: string): Promise<{ svg: string | null; url: string; ok: boolean }> {
  const { url, ok } = publicTournamentUrl(code);
  if (!ok) return { svg: null, url, ok };
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#07090c", light: "#ffffff" } });
  return { svg, url, ok };
}
