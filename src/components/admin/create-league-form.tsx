"use client";

import { useState } from "react";
import { createLeague } from "@/actions/leagues";
import { Button, Field, Input } from "@/components/ui";
import { Feedback, useAction } from "@/components/ui/use-action";

export function CreateLeagueForm() {
  const { exec, pending, error, message } = useAction();
  const [name, setName] = useState("");
  const [tz, setTz] = useState("America/New_York");
  const [email, setEmail] = useState("");
  return (
    <form
      className="grid gap-3 sm:grid-cols-[2fr_1.4fr_2fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        exec(() => createLeague({ name, timezone: tz, adminEmail: email }), { success: "League created.", onSuccess: () => { setName(""); setEmail(""); } });
      }}
    >
      <Field label="League name"><Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Smokey Mountain Poker League" /></Field>
      <Field label="Default time zone"><Input value={tz} onChange={(e) => setTz(e.target.value)} required /></Field>
      <Field label="First league admin (email, optional)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Button variant="primary" disabled={pending}>{pending ? "Creating…" : "Create league"}</Button>
      <div className="sm:col-span-4"><Feedback error={error} message={message} /></div>
    </form>
  );
}
