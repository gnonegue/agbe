// Lecture à voix haute (synthèse vocale du navigateur, français et anglais).
// Les langues locales (éwé, mina, kabyè, tem, moba) viendront d'enregistrements de comédiens : voir `recorded`.
const KEY = 'agbe.voice';
let queued = 0;

export function voiceOn(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}
export function setVoiceOn(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* stockage indisponible : réglage gardé pour la session seulement */
  }
  if (!on) window.speechSynthesis?.cancel();
}

export const voiceSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * Emplacement des futures voix enregistrées : clé de texte → fichier audio par langue.
 * Vide pour l'instant ; quand un enregistrement existe, il est joué à la place de la synthèse.
 */
export const recorded: Record<string, Partial<Record<string, string>>> = {};

/** Découpe en phrases courtes : Chrome coupe les longues lectures au bout d'une quinzaine de secondes. */
function chunks(text: string): string[] {
  const parts = text.match(/[^.!?…\n]+[.!?…]*/g) ?? [text];
  const out: string[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (part.length <= 170) out.push(part);
    else for (let k = 0; k < part.length; k += 170) out.push(part.slice(k, k + 170));
  }
  return out;
}

export const NO_VOICE_EVENT = 'agbe:noVoice';
let warnedNoVoice = false;
let chimeCtx: AudioContext | null = null;
/** Petit « ding » à deux notes : signal sonore d'une notification quand le navigateur n'a aucune voix à prêter. */
function chime(): void {
  try {
    chimeCtx ??= new AudioContext();
    const c = chimeCtx;
    void c.resume();
    [880, 1318].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      const at = c.currentTime + i * 0.16;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.18, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      o.connect(g).connect(c.destination);
      o.start(at);
      o.stop(at + 0.55);
    });
  } catch {
    /* audio indisponible */
  }
}

let voicesReady = false;
const pendingSpeech: (() => void)[] = [];
function whenVoices(run: () => void): void {
  const synth = window.speechSynthesis;
  if (voicesReady || synth.getVoices().length > 0) {
    voicesReady = true;
    return run();
  }
  // Les voix se chargent après le premier appel : on attend l'évènement (ou 600 ms) au lieu de lire en silence
  pendingSpeech.push(run);
  if (pendingSpeech.length > 1) return;
  const flush = () => {
    voicesReady = true;
    synth.removeEventListener('voiceschanged', flush);
    pendingSpeech.splice(0).forEach((f) => f());
  };
  synth.addEventListener('voiceschanged', flush);
  window.setTimeout(flush, 600);
}

/** Lit un texte dans la langue de l'interface. Par défaut interrompt la phrase précédente ; `queue` la lit à la suite. */
export function speak(text: string, lang: string, opts: { queue?: boolean } = {}): void {
  if (!voiceSupported() || !voiceOn() || !text) return;
  const synth = window.speechSynthesis;
  // Notifications à la suite : au plus 6 phrases en attente, pour ne pas lire un retard de plusieurs minutes
  if (opts.queue) {
    if (synth.pending && queued >= 6) return;
  } else {
    synth.cancel();
    queued = 0;
  }
  // Une synthèse restée en pause (onglet remis au premier plan, autre lecture interrompue) ne lit plus rien tant qu'on ne la relance pas
  if (synth.paused) synth.resume();
  const clean = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
  whenVoices(() => {
    const want = lang === 'en' ? 'en' : 'fr';
    const voices = synth.getVoices();
    // Aucune voix (navigateur isolé du système, par exemple Brave en Flatpak) : on le signale une fois, au lieu de se taire sans explication
    if (voices.length === 0 && !warnedNoVoice) {
      warnedNoVoice = true;
      window.dispatchEvent(new Event(NO_VOICE_EVENT));
    }
    // Pas de voix : les notifications gardent au moins un signal sonore
    if (voices.length === 0) {
      if (opts.queue) chime();
      return;
    }
    // Préférence pour une voix d'Afrique de l'Ouest si le système en propose une, sinon la langue générique
    // puis une voix de qualité (Google, Natural…) plutôt qu'eSpeak, robotique et grinçante sous Linux
    const ofLang = voices.filter((v) => v.lang.startsWith(want));
    const rank = (v: SpeechSynthesisVoice) => (/^(fr|en)-(TG|BJ|CI|SN|GH|NG)/i.test(v.lang) ? 0 : /google|natural|neural|online|premium|enhanced/i.test(v.name) ? 1 : /espeak|mbrola/i.test(v.name) ? 3 : 2);
    const voice = ofLang.sort((a, b) => rank(a) - rank(b))[0] ?? null;
    for (const part of chunks(clean)) {
      queued++;
      const u = new SpeechSynthesisUtterance(part);
      u.voice = voice;
      u.lang = voice?.lang ?? (want === 'en' ? 'en-GB' : 'fr-FR');
      u.rate = 1;
      u.onend = u.onerror = () => {
        queued = Math.max(0, queued - 1);
      };
      synth.speak(u);
    }
  });
}
