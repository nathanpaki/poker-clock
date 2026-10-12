"use client";

/**
 * All sounds are synthesized with the Web Audio API — no files, no third-party
 * services. Each alert has a distinct shape so staff can tell them apart from
 * across the room.
 */

export type AlertKind = "warning" | "levelChange" | "breakStart" | "breakEnd";

export type AudioSettings = {
  enabled: boolean; // this device plays sound at all (designate the TV)
  warning: boolean;
  levelChange: boolean;
  breaks: boolean;
  speak: boolean;
  volume: number; // 0..1
};

export const DEFAULT_AUDIO: AudioSettings = { enabled: true, warning: true, levelChange: true, breaks: true, speak: false, volume: 0.8 };
const SETTINGS_KEY = "pokerclock:audio-settings";

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_AUDIO, ...JSON.parse(raw) } : DEFAULT_AUDIO;
  } catch {
    return DEFAULT_AUDIO;
  }
}

export function saveAudioSettings(s: AudioSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode — settings last for this session only */
  }
}

/** Alert keys already handled on this device, per tournament. Survives refresh. */
export function claimAlert(tournamentCode: string, key: string): boolean {
  const storageKey = `pokerclock:alerts:${tournamentCode}`;
  try {
    const list: string[] = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (list.includes(key)) return false;
    list.push(key);
    localStorage.setItem(storageKey, JSON.stringify(list.slice(-60)));
    return true;
  } catch {
    // Fall back to an in-memory set.
    const mem = ((globalThis as { __alerts?: Set<string> }).__alerts ??= new Set());
    const k = `${tournamentCode}:${key}`;
    if (mem.has(k)) return false;
    mem.add(k);
    return true;
  }
}

class AudioEngine {
  private ctx: AudioContext | null = null;

  get state(): AudioContextState | "unavailable" {
    if (typeof window === "undefined" || !("AudioContext" in window)) return "unavailable";
    return this.ctx?.state ?? "suspended";
  }

  /** Must be called from a user gesture (click/tap/keypress) because of autoplay rules. */
  async unlock(): Promise<boolean> {
    if (typeof window === "undefined" || !("AudioContext" in window)) return false;
    this.ctx ??= new AudioContext();
    if (this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
    return this.ctx.state === "running";
  }

  private tone(freq: number, start: number, dur: number, volume: number, type: OscillatorType = "sine") {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + start;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  play(kind: AlertKind, volume: number): boolean {
    if (!this.ctx || this.ctx.state !== "running") return false;
    const v = Math.max(0, Math.min(1, volume)) * 0.6;
    switch (kind) {
      case "warning": // two short, sharp beeps
        this.tone(1320, 0, 0.14, v, "square");
        this.tone(1320, 0.22, 0.14, v, "square");
        break;
      case "levelChange": // rising three-note chime
        [659.25, 830.61, 987.77].forEach((f, i) => this.tone(f, i * 0.18, 0.55, v, "triangle"));
        this.tone(1318.5, 0.54, 0.9, v * 0.8, "sine");
        break;
      case "breakStart": // falling two-tone, longer
        this.tone(784, 0, 0.7, v, "sine");
        this.tone(523.25, 0.45, 1.1, v, "sine");
        break;
      case "breakEnd": // bright double bell
        this.tone(1046.5, 0, 0.5, v, "triangle");
        this.tone(1568, 0.08, 0.6, v * 0.6, "sine");
        this.tone(1046.5, 0.6, 0.5, v, "triangle");
        this.tone(1568, 0.68, 0.8, v * 0.6, "sine");
        break;
    }
    return true;
  }

  speak(text: string, volume: number) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.volume = volume;
    u.rate = 0.95;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
}

export const audioEngine = new AudioEngine();
