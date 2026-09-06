'use client'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLang } from '@/lib/useLang'
import { usePlan } from '@/lib/usePlan'
import { uploadAsset } from '@/lib/upload'
import {
  loadMenu,
  saveItem as saveItemRow,
  deleteItem as deleteItemRow,
  saveCategory as saveCategoryRow,
  deleteCategory as deleteCategoryRow,
  saveSettings,
  saveItemView,
} from '@/lib/data/menu'
import {
  DEFAULT_MENU_FILTERS,
  filterMenuItems,
  inferMenuGroupForCategory,
  menuFiltersAreActive,
  parseDrinkCategories,
  serializeDrinkCategories,
} from '@/lib/menuFilters'

// Ids are uuids now, not numbers. Nothing here ever did arithmetic on one - they are
// only ever passed back to a query - so this is a type change and not a logic change.
type Category = { id: string; name_en: string; name_ka: string; sort_order: number }
type MenuGroup = 'food' | 'drink'
type MenuItem = {
  id: string; name_en: string; name_ka: string
  description_en: string; description_ka: string
  price: string; category_id: string | null; model: string; model_usdz: string
  sort_order: number; visible: boolean; ar_scale: number; thumbnail_url: string; thumb_3d: boolean; is_3d: boolean; text_only: boolean; featured: boolean
  // The library is pointers, not copies (MENU-PLATFORM §3): `model` is the url a viewer
  // loads, `model_id` is which row it came from and the only thing that can be changed.
  model_id: string | null
  // A dish priced more than one way. 30 of the 170 live dishes have these.
  variants: { [lang: string]: string }[]
}
type MenuItemPayload = Partial<Omit<MenuItem, 'id'>> & Pick<
  Omit<MenuItem, 'id'>,
  'name_en' | 'name_ka' | 'description_en' | 'description_ka' | 'price' | 'category_id' | 'sort_order' | 'visible' | 'thumbnail_url'
>
type MenuFilters = {
  query: string
  menuGroup: 'all' | MenuGroup
  categoryId: string
  visibility: 'all' | 'visible' | 'hidden'
  mediaState: 'all' | 'ar' | 'photo' | 'text' | 'missing-image'
  quality: 'all' | 'missing-en' | 'missing-ka' | 'missing-price'
}
const EMPTY_ITEM: Omit<MenuItem, 'id'> = {
  name_en: '', name_ka: '', description_en: '', description_ka: '',
  price: '', category_id: null, model: '', model_usdz: '', sort_order: 0, visible: true, ar_scale: 1.0, thumbnail_url: '', thumb_3d: false, is_3d: true, text_only: false, featured: false,
  model_id: null, variants: [],
}

function isActiveArItem(item: Pick<MenuItem, 'visible' | 'model' | 'is_3d'>) {
  return item.visible && item.is_3d && item.model.trim().length > 0
}

function normalizeTextOnlyItem(item: Omit<MenuItem, 'id'>) {
  if (!item.text_only) return item
  return {
    ...item,
    is_3d: false,
    model: '',
    model_usdz: '',
    thumbnail_url: '',
    thumb_3d: false,
    ar_scale: 1.0,
  }
}

// Per-item starting camera view for the customer 3D thumbnail/preview. Stored in
// theme_config (key `item_view_<itemId>`, value "h v zoom") — not a menu_items
// column, so it needs no schema migration. index.html reads the same keys.
const DEFAULT_ITEM_VIEW = { h: 0, v: 75, zoom: 105 }
function parseItemView(raw?: string) {
  const parts = (raw || '').trim().split(/\s+/).map(Number)
  if (parts.length === 3 && parts.every(n => Number.isFinite(n))) {
    return { h: parts[0], v: parts[1], zoom: parts[2] }
  }
  return { ...DEFAULT_ITEM_VIEW }
}

export default function MenuPage() {
  const supabase = createClient()
  const [T, lang] = useLang()
  const plan = usePlan()
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems]           = useState<MenuItem[]>([])
  const [filters, setFilters]       = useState<MenuFilters>({ ...DEFAULT_MENU_FILTERS } as MenuFilters)
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<'items' | 'categories'>('items')
  const [showFilters, setShowFilters] = useState(false)

  const [itemModal, setItemModal]   = useState(false)
  const [editItem, setEditItem]     = useState<MenuItem | null>(null)
  const [itemForm, setItemForm]     = useState<Omit<MenuItem, 'id'>>(EMPTY_ITEM)
  const [itemMenuGroup, setItemMenuGroup] = useState<MenuGroup>('food')
  const [drinkCategoryNames, setDrinkCategoryNames] = useState<Set<string>>(new Set())
  const [drinkCategoriesConfigured, setDrinkCategoriesConfigured] = useState(false)
  const [itemViews, setItemViews]   = useState<Record<string, string>>({})
  const [viewForm, setViewForm]     = useState({ ...DEFAULT_ITEM_VIEW })
  const [sortOrderTouched, setSortOrderTouched] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [deleteId, setDeleteId]     = useState<string | null>(null)

  const [catModal, setCatModal]         = useState(false)
  const [editCat, setEditCat]           = useState<Category | null>(null)
  const [catForm, setCatForm]           = useState({ name_en: '', name_ka: '', sort_order: 0 })
  const [deleteCatId, setDeleteCatId]   = useState<string | null>(null)

  const [msg, setMsg] = useState('')
  const [phoneLayout, setPhoneLayout] = useState<'list' | 'twin'>('list')
  const [spinEnabled, setSpinEnabled] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const glbInputRef = useRef<HTMLInputElement>(null)
  const usdzInputRef = useRef<HTMLInputElement>(null)
  const itemFormPanelRef = useRef<HTMLDivElement>(null)
  const [thumbUploading, setThumbUploading] = useState(false)
  const [thumbProgress, setThumbProgress] = useState('')
  const thumbInputRef = useRef<HTMLInputElement>(null)
  const text = useCallback((template: string, values: Record<string, string | number>) => (
    Object.entries(values).reduce(
      (result, [key, value]) => result.replace(`{${key}}`, String(value)),
      template,
    )
  ), [])

  const load = useCallback(async () => {
    if (plan.loading || !plan.restaurantId) {
      setLoading(plan.loading)
      return
    }
    setLoading(true)
    // Six queries became three, and four of those six were theme_config key lookups that
    // are one `tenants` row now. Everything that maps the new schema onto the shape this
    // screen speaks lives in lib/data/menu.ts and nowhere else.
    const { categories: cats, items: its, settings } = await loadMenu(plan.restaurantId)
    setCategories(cats)
    setItems(its)
    setItemViews(settings.itemViews)
    setPhoneLayout(settings.phoneLayout)
    setSpinEnabled(settings.spinEnabled)
    setDrinkCategoryNames(parseDrinkCategories(settings.drinkCategories))
    setDrinkCategoriesConfigured(settings.drinkCategories != null)
    setLoading(false)
  }, [plan.loading, plan.restaurantId])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  useEffect(() => {
    if (!itemModal) return
    requestAnimationFrame(() => {
      itemFormPanelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }, [itemModal, editItem])

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  // Phone layout toggle. ON = twin (two photo cards per row on phones); OFF =
  // the default single/list view. Saved immediately to theme_config; the
  // customer app reads `phone_layout` and only switches when it is "twin", so
  // desktop and non-twin tenants are unaffected.
  async function updatePhoneLayout(v: 'list' | 'twin') {
    if (!plan.restaurantId) return
    setPhoneLayout(v)
    const error = await saveSettings(plan.restaurantId, { phone_layout: v })
    flash(error ? text(T.saveFailed, { message: error.message })
                : v === 'twin' ? T.twinPhoneOn
                               : T.singlePhoneOn)
  }

  // 360° Spin toggle. ON adds a "360° SPIN" button in the 3D viewer that slowly
  // auto-rotates the dish (hands-free). Saved to theme_config.spin_enabled; the
  // customer app shows the button only when this is truthy, so it's off by default.
  async function updateSpinEnabled(on: boolean) {
    if (!plan.restaurantId) return
    setSpinEnabled(on)
    const error = await saveSettings(plan.restaurantId,
                                     { spin_enabled: on ? 'true' : 'false' })
    flash(error ? text(T.saveFailed, { message: error.message })
                : on ? T.spinOn
                     : T.spinOff)
  }

  const activeArItemCount = items.filter(isActiveArItem).length
  const itemLimitLabel = plan.itemLimit === null ? T.unlimited : String(plan.itemLimit)
  const planLimitReached = plan.itemLimit !== null && activeArItemCount >= plan.itemLimit

  function activeCountWithForm() {
    const existingItems = editItem ? items.filter(item => item.id !== editItem.id) : items
    const normalizedForm = normalizeTextOnlyItem(itemForm)
    const formItem = { visible: normalizedForm.visible, model: normalizedForm.model, is_3d: normalizedForm.is_3d }
    return existingItems.filter(isActiveArItem).length + (isActiveArItem(formItem) ? 1 : 0)
  }

  function nextSortOrderForCategory(categoryId: string | null) {
    const categoryItems = items.filter(item => item.category_id === categoryId)
    const maxSortOrder = categoryItems.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), 0)
    return maxSortOrder + 1
  }

  function categoryForGroup(categoryId: string | null) {
    return categoryId === null
      ? { id: '', name_en: 'Other', name_ka: 'სხვა', sort_order: 0 }
      : categories.find(category => category.id === categoryId) ?? null
  }

  function groupForCategory(categoryId: string | null): MenuGroup {
    return inferMenuGroupForCategory(categoryForGroup(categoryId), drinkCategoryNames, !drinkCategoriesConfigured)
  }

  function nextDrinkCategoryNames(categoryId: string | null, group: MenuGroup) {
    const category = categoryForGroup(categoryId)
    const name = String(category?.name_en || '').trim()
    if (!name) return drinkCategoryNames
    const next = new Set(drinkCategoryNames)
    if (group === 'drink') {
      next.add(name.toLocaleLowerCase())
    } else {
      next.delete(name.toLocaleLowerCase())
    }
    return next
  }

  async function saveDrinkCategoriesForItem(categoryId: string | null, group: MenuGroup) {
    if (!plan.restaurantId) return { error: null as { message: string } | null }
    const next = nextDrinkCategoryNames(categoryId, group)
    const value = serializeDrinkCategories(
      categoryId === null && next.has('other')
        ? [...categories, { id: '', name_en: 'Other', name_ka: 'სხვა', sort_order: 0 }]
        : categories,
      next,
    )
    const error = await saveSettings(plan.restaurantId, { drink_categories: value })
    if (!error) {
      setDrinkCategoryNames(next)
      setDrinkCategoriesConfigured(true)
    }
    return { error }
  }

  function itemPayloadForSave(base: Omit<MenuItem, 'id'>): MenuItemPayload {
    const normalized = normalizeTextOnlyItem(base)
    if (plan.canUploadModels) return normalized

    const payload: MenuItemPayload = {
      name_en: normalized.name_en,
      name_ka: normalized.name_ka,
      description_en: normalized.description_en,
      description_ka: normalized.description_ka,
      price: normalized.price,
      category_id: normalized.category_id,
      sort_order: normalized.sort_order,
      visible: normalized.visible,
      thumbnail_url: normalized.thumbnail_url,
      text_only: normalized.text_only,
      featured: normalized.featured,
    }

    if (!editItem || normalized.text_only) {
      payload.is_3d = false
      payload.model = ''
      payload.model_usdz = ''
      payload.thumb_3d = false
      payload.ar_scale = 1.0
    }

    return payload
  }

  function openNewItem() {
    const categoryId = categories[0]?.id ?? null
    setEditItem(null)
    setSortOrderTouched(false)
    setItemForm({
      ...EMPTY_ITEM,
      category_id: categoryId,
      sort_order: nextSortOrderForCategory(categoryId),
      is_3d: plan.canUploadModels,
    })
    setItemMenuGroup(groupForCategory(categoryId))
    setViewForm({ ...DEFAULT_ITEM_VIEW })
    setItemModal(true)
  }
  function openEditItem(item: MenuItem) {
    setEditItem(item)
    setSortOrderTouched(true)
    setItemForm({ name_en: item.name_en, name_ka: item.name_ka,
      description_en: item.description_en, description_ka: item.description_ka,
      price: item.price, category_id: item.category_id, model: item.model, model_usdz: item.model_usdz ?? '',
      sort_order: item.sort_order, visible: item.visible, ar_scale: item.ar_scale ?? 1.0,
      thumbnail_url: item.thumbnail_url ?? '', thumb_3d: item.thumb_3d ?? false, is_3d: item.is_3d ?? true, featured: item.featured ?? false,
      model_id: item.model_id ?? null, variants: item.variants ?? [],
      text_only: item.text_only ?? (!item.is_3d && !item.thumbnail_url && !item.model && !item.model_usdz) })
    setItemMenuGroup(groupForCategory(item.category_id))
    setViewForm(parseItemView(itemViews[item.id]))
    setItemModal(true)
  }
  async function saveItem() {
    if (!plan.restaurantId) {
      flash(T.noRestaurantMappedShort)
      return
    }
    if (plan.itemLimit !== null && activeCountWithForm() > plan.itemLimit) {
      flash(text(T.planLimitReached, { active: activeArItemCount, limit: plan.itemLimit }))
      return
    }
    setSaving(true)
    const nextItemForm = editItem || sortOrderTouched
      ? itemForm
      : { ...itemForm, sort_order: nextSortOrderForCategory(itemForm.category_id) }
    const payload = itemPayloadForSave(nextItemForm) as Omit<MenuItem, 'id'>

    const { id: savedId, error } = await saveItemRow(
      plan.restaurantId, editItem?.id ?? null, payload)
    if (error) {
      setSaving(false)
      flash(text(T.saveFailed, { message: error.message }))
      return
    }

    const { error: drinkCategoryError } = await saveDrinkCategoriesForItem(nextItemForm.category_id, itemMenuGroup)
    if (drinkCategoryError) {
      setSaving(false)
      flash(text(T.saveFailed, { message: drinkCategoryError.message }))
      return
    }

    // The angle goes onto the MODEL, not the item (0003_model_view): it describes how to
    // frame a mesh, so attaching that mesh to a second dish carries the framing with it
    // rather than making somebody type it again. A dish with no model has nothing to
    // frame, and the data layer says so rather than writing a stray row.
    if (savedId) {
      const isDefaultView = viewForm.h === DEFAULT_ITEM_VIEW.h && viewForm.v === DEFAULT_ITEM_VIEW.v && viewForm.zoom === DEFAULT_ITEM_VIEW.zoom
      const clear = isDefaultView || !nextItemForm.is_3d || nextItemForm.text_only
      await saveItemView(nextItemForm.model_id,
                         clear ? '' : `${viewForm.h} ${viewForm.v} ${viewForm.zoom}`)
    }
    setSaving(false); setItemModal(false); setUploadProgress(''); setThumbProgress(''); await load()
    flash(editItem ? T.itemUpdated : T.itemAdded)
  }
  async function confirmDelete() {
    if (!deleteId) return
    // No second delete for the camera angle any more: it lives on the model, and the model
    // outlives the dish on purpose. It cost 30 credits and it is still the library's.
    const error = await deleteItemRow(deleteId)
    setDeleteId(null); await load()
    flash(error ? text(T.saveFailed, { message: error.message }) : T.itemDeleted)
  }

  function openNewCat() {
    setEditCat(null)
    setCatForm({ name_en: '', name_ka: '', sort_order: categories.length + 1 })
    setCatModal(true)
  }
  function openEditCat(cat: Category) {
    setEditCat(cat)
    setCatForm({ name_en: cat.name_en, name_ka: cat.name_ka, sort_order: cat.sort_order })
    setCatModal(true)
  }
  async function saveCat() {
    if (!plan.restaurantId) {
      flash(T.noRestaurantMappedShort)
      return
    }
    setSaving(true)
    // Straight to the table rather than through /api/categories/reorder. That route exists
    // to renumber sort_order across a restaurant in one transaction on the OLD schema; our
    // positions are per-tenant integers and RLS already scopes the write, so the round trip
    // through a server route bought nothing but a second place to be wrong.
    const { error } = await saveCategoryRow(plan.restaurantId, editCat?.id ?? null, catForm)
    if (error) {
      setSaving(false)
      flash(error.message || T.categorySaveFailed)
      return
    }
    setSaving(false); setCatModal(false); await load()
    flash(editCat ? T.catUpdated : T.catAdded)
  }
  async function confirmDeleteCat() {
    if (!deleteCatId) return
    // The dishes survive: the foreign key is `on delete set null`, so they fall into
    // "no category" and can be re-filed. Tidying up must not destroy a morning's typing.
    const error = await deleteCategoryRow(deleteCatId)
    setDeleteCatId(null); await load()
    flash(error ? text(T.saveFailed, { message: error.message }) : T.catDeleted)
  }

  const categoryName = useCallback((cat: Category) =>
    lang === 'ka'
      ? cat.name_ka || cat.name_en || '—'
      : cat.name_en || cat.name_ka || '—',
    [lang],
  )
  const catName = (id: string | null) => {
    const category = categories.find(c => c.id === id)
    return category ? categoryName(category) : '—'
  }
  const filteredItems = useMemo<MenuItem[]>(
    () => filterMenuItems(items, categories, filters, drinkCategoryNames, !drinkCategoriesConfigured) as MenuItem[],
    [items, categories, filters, drinkCategoryNames, drinkCategoriesConfigured],
  )
  const filtersActive = menuFiltersAreActive(filters)
  const resultCountLabel = T.menuResultCount
    .replace('{shown}', String(filteredItems.length))
    .replace('{total}', String(items.length))
  function updateFilter<K extends keyof MenuFilters>(key: K, value: MenuFilters[K]) {
    setFilters(current => ({ ...current, [key]: value }))
  }
  function clearFilters() {
    setFilters({ ...DEFAULT_MENU_FILTERS } as MenuFilters)
  }

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
          {T.noRestaurantMenuDesc}
        </p>
      </div>
    )
  }

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
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Conversion failed')), 'image/webp', 0.88)
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')) }
      img.src = url
    })
  }

  async function uploadImage(file: File) {
    if (!file.type.startsWith('image/')) {
      setThumbProgress(T.onlyImageFiles)
      return
    }
    setThumbUploading(true)
    setThumbProgress(T.uploading)
    let blob: Blob
    try {
      blob = await toWebP(file)
    } catch {
      setThumbProgress(T.couldNotProcessImage)
      setThumbUploading(false)
      return
    }
    try {
      const publicUrl = await uploadAsset(blob, 'photo', plan.restaurantId, file.name)
      setItemForm(f => ({ ...f, thumbnail_url: publicUrl, text_only: false }))
      setThumbProgress(text(T.uploadedFile, { name: file.name }))
    } catch (e) {
      setThumbProgress(text(T.uploadFailed, { message: e instanceof Error ? e.message : String(e) }))
    }
    setThumbUploading(false)
  }

  async function uploadModel(file: File, kind: 'glb' | 'usdz') {
    const extension = `.${kind}`
    if (!file.name.toLowerCase().endsWith(extension)) {
      setUploadProgress(text(T.onlyExtensionFiles, { extension }))
      return
    }
    setUploading(true)
    setUploadProgress(T.uploading)
    try {
      // Hand-uploading a model stays OURS - the route enforces it. An owner gets one
      // through "Make a 3D model", where the photos are kept, the quota applies and the
      // result is something we can rebuild. A file dropped in here has none of that.
      const publicUrl = await uploadAsset(file, kind, plan.restaurantId, file.name)

      setItemForm(f => kind === 'usdz' ? { ...f, model_usdz: publicUrl, text_only: false } : { ...f, model: publicUrl, text_only: false, is_3d: true })
      setUploadProgress(text(T.uploadedFile, { name: file.name }))
    } catch (e) {
      setUploadProgress(text(T.uploadFailed, { message: e instanceof Error ? e.message : String(e) }))
    }
    setUploading(false)
  }

  return (
    <div>
      {/* One header: what this is, which views there are, and the single primary action.
          The restaurant's name is in the sidebar and does not need saying twice. */}
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div className="mr-auto">
          <h1 className="page-title">{T.menuTitle}</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
            {items.length} dish{items.length === 1 ? '' : 'es'} · {categories.length} categories
            {activeArItemCount > 0 && <> · {activeArItemCount} in 3D</>}
          </p>
        </div>

        <div className="flex rounded-lg p-0.5" style={{ background: 'var(--card2)' }}>
          {(['items', 'categories'] as const).map(id => (
            <button key={id} onClick={() => setTab(id)}
                    className="px-3.5 py-1.5 rounded-md text-sm font-semibold transition-colors"
                    style={{ background: tab === id ? 'var(--card)' : 'transparent',
                             color: tab === id ? 'var(--text)' : 'var(--dim)',
                             boxShadow: tab === id ? 'var(--shadow)' : 'none' }}>
              {id === 'items' ? T.tabItems : T.tabCategories}
            </button>
          ))}
        </div>

        <button onClick={tab === 'items' ? openNewItem : openNewCat} className="btn btn-primary">
          {tab === 'items' ? T.addItem : T.addCategory}
        </button>
      </div>

      {msg && <div className="card px-4 py-3 mb-4 text-sm">{msg}</div>}

      {loading ? (
        <p style={{ color: 'var(--dim)' }}>{T.loading}</p>
      ) : tab === 'items' ? (
        <>
          {/* Search is always here; the five filters are one tap away with a count when
              they are on. Five dropdowns permanently open is a screen that looks like work
              before any work has been done. */}
          <div className="card p-3 md:p-4 mb-4">
            <div className="flex gap-2 items-center">
              <label className="sr-only" htmlFor="menu-search">{T.menuSearchPlaceholder}</label>
              <input id="menu-search" type="search" value={filters.query}
                     onChange={e => updateFilter('query', e.target.value)}
                     placeholder={T.menuSearchPlaceholder} className="flex-1" />
              <button type="button" onClick={() => setShowFilters(s => !s)}
                      className="btn btn-sm shrink-0"
                      style={filtersActive ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : undefined}>
                {T.menuFilterAll === 'All' ? 'Filters' : T.menuFilterCategory}
                {filtersActive ? ' ·' : ''}
              </button>
              {filtersActive && (
                <button type="button" onClick={clearFilters} className="btn btn-sm btn-ghost shrink-0">
                  {T.menuClearFilters}
                </button>
              )}
            </div>

            <div className={showFilters ? 'mt-3' : 'hidden'}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
                <FilterField label={T.menuFilterCategory}>
                  <select value={filters.categoryId} onChange={e => updateFilter('categoryId', e.target.value)}>
                    <option value="all">{T.menuFilterAll}</option>
                    {categories.map(category => (
                      <option key={category.id} value={category.id}>{categoryName(category)}</option>
                    ))}
                  </select>
                </FilterField>
                <FilterField label={T.menuFilterTopLevel}>
                  <select value={filters.menuGroup}
                          onChange={e => updateFilter('menuGroup', e.target.value as MenuFilters['menuGroup'])}>
                    <option value="all">{T.menuFilterAll}</option>
                    <option value="food">{T.foodTab}</option>
                    <option value="drink">{T.drinksTab}</option>
                  </select>
                </FilterField>
                <FilterField label={T.menuFilterVisibility}>
                  <select value={filters.visibility}
                          onChange={e => updateFilter('visibility', e.target.value as MenuFilters['visibility'])}>
                    <option value="all">{T.menuFilterAll}</option>
                    <option value="visible">{T.menuFilterVisible}</option>
                    <option value="hidden">{T.menuFilterHidden}</option>
                  </select>
                </FilterField>
                <FilterField label={T.menuFilterMedia}>
                  <select value={filters.mediaState}
                          onChange={e => updateFilter('mediaState', e.target.value as MenuFilters['mediaState'])}>
                    <option value="all">{T.menuFilterAll}</option>
                    <option value="ar">{T.menuFilterAr}</option>
                    <option value="photo">{T.menuFilterPhotoOnly}</option>
                    <option value="text">{T.menuFilterTextOnly}</option>
                    <option value="missing-image">{T.menuFilterMissingImage}</option>
                  </select>
                </FilterField>
                <FilterField label={T.menuFilterQuality}>
                  <select value={filters.quality}
                          onChange={e => updateFilter('quality', e.target.value as MenuFilters['quality'])}>
                    <option value="all">{T.menuFilterAll}</option>
                    <option value="missing-en">{T.menuFilterMissingEn}</option>
                    <option value="missing-ka">{T.menuFilterMissingKa}</option>
                    <option value="missing-price">{T.menuFilterMissingPrice}</option>
                  </select>
                </FilterField>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4">
                <span className="text-xs" style={{ color: 'var(--dim)' }}>{resultCountLabel}</span>

                {/* How the menu LOOKS on a phone: settings, not actions, so they live with
                    the other view controls rather than beside "Add dish". */}
                <label className="flex items-center gap-2 text-xs ml-auto" style={{ color: 'var(--dim)' }}
                       title={T.twinPhoneTitle}>
                  <input type="checkbox" checked={phoneLayout === 'twin'} style={{ width: 'auto' }}
                         onChange={e => updatePhoneLayout(e.target.checked ? 'twin' : 'list')} />
                  {T.twinPhoneView}
                </label>
                <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--dim)' }}
                       title={T.spinTitle}>
                  <input type="checkbox" checked={spinEnabled} style={{ width: 'auto' }}
                         onChange={e => updateSpinEnabled(e.target.checked)} />
                  360° spin
                </label>
            </div>
          </div>
          {planLimitReached && plan.itemLimit !== null && (
            <div className="mb-4 rounded-xl p-3 text-sm"
                 style={{ background: 'rgba(242,181,53,0.08)', color: 'var(--dim)', border: '1px solid var(--border)' }}>
              {T.planLimitReachedHint}
            </div>
          )}
          {/* A menu should look like food. The photo is the first column, the whole row
              opens the editor, and the model is a badge - the old "Model" column printed
              the raw R2 URL, which is developer output, not a product. */}
          <div className="card overflow-hidden">
            <div className="table-scroll">
              <table className="w-full text-sm" style={{ minWidth: 640 }}>
                <thead>
                  <tr style={{ background: 'var(--card2)', borderBottom: '1px solid var(--border)' }}>
                    <th className="w-14"></th>
                    {[T.colName, T.colCategory, T.colPrice, '3D', T.colVisible, ''].map((h, i) => (
                      <th key={i} className="px-3 py-2.5 text-left eyebrow"
                          style={{ textAlign: h === T.colPrice ? 'right' : 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(item => (
                    <tr key={item.id} onClick={() => openEditItem(item)}
                        className="cursor-pointer transition-colors"
                        style={{ borderTop: '1px solid var(--border)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--card2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td className="pl-4 py-2">
                        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0"
                             style={{ background: 'var(--card2)' }}>
                          {item.thumbnail_url
                            ? <img src={item.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                            : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold">{item.name_en || <span style={{ color: 'var(--danger)' }}>{T.menuFilterMissingEn}</span>}</div>
                        {item.name_ka && <div className="text-xs" style={{ color: 'var(--dim)' }}>{item.name_ka}</div>}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--dim)' }}>
                        {catName(item.category_id)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                        {item.price || <span style={{ color: 'var(--danger)' }}>—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {item.model
                          ? <span className={`pill ${item.is_3d ? 'pill-on' : 'pill-mute'}`}>
                              {item.is_3d ? '3D' : 'off'}
                            </span>
                          : <span style={{ color: 'var(--dim)' }}>—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`pill ${item.visible ? 'pill-on' : 'pill-off'}`}>
                          {item.visible ? T.visible : T.hidden}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={e => { e.stopPropagation(); setDeleteId(item.id) }}
                                className="btn btn-sm btn-ghost btn-danger">{T.delete}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {filteredItems.length === 0 && (
            <div className="mt-4 rounded-xl p-5 text-center"
                 style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              <div className="font-semibold" style={{ color: 'var(--text)' }}>{T.menuNoResultsTitle}</div>
              <p className="text-sm mt-1" style={{ color: 'var(--dim)' }}>{T.menuNoResultsText}</p>
              <button type="button"
                      onClick={clearFilters}
                      className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold"
                      style={{ background: 'var(--gold)', color: 'var(--gold-ink)' }}>
                {T.menuClearFilters}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="table-scroll">
              <table className="w-full text-sm" style={{ minWidth: 420 }}>
                <thead>
                  <tr style={{ background: 'var(--card2)', borderBottom: '1px solid var(--border)' }}>
                    {[T.nameEn, T.nameKa, T.colMenuOrder, T.colItems, ''].map((h, i) => (
                      <th key={i} className="px-4 py-2.5 text-left eyebrow">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {categories.map(cat => (
                    <tr key={cat.id} onClick={() => openEditCat(cat)}
                        className="cursor-pointer transition-colors"
                        style={{ borderTop: '1px solid var(--border)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--card2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td className="px-4 py-2.5 font-semibold">{cat.name_en}</td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--dim)' }}>{cat.name_ka}</td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--dim)' }}>{cat.sort_order}</td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--dim)' }}>
                        {items.filter(it => it.category_id === cat.id).length}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={e => { e.stopPropagation(); setDeleteCatId(cat.id) }}
                                className="btn btn-sm btn-ghost btn-danger">{T.delete}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {categories.length === 0 && (
              <p className="p-8 text-center text-sm" style={{ color: 'var(--dim)' }}>
                No categories yet. Dishes without one still show, grouped together.
              </p>
            )}
          </div>
        </>
      )}

      {itemModal && (
        <Modal
          title={editItem ? T.editItemTitle : T.addItemTitle}
          onClose={() => setItemModal(false)}
          panelRef={itemFormPanelRef}
          placement="top"
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label={T.nameEn}>
              <input value={itemForm.name_en} onChange={e => setItemForm(f => ({ ...f, name_en: e.target.value }))} />
            </Field>
            <Field label={T.nameKa}>
              <input value={itemForm.name_ka} onChange={e => setItemForm(f => ({ ...f, name_ka: e.target.value }))} />
            </Field>
            <Field label={T.descEn} className="col-span-2">
              <textarea rows={2} value={itemForm.description_en}
                        onChange={e => setItemForm(f => ({ ...f, description_en: e.target.value }))} />
            </Field>
            <Field label={T.descKa} className="col-span-2">
              <textarea rows={2} value={itemForm.description_ka}
                        onChange={e => setItemForm(f => ({ ...f, description_ka: e.target.value }))} />
            </Field>
            <Field label={T.priceLabel}>
              <input value={itemForm.price} onChange={e => setItemForm(f => ({ ...f, price: e.target.value }))} />
            </Field>
            <Field label={T.categoryLabel}>
              <select value={itemForm.category_id ?? ''}
                      onChange={e => {
                        const categoryId = e.target.value || null
                        setItemForm(f => ({
                          ...f,
                          category_id: categoryId,
                          sort_order: editItem || sortOrderTouched ? f.sort_order : nextSortOrderForCategory(categoryId),
                        }))
                        setItemMenuGroup(groupForCategory(categoryId))
                      }}>
                {categories.map(c => <option key={c.id} value={c.id}>{categoryName(c)}</option>)}
              </select>
            </Field>
            <Field label={T.topLevelTab} className="col-span-2">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={T.topLevelTab}>
                {(['food', 'drink'] as const).map(group => (
                  <label key={group}
                         className="flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer"
                         style={{ background: itemMenuGroup === group ? 'rgba(242,181,53,0.12)' : 'var(--card2)',
                                  border: `1px solid ${itemMenuGroup === group ? 'var(--gold)' : 'var(--border)'}` }}>
                    <input
                      type="radio"
                      name="menu-group"
                      value={group}
                      checked={itemMenuGroup === group}
                      required
                      style={{ width: 'auto' }}
                      onChange={() => setItemMenuGroup(group)}
                    />
                    <span className="text-sm font-medium" style={{ color: itemMenuGroup === group ? 'var(--gold)' : 'var(--text)' }}>
                      {group === 'drink' ? T.drinksTab : T.foodTab}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
                {T.topLevelTabHint}
              </p>
            </Field>
            <Field label={T.textOnlyItem} className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={itemForm.text_only}
                  style={{ width: 'auto' }}
                  onChange={e => {
                    if (e.target.checked) {
                      setItemForm(f => ({
                        ...f,
                        is_3d: false,
                        model: '',
                        model_usdz: '',
                        thumbnail_url: '',
                        thumb_3d: false,
                        text_only: true,
                      }))
                    } else {
                      setItemForm(f => ({ ...f, text_only: false, is_3d: plan.canUploadModels ? true : f.is_3d }))
                    }
                  }}
                />
                <span className="text-sm" style={{ color: 'var(--dim)' }}>
                  {T.textOnlyLabel}
                </span>
              </label>
              <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
                {T.textOnlyHint}
              </p>
            </Field>
            {plan.canUploadModels && !itemForm.text_only && (
              <Field label={T.pictureOnlyLabel} className="col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!itemForm.is_3d} style={{ width: 'auto' }}
                         onChange={e => setItemForm(f => ({
                           ...f,
                           is_3d: !e.target.checked,
                           text_only: false,
                           thumb_3d: e.target.checked ? false : f.thumb_3d,
                         }))} />
                  <span className="text-sm" style={{ color: 'var(--dim)' }}>{T.pictureOnlyHint}</span>
                </label>
              </Field>
            )}
            {plan.canUploadModels && itemForm.is_3d && !itemForm.text_only && (
              <Field label={T.model3d} className="col-span-2">
                <div className="space-y-2">
                  <p className="text-xs leading-5" style={{ color: 'var(--dim)' }}>
                    {T.usdzRequiredHint}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={uploading}
                            onClick={() => glbInputRef.current?.click()}
                            className="px-3 py-1.5 rounded text-xs font-medium"
                            style={{ background: 'var(--card2)', color: 'var(--gold)',
                                     border: '1px solid var(--border)', opacity: uploading ? 0.5 : 1 }}>
                      {uploading ? T.uploading : T.uploadGlb}
                    </button>
                    <input ref={glbInputRef} type="file" accept=".glb" style={{ display: 'none' }}
                           onChange={e => { const f = e.target.files?.[0]; if (f) uploadModel(f, 'glb'); e.target.value = '' }} />
                    <button type="button" disabled={uploading}
                            onClick={() => usdzInputRef.current?.click()}
                            className="px-3 py-1.5 rounded text-xs font-medium"
                            style={{ background: 'var(--card2)', color: 'var(--gold)',
                                     border: '1px solid var(--border)', opacity: uploading ? 0.5 : 1 }}>
                      {uploading ? T.uploading : T.uploadUsdz}
                    </button>
                    <input ref={usdzInputRef} type="file" accept=".usdz" style={{ display: 'none' }}
                           onChange={e => { const f = e.target.files?.[0]; if (f) uploadModel(f, 'usdz'); e.target.value = '' }} />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="text-xs px-2 py-1.5 rounded truncate"
                         style={{ background: 'var(--card2)', color: 'var(--dim)', border: '1px solid var(--border)' }}>
                      {itemForm.model
                        ? <span>GLB {T.current}<span style={{ color: 'var(--text)' }}>{itemForm.model.startsWith('http') ? itemForm.model.split('/').pop() : itemForm.model}</span></span>
                        : <span style={{ color: 'var(--dim)' }}>GLB: {T.noModel}</span>
                      }
                    </div>
                    <div className="text-xs px-2 py-1.5 rounded truncate"
                         style={{ background: 'var(--card2)', color: 'var(--dim)', border: '1px solid var(--border)' }}>
                      {itemForm.model_usdz
                        ? <span>USDZ {T.current}<span style={{ color: 'var(--text)' }}>{itemForm.model_usdz.startsWith('http') ? itemForm.model_usdz.split('/').pop() : itemForm.model_usdz}</span></span>
                        : <span style={{ color: 'var(--dim)' }}>USDZ: {T.noModel}</span>
                      }
                    </div>
                  </div>
                  {uploadProgress && (
                    <div className="text-xs px-2 py-1.5 rounded"
                         style={{ background: 'var(--card2)', color: uploadProgress.startsWith(text(T.uploadedFile, { name: '' })) ? 'var(--success)' : 'var(--danger)', border: '1px solid var(--border)' }}>
                      {uploadProgress}
                    </div>
                  )}
                </div>
              </Field>
            )}
            {!itemForm.text_only && (
            <Field label={T.thumbnailLabel} className="col-span-2">
              <div className="space-y-2">
                <div className="flex gap-2 items-center">
                  <button type="button" disabled={thumbUploading}
                          onClick={() => thumbInputRef.current?.click()}
                          className="px-3 py-1.5 rounded text-xs font-medium"
                          style={{ background: 'var(--card2)', color: 'var(--gold)',
                                   border: '1px solid var(--border)', opacity: thumbUploading ? 0.5 : 1 }}>
                    {thumbUploading ? T.uploading : T.uploadThumb}
                  </button>
                  {itemForm.thumbnail_url && (
                    <button type="button"
                            onClick={() => { setItemForm(f => ({ ...f, thumbnail_url: '', thumb_3d: false })); setThumbProgress('') }}
                            className="px-3 py-1.5 rounded text-xs font-medium"
                            style={{ background: 'rgba(224,82,82,0.1)', color: 'var(--danger)', border: '1px solid rgba(224,82,82,0.25)' }}>
                      {T.clearThumb}
                    </button>
                  )}
                  {itemForm.thumbnail_url && (
                    <img src={itemForm.thumbnail_url} alt={T.thumbnailPreviewAlt}
                         style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6,
                                  border: '1px solid var(--border)' }} />
                  )}
                  <input ref={thumbInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                         onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = '' }} />
                </div>
                <div className="text-xs px-2 py-1.5 rounded truncate"
                     style={{ background: 'var(--card2)', color: 'var(--dim)', border: '1px solid var(--border)' }}>
                  {thumbProgress
                    ? <span style={{ color: thumbProgress.startsWith(text(T.uploadedFile, { name: '' })) ? 'var(--success)' : 'var(--danger)' }}>{thumbProgress}</span>
                    : itemForm.thumbnail_url
                      ? <span>{T.current}<span style={{ color: 'var(--text)' }}>{itemForm.thumbnail_url.split('/').pop()}</span></span>
                      : <span style={{ color: 'var(--dim)' }}>{T.noThumbnail}</span>
                  }
                </div>
                <p className="text-xs" style={{ color: 'var(--dim)' }}>
                  {T.thumbOptionalHint}
                </p>
              </div>
            </Field>
            )}
            {plan.canUploadModels && itemForm.is_3d && !itemForm.text_only && itemForm.thumbnail_url && (
              <Field label={T.thumb3dLabel} className="col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={itemForm.thumb_3d} style={{ width: 'auto' }}
                         onChange={e => setItemForm(f => ({ ...f, thumb_3d: e.target.checked }))} />
                  <span className="text-sm" style={{ color: 'var(--dim)' }}>{T.thumb3dHint}</span>
                </label>
              </Field>
            )}
            <Field label={T.sortOrder}>
              <input type="number" value={itemForm.sort_order}
                     onChange={e => {
                       setSortOrderTouched(true)
                       setItemForm(f => ({ ...f, sort_order: Number(e.target.value) }))
                     }} />
            </Field>
            {plan.canUploadModels && !itemForm.text_only && (
              <Field label={T.arScale}>
                <input type="number" min="0.01" max="10" step="0.05"
                       value={itemForm.ar_scale}
                       onChange={e => setItemForm(f => ({ ...f, ar_scale: Number(e.target.value) }))} />
                <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>{T.arScaleHint}</p>
              </Field>
            )}
            {plan.canUploadModels && itemForm.is_3d && !itemForm.text_only && (
              <Field label={T.viewAngle} className="col-span-2">
                <div className="grid grid-cols-3 gap-3">
                  <label className="text-xs" style={{ color: 'var(--dim)' }}>
                    {T.viewAngleH}
                    <input type="number" min="0" max="360" step="5" value={viewForm.h}
                           onChange={e => setViewForm(v => ({ ...v, h: Number(e.target.value) }))} />
                  </label>
                  <label className="text-xs" style={{ color: 'var(--dim)' }}>
                    {T.viewAngleV}
                    <input type="number" min="0" max="85" step="5" value={viewForm.v}
                           onChange={e => setViewForm(v => ({ ...v, v: Number(e.target.value) }))} />
                  </label>
                  <label className="text-xs" style={{ color: 'var(--dim)' }}>
                    {T.viewAngleZoom}
                    <input type="number" min="30" max="300" step="5" value={viewForm.zoom}
                           onChange={e => setViewForm(v => ({ ...v, zoom: Number(e.target.value) }))} />
                  </label>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>{T.viewAngleHint}</p>
              </Field>
            )}
            <Field label={T.featured} className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={itemForm.featured} style={{ width: 'auto' }}
                       onChange={e => setItemForm({ ...itemForm, featured: e.target.checked })} />
                <span className="text-sm" style={{ color: 'var(--dim)' }}>{T.featuredOnMenu}</span>
              </label>
              <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>{T.featuredHint}</p>
            </Field>
            <Field label={T.visibility} className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={itemForm.visible} style={{ width: 'auto' }}
                       onChange={e => {
                         const next = { ...itemForm, visible: e.target.checked }
                         const existingItems = editItem ? items.filter(item => item.id !== editItem.id) : items
                         const nextCount = existingItems.filter(isActiveArItem).length + (isActiveArItem(next) ? 1 : 0)
                         if (plan.itemLimit !== null && nextCount > plan.itemLimit) {
                           flash(text(T.planLimitReached, { active: activeArItemCount, limit: plan.itemLimit }))
                           return
                         }
                         setItemForm(next)
                       }} />
                <span className="text-sm" style={{ color: 'var(--dim)' }}>{T.visibleOnMenu}</span>
              </label>
              {plan.itemLimit !== null && (
                <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>
                  {T.activeArItemsHint}
                </p>
              )}
            </Field>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={() => setItemModal(false)}
                    className="px-4 py-2 rounded-lg text-sm"
                    style={{ color: 'var(--dim)', border: '1px solid var(--border)' }}>
              {T.cancel}
            </button>
            <button onClick={saveItem} disabled={saving}
                    className="px-5 py-2 rounded-lg text-sm font-semibold"
                    style={{ background: 'var(--gold)', color: 'var(--gold-ink)', opacity: saving ? 0.6 : 1 }}>
              {saving ? T.saving : T.save}
            </button>
          </div>
        </Modal>
      )}

      {catModal && (
        <Modal title={editCat ? T.editCatTitle : T.addCatTitle} onClose={() => setCatModal(false)}>
          <div className="space-y-4">
            <Field label={T.nameEn}>
              <input value={catForm.name_en} onChange={e => setCatForm(f => ({ ...f, name_en: e.target.value }))} />
            </Field>
            <Field label={T.nameKa}>
              <input value={catForm.name_ka} onChange={e => setCatForm(f => ({ ...f, name_ka: e.target.value }))} />
            </Field>
            <Field label={T.categoryMenuOrder}>
              <input type="number" min="1" step="1" value={catForm.sort_order}
                     onChange={e => setCatForm(f => ({ ...f, sort_order: Number(e.target.value) }))} />
              <p className="text-xs mt-1" style={{ color: 'var(--dim)' }}>{T.categoryMenuOrderHint}</p>
            </Field>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={() => setCatModal(false)}
                    className="px-4 py-2 rounded-lg text-sm"
                    style={{ color: 'var(--dim)', border: '1px solid var(--border)' }}>
              {T.cancel}
            </button>
            <button onClick={saveCat} disabled={saving}
                    className="px-5 py-2 rounded-lg text-sm font-semibold"
                    style={{ background: 'var(--gold)', color: 'var(--gold-ink)', opacity: saving ? 0.6 : 1 }}>
              {saving ? T.saving : T.save}
            </button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title={T.deleteItemTitle} onClose={() => setDeleteId(null)}>
          <p className="text-sm mb-6" style={{ color: 'var(--dim)' }}>{T.deleteItemText}</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteId(null)}
                    className="px-4 py-2 rounded-lg text-sm"
                    style={{ color: 'var(--dim)', border: '1px solid var(--border)' }}>
              {T.cancel}
            </button>
            <button onClick={confirmDelete}
                    className="px-5 py-2 rounded-lg text-sm font-semibold"
                    style={{ background: 'var(--danger)', color: '#fff' }}>
              {T.delete}
            </button>
          </div>
        </Modal>
      )}

      {deleteCatId && (
        <Modal title={T.deleteCatTitle} onClose={() => setDeleteCatId(null)}>
          <p className="text-sm mb-6" style={{ color: 'var(--dim)' }}>{T.deleteCatText}</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteCatId(null)}
                    className="px-4 py-2 rounded-lg text-sm"
                    style={{ color: 'var(--dim)', border: '1px solid var(--border)' }}>
              {T.cancel}
            </button>
            <button onClick={confirmDeleteCat}
                    className="px-5 py-2 rounded-lg text-sm font-semibold"
                    style={{ background: 'var(--danger)', color: '#fff' }}>
              {T.delete}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({
  title,
  onClose,
  children,
  panelRef,
  placement = 'center',
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  panelRef?: React.Ref<HTMLDivElement>
  placement?: 'center' | 'top'
}) {
  return (
    <div className={[
      'fixed inset-0 z-50 flex overflow-y-auto p-4',
      placement === 'top' ? 'items-start justify-center md:pt-8' : 'items-center justify-center',
    ].join(' ')}
         style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div ref={panelRef}
           className="w-full max-w-xl rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
           style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-lg">{title}</h2>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--dim)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs mb-1.5 uppercase tracking-widest"
             style={{ color: 'var(--dim)' }}>{label}</label>
      {children}
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 lg:w-44">
      <span className="block text-[11px] mb-1.5 uppercase tracking-widest"
            style={{ color: 'var(--dim)' }}>{label}</span>
      {children}
    </label>
  )
}
