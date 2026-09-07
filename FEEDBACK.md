# The live menu is not a faithful copy — Temo, 2026-09-07

The menu app is deployed and reachable at
**https://betareal-menu.betareal-ar.workers.dev/mg** — and what it serves is wrong.

Temo, after opening it on a phone:

> "this is not a copy of og monday greens it is something that tried to be a copy of a copy
> and failed. and considering u have access to the files u should have done better."

He is right, and the reason is specific and my fault: **I stubbed the features instead of
porting them.** `menu/render/ported/shim.js` — the file whose own comment calls itself "the
ONLY adapter" — contains:

```js
window.addToBasket   = function () {};      // the basket, gone
window._setQty       = function () {};
window._variantsHtml = function () { return ""; };   // glass / bottle, gone
window._addonsHtml   = function () { return ""; };
// ...plus nine FAKE HIDDEN <div>s standing in for the photo lightbox
```

Those stubs were written to let `viewer.js` boot without crashing. They did that. They also
silently removed half the product, and the rendered page looked plausible enough that
nothing caught it until a person opened it on a phone.

---

## The eight faults, as reported

1. **Dark theme always.** No light/dark switch. There is a small button top-right that
   does nothing.
2. **Categories do not work.** Tapping a category filters nothing.
3. **3D dishes do not appear on top.** They should lead the list.
4. **Everything is sorted alphabetically.** Wrong order entirely — it should follow the
   owner's `position`.
5. **No add-to-cart button.** Stubbed out (above).
6. **Photos take forever to load.**
7. **Variant switching does not work** — glass → bottle does nothing. Stubbed out (above).
8. **Photo expansion does not work** — the lightbox is nine fake hidden divs.

---

## The architectural point, which matters more than the eight bugs

Temo, same message:

> "make sure to differentiate what are normal website features and what are template
> additions, like add to cart, category sorted, 3d on top, 3d and AR view, show to waiter,
> view the cart, these and some others are baisc features not template specific."

**I blurred two different things into one.** There are:

### Platform features — every menu has these, whatever it looks like

- add to cart / view the cart / show to waiter
- category filtering and the category bar
- 3D dishes ordered first
- 3D view and AR view
- photo expansion (lightbox)
- variants (glass / bottle, regular / decaf)
- light / dark switch
- language switch

These are **the product**. A template that "does not have" one of them is a broken
template, not a design choice. They belong in one shared layer that every template gets.

### Template additions — what makes one restaurant look unlike another

- the palette (68 colour keys)
- fonts
- hero: image, gallery, video, crossfade
- card shape, spacing, radius, shadows
- editorial sections a particular template renders

The current port has no such line drawn. Features live wherever they happened to land when
I was making `viewer.js` boot, which is why removing a stub removed a feature.

---

## Where the real thing is

**`C:\Users\temot\BetaReal scaleable\index.html` — 13,881 lines.** The whole production
app: markup, CSS and JS in one file. That is the source of truth for every behaviour above,
and it is on this machine. There was never a reason to reimplement from memory.

Ported so far, in `menu/render/ported/`:

| file | what it is | state |
|---|---|---|
| `full.css` | the entire stylesheet | verbatim, complete |
| `xr.js` | the WebXR AR carousel | verbatim |
| `viewer.js` | the 3D modal, AR entry, thumbnail upgrades | verbatim |
| `hero.js` | hero video, crossfade, venue block | verbatim |
| `page.js` | category filter, language, theme | **incomplete — the faults live here** |
| `init.js` | boot | thin |
| `shim.js` | **ours**, the adapter | **stubs the missing half** |

`build_viewer.py` concatenates these into `app/public/viewer.js`, which the diner page
loads. `check_render.py` asserts the served file matches its sources.

---

## What has to happen

1. **Draw the line.** A `platform` layer with every feature in the first list, and template
   CSS that only changes appearance. Then a feature cannot be lost by editing a template.
2. **Port the missing behaviour from `index.html`, verbatim**, the way `viewer.js` and
   `xr.js` were ported — not reimplemented. The basket, the lightbox, variants, the theme
   toggle, category filtering, the ordering.
3. **Fix the ordering.** Alphabetical is wrong; `position` within category is right, with
   3D dishes first.
4. **Photo loading.** Measure before guessing — the imported rows point at 1200px r2.dev
   URLs, and the diner page draws them at 430px.
5. **A check per feature.** Every one of the eight faults above should fail a check if it
   regresses. `check_render.py` currently proves the FILES are present; it does not prove
   the FEATURES work, which is exactly how eight of them went missing at once.

---

## State of everything else, 2026-09-07

**Deployed:** menu app on Cloudflare Workers, `betareal-menu.betareal-ar.workers.dev`,
R2 via bindings (no storage credentials in the Worker), secrets set. Verified live: `/mg`
and `/corner` render, `/nope` 404s, a model serves from R2 at 219 KB.

**Not deployed:** the admin (Next 16, needs OpenNext — fallback to Vercel if it fights).
The bridge and optimiser still run on Temo's PC.

**Never run:** the 3D generation loop, end to end. Still the biggest untested thing.

**Domain:** `betareal.ge` is live in a teammate's Cloudflare account, serving the marketing
site and the current Monday Greens. Moving it is a production migration — see the runbook
artifact. Not a blocker; `workers.dev` is fine for testing.

**Checks:** 392 across six suites, all passing — and that number is exactly the point of
item 5 above. None of them caught this.
