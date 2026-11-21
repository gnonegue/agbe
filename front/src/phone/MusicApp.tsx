import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentTrack, isPlaying, musicOn, musicVolume, nextTrack, nowPlayingTrack, onMusicChange, playClip, setMusicOn, setMusicVolume, stopMusic } from '../lib/music';
import { playTogoRadio, RANKING, searchTracks, trendYear, yearRanking, type Artist, type CatalogTrack, type YearRow } from '../lib/musicCatalog';
import { matches } from '../lib/search';

/**
 * Musique : lecteur (ambiance, radio togolaise, aperçus), classement des artistes du Togo du meilleur au moins bien classé,
 * titres du moment trouvés en direct, recherche libre et volume. L'écoute complète se fait sur les plateformes officielles.
 */
const PLATFORMS: [string, string, (q: string) => string][] = [
  ['YouTube', '▶️', (q) => `https://www.youtube.com/results?search_query=${q}`],
  ['Spotify', '🟢', (q) => `https://open.spotify.com/search/${q}`],
  ['Audiomack', '🎵', (q) => `https://audiomack.com/search?q=${q}`],
];

const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

function TrackRow({ track, onPlay, now }: { track: CatalogTrack; onPlay: (t: CatalogTrack) => void; now: boolean }) {
  const { t } = useTranslation();
  return (
    <li className={`item${now ? ' playing' : ''}`}>
      {track.artwork && <img src={track.artwork} alt="" width={40} height={40} loading="lazy" style={{ borderRadius: 8 }} />}
      <div className="item-main">
        <strong>{track.title}</strong>
        <small className="muted">{track.artist}{track.year ? ` · ${track.year}` : ''}</small>
      </div>
      <button type="button" className="btn small" onClick={() => onPlay(track)} aria-label={t('music.playPreview', { title: track.title })}>{now ? '🔊' : '▶️'}</button>
      <button type="button" className="btn ghost small" onClick={() => open(track.url ?? PLATFORMS[0]![2](encodeURIComponent(`${track.artist} ${track.title}`)))}>{t('music.fullTrack')}</button>
    </li>
  );
}

export default function MusicApp() {
  const { t } = useTranslation();
  const [, refresh] = useState(0);
  useEffect(() => onMusicChange(() => refresh((n) => n + 1)), []);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<CatalogTrack[] | null>(null);
  // Classement de l'année (calculé une fois par jour) : tendances et ordre des artistes
  const [rows, setRows] = useState<YearRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    void yearRanking().then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, []);
  const year = trendYear();
  const chart: { artist: Artist; tracks: CatalogTrack[] }[] | null = rows ? rows.filter((r) => r.thisYear.length > 0).slice(0, 10).map((r) => ({ artist: r.artist, tracks: r.thisYear.slice(0, 2) })) : null;
  // Recherche libre : classement local immédiat + titres trouvés en direct (après une courte pause de frappe)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return void setFound(null);
    let alive = true;
    const id = window.setTimeout(() => void searchTracks(q, 25).then((r) => alive && setFound([...r].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)))), 350);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [query]);
  // Ordre de l'année dès qu'il est connu (sinon l'ordre éditorial), avec le nombre de titres sortis cette année
  const ranked = useMemo(() => {
    const list = rows ?? RANKING.map((artist) => ({ artist, thisYear: [] as CatalogTrack[], latest: [] as CatalogTrack[] }));
    return list.map((r, i) => ({ a: r.artist, rank: i + 1, n: r.thisYear.length })).filter(({ a }) => matches(query, a.name, t(`music.artists.${a.key}`)));
  }, [rows, query, t]);
  const playing = isPlaying();
  const track = currentTrack();
  const clip = nowPlayingTrack();
  const play = (tr: CatalogTrack) => playClip(tr);
  return (
    <section>
      <h2>🎵 {t('music.title')}</h2>
      <div className="panel">
        <strong>{playing ? '🔊' : '🔇'} {t('music.player')}</strong>
        <p className="small-line">{clip ? `${clip.artist} — ${clip.title}` : track ? `${track.artist} — ${track.title}` : t('music.ambient')}</p>
        <div className="row-between">
          <button type="button" className="btn primary" onClick={() => (playing ? (stopMusic(), setMusicOn(false)) : setMusicOn(true))}>
            {playing ? `⏸ ${t('music.pause')}` : `▶️ ${t('music.play')}`}
          </button>
          <button type="button" className="btn" onClick={() => void playTogoRadio()}>📻 {t('music.radio')}</button>
          {track && (
            <button type="button" className="btn" onClick={() => void nextTrack()}>⏭ {t('music.next')}</button>
          )}
        </div>
        <label className="small-line" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.5rem' }}>
          🔈
          <input type="range" min={0} max={100} value={Math.round(musicVolume() * 100)} onChange={(e) => setMusicVolume(Number(e.target.value) / 100)} aria-label={t('music.volume')} style={{ flex: 1 }} />
          🔊
        </label>
        {!musicOn() && !clip && <small className="muted">{t('music.offHint')}</small>}
      </div>
      <input className="phone-search" style={{ background: 'rgba(0,0,0,.06)', color: 'inherit', textAlign: 'left' }} type="search" placeholder={t('music.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('music.search')} />
      {found !== null && (
        <>
          <h3>{t('music.results')}</h3>
          {found.length === 0 ? <p className="muted">{t('music.noResults')}</p> : <ul className="list">{found.map((x) => <TrackRow key={x.id} track={x} onPlay={play} now={clip?.title === x.title} />)}</ul>}
        </>
      )}
      {query.trim().length < 2 && (
        <>
          <h3>🔥 {t('music.chart', { year })}</h3>
          {chart === null && <p className="muted">{t('app.loading')}</p>}
          {chart?.length === 0 && <p className="muted">{t(navigator.onLine ? 'music.chartNone' : 'music.chartOffline', { year })}</p>}
          {chart?.map(({ artist, tracks }, i) => (
            <div key={artist.key}>
              <small className="muted">#{i + 1} {artist.name}</small>
              <ul className="list">{tracks.map((x) => <TrackRow key={x.id} track={x} onPlay={play} now={clip?.title === x.title} />)}</ul>
            </div>
          ))}
        </>
      )}
      <h3>🏆 {t('music.ranking', { year })}</h3>
      <p className="muted">{t('music.intro')}</p>
      {ranked.map(({ a, rank, n }) => (
        <div key={a.key} className={`panel artist${n > 0 ? ' star' : ''}`}>
          <div className="artist-head">
            <span className="artist-avatar" aria-hidden="true">{a.emoji}</span>
            <div>
              <strong>#{rank} {a.name}</strong>
              {n > 0 && <small className="ok"> ★ {t('music.yearTracks', { count: n, year })}</small>}
              <p className="small-line">{t(`music.artists.${a.key}`)}</p>
            </div>
          </div>
          <div className="row-between">
            {PLATFORMS.map(([name, icon, url]) => (
              <button key={name} type="button" className="btn ghost small" onClick={() => open(url(encodeURIComponent(a.name)))} aria-label={t('music.listenOn', { artist: a.name, platform: name })}>
                {icon} {name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <small className="muted">{t('music.support')}</small>
    </section>
  );
}
