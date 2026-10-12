import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PreviewClient } from "./preview-client";

/** Development-only design preview: /preview. Disabled in production builds. */
export default async function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const qrSvg = await QRCode.toString("https://clock.example.com/tournament/K7Q4MX", { type: "svg", margin: 1, color: { dark: "#07090c", light: "#ffffff" } });
  return (
    <main className="p-0 lg:p-[1.2vh]">
      <PreviewClient qrSvg={qrSvg} />
    </main>
  );
}
