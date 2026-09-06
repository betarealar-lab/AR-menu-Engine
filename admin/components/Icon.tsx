// Line icons, drawn here.
//
// Not an icon package: eight glyphs do not justify a dependency that has to be kept
// current forever, and these inherit `currentColor` so they follow the active state
// without a second colour prop.
//
// The sidebar used to render its "icon" as text - the word "Menu" in 10px uppercase next
// to the word "Menu" - so every row said itself twice. That is what these replace.

export type IconName =
  | 'home' | 'menu' | 'chart' | 'palette' | 'cube' | 'qr' | 'grid' | 'history'
  | 'external' | 'signout' | 'sun' | 'moon' | 'pulse' | 'user'

const PATHS: Record<IconName, string> = {
  home:     'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-5.5h5V20',
  menu:     'M4 6h16M4 12h16M4 18h11',
  chart:    'M4 20V10M10 20V4M16 20v-7M22 20H2',
  palette:  'M12 3a9 9 0 1 0 0 18c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.5-1.1-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.7-9-7.7Z M7.5 12.5h.01M10 8.5h.01M14.5 8h.01',
  cube:     'M12 2.8 20.5 7v10L12 21.2 3.5 17V7L12 2.8ZM12 21.2V11M20.5 7 12 11 3.5 7',
  qr:       'M4 4h6v6H4V4ZM14 4h6v6h-6V4ZM4 14h6v6H4v-6ZM14 14h2.5v2.5H14V14ZM19.5 14H20v.5M14 19.5V20h.5M19.5 19.5H20v.5',
  grid:     'M4 4h7v7H4V4ZM13 4h7v7h-7V4ZM4 13h7v7H4v-7ZM13 13h7v7h-7v-7Z',
  history:  'M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5M12 7.5V12l3 2',
  external: 'M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  signout:  'M15 17l5-5-5-5M20 12H9M12 20H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6',
  sun:      'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon:     'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  pulse:    'M2 12h4l3-8 6 16 3-8h4',
  user:     'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0',
}

export default function Icon({ name, size = 18, className = '' }: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={1.75}
         strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  )
}
