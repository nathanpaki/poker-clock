"use client";

import { declareWinner } from "@/actions/roster";
import { Button } from "@/components/ui";
import { Feedback, useAction } from "@/components/ui/use-action";

export function DeclareWinnerButton({ tournamentId, registrationId, name }: { tournamentId: string; registrationId: string; name: string }) {
  const { exec, pending, error } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber bg-panel p-4">
      <p className="flex-1">
        <span className="text-mist">Last player standing:</span> <span className="font-display text-2xl font-semibold">{name}</span>
      </p>
      <Button
        variant="primary"
        disabled={pending}
        onClick={() => confirm(`Declare ${name} the winner? This finishes them 1st, stops the clock and closes the tournament.`) && exec(() => declareWinner({ tournamentId, registrationId }))}
      >
        {pending ? "Saving…" : `Declare ${name} the winner`}
      </Button>
      <Feedback error={error} />
    </div>
  );
}
