import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { saveLook } from '../api/endpoints';
import { buildPerson, CLOTH_COLORS, FABRICS, HAIR_COLORS, HAIR_STYLES, lookFromSaved, Materials, OUTFITS, SKIN_TONES, type SavedLook } from '../game/kit';
import { useGame } from '../phone/ctx';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Aperçu 3D tournant (glisser pour faire pivoter). */
/** `close` : cadrage serré (garde-robe), le personnage remplit l'aperçu. */
export function LookPreview({ look, close = false }: { look: SavedLook; close?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{ set: (l: SavedLook) => void } | null>(null);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // WebGL indisponible : les choix restent utilisables
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    node.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    if (close) camera.position.set(0, 1.1, 4.15);
    else camera.position.set(0, 1.25, 4.6);
    camera.lookAt(0, close ? 0.95 : 1, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c4d6, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 4, 3);
    scene.add(key);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshLambertMaterial({ color: 0xdfe3e8 }));
    disc.rotation.x = -Math.PI / 2;
    scene.add(disc);
    const mats = new Materials(true);
    let person: THREE.Group | null = null;
    let yaw = 0.35;
    const set = (l: SavedLook) => {
      if (person) scene.remove(person);
      person = buildPerson(mats, lookFromSaved(l));
      person.rotation.y = yaw;
      scene.add(person);
    };
    api.current = { set };
    set(look);
    let drag: number | null = null;
    const down = (e: PointerEvent) => (drag = e.clientX);
    const move = (e: PointerEvent) => {
      if (drag === null) return;
      yaw += (e.clientX - drag) * 0.012;
      drag = e.clientX;
      if (person) person.rotation.y = yaw;
    };
    const up = () => (drag = null);
    renderer.domElement.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    const resize = () => {
      const w = node.clientWidth;
      const h = node.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      // Redessiné aussitôt : un canvas redimensionné reste vide jusqu'à l'image suivante (clignotement)
      renderer.render(scene, camera);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(node);
    resize();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      mats.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
    // L'aperçu est créé une fois ; les changements passent par api.set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    api.current?.set(look);
  }, [look]);
  return (
    <div className="look-preview" ref={el}>
      <span className="look-hint">{useTranslation().t('look.drag')}</span>
    </div>
  );
}

/** Éditeur d'apparence façon « Look » : corps, coiffure, tenue, tissu, peau, cheveux, couleur. */
export default function LookEditor({ initial, onClose }: { initial: SavedLook; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useGame();
  const [l, setL] = useState<SavedLook>(initial);
  const set = (p: Partial<SavedLook>) => setL((x) => ({ ...x, ...p }));
  const random = () =>
    setL({
      female: Math.random() < 0.5,
      hair: HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)]!,
      outfit: OUTFITS[Math.floor(Math.random() * OUTFITS.length)]!,
      fabric: FABRICS[Math.floor(Math.random() * FABRICS.length)]!,
      skin: Math.floor(Math.random() * SKIN_TONES.length),
      hairColor: Math.floor(Math.random() * 3),
      color: Math.floor(Math.random() * CLOTH_COLORS.length),
    });
  const save = async () => {
    if (await run(() => saveLook(l), () => t('look.saved'))) onClose();
  };
  const chips = <T extends string>(list: readonly T[], value: T, key: string, pick: (v: T) => void) => (
    <div className="look-chips">
      {list.map((v) => (
        <button key={v} type="button" className={v === value ? 'look-chip on' : 'look-chip'} onClick={() => pick(v)}>
          {t(`look.${key}.${v}`)}
        </button>
      ))}
    </div>
  );
  const swatches = (list: number[], value: number, pick: (i: number) => void, label: string) => (
    <div className="look-swatches" role="radiogroup" aria-label={label}>
      {list.map((c, i) => (
        <button key={c} type="button" role="radio" aria-checked={i === value} aria-label={`${label} ${i + 1}`} className={i === value ? 'swatch-btn on' : 'swatch-btn'} style={{ background: hex(c) }} onClick={() => pick(i)} />
      ))}
    </div>
  );
  return (
    <div className="look-editor" role="dialog" aria-modal="true" aria-label={t('look.title')}>
      <header className="look-top">
        <button className="btn ghost small" onClick={onClose} aria-label={t('app.close')}>‹</button>
        <strong>{t('look.title')}</strong>
        <button className="btn small" onClick={random} aria-label={t('look.random')}>🔀</button>
      </header>
      <LookPreview look={l} />
      <div className="look-panel">
        <h4>{t('look.body')}</h4>
        <div className="look-chips two">
          <button type="button" className={l.female ? 'look-chip on' : 'look-chip'} onClick={() => set({ female: true })}>{t('look.woman')}</button>
          <button type="button" className={!l.female ? 'look-chip on' : 'look-chip'} onClick={() => set({ female: false })}>{t('look.man')}</button>
        </div>
        <h4>{t('look.hairstyle')}</h4>
        {chips(HAIR_STYLES, l.hair, 'hairs', (hair) => set({ hair }))}
        <h4>{t('look.outfit')}</h4>
        {chips(OUTFITS, l.outfit, 'outfits', (outfit) => set({ outfit }))}
        <h4>{t('look.fabric')}</h4>
        {chips(FABRICS, l.fabric, 'fabrics', (fabric) => set({ fabric }))}
        <h4>{t('look.color')}</h4>
        {swatches(CLOTH_COLORS, l.color, (color) => set({ color }), t('look.color'))}
        <h4>{t('look.skin')}</h4>
        {swatches(SKIN_TONES, l.skin, (skin) => set({ skin }), t('look.skin'))}
        <h4>{t('look.hairColor')}</h4>
        {swatches(HAIR_COLORS, l.hairColor, (hairColor) => set({ hairColor }), t('look.hairColor'))}
        <button className="btn primary big" disabled={busy} onClick={() => void save()}>{t('look.save')}</button>
      </div>
    </div>
  );
}
