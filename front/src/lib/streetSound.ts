// Ambiance sonore de la rue, synthétisée par le navigateur (aucun fichier audio) :
// grondement de la circulation, bourdonnement des zémidjans et klaxons au hasard quand des véhicules sont proches.
// Suit le même interrupteur 🔊 que la voix ; démarre au premier geste (règle des navigateurs).
import { voiceOn } from './voice';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let rumble: GainNode | null = null;
let buzz: GainNode | null = null;
let nextHorn = 0;
/** Dans un bâtiment (maison, maquis, hôpital…) : aucun bruit de rue, quoi que demande la scène de la ville. */
let indoors = false;

export function setStreetIndoors(on: boolean): void {
  indoors = on;
  if (on && ctx && rumble && buzz) {
    rumble.gain.cancelScheduledValues(ctx.currentTime);
    buzz.gain.cancelScheduledValues(ctx.currentTime);
    rumble.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    buzz.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
  }
}

function start(): void {
  if (ctx || typeof window === 'undefined' || !('AudioContext' in window)) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  // Bruit brun filtré : roulement de la circulation
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  rumble = ctx.createGain();
  rumble.gain.value = 0;
  noise.connect(lp).connect(rumble).connect(master);
  noise.start();
  // Moteur deux-temps des motos : dent de scie grave modulée
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 92;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 7;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 14;
  lfo.connect(lfoGain).connect(osc.frequency);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 300;
  buzz = ctx.createGain();
  buzz.gain.value = 0;
  osc.connect(bp).connect(buzz).connect(master);
  osc.start();
  lfo.start();
}

/** À appeler sur un geste de l'utilisateur (toucher, clic, touche). */
export function unlockStreetSound(): void {
  start();
  void ctx?.resume();
}

function horn(moto: boolean): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.value = 0;
  g.connect(master);
  // Klaxon de voiture : deux notes ; moto : petit « bip bip » aigu
  const notes = moto ? [[620, 0, 0.09], [620, 0.14, 0.09]] : [[392, 0, 0.35], [494, 0, 0.35]];
  for (const [f, at, dur] of notes) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f!;
    o.connect(g);
    o.start(t + at!);
    o.stop(t + at! + dur!);
  }
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(moto ? 0.06 : 0.08, t + 0.02);
  g.gain.setValueAtTime(moto ? 0.06 : 0.08, t + (moto ? 0.22 : 0.33));
  g.gain.linearRampToValueAtTime(0, t + (moto ? 0.25 : 0.36));
}

/**
 * Mise à jour (quelques fois par seconde) : nombre de voitures et de motos proches du joueur
 * (0 en carte ou à l'intérieur), pour régler le volume et déclencher les klaxons.
 */
export function updateStreetSound(cars: number, motos: number, outdoors = true): void {
  if (!ctx || !rumble || !buzz) return;
  const on = voiceOn() && outdoors && !indoors ? 1 : 0;
  const t = ctx.currentTime;
  rumble.gain.setTargetAtTime(on * Math.min(0.9, 0.12 + cars * 0.09), t, 0.4);
  buzz.gain.setTargetAtTime(on * Math.min(0.12, motos * 0.025), t, 0.4);
  if (on && cars + motos > 0 && performance.now() > nextHorn) {
    horn(motos > cars ? true : Math.random() < 0.4);
    nextHorn = performance.now() + 2500 + Math.random() * Math.max(2500, 12000 - (cars + motos) * 1200);
  }
}

// Premier geste n'importe où (joystick, clavier, boutons) : le son peut démarrer
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, unlockStreetSound, { passive: true });
}
