// Sirène d'ambulance « deux tons » (pin-pon), synthétisée par le navigateur (aucun fichier audio).
// Suit le même interrupteur 🔊 que la voix et la rue ; le volume est fixé à chaque image selon la distance.
import { voiceOn } from './voice';

const TONES = [435, 580];
const HALF_PERIOD_S = 0.55;

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let osc: OscillatorNode | null = null;
let timer = 0;

export function sirenStart(): void {
  if (ctx || typeof window === 'undefined' || !('AudioContext' in window) || !voiceOn()) return;
  ctx = new AudioContext();
  ctx.resume().catch(() => undefined);
  gain = ctx.createGain();
  gain.gain.value = 0;
  // Timbre de trompe : dent de scie adoucie par un passe-bas
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1900;
  osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = TONES[0]!;
  osc.connect(lp).connect(gain).connect(ctx.destination);
  osc.start();
  let k = 0;
  timer = window.setInterval(() => {
    if (!ctx || !osc) return;
    k = 1 - k;
    osc.frequency.setTargetAtTime(TONES[k]!, ctx.currentTime, 0.012);
  }, HALF_PERIOD_S * 1000);
}

/** Volume de 0 à 1 (lissé pour éviter les claquements). */
export function sirenLevel(v: number): void {
  if (!ctx || !gain) return;
  gain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.16, ctx.currentTime, 0.15);
}

export function sirenStop(): void {
  window.clearInterval(timer);
  const c = ctx;
  if (!c || !gain) return;
  gain.gain.setTargetAtTime(0, c.currentTime, 0.2);
  ctx = null;
  gain = null;
  osc = null;
  window.setTimeout(() => void c.close(), 900);
}
