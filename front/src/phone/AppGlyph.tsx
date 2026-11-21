import type { ReactElement } from 'react';

/** Pictogrammes « filaires » des applications du téléphone (traits blancs arrondis, façon SF Symbols). */
const PATHS: Record<string, string> = {
  "dash": "M5 20V11M12 20V4M19 20v-6",
  "chat": "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  "messages": "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  "work": "M3 8h18v12H3zM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M3 13h18",
  "ride": "M6 18a3 3 0 1 0 0-.01M18 18a3 3 0 1 0 0-.01M6 18h5l3-8h3M13 10l-2-3H8",
  "garage": "M3 13l2-5h14l2 5v5H3zM3 13h18M7 18v2M17 18v2",
  "intercity": "M5 4h14a1 1 0 0 1 1 1v12H4V5a1 1 0 0 1 1-1zM4 11h16M8 20v-3M16 20v-3",
  "hotel": "M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6",
  "contacts": "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  "music": "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  "games": "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01",
  "guide": "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
  "wallet": "M4 6h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3 10h18M7 15h4",
  "tontine": "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 5.4a3 3 0 0 1 0 5.2M17 14a6 6 0 0 1 4 6",
  "market": "M3 9h18l-2 11H5zM8 9l3-5M16 9l-3-5",
  "family": "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z",
  "company": "M4 21V4h10v17M14 9h6v12M8 8h2M8 12h2M8 16h2M3 21h18",
  "school": "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5",
  "trade": "M3 17l2 3h14l2-3zM6 17V9h12v8M12 9V4",
  "estate": "M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6",
  "industry": "M3 21V10l6 4V10l6 4V6h4v15zM7 17h2M12 17h2M17 17h2",
  "invest": "M3 17l6-6 4 4 8-8M15 7h6v6",
  "fx": "M4 8h14l-3-3M20 16H6l3 3",
  "notes": "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7",
  "study": "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5M9 8h3",
  "kitchen": "M4 10h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6zM2 11h2M20 11h2M9 4c0 1.5 1.5 1.5 1.5 3M14 4c0 1.5 1.5 1.5 1.5 3",
  "eat": "M3 11h18a9 9 0 0 1-18 0zM8 4c0 2 2 2 2 4M13 4c0 2 2 2 2 4",
  "journal": "M12 7a4 4 0 0 0-4-3H3v15h5a4 4 0 0 1 4 3 4 4 0 0 1 4-3h5V4h-5a4 4 0 0 0-4 3zM12 7v15",
  "rent": "M3 11l9-8 9 8M5 10v10h14V10M10 20v-5h4v5",
  "rest": "M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z",
  "payroll": "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  "shop": "M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0",
  "ads": "M3 11v3h4l8 4V7L7 11zM18 9a4 4 0 0 1 0 6",
  "map": "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  "places": "M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11zM12 10h.01",
  "agenda": "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  "news": "M5 4h11v16H5zM16 8h3v10a2 2 0 0 1-2 2M8 8h5M8 12h5M8 16h3",
  "health": "M3 12h4l2-5 4 10 2-5h6",
  "weather": "M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1A4 4 0 0 1 17 18z",
  "bank": "M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18",
  "calc": "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01",
  "bugs": "M9 7a3 3 0 0 1 6 0M8 9h8v6a4 4 0 0 1-8 0zM4 10l4 2M20 10l-4 2M4 18l4-2M20 18l-4-2M12 9v10M9 4L7.5 2M15 4l1.5-2",
  "settings": "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2",
  "faith": "M12 2v4M10 4h4M5 21V11l7-5 7 5v10M3 21h18M10 21v-4a2 2 0 0 1 4 0v4",
  "public": "M3 9l9-5 9 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 21h18M3 18h18",
  "people": "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 20a6 6 0 0 0-4-5.6",
  "globe": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  "rocket": "M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 15l-3-3c1-4 4-8 9-9 1 0 3 0 3 0s0 2 0 3c-1 5-5 8-9 9zM14 10h.01",
  "flag": "M5 21V4M5 4h11l-2 4 2 4H5"
};

export function hasGlyph(id: string): boolean {
  return id in PATHS;
}

export default function AppGlyph({ id, size = 30, color = '#fff' }: { id: string; size?: number; color?: string }): ReactElement | null {
  const d = PATHS[id];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
