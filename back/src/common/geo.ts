import geoip from 'geoip-country';

/** Code pays ISO-3166-1 (2 lettres) depuis une IP, ou null si locale/inconnue. Base MaxMind GeoLite2 embarquée, aucun appel réseau. */
export function countryOf(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return geoip.lookup(ip)?.country ?? null;
}
