// Musique de fond douce (volume bas), démarrée au premier geste (règle des navigateurs).
// Par défaut : ambiance togolaise créée par le jeu (cloche gankogui, tambours agbadja légers, nappe douce).
// Des morceaux d'artistes peuvent la remplacer UNIQUEMENT avec leur autorisation : fichiers déposés dans
// public/music/ et listés dans public/music/playlist.json ([{ "title": "…", "artist": "…", "file": "x.mp3" }]).
const KEY = 'agbe.music';
const VOLUME = 0.12;
const VOL_KEY = 'agbe.music.volume';

/** Volume choisi par le joueur (0 à 1), mémorisé sur l'appareil. */
export function musicVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOL_KEY));
    return localStorage.getItem(VOL_KEY) === null || Number.isNaN(v) ? 0.6 : Math.min(1, Math.max(0, v));
  } catch {
    return 0.6;
  }
}

/** Facteur appliqué au volume (1 = normal) : le maquis joue la radio en fond, doucement. */
let duck = 1;
export function setMusicDuck(k: number): void {
  duck = Math.min(1, Math.max(0, k));
  if (audio) audio.volume = musicVolume() * duck;
  if (gain && ctx) gain.gain.setTargetAtTime(VOLUME * 2 * musicVolume() * duck, ctx.currentTime, 0.05);
}

export function setMusicVolume(v: number): void {
  const value = Math.min(1, Math.max(0, v));
  try {
    localStorage.setItem(VOL_KEY, String(value));
  } catch {
    /* réglage pour la session seulement */
  }
  if (audio) audio.volume = value * duck;
  if (gain && ctx) gain.gain.setTargetAtTime(VOLUME * 2 * value * duck, ctx.currentTime, 0.05);
  notify();
}

export interface Track {
  title: string;
  artist: string;
  file: string;
}

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let timer = 0;
let audio: HTMLAudioElement | null = null;
let playlist: Track[] | null = null;
let index = 0;
let playing = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** Musique coupée par défaut : elle ne joue que si le joueur la lance lui-même dans l'appli Musique. */
export function musicOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const isPlaying = () => playing;

/** Extrait en cours (radio togolaise ou aperçu choisi dans l'appli Musique). */
let nowPlaying: { title: string; artist: string; url: string | null } | null = null;
export const nowPlayingTrack = () => nowPlaying;

/** Joue un extrait (aperçu de 30 s) à la place de la musique de fond ; `onEnd` enchaîne le suivant. */
export function playClip(clip: { title: string; artist: string; previewUrl: string; url: string | null }, onEnd?: () => void): void {
  stopAmbient();
  audio?.pause();
  playing = true;
  nowPlaying = { title: clip.title, artist: clip.artist, url: clip.url };
  audio = new Audio(clip.previewUrl);
  audio.volume = musicVolume() * duck;
  audio.onpause = () => notify();
  audio.onplay = () => notify();
  audio.onended = () => {
    nowPlaying = null;
    playing = false;
    notify();
    onEnd?.();
  };
  void audio.play().catch(() => undefined);
  notify();
}
export const currentTrack = (): Track | null => (playlist && audio ? playlist[index] ?? null : null);
export function onMusicChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

async function loadPlaylist(): Promise<Track[]> {
  if (playlist) return playlist;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}music/playlist.json`, { cache: 'no-cache' });
    const list = r.ok ? ((await r.json()) as Track[]) : [];
    playlist = Array.isArray(list) ? list.filter((t) => t && /^[\w.-]+\.(mp3|ogg|m4a)$/i.test(t.file)) : [];
  } catch {
    playlist = [];
  }
  return playlist;
}

/** Ambiance synthétisée : motif de cloche à 12 temps (gankogui), tambour grave, nappe d'accords. */
function startAmbient(): void {
  if (!ctx) ctx = new AudioContext();
  void ctx.resume();
  gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(VOLUME * 2 * musicVolume() * duck, ctx.currentTime + 4);
  gain.connect(ctx.destination);
  const c = ctx;
  const g = gain;
  const BELL = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1];
  const CHORDS = [[220, 277, 330], [196, 247, 294], [174.6, 220, 262], [196, 247, 294]];
  const step = 60 / 104 / 2;
  let n = 0;
  let next = c.currentTime + 0.1;
  const note = (f: number, at: number, dur: number, type: OscillatorType, vol: number) => {
    const o = c.createOscillator();
    const e = c.createGain();
    o.type = type;
    o.frequency.value = f;
    e.gain.setValueAtTime(0, at);
    e.gain.linearRampToValueAtTime(vol, at + 0.01);
    e.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(e).connect(g);
    o.start(at);
    o.stop(at + dur + 0.05);
  };
  const tick = () => {
    while (next < c.currentTime + 0.4) {
      const beat = n % 12;
      if (BELL[beat]) note(beat === 0 ? 1320 : 1760, next, 0.12, 'triangle', 0.18);
      if (beat === 0 || beat === 7) note(70, next, 0.35, 'sine', 0.9);
      if (beat === 3 || beat === 9) note(140, next, 0.18, 'sine', 0.35);
      if (beat === 0) for (const f of CHORDS[Math.floor(n / 12) % CHORDS.length]!) note(f, next, step * 11, 'sine', 0.08);
      n++;
      next += step;
    }
  };
  tick();
  timer = window.setInterval(tick, 150);
}

function stopAmbient(): void {
  window.clearInterval(timer);
  timer = 0;
  gain?.disconnect();
  gain = null;
}

function playTrack(list: Track[]): void {
  audio?.pause();
  const tr = list[index % list.length]!;
  audio = new Audio(`${import.meta.env.BASE_URL}music/${tr.file}`);
  audio.volume = musicVolume() * duck;
  audio.onended = () => {
    index = (index + 1) % list.length;
    playTrack(list);
    notify();
  };
  void audio.play().catch(() => undefined);
}

export async function startMusic(): Promise<void> {
  if (playing) return;
  playing = true;
  const list = await loadPlaylist();
  if (!playing) return;
  if (list.length > 0) playTrack(list);
  else startAmbient();
  notify();
}

/** Pause / reprise de l'extrait ou du morceau en cours (l'ambiance synthétisée, elle, s'arrête et se relance). */
export function isPaused(): boolean {
  return !!audio && audio.paused;
}

export function togglePause(): void {
  if (audio) {
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
    notify();
  } else if (playing) stopMusic();
}

export function stopMusic(): void {
  playing = false;
  nowPlaying = null;
  audio?.pause();
  audio = null;
  stopAmbient();
  notify();
}

export function setMusicOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* réglage pour la session seulement */
  }
  if (on) void startMusic();
  else stopMusic();
}

export async function nextTrack(): Promise<void> {
  const list = await loadPlaylist();
  if (list.length === 0) return;
  index = (index + 1) % list.length;
  if (playing) playTrack(list);
  notify();
}
