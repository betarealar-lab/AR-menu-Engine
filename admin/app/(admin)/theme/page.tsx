'use client'
import { useEffect, useState, useCallback, useMemo, type CSSProperties } from 'react'
import { loadThemeConfig, saveThemeConfig, setTemplate, loadTemplates } from '@/lib/data/theme'
import ThemePreview, { type PreviewMode } from '@/components/ThemePreview'
import { PALETTE_GROUPS } from '@/lib/palette'
import { uploadAsset } from '@/lib/upload'
import { useLang } from '@/lib/useLang'
import { usePlan } from '@/lib/usePlan'
import LockedCard from '@/components/LockedCard'
import { TEMPLATE_PRESETS, type ThemeConfig } from '@/lib/themePresets'
import { isThemeTemplateActionAllowed, normalizeThemeTabForRole, themeTabsForRole } from '@/lib/adminUx'

// Per-tenant editorial copy rendered by templates that have hero/visit sections.
// Editorial copy - hero kicker, info title, venue links - for four templates the
// platform has and we do not: baoma, burger_bar, mugsy_street_diner, pipes_fabrika. The
// whole section was gated on `CONTENT_TEMPLATES.has(template_key)`, and since our
// catalogue holds two stylesheets, none of it could ever render. Twenty-six field
// definitions and about forty translation keys behind a condition that is always false.
//
// The KEYS stay in the preserve-on-switch list below, deliberately. A restaurant imported
// from the platform may carry these values, nothing here renders them, and quietly
// deleting somebody's data because our UI cannot show it is not a tidy-up. When one of
// those templates gets a stylesheet, the editor comes back with it.
const CONTENT_KEYS = [
  'hero_kicker', 'hero_kicker_ka', 'hero_copy', 'hero_copy_ka', 'hero_cta', 'hero_cta_ka',
  'info_kicker', 'info_kicker_ka', 'info_title', 'info_title_ka',
  'location_address', 'location_address_ka', 'info_text', 'info_text_ka',
  'info_directions_label', 'info_directions_label_ka', 'info_directions_url',
  'info_instagram_label', 'info_instagram_url', 'info_map_query', 'info_map_link',
  'venue_links', 'info_image_url', 'mugsy_order_links', 'mugsy_locations',
]

// The hero clip is footage of this restaurant's food, so it belongs to the tenant
// the same way the hero photos do and survives a template switch with them.
const HERO_VIDEO_KEYS = ['hero_video_url', 'hero_video_mobile_url', 'hero_video_poster_url'] as const

// A hero clip that clears this is already an encoding mistake, not a slow upload.
// The real budget is ~1 MB; this is the wall, not the target.
const HERO_VIDEO_MAX_MB = 6

// Content survives a template switch — it describes the restaurant, not the look.
const BRANDING_KEYS = ['site_name', 'site_name_ka', 'logo_url', 'hero_logo_url', 'hero_image_url', 'hero_images', ...HERO_VIDEO_KEYS, ...CONTENT_KEYS]

// The hero gallery is stored in theme_config.hero_images as a JSON array of URLs.
// Older rows may hold a comma/newline list, so accept that shape too.
function parseHeroImages(raw?: string): string[] {
  const s = (raw || '').trim()
  if (!s) return []
  let list: unknown[] = []
  if (s[0] === '[') { try { list = JSON.parse(s) } catch { list = [] } }
  if (!list.length) list = s.replace(/^\[|\]$/g, '').split(/[,;\n]/)
  const out: string[] = []
  list.forEach(v => {
    const url = String(v).replace(/^["'\s]+|["'\s]+$/g, '')
    if (url && !out.includes(url)) out.push(url)
  })
  return out
}

// The colour rows come from lib/palette.ts now, grouped by what they change and labelled
// in the words an owner would use. The old lists were thirteen bare key names per mode -
// "Card", "Card 2", "Dim", "Accent (gold)" - which name the variable rather than the
// thing that moves, and "(gold)" was simply wrong for a restaurant whose accent is green.
// That file also owns which part of the real menu maps to which row, so the preview's
// click-to-edit and these labels cannot describe different colours.

// Two lists, because the two jobs are different. A heading font can have character; a
// body font has to survive a dish description at 14px on a phone in a dim restaurant, and
// a display face like Bebas Neue is unreadable there - which is what it was defaulted to.
// Every one of these is on Google Fonts and is loaded by the renderer the same way.
const HEADING_FONTS = [
  'Fraunces', 'Playfair Display', 'Bebas Neue', 'Oswald', 'Cormorant Garamond',
  'Libre Baskerville', 'Marcellus', 'Unbounded', 'Space Grotesk',
  'Montserrat', 'Poppins', 'Inter',
]
const BODY_FONTS = [
  'Nunito', 'Inter', 'Lato', 'Open Sans', 'Source Sans 3', 'Roboto',
  'Work Sans', 'Karla', 'Manrope', 'PT Serif', 'Merriweather', 'Montserrat',
]

type ThemeTabId = 'templates' | 'night' | 'day' | 'background' | 'fonts' | 'branding'

function isColor(v: string) {
  return /^#[0-9a-fA-F]{3,8}$/.test(v) || v.startsWith('rgb')
}

function toHex(v: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const m = v.match(/#(.)(.)(.)/)
    if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`
  }
  return '#000000'
}

// Pull the plain URL out of a CSS `url("…")` background-image value (empty if it's a
// gradient, `none`, or unset — so the picker only previews an actual uploaded image).
function bgImageUrl(v?: string): string {
  const m = /url\(["']?([^"')]+)["']?\)/.exec(v || '')
  return m ? m[1] : ''
}

function currentTemplateDefaults(config: ThemeConfig, restaurantSlug?: string | null): ThemeConfig {
  const templateKey = config.template_key
  const preset = TEMPLATE_PRESETS.find(item => item.key === templateKey)
    ?? (restaurantSlug === 'monday-greens' ? TEMPLATE_PRESETS.find(item => item.key === 'monday_greens') : undefined)
    ?? TEMPLATE_PRESETS[0]
  const preservedBranding = Object.fromEntries(
    BRANDING_KEYS
      .filter(key => Object.prototype.hasOwnProperty.call(config, key))
      .map(key => [key, config[key]]),
  )
  return { ...preset.values, ...preservedBranding, template_key: preset.key }
}

// Logo / hero images are converted to WebP client-side, then uploaded straight to R2
// via the presigned PUT (same path as menu thumbnails). Images are allowed for clients;
// only GLB/USDZ models are super-admin-only.
async function toWebP(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Conversion failed')), 'image/webp', 0.9)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')) }
    img.src = url
  })
}

// ── Contrast (WCAG) ───────────────────────────────────────────────────
// Each editable color is checked against the surface it sits on; a row warns
// when the ratio drops below 3:1 (the large/UI-text threshold). `against` = the
// row is foreground text over that key; `fg` = the row is a background and that
// key is the text on it.
const CONTRAST: Record<string, { against?: string; fg?: string }> = {
  text:          { against: 'card' },
  dim:           { against: 'card' },
  price_color:   { against: 'card' },
  add_btn_color: { against: 'card' },
  accent_text:   { against: 'accent' },
  badge_bg:      { fg: 'accent_text' },
  modal_bg:      { fg: 'dim' },
  bg:            { fg: 'text' },
  card:          { fg: 'text' },
  card2:         { fg: 'text' },
}
function hexToRgb(h: string): [number, number, number] | null {
  let s = (h || '').trim().replace('#', '')
  if (s.length === 3) s = s.split('').map(c => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)) as [number, number, number]
}
function relLum([r, g, b]: [number, number, number]): number {
  const a = [r, g, b].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) })
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]
}
function contrastRatio(a: string, b: string): number | null {
  const c1 = hexToRgb(a), c2 = hexToRgb(b)
  if (!c1 || !c2) return null
  const L1 = relLum(c1), L2 = relLum(c2), hi = Math.max(L1, L2), lo = Math.min(L1, L2)
  return (hi + 0.05) / (lo + 0.05)
}
// Effective on-screen color for a base field — mirrors the preview's fallbacks.
function effColor(field: string, mode: string, config: ThemeConfig): string | undefined {
  const v = config[`${mode}_${field}`]
  if (field === 'price_color')   return v || config[`${mode}_hero_color`] || config[`${mode}_accent`]
  if (field === 'add_btn_color') return v || config[`${mode}_accent`]
  if (field === 'badge_bg')      return v || config[`${mode}_accent`]
  return v
}
// The failing ratio (< 3) for a field key like "night_text", or null if fine/N-A.
function rowWarnRatio(fieldKey: string, config: ThemeConfig): number | null {
  const m = fieldKey.startsWith('day_') ? 'day' : 'night'
  const field = fieldKey.replace(/^(night|day)_/, '')
  const spec = CONTRAST[field]
  if (!spec) return null
  const fg = effColor(spec.fg || field, m, config)
  const bg = effColor(spec.against || field, m, config)
  if (!fg || !bg) return null
  const r = contrastRatio(fg, bg)
  return r != null && r < 3 ? r : null
}

export default function ThemePage() {
  const [T] = useLang()
  const plan = usePlan()
  const [config, setConfig]   = useState<ThemeConfig>({})
  const [savedConfig, setSavedConfig] = useState<ThemeConfig>({})
  // `loading` is DERIVED, not set inside the effect. Every one of these screens used to
  // open with `setLoading(plan.loading)` in the effect body, which is a synchronous state
  // write during an effect and so a second render before the first has painted - on every
  // screen, on every navigation. Tracking which restaurant the data belongs to says the
  // same thing without the extra render, and correctly shows loading again when somebody
  // switches restaurant.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const loading = plan.loading || (!!plan.restaurantId && loadedFor !== plan.restaurantId)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState('')
  const [tab, setTab]         = useState<ThemeTabId>('templates')
  // The palette being edited. The preview follows it, and the night/day tabs set it, so
  // there is one answer to "which mode am I looking at" rather than two that can disagree.
  const [mode, setMode]       = useState<PreviewMode>('night')
  // Only the templates we can actually RENDER. The preset list below has twenty-two
  // entries; `app/src/lib/css/` has two stylesheets. Picking any of the other twenty set a
  // template_key the renderer does not know, so it silently fell back to Monday Greens -
  // and the old mock preview happily showed the preset's colours on its own markup, so the
  // preview and the published page disagreed with nobody to notice.
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
  const [flashKey, setFlashKey]       = useState<string | null>(null)
  const [pendingPick, setPendingPick] = useState<string | null>(null)
  const text = useCallback((template: string, values: Record<string, string | number>) => (
    Object.entries(values).reduce(
      (result, [key, value]) => result.replace(`{${key}}`, String(value)),
      template,
    )
  ), [])

  // Unsaved-changes tracking: compare the working config against the last
  // persisted snapshot (order-independent).
  const dirty = useMemo(
    () => JSON.stringify(Object.entries(config).sort()) !== JSON.stringify(Object.entries(savedConfig).sort()),
    [config, savedConfig],
  )

  const load = useCallback(async () => {
    if (plan.loading || !plan.canUseTheme || !plan.restaurantId) return
    // 104 key/value rows became one row of two jsonb columns. Which side each key lands
    // on is isPaletteKey - the same rule that split the live restaurants on import.
    const map = await loadThemeConfig(plan.restaurantId)
    setConfig(map)
    setSavedConfig(map)
    setLoadedFor(plan.restaurantId)
  }, [plan.canUseTheme, plan.loading, plan.restaurantId])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  useEffect(() => {
    loadTemplates(config.template_key || '').then(rows =>
      setTemplates(rows.map(r => ({ id: r.id as string, name: r.name as string }))))
  }, [config.template_key])
  useEffect(() => {
    queueMicrotask(() => {
      setTab(current => normalizeThemeTabForRole(current, plan.role) as ThemeTabId)
    })
  }, [plan.role])

  // Leave guard #1 — warn on refresh / tab-close / external navigation.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // Leave guard #2 — confirm before an in-app (SPA) navigation away, e.g. the
  // sidebar links. Capture-phase so it runs before Next's <Link> click handler;
  // cancelling blocks the navigation. Skips new-tab / external / hash / modified
  // clicks (those don't lose the current edits).
  useEffect(() => {
    if (!dirty) return
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement).closest('a')
      const href = a?.getAttribute('href')
      if (!a || !href || a.target === '_blank' || href.startsWith('#') || /^[a-z]+:\/\//i.test(href)) return
      if (!window.confirm(T.unsavedLeave)) { e.preventDefault(); e.stopPropagation() }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [dirty, T])

  // Click-to-edit: the preview says which colour governs what was tapped, and the editor
  // goes to that row - the right tab, scrolled to, flashed, with the picker open. It is
  // the one thing the old mock did better than the real page, and it works across the
  // frame because both sides read the same map (lib/palette.ts).
  const pickField = useCallback((field: string) => {
    setTab(mode)                       // the palette being previewed is the one to edit
    setPendingPick(`${mode}_${field}`)
  }, [mode])

  useEffect(() => {
    if (!pendingPick) return
    const raf = requestAnimationFrame(() => {
      const row = document.getElementById(`crow-${pendingPick}`)
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const input = row.querySelector('input[type=color]') as (HTMLInputElement & { showPicker?: () => void }) | null
        try { input?.showPicker?.() } catch { input?.focus() }
      }
      setFlashKey(pendingPick)
      setPendingPick(null)
    })
    return () => cancelAnimationFrame(raf)
  }, [pendingPick, tab])
  useEffect(() => {
    if (!flashKey) return
    const t = setTimeout(() => setFlashKey(null), 1300)
    return () => clearTimeout(t)
  }, [flashKey])

  const [uploadingKey, setUploadingKey] = useState('')

  function set(key: string, value: string) {
    setConfig(c => ({ ...c, [key]: value }))
  }

  function setColor(key: string, value: string) {
    setConfig(current => {
      const next = { ...current, [key]: value }
      if ((key === 'night_bg' || key === 'day_bg') && value.trim()) {
        const prefix = key === 'night_bg' ? 'night' : 'day'
        next[`${prefix}_bg2`] = value
        next[`${prefix}_bg_image`] = 'linear-gradient(180deg, var(--bg) 0%, var(--bg) 100%)'
        next[`${prefix}_bg_size`] = 'auto'
        next[`${prefix}_bg_repeat`] = 'no-repeat'
      }
      // The thumbnail stage renders with --stage-bg and the modal with
      // --modal-bg-image; templates set those explicitly, which would override
      // a plain thumb_bg / modal_bg color and make the picker look like it does
      // nothing. Re-link the derived token to the chosen color so it takes.
      if ((key === 'night_thumb_bg' || key === 'day_thumb_bg') && value.trim()) {
        const prefix = key === 'night_thumb_bg' ? 'night' : 'day'
        next[`${prefix}_stage_bg`] = 'var(--thumb-bg)'
      }
      if ((key === 'night_modal_bg' || key === 'day_modal_bg') && value.trim()) {
        const prefix = key === 'night_modal_bg' ? 'night' : 'day'
        next[`${prefix}_modal_bg_image`] = 'linear-gradient(180deg, var(--modal-bg) 0%, var(--modal-bg) 100%)'
      }
      return next
    })
  }

  async function uploadImage(key: string, file: File) {
    if (!file.type.startsWith('image/')) { setMsg(T.onlyImageFiles); return }
    setUploadingKey(key)
    try {
      const blob = await toWebP(file)
      const { url: publicUrl } = await uploadAsset(blob, 'hero', plan.restaurantId, file.name)
      set(key, publicUrl)
      setMsg(T.imageUploaded)
    } catch (e) {
      setMsg(text(T.uploadFailed, { message: e instanceof Error ? e.message : String(e) }))
    }
    setUploadingKey('')
  }

  // ── Hero gallery ───────────────────────────────────────────────────────────
  // Photos live in hero_images (JSON array). hero_image_url is kept in sync with the
  // first photo, so the single-image fallback keeps working everywhere.
  const heroImages = parseHeroImages(config.hero_images)

  function writeHeroImages(list: string[]) {
    setConfig(c => ({ ...c, hero_images: JSON.stringify(list), hero_image_url: list[0] ?? '' }))
  }

  // Appends against the freshest config, so uploading several files can't drop any.
  function appendHeroImages(urls: string[]) {
    setConfig(c => {
      const current = parseHeroImages(c.hero_images)
      const merged = [...current, ...urls.filter(u => !current.includes(u))]
      return { ...c, hero_images: JSON.stringify(merged), hero_image_url: merged[0] ?? '' }
    })
  }

  async function uploadHeroImages(files: File[]) {
    const picked = files.filter(f => f.type.startsWith('image/'))
    if (!picked.length) { setMsg(T.onlyImageFiles); return }
    setUploadingKey('hero_images')
    const added: string[] = []
    try {
      for (const file of picked) {
        const blob = await toWebP(file)
        const { url: publicUrl } = await uploadAsset(blob, 'hero', plan.restaurantId, file.name)
        added.push(publicUrl)
      }
      appendHeroImages(added)
      setMsg(text(T.heroPhotosUploaded, { count: added.length }))
    } catch (e) {
      setMsg(text(T.uploadFailed, { message: e instanceof Error ? e.message : String(e) }))
    }
    setUploadingKey('')
  }

  function removeHeroImage(index: number) {
    writeHeroImages(heroImages.filter((_, n) => n !== index))
  }

  // ── Hero video ─────────────────────────────────────────────────────────────
  // Uploaded as-is: unlike photos, there is no browser-side re-encode that could
  // rescue an oversized file, so an unencoded one is refused rather than pushed
  // to R2 and hung on the top of a guest's first screen.
  async function uploadHeroVideo(key: string, file: File) {
    if (!/\.mp4$/i.test(file.name)) { setMsg(T.onlyMp4Files); return }
    const mb = file.size / (1024 * 1024)
    if (mb > HERO_VIDEO_MAX_MB) {
      // A cap on PAGE WEIGHT, not on what the server accepts - this clip sits on top of
      // every diner's first screen. The live ones are 1.2 and 1.6 MB. Encode it down
      // rather than raising this.
      setMsg(`${file.name} is ${mb.toFixed(1)} MB. A hero video has to stay under `
             + `${HERO_VIDEO_MAX_MB} MB — it loads before anything else a diner sees. `
             + `Encode it smaller and try again.`)
      return
    }
    setUploadingKey(key)
    try {
      // Ours to upload, not an owner's: nothing in a browser trims a video, and a phone
      // hands over tens of megabytes at the top of the page. The route enforces it.
      const { url: publicUrl } = await uploadAsset(file, 'video', plan.restaurantId, file.name)
      set(key, publicUrl)
      setMsg(T.heroVideoUploaded)
    } catch (e) {
      setMsg(text(T.uploadFailed, { message: e instanceof Error ? e.message : String(e) }))
    }
    setUploadingKey('')
  }

  function moveHeroImage(index: number, dir: -1 | 1) {
    const to = index + dir
    if (to < 0 || to >= heroImages.length) return
    const list = [...heroImages]
    const held = list[index]
    list[index] = list[to]
    list[to] = held
    writeHeroImages(list)
  }

  // Background images set the CSS background-image token (url(...)) plus cover/no-repeat,
  // so an uploaded photo fills the whole menu backdrop.
  async function uploadBgImage(mode: 'night' | 'day', file: File) {
    if (!file.type.startsWith('image/')) { setMsg(T.onlyImageFiles); return }
    const key = `${mode}_bg_image`
    setUploadingKey(key)
    try {
      const blob = await toWebP(file)
      const { url: publicUrl } = await uploadAsset(blob, 'hero', plan.restaurantId, file.name)
      set(key, `url("${publicUrl}")`)
      set(`${mode}_bg_size`, 'cover')
      set(`${mode}_bg_repeat`, 'no-repeat')
      setMsg(T.backgroundImageUploaded)
    } catch (e) {
      setMsg(text(T.uploadFailed, { message: e instanceof Error ? e.message : String(e) }))
    }
    setUploadingKey('')
  }

  async function save() {
    setSaving(true)
    await saveThemeConfig(plan.restaurantId!, config)
    setSavedConfig({ ...config })
    setSaving(false)
    setMsg(T.saved)
    setTimeout(() => setMsg(''), 4000)
  }

  async function reset() {
    if (!confirm(T.resetConfirm)) return
    const next = currentTemplateDefaults(config, plan.restaurantSlug)
    // A reset REPLACES the bag rather than merging over it - that is the point of a reset,
    // and saveThemeConfig writes both columns whole, so a key the template does not define
    // genuinely goes away instead of surviving as a leftover nobody can see.
    const error = await saveThemeConfig(plan.restaurantId!, next)
    if (error) {
      setMsg(text(T.resetFailed, { message: error.message }))
      setTimeout(() => setMsg(''), 5000)
      return
    }
    setConfig(next)
    setSavedConfig({ ...next })
    setMsg(T.resetDone)
    setTimeout(() => setMsg(''), 3000)
  }

  // Legibility hint for a color row (or null). Built here so it can be localized.
  const warnText = (key: string): string | null => {
    const r = rowWarnRatio(key, config)
    return r != null ? `${T.contrastLow} (${r.toFixed(1)}:1)` : null
  }

  const templateActionsAllowed = isThemeTemplateActionAllowed(plan.role)
  const tabLabels: Record<ThemeTabId, string> = {
    templates: T.tabPresets,
    night: T.tabNight,
    day: T.tabDay,
    background: T.tabBackground,
    fonts: T.tabFonts,
    branding: T.tabBranding,
  }
  const tabs = themeTabsForRole(plan.role).map(item => ({
    id: item.id as ThemeTabId,
    label: tabLabels[item.id as ThemeTabId],
  }))

  if (!plan.loading && !plan.restaurantId) {
    return (
      <div className="max-w-xl rounded-xl p-6" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--dim)' }}>
          {T.tenantRequired}
        </div>
        <h1 className="text-xl md:text-2xl font-bold page-title" style={{ color: 'var(--gold)' }}>
          {T.noRestaurantMapped}
        </h1>
        <p className="text-sm mt-2 leading-6" style={{ color: 'var(--dim)' }}>
          {T.noRestaurantThemeDesc}
        </p>
      </div>
    )
  }

  if (!plan.loading && !plan.canUseTheme) {
    return (
      <LockedCard
        title={T.themeLockedTitle}
        description={T.themeLockedDesc}
        planLabel={plan.label}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div className="mr-auto">
          <h1 className="page-title">{T.themeTitle}</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
            {dirty ? 'Unsaved changes — the preview is showing them' : 'Everything saved'}
          </p>
        </div>
        {msg && <span className="pill pill-on">{msg}</span>}
        {dirty && !msg && <span className="pill pill-wait">unsaved</span>}
        <button onClick={reset} className="btn btn-ghost btn-danger">{T.reset}</button>
        <button onClick={save} disabled={saving || !dirty} className="btn btn-primary">
          {saving ? T.saving : T.saveChanges}
        </button>
      </div>

      {/* The preview comes FIRST in the document, and stays on the right on a wide screen
          via `order`. On anything narrower there is no room for two columns, and an editor
          that puts its controls first makes you scroll past every field to find out what
          they did - worst of all on the branding tab, which is the longest one. Seeing the
          menu before you touch it is most of knowing what to touch. */}
      <div className="flex flex-col xl:flex-row gap-6 items-start">
        <ThemePreview slug={plan.restaurantSlug} config={config} mode={mode}
                      onMode={setMode} template={config.template_key || ''}
                      onPick={pickField} />

        <div className="w-full xl:flex-1 xl:min-w-0 xl:max-w-2xl xl:order-first">

      <div className="flex gap-0.5 mb-5 p-0.5 rounded-lg w-fit flex-wrap"
           style={{ background: 'var(--card2)' }}>
        {tabs.map(t => (
          <button key={t.id}
                  onClick={() => {
                    setTab(t.id)
                    // The preview follows the palette being edited. Set here rather than
                    // in an effect on `tab`: it is derived from a click, and deriving it
                    // in an effect is a second render that can also disagree for a frame.
                    if (t.id === 'day' || t.id === 'night') setMode(t.id)
                  }}
                  className="px-3.5 py-1.5 rounded-md text-sm font-semibold transition-colors"
                  style={{ background: tab === t.id ? 'var(--card)' : 'transparent',
                           color: tab === t.id ? 'var(--text)' : 'var(--dim)',
                           boxShadow: tab === t.id ? 'var(--shadow)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--dim)' }}>{T.loading}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 max-w-2xl">
          {tab === 'templates' && templateActionsAllowed && (
            <div className="grid gap-3">
              {/* SHAPE. Which stylesheet the page is rendered with - and only the ones we
                  ship, read from the catalogue rather than from the preset list below. */}
              <div className="card p-4">
                <div className="eyebrow mb-1">Layout</div>
                <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
                  The shape of the page. Colours, fonts and photos sit on top of it and
                  carry across when you switch.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {templates.map(tpl => {
                    const on = (config.template_key || '') === tpl.id
                    return (
                      <button key={tpl.id} type="button"
                              onClick={async () => {
                                setConfig(c => ({ ...c, template_key: tpl.id }))
                                // Written straight through: the template is a column the
                                // renderer joins on, not a value in the palette bag, and
                                // the preview has to reload to pick up a new stylesheet.
                                if (plan.restaurantId) await setTemplate(plan.restaurantId, tpl.id)
                                setMsg(text(T.templateLoaded, { name: tpl.name }))
                              }}
                              className="text-left px-4 py-3 rounded-lg text-sm font-semibold transition-colors"
                              style={{ border: `1px solid ${on ? 'var(--gold)' : 'var(--border)'}`,
                                       background: on ? 'var(--gold-dim)' : 'var(--bg)',
                                       color: on ? 'var(--gold)' : 'var(--text)' }}>
                        {tpl.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* PALETTE. A starting set of colours, applied ON TOP of whatever layout is
                  chosen - so these stopped carrying a template_key with them. That was the
                  bug: twenty-two "templates" for two stylesheets. */}
              <div className="eyebrow px-1 pt-2">Colour palettes</div>
              {TEMPLATE_PRESETS.map(preset => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => {
                    if (!templateActionsAllowed) return
                    const colours = { ...preset.values }
                    delete colours.template_key
                    setConfig(current => ({ ...current, ...colours }))
                    setMsg(text(T.templateLoaded, { name: preset.label }))
                  }}
                  className="text-left p-4 rounded-xl transition-colors"
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }}
                >
                  <div className="flex items-center gap-3">
                    <TemplateSwatch values={preset.values} />
                    <div className="min-w-0">
                      <div className="font-semibold" style={{ color: 'var(--gold)' }}>{preset.label}</div>
                      <div className="text-sm mt-1" style={{ color: 'var(--dim)' }}>{preset.description}</div>
                    </div>
                  </div>
                </button>
              ))}
              <div className="text-xs leading-5" style={{ color: 'var(--dim)' }}>
                {T.templatesHint}
              </div>
            </div>
          )}
          {(tab === 'night' || tab === 'day') && (
            <>
              <p className="text-xs" style={{ color: 'var(--dim)' }}>
                Tap anything in the preview to jump to the colour that changes it. Leave a
                row empty to use the template&rsquo;s own.
              </p>
              {PALETTE_GROUPS.map(group => (
                <div key={group.id} className="card p-4">
                  <div className="eyebrow mb-0.5">{group.title}</div>
                  {group.hint && (
                    <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>{group.hint}</p>
                  )}
                  <div className={group.hint ? '' : 'mt-3'}>
                    {group.fields.map(f => {
                      const key = `${tab}_${f.key}`
                      return (
                        <ColorRow key={key} fieldKey={key} label={f.label} what={f.what}
                                  value={config[key] ?? ''}
                                  flash={flashKey === key} warning={warnText(key)}
                                  onChange={v => setColor(key, v)} />
                      )
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
          {tab === 'background' && (
            <>
              <p className="text-xs px-1" style={{ color: 'var(--dim)' }}>{T.bgHint}</p>
              {(['night', 'day'] as const).map(m => (
                <div key={m} className="card p-4">
                  <div className="eyebrow mb-0.5">{m === 'night' ? T.tabNight : T.tabDay}</div>
                  <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
                    {m === 'night'
                      ? 'What most diners see: the menu opens dark unless you say otherwise.'
                      : 'The lighter palette, for daytime or a bright room.'}
                  </p>
                  <ColorRow label="Page colour" what="Behind everything on the page."
                            value={config[`${m}_bg`] ?? ''}
                            onChange={v => setColor(`${m}_bg`, v)} />
                  <div className="mt-3">
                    <ImageUploadRow label={T.bgImageLabel}
                                    hint="Optional. A texture or photo behind the dishes — keep it quiet, it sits under everything."
                                    value={bgImageUrl(config[`${m}_bg_image`])}
                                    uploading={uploadingKey === `${m}_bg_image`}
                                    uploadLabel={T.uploadThumb} clearLabel={T.bgClearImage}
                                    previewAlt={T.imagePreviewAlt}
                                    onPick={f => uploadBgImage(m, f)}
                                    onClear={() => set(`${m}_bg_image`, 'none')} />
                  </div>
                </div>
              ))}
            </>
          )}
          {tab === 'fonts' && (
            <>
              <div className="card p-4">
                <div className="eyebrow mb-0.5">Headings</div>
                <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
                  The restaurant name and the category names. This one can have character.
                </p>
                <FontRow label={T.fontHeading} preview={T.fontPreview} fonts={HEADING_FONTS}
                         value={config.font_heading ?? 'Fraunces'}
                         onChange={v => set('font_heading', v)} />
              </div>

              <div className="card p-4">
                <div className="eyebrow mb-0.5">Body</div>
                <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
                  Dish names, descriptions and prices. It has to stay readable at 14px on a
                  phone in a dim room, so plainer is better here.
                </p>
                <FontRow label={T.fontBody} preview={T.fontPreview} fonts={BODY_FONTS}
                         value={config.font_body ?? 'Nunito'}
                         onChange={v => set('font_body', v)} />
              </div>

              <p className="text-xs px-1" style={{ color: 'var(--dim)' }}>
                {T.fontNote}
                <a href="https://fonts.google.com" target="_blank" rel="noreferrer"
                   style={{ color: 'var(--gold)' }}>{T.fontNoteLink}</a>
                {T.fontNoteEnd}
              </p>
            </>
          )}
          {tab === 'branding' && (
            <>
              <div className="card p-4">
                <div className="eyebrow mb-0.5">Name</div>
                <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
                  What diners see at the top of the menu.
                </p>
                <BrandRow label={T.brandNameEn} value={config.site_name ?? ''}
                          onChange={v => set('site_name', v)} />
                <BrandRow label={T.brandNameKa} value={config.site_name_ka ?? ''}
                          onChange={v => set('site_name_ka', v)} />
              </div>

              <div className="card p-4">
                <div className="eyebrow mb-0.5">Logo</div>
                <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
                  Sits in the header, above the dishes. A transparent PNG or WebP reads
                  best on both the day and night palettes.
                </p>
                <ImageUploadRow label={T.brandLogo} hint={T.brandLogoHint} value={config.logo_url ?? ''}
                                uploading={uploadingKey === 'logo_url'} uploadLabel={T.uploadThumb}
                                clearLabel={T.clearThumb} previewAlt={T.imagePreviewAlt}
                                onPick={f => uploadImage('logo_url', f)} onClear={() => set('logo_url', '')} />
              </div>

              <div className="card p-4">
                <div className="eyebrow mb-0.5">Hero</div>
                <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
                  The first thing a diner sees. One photo is a still hero; two or more
                  crossfade. About three quarters of diners scroll past this - it is the
                  single most looked-at thing on the menu.
                </p>
                {/* The old single "Hero image" row was removed: the gallery replaces it
                    (one photo = a still hero, two or more crossfade). hero_image_url is
                    still written from the first gallery photo, so the fallback keeps
                    working. */}
                <HeroGalleryRow label={T.brandHeroGallery} hint={T.brandHeroGalleryHint}
                                images={heroImages} uploading={uploadingKey === 'hero_images'}
                                addLabel={T.heroAddImages} removeLabel={T.heroRemove}
                                upLabel={T.heroMoveUp} downLabel={T.heroMoveDown}
                                emptyLabel={T.heroEmpty} previewAlt={T.imagePreviewAlt}
                                onPick={uploadHeroImages} onRemove={removeHeroImage} onMove={moveHeroImage} />
              </div>

              {/* Ours to upload, and the server says so too (api/asset). A photo the
                  browser re-encodes to WebP can only get smaller; a clip straight off a
                  phone is tens of megabytes on top of a diner's first screen and nothing
                  in a browser trims it. We grade and encode these. */}
              {plan.canUploadModels && (
                <div className="card p-4">
                  <div className="eyebrow mb-0.5">Hero video · BetaReal</div>
                  <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
                    Plays behind the hero instead of a photo. Keep it under
                    {' '}{HERO_VIDEO_MAX_MB} MB — the live ones are about 1.5 MB. The
                    poster is what shows while it loads, and on any device that will not
                    autoplay.
                  </p>
                  <VideoUploadRow label={T.heroVideoWide} hint={T.heroVideoWideHint}
                                  value={config.hero_video_url ?? ''}
                                  uploading={uploadingKey === 'hero_video_url'}
                                  uploadLabel={T.uploadThumb} clearLabel={T.clearThumb}
                                  onPick={f => uploadHeroVideo('hero_video_url', f)}
                                  onClear={() => set('hero_video_url', '')} />
                  <VideoUploadRow label={T.heroVideoMobile} hint={T.heroVideoMobileHint}
                                  value={config.hero_video_mobile_url ?? ''}
                                  uploading={uploadingKey === 'hero_video_mobile_url'}
                                  uploadLabel={T.uploadThumb} clearLabel={T.clearThumb}
                                  onPick={f => uploadHeroVideo('hero_video_mobile_url', f)}
                                  onClear={() => set('hero_video_mobile_url', '')} />
                  <ImageUploadRow label={T.heroVideoPoster} hint={T.heroVideoPosterHint}
                                  value={config.hero_video_poster_url ?? ''}
                                  uploading={uploadingKey === 'hero_video_poster_url'}
                                  uploadLabel={T.uploadThumb} clearLabel={T.clearThumb}
                                  previewAlt={T.imagePreviewAlt}
                                  onPick={f => uploadImage('hero_video_poster_url', f)}
                                  onClear={() => set('hero_video_poster_url', '')} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-8 p-4 rounded-xl text-sm"
           style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--dim)' }}>{T.reloadHint}</span>
        {(() => {
          // Link to THIS tenant's live menu (base + ?tenant=<slug>), matching how the
          // customer app resolves tenants — not a bare, tenant-less URL.
          const base = (process.env.NEXT_PUBLIC_CUSTOMER_APP_URL || 'https://restaurant-ar.pages.dev').replace(/\/$/, '')
          const url = plan.restaurantSlug ? `${base}/?tenant=${encodeURIComponent(plan.restaurantSlug)}` : base
          return (
            <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
              {url.replace(/^https?:\/\//, '')} ↗
            </a>
          )
        })()}
      </div>
        </div>

      </div>
    </div>
  )
}

/** One colour. The label says what moves; `what` says it in a sentence. A row is a row in
 *  a group now rather than a card of its own - thirteen cards in a column is thirteen
 *  boxes competing with each other and no sense of which belong together. */
function ColorRow({ fieldKey, label, what, value, onChange, flash, warning }:
  { fieldKey?: string; label: string; what?: string; value: string
    onChange: (v: string) => void; flash?: boolean; warning?: string | null }) {
  const colorVal = isColor(value) ? toHex(value) : '#000000'
  return (
    <div id={fieldKey ? `crow-${fieldKey}` : undefined}
         className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg"
         style={{ borderTop: '1px solid var(--border)',
                  background: flash ? 'var(--gold-dim)' : 'transparent',
                  boxShadow: flash ? '0 0 0 2px var(--gold)' : undefined,
                  transition: 'background .25s, box-shadow .25s' }}>
      <input type="color" value={colorVal} onChange={e => onChange(e.target.value)}
             aria-label={label}
             style={{ width: 40, height: 40, padding: 2, flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold leading-tight">{label}</div>
        {what && (
          <div className="text-[11px] leading-4 mt-0.5" style={{ color: 'var(--dim)' }}>{what}</div>
        )}
      </div>
      <input value={value} onChange={e => onChange(e.target.value)}
             className="font-mono shrink-0"
             style={{ fontSize: '0.75rem', padding: '5px 8px', width: 118,
                      borderColor: warning ? 'var(--danger)' : undefined }}
             placeholder="template" />
      {warning && (
        <span title={warning} className="shrink-0" style={{ cursor: 'help', lineHeight: 0 }}>
          <svg width="17" height="15" viewBox="0 0 16 14" aria-hidden="true">
            <path d="M8 1.4 L15 12.6 H1 Z" fill="none" stroke="#e0533c" strokeWidth="1.5" strokeLinejoin="round" />
            <line x1="8" y1="5.4" x2="8" y2="8.8" stroke="#e0533c" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="10.9" r="0.9" fill="#e0533c" />
          </svg>
        </span>
      )}
      <div className="w-10 h-8 rounded-md border shrink-0"
           style={{ background: value, borderColor: 'var(--border)' }} />
    </div>
  )
}

function TemplateSwatch({ values }: { values: ThemeConfig }) {
  return (
    <span
      className="relative block h-14 w-20 shrink-0 overflow-hidden rounded-lg"
      style={{
        background: values.day_bg_image ?? `linear-gradient(135deg, ${values.day_bg}, ${values.day_bg2 ?? values.day_bg})`,
        border: `1px solid ${values.day_border ?? 'var(--border)'}`,
      }}
      aria-hidden="true"
    >
      <span
        className="absolute left-2 top-2 h-8 w-11 rounded-md"
        style={{
          background: values.day_card_bg ?? `linear-gradient(135deg, ${values.day_card}, ${values.day_card2 ?? values.day_card})`,
          boxShadow: values.day_item_shadow ?? '0 4px 12px rgba(0,0,0,0.12)',
        }}
      />
      <span
        className="absolute bottom-2 right-2 h-4 w-9 rounded-full"
        style={{ background: values.day_cta_bg ?? values.day_accent }}
      />
    </span>
  )
}

/** One font. The list is the job's list - headings and body have different needs - and
 *  the sample is set in the face itself, loaded on demand, because a font name means
 *  nothing to anybody until they see it. */
function FontRow({ label, value, preview, fonts, onChange }: {
  label: string; value: string; preview: string
  fonts: readonly string[]; onChange: (v: string) => void
}) {
  useEffect(() => {
    const links = fonts.map(fam => {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam)}:wght@400;600&display=swap`
      document.head.appendChild(l)
      return l
    })
    return () => { links.forEach(l => l.remove()) }
  }, [fonts])

  return (
    <div>
      <div className="text-sm font-semibold mb-2">{label}</div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
        {fonts.map(f => {
          const on = value === f
          return (
            <button key={f} type="button" onClick={() => onChange(f)}
                    className="text-left px-3 py-2 rounded-lg transition-colors"
                    style={{ border: `1px solid ${on ? 'var(--gold)' : 'var(--border)'}`,
                             background: on ? 'var(--gold-dim)' : 'var(--bg)' }}>
              <div style={{ fontFamily: `'${f}', system-ui, sans-serif`, fontSize: 17,
                            color: on ? 'var(--gold)' : 'var(--text)', lineHeight: 1.25 }}>
                {preview}
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>{f}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Multi-photo hero. Order matters (it's the order guests see), so each row carries
// up/down controls — arrows rather than drag, so it behaves the same on a phone.
function HeroGalleryRow({ label, hint, images, uploading, addLabel, removeLabel, upLabel, downLabel, emptyLabel, previewAlt, onPick, onRemove, onMove }: {
  label: string; hint: string; images: string[]; uploading: boolean
  addLabel: string; removeLabel: string; upLabel: string; downLabel: string
  emptyLabel: string; previewAlt: string
  onPick: (files: File[]) => void; onRemove: (index: number) => void; onMove: (index: number, dir: -1 | 1) => void
}) {
  const arrowBtn: CSSProperties = {
    background: 'var(--card2)', color: 'var(--gold)',
    border: '1px solid var(--border)', borderRadius: 6,
    width: 28, height: 28, lineHeight: 1, cursor: 'pointer',
  }
  return (
    <div className="p-3 rounded-xl" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      <div className="text-xs mb-2 uppercase tracking-widest" style={{ color: 'var(--dim)' }}>{label}</div>

      <label className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer inline-block"
             style={{ background: 'var(--card2)', color: 'var(--gold)', border: '1px solid var(--border)', opacity: uploading ? 0.5 : 1 }}>
        {uploading ? '…' : addLabel}
        <input type="file" accept="image/*" multiple style={{ display: 'none' }} disabled={uploading}
               onChange={e => {
                 const files = Array.from(e.target.files || [])
                 if (files.length) onPick(files)
                 e.target.value = ''
               }} />
      </label>

      {images.length === 0 && (
        <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>{emptyLabel}</p>
      )}

      {images.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 list-none p-0">
          {images.map((url, i) => (
            <li key={`${url}-${i}`} className="flex items-center gap-3 p-2 rounded-lg"
                style={{ background: 'var(--card2)', border: '1px solid var(--border)' }}>
              <span className="text-xs w-5 text-center shrink-0" style={{ color: 'var(--dim)' }}>{i + 1}</span>
              <img src={url} alt={previewAlt}
                   style={{ height: 44, width: 68, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
              <span className="flex-1" />
              <button type="button" onClick={() => onMove(i, -1)} disabled={i === 0}
                      title={upLabel} aria-label={upLabel}
                      style={{ ...arrowBtn, opacity: i === 0 ? 0.35 : 1 }}>↑</button>
              <button type="button" onClick={() => onMove(i, 1)} disabled={i === images.length - 1}
                      title={downLabel} aria-label={downLabel}
                      style={{ ...arrowBtn, opacity: i === images.length - 1 ? 0.35 : 1 }}>↓</button>
              <button type="button" onClick={() => onRemove(i)} title={removeLabel} aria-label={removeLabel}
                      style={{ background: 'rgba(224,82,82,0.1)', color: 'var(--danger)',
                               border: '1px solid rgba(224,82,82,0.25)', borderRadius: 6,
                               width: 28, height: 28, lineHeight: 1, cursor: 'pointer' }}>×</button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs mt-2" style={{ color: 'var(--dim)' }}>{hint}</p>
    </div>
  )
}

function ImageUploadRow({ label, hint, value, uploading, uploadLabel, clearLabel, previewAlt, onPick, onClear }: {
  label: string; hint: string; value: string; uploading: boolean; uploadLabel: string; clearLabel: string; previewAlt: string
  onPick: (f: File) => void; onClear: () => void
}) {
  return (
    <div className="p-3 rounded-xl" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      <div className="text-xs mb-2 uppercase tracking-widest" style={{ color: 'var(--dim)' }}>{label}</div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer"
               style={{ background: 'var(--card2)', color: 'var(--gold)', border: '1px solid var(--border)', opacity: uploading ? 0.5 : 1 }}>
          {uploading ? '…' : uploadLabel}
          <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploading}
                 onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }} />
        </label>
        {value && (
          <>
            <button type="button" onClick={onClear} className="px-3 py-1.5 rounded text-xs font-medium"
                    style={{ background: 'rgba(224,82,82,0.1)', color: 'var(--danger)', border: '1px solid rgba(224,82,82,0.25)' }}>
              {clearLabel}
            </button>
            <img src={value} alt={previewAlt}
                 style={{ height: 40, maxWidth: 120, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--border)' }} />
          </>
        )}
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--dim)' }}>{hint}</p>
    </div>
  )
}

// Same shape as ImageUploadRow, but the preview has to be a <video>: an <img>
// pointed at an MP4 is just a broken icon, which reads as a failed upload.
// Muted + loop + playsInline so the preview behaves like the live hero does.
function VideoUploadRow({ label, hint, value, uploading, uploadLabel, clearLabel, onPick, onClear }: {
  label: string; hint: string; value: string; uploading: boolean; uploadLabel: string; clearLabel: string
  onPick: (f: File) => void; onClear: () => void
}) {
  return (
    <div className="p-3 rounded-xl" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      <div className="text-xs mb-2 uppercase tracking-widest" style={{ color: 'var(--dim)' }}>{label}</div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer"
               style={{ background: 'var(--card2)', color: 'var(--gold)', border: '1px solid var(--border)', opacity: uploading ? 0.5 : 1 }}>
          {uploading ? '…' : uploadLabel}
          <input type="file" accept="video/mp4,.mp4" style={{ display: 'none' }} disabled={uploading}
                 onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }} />
        </label>
        {value && (
          <>
            <button type="button" onClick={onClear} className="px-3 py-1.5 rounded text-xs font-medium"
                    style={{ background: 'rgba(224,82,82,0.1)', color: 'var(--danger)', border: '1px solid rgba(224,82,82,0.25)' }}>
              {clearLabel}
            </button>
            <video src={value} muted loop playsInline autoPlay preload="metadata"
                   style={{ height: 56, maxWidth: 140, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
          </>
        )}
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--dim)' }}>{hint}</p>
    </div>
  )
}

function BrandRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="p-3 rounded-xl"
         style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      <div className="text-xs mb-2 uppercase tracking-widest" style={{ color: 'var(--dim)' }}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
