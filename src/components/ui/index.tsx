import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-amber text-ink hover:brightness-110 font-semibold",
  secondary: "border border-line bg-panel text-snow hover:border-line-strong",
  danger: "bg-danger text-white hover:brightness-110 font-semibold",
  ghost: "text-mist hover:text-snow",
};

export function Button({ variant = "secondary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...p}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  );
}

export function Input({ className = "", ...p }: InputHTMLAttributes<HTMLInputElement>) {
  // A caller-supplied width wins over the default full width.
  return <input {...p} className={`min-h-10 ${/(^|\s)w-/.test(className) ? "" : "w-full"} rounded-lg border border-line bg-ink px-3 py-2 text-sm text-snow placeholder:text-line-strong ${className}`} />;
}

export function Select({ className = "", ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`min-h-10 ${/(^|\s)w-/.test(className) ? "" : "w-full"} rounded-lg border border-line bg-ink px-3 py-2 text-sm text-snow ${className}`} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-mist">{label}</span>
      {children}
      {hint && <span className="text-xs text-mist/70">{hint}</span>}
    </label>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "amber" | "danger" | "ok" }) {
  const t = { muted: "border-line text-mist", amber: "border-amber/60 text-amber", danger: "border-danger/60 text-danger", ok: "border-emerald-500/50 text-emerald-400" }[tone];
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs ${t}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-mist">{children}</p>;
}
