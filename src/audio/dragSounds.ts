export type DragSoundKind = "pickup" | "tick" | "drop";

const SOUND_ENABLED_KEY = "prompt-workbench-tag-editor:drag-sounds";
const INSERTION_TICK_INTERVAL_MS = 35;

type AudioContextConstructor = new () => AudioContext;

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };

let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (sharedContext) return sharedContext;
  const audioWindow = window as AudioWindow;
  const Constructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!Constructor) return null;
  try {
    sharedContext = new Constructor();
    return sharedContext;
  } catch {
    return null;
  }
}

function addTone(
  context: AudioContext,
  startAt: number,
  duration: number,
  startFrequency: number,
  endFrequency: number,
  peakGain: number,
  type: OscillatorType,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + duration);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + Math.min(duration * 0.16, 0.012));
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.01);
}

function addNoise(
  context: AudioContext,
  startAt: number,
  duration: number,
  peakGain: number,
  frequency: number,
): void {
  const frameCount = Math.max(1, Math.ceil(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    const envelope = 1 - index / channel.length;
    channel[index] = (Math.random() * 2 - 1) * envelope;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(frequency, startAt);
  filter.Q.setValueAtTime(0.8, startAt);
  gain.gain.setValueAtTime(peakGain, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(startAt);
  source.stop(startAt + duration + 0.01);
}

function renderSound(context: AudioContext, kind: DragSoundKind): void {
  const startAt = context.currentTime + 0.004;
  if (kind === "pickup") {
    addTone(context, startAt, 0.045, 980, 520, 0.018, "triangle");
    addTone(context, startAt + 0.006, 0.06, 245, 145, 0.018, "sine");
    addNoise(context, startAt, 0.075, 0.038, 1700);
    addNoise(context, startAt + 0.008, 0.055, 0.024, 3600);
    return;
  }
  if (kind === "tick") {
    addTone(context, startAt, 0.026, 1420, 760, 0.029, "triangle");
    addNoise(context, startAt, 0.022, 0.019, 2700);
    return;
  }
  addTone(context, startAt, 0.095, 245, 112, 0.054, "sine");
  addNoise(context, startAt, 0.04, 0.012, 540);
}

export function playDragSound(kind: DragSoundKind, enabled: boolean): void {
  if (!enabled) return;
  const context = getAudioContext();
  if (!context) return;
  const play = () => {
    try {
      renderSound(context, kind);
    } catch {
      // Audio feedback must never interrupt a drag operation.
    }
  };
  if (context.state === "suspended") {
    void context
      .resume()
      .then(play)
      .catch(() => undefined);
  } else {
    play();
  }
}

export function readDragSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeDragSoundPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUND_ENABLED_KEY, enabled ? "on" : "off");
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export interface DragSoundController {
  start: (enabled: boolean) => void;
  moveTo: (targetKey: string | null, enabled: boolean, now?: number) => void;
  finish: (successful: boolean, enabled: boolean) => void;
  cancel: () => void;
}

export function createDragSoundController(
  play: (kind: DragSoundKind, enabled: boolean) => void = playDragSound,
): DragSoundController {
  let lastTargetKey: string | null = null;
  let lastTickAt = Number.NEGATIVE_INFINITY;
  return {
    start(enabled) {
      lastTargetKey = null;
      lastTickAt = Number.NEGATIVE_INFINITY;
      if (enabled) play("pickup", true);
    },
    moveTo(targetKey, enabled, now = performance.now()) {
      if (!targetKey) {
        lastTargetKey = null;
        return;
      }
      if (targetKey === lastTargetKey) return;
      lastTargetKey = targetKey;
      if (now - lastTickAt < INSERTION_TICK_INTERVAL_MS) return;
      lastTickAt = now;
      if (enabled) play("tick", true);
    },
    finish(successful, enabled) {
      if (successful && enabled) play("drop", true);
      lastTargetKey = null;
    },
    cancel() {
      lastTargetKey = null;
    },
  };
}
