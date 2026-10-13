"use client";

import { useEffect, useState } from "react";
import { audioEngine, DEFAULT_AUDIO, loadAudioSettings, saveAudioSettings, type AlertKind, type AudioSettings } from "./audio";

const TESTS: { kind: AlertKind; label: string }[] = [
  { kind: "warning", label: "1-minute warning" },
  { kind: "levelChange", label: "Level change" },
  { kind: "breakStart", label: "Break starts" },
  { kind: "breakEnd", label: "Break ends" },
];

/** `inline`: show the "turn on sound" prompt next to the icon instead of floating over the screen. */
export function AudioControls({ inline = false }: { inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<AudioSettings>(DEFAULT_AUDIO);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    setS(loadAudioSettings());
    setUnlocked(audioEngine.state === "running");
  }, []);

  const update = (patch: Partial<AudioSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveAudioSettings(next);
    window.dispatchEvent(new Event("pokerclock:audio-settings"));
  };

  const unlock = async () => setUnlocked(await audioEngine.unlock());

  const test = async (kind: AlertKind) => {
    if (!(await audioEngine.unlock())) return;
    setUnlocked(true);
    audioEngine.play(kind, s.volume);
    if (kind === "levelChange" && s.speak) setTimeout(() => audioEngine.speak("Blinds are now 400 / 800", s.volume), 1400);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Sound settings"
        className="rounded-md p-1.5 text-mist hover:text-snow focus-visible:outline-2 focus-visible:outline-amber"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M11 5 6 9H2v6h4l5 4V5Z" />
          {s.enabled ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="m22 9-6 6M16 9l6 6" />}
        </svg>
      </button>

      {s.enabled && !unlocked && inline && (
        <button type="button" onClick={unlock} className="min-h-11 whitespace-nowrap rounded-lg border border-amber/70 px-3 text-sm text-amber">
          Sound off · tap
        </button>
      )}
      {s.enabled && !unlocked && !inline && (
        <button
          type="button"
          onClick={unlock}
          className="fixed bottom-3 left-1/2 z-30 -translate-x-1/2 lg:bottom-auto lg:top-3 rounded-lg border border-amber bg-ink px-4 py-2 font-display text-lg text-amber shadow-lg focus-visible:outline-2 focus-visible:outline-amber"
        >
          Tap to turn on sound
        </button>
      )}

      {open && (
        <div className="absolute right-4 top-14 z-40 w-[min(92vw,340px)] rounded-xl border border-line bg-panel p-4 text-left text-base text-snow shadow-2xl">
          <p className="mb-3 text-sm text-mist">Settings apply to this device only. Turn sound on for the TV and off for phones.</p>
          <Toggle label="Play sounds on this device" checked={s.enabled} onChange={(v) => update({ enabled: v })} />
          <div className={s.enabled ? "" : "pointer-events-none opacity-40"}>
            <Toggle label="1-minute warning" checked={s.warning} onChange={(v) => update({ warning: v })} />
            <Toggle label="Level change" checked={s.levelChange} onChange={(v) => update({ levelChange: v })} />
            <Toggle label="Break start and end" checked={s.breaks} onChange={(v) => update({ breaks: v })} />
            <Toggle label="Announce new blinds aloud" checked={s.speak} onChange={(v) => update({ speak: v })} />
            <label className="mt-2 flex items-center gap-3 text-sm">
              Volume
              <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => update({ volume: Number(e.target.value) })} className="flex-1 accent-amber" />
            </label>
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 text-sm text-mist">{unlocked ? "Sound is on. Test each alert:" : "Browsers block sound until you tap. Any test button turns it on."}</p>
            <div className="grid grid-cols-2 gap-2">
              {TESTS.map((t) => (
                <button key={t.kind} type="button" onClick={() => test(t.kind)} className="rounded-md border border-line px-2 py-1.5 text-sm hover:border-amber focus-visible:outline-2 focus-visible:outline-amber">
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1.5 text-sm">
      {label}
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-amber" />
    </label>
  );
}
