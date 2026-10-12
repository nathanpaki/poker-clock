import Link from "next/link";
import { redirect } from "next/navigation";
import { normalizeCode } from "@/lib/code";

async function go(formData: FormData) {
  "use server";
  const code = normalizeCode(String(formData.get("code") ?? ""));
  redirect(code ? `/tournament/${code}` : "/?invalid=1");
}

export default async function Home({ searchParams }: { searchParams: Promise<{ invalid?: string }> }) {
  const { invalid } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 p-6">
      <h1 className="font-display text-5xl font-bold leading-none">Find your table&rsquo;s clock</h1>
      <form action={go} className="flex flex-col gap-3">
        <label htmlFor="code" className="text-mist">Enter the six-character code shown on the TV</label>
        <input
          id="code"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={6}
          placeholder="K7Q4MX"
          className="rounded-lg border border-line bg-panel px-4 py-3 font-display text-3xl uppercase tracking-[0.3em] text-snow placeholder:text-line-strong"
        />
        {invalid && <p className="text-amber">That code doesn&rsquo;t look right. Codes are six letters and numbers.</p>}
        <button className="rounded-lg bg-amber px-4 py-3 font-display text-xl font-semibold text-ink">Open clock</button>
      </form>
      <Link href="/admin" className="text-mist underline-offset-4 hover:text-snow hover:underline">Staff sign in</Link>
    </main>
  );
}
