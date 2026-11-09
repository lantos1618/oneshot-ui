/** Icons: inline SVG paths (24×24, stroke) and <Icon>. Add your own paths to ICONS. Part of @lyndon/ui/core. */
import { type CSSProperties } from 'react'
import { cn } from './helpers'
import { uiShared } from './shared'

/* ════════════════════════════════════════════════════════════════════════════
 * 3. ICONS: inline paths (24×24, stroke). Add your own to ICONS.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every icon path known on the page, by name. Each copy of the library (the package, each drop-in file) adds its ICONS
 * when it loads, so a drop-in that embeds only the icons it uses still draws any other name another file brought;
 * apps add their own with registerIcons.
 */
const iconRegistry = uiShared('icons', () => Object.create(null) as Record<string, string>)

export const ICONS = {
  check: 'M5 12l5 5L20 7', x: 'M18 6 6 18M6 6l12 12', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  chevronDown: 'm6 9 6 6 6-6', chevronUp: 'm18 15-6-6-6 6', chevronRight: 'm9 18 6-6-6-6', chevronLeft: 'm15 18-6-6 6-6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  heart: 'M19.5 12.6 12 20l-7.5-7.4A4.9 4.9 0 0 1 12 6a4.9 4.9 0 0 1 7.5 6.6z',
  star: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 6 10 6a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  upload: 'M12 16V4m0 0-5 5m5-5 5 5M4 20h16', file: 'M14 3H6v18h12V7zM14 3v4h4',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3', edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  share: 'M4 12v7h16v-7M12 3v12M7 8l5-5 5 5', bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', home: 'M3 11l9-8 9 8M5 10v10h14V10',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z', folder: 'M3 6h6l2 2h10v11H3z', menu: 'M4 6h16M4 12h16M4 18h16',
  send: 'M12 19V5m0 0-6 6m6-6 6 6', stop: 'M7 7h10v10H7z', sparkles: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01', mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  columns: 'M4 4h16v16H4zM9.5 4v16M14.5 4v16', pinLeft: 'M4 4v16M20 12H9M13 8l-4 4 4 4', pinRight: 'M20 4v16M4 12h11M11 8l4 4-4 4',
  more: 'M5 12h.01M12 12h.01M19 12h.01', grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', terminal: 'M4 17l6-5-6-5M12 19h8',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  arrowUp: 'M12 19V5M5 12l7-7 7 7', arrowDown: 'M12 5v14M19 12l-7 7-7-7', refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5', monitor: 'M3 4h18v12H3zM8 20h8M12 16v4', keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  code: 'm8 8-5 4 5 4M16 8l5 4-5 4', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z', card: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM2 10h20', message: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2', mapPin: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  users: 'M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2 20a7 7 0 0 1 14 0M16 4a3.5 3.5 0 0 1 0 7M22 20a7 7 0 0 0-4-6.3', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z', book: 'M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 0 2 2h14', panel: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 4v16', wifiOff: 'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.4-1.7M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 10.7 5M12 20h.01',
  thumbUp: 'M7 10v11H3V10zM7 10l4-8a3 3 0 0 1 3 3v4h6a2 2 0 0 1 2 2.3l-1.4 8a2 2 0 0 1-2 1.7H7', plug: 'M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5', sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4', image: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM21 16l-5-5L5 20', hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5V4a1.5 1.5 0 0 1 3 0v8m0-6.5a1.5 1.5 0 0 1 3 0V13m0-4.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.3 15.5a1.6 1.6 0 0 1 2.4-2.1L8 14.8', rocket: 'M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1zM12 15l-3-3a22 22 0 0 1 2-4A13 13 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2zM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5', bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z', undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  // folded in from the layout, editor, diagram, code, media and chat glyph sets
  paperclip: 'm21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8',
  commit: 'M3 12h6m6 0h6M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  pullRequest: 'M6 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-4m0 0 2-2m-2 2 2 2',
  branch: 'M6 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 8.5v7M18 10.5c0 4-6 3-11 6',
  alertCircle: 'M12 9v4M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  listBullet: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01', listOrdered: 'M10 6h10M10 12h10M10 18h10M4 4v4M3 8h2M3 14h2l-2 3h2',
  listPlus: 'M4 6h11M4 12h11M4 18h7M18 15v6M15 18h6', quote: 'M7 8h4v4H8a3 3 0 0 0 3 3M14 8h4v4h-3a3 3 0 0 0 3 3',
  database: 'M4 5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  fileText: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h4', layout: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 9h18M9 21V9',
  bot: 'M7 7h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zM12 3v4M9 13h.01M15 13h.01',
  shieldCheck: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4', plane: 'm22 2-7 20-4-9-9-4z',
  cloud: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z', webhook: 'M18 16a4 4 0 1 1-4 4M6 16a4 4 0 1 0 4 4M12 4a4 4 0 0 0-2 7.5L6 16m6-12a4 4 0 0 1 2 7.5L18 16',
  stream: 'M3 6h13M3 12h18M3 18h9', warehouse: 'M3 21V9l9-6 9 6v12M7 21v-8h10v8M7 17h10', asterisk: 'M12 2v20M2 12h20M5 5l14 14M19 5 5 19',
  diff: 'M12 3v8M8 7h8M8 17h8', wrap: 'M3 6h18M3 12h15a3 3 0 0 1 0 6h-4m0 0 2-2m-2 2 2 2M3 18h7',
  replay: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5', forward: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  play: 'M8 5.5v13l11-6.5z', pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  volume: 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13', volumeX: 'M11 5 6 9H3v6h3l5 4zM16 9l6 6M22 9l-6 6',
  maximize: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', minimize: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  bookmark: 'M6 3h12v18l-6-4-6 4z', imageOff: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 16l5-5 4 4 3-3 6 6M3 3l18 18',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5M8 11h6M11 8v6',
  chevronsLeftRight: 'm9 6-6 6 6 6M15 6l6 6-6 6',
  alignLeft: 'M4 6h16M4 12h10M4 18h14', alignCenter: 'M4 6h16M7 12h10M5 18h14', alignRight: 'M4 6h16M10 12h10M6 18h14',
} as const

export type IconName = keyof typeof ICONS

/**
 * Add icon paths page-wide (24×24 viewBox, stroke `d` strings): `registerIcons({ logo: 'M4 4h16v16H4z' })`, then
 * `<Icon name={'logo' as IconName} />` or `<IconButton icon="logo" label="Home" />`. Existing names are kept.
 */
export function registerIcons(paths: Record<string, string>) {
  for (const k of Object.keys(paths)) if (!(k in iconRegistry) && typeof paths[k] === 'string') iconRegistry[k] = paths[k]
}
registerIcons(ICONS)

/** The path of an icon by name (ICONS, then the page-wide registry), or undefined. */
export const iconPath = (name: string): string | undefined => (ICONS as Record<string, string | undefined>)[name] ?? iconRegistry[name]

/**
 * An icon from ICONS (24×24 stroke paths). `filled` draws it solid in the text colour (play, pause, star); `fill` paints the
 * inside of a stroked one. Decorative: always aria-hidden, so label the control around it.
 */
export function Icon({ name, size = 16, strokeWidth = 2, className, fill = 'none', filled, style }:
  { name: IconName; size?: number; strokeWidth?: number; className?: string; fill?: string; filled?: boolean; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : fill} stroke={filled ? 'none' : 'currentColor'} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={cn('flex-none', className)} style={style} aria-hidden="true">
      <path d={iconPath(name)} />
    </svg>
  )
}

/** True when `v` names a known icon (ICONS or registerIcons). */
export const isIconName = (v: unknown): v is IconName => typeof v === 'string' && iconPath(v) !== undefined
