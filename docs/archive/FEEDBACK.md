# The live menu was not a faithful copy — fixed 2026-09-07, and again 2026-09-08

**Status: done and deployed.** Kept as the record of what went wrong, because the mistake
is the kind that repeats.

Temo, after opening `https://betareal-menu.betareal-ar.workers.dev/mg` on a phone:

> "this is not a copy of og monday greens it is something that tried to be a copy of a copy
> and failed. and considering u have access to the files u should have done better."

He was right, and the reason was specific: **I stubbed the features instead of porting
them.** `menu/render/ported/shim.js` — the file whose own comment called itself "the ONLY
adapter" — contained:

```js
window.addToBasket   = function () {};              // the basket, gone
window._variantsHtml = function () { return ""; };  // glass / bottle, gone
// ...plus nine FAKE HIDDEN <div>s standing in for the photo lightbox
```

Those stubs were written to let `viewer.js` boot without crashing. They did that. They also
silently removed half the product, and the rendered page looked plausible enough that
nothing caught it until a person opened it on a phone.

---

## Worse than reported

Two things nobody could have got far enough to see:

**The page carried no overlay markup at all.** `viewer.js` binds `#modal-spin` at TOP LEVEL
on its 18th line. With that element absent it is `null.addEventListener` — a TypeError that
aborts the rest of the block and leaves every `let` after it in the temporal dead zone. So
the 3D viewer, AR, the thumbnail upgrades and every basket call the viewer makes were all
gone, from one line, with one message in a console nobody was reading.

**`__bootViewer` was called from nowhere.** Defined in `shim.js`, invoked by nothing. On
every deployed page `menuItems` stayed `[]`: no thumbnail ever upgraded to live 3D, no AR
model was preloaded, and every 3D and AR event was filed against item index -1. The counts
existed and were all wrong.

---

## The eight faults, and what each one actually was

| reported | cause | fix |
|---|---|---|
| dark theme always, dead toggle | the button shipped with the word "Night" in a 34px circle; and only ONE palette was emitted, unscoped, *before* the template sheet — so it lost every specificity tie and the restaurant's own colours were never applied | icon button; both palettes emitted, each scoped to its own `[data-theme]`, after the sheet |
| categories do not work | one flat list of 170 cards; nothing to filter | `.cat-section` per category with a heading, as the platform does |
| **categories STILL do not work** (reported again, 2026-09-08) | `el.hidden = true` does nothing: `[hidden]{display:none}` is a USER-AGENT rule and the template sheet's `.menu-item{display:grid}` is an AUTHOR rule, which wins at any specificity. The headings hid (no `display` of their own), so a tap removed the structure and left all 175 dishes in place | `platform.css`, loaded after the template sheet, with `!important` on the hidden state only - the same trick the platform's own `.cat-nav:not([hidden])` uses |
| everything alphabetical | `order by i.position, i.name` — but `position` is the rank WITHIN a category. 170 dishes, 26 categories, 26 distinct positions. Sorting the whole menu by it interleaves every category and breaks ties by name | order by category position, then item position |
| 3D not on top | no AR-featured block, no 3D-first ordering | AR block leads the All view; 3D first inside a selected category |
| no add-to-cart | `addToBasket` was a stub, so there was nothing for a button to call | `platform.js`, ported; a cart control on every card |
| photos take forever | 187 photos averaging 2 MB, some **7008 px wide** from a phone camera, drawn in a 430 px card, cross-origin, no `Cache-Control` | `menu/photos.py`: 860 px WebP in our own bucket, same-origin, immutable. **376.7 MB → 6.8 MB** |
| variants dead | `_variantsHtml` returned `""` | ported; real pills, real prices, its own basket line |
| photo expansion dead | the lightbox was nine fake hidden divs | real markup from `chrome.html`; `viewer.js` already had the behaviour |

Also found on the way: a dish with an approved model and `is_3d` **off** is a photo dish by
the owner's choice, and the runtime was overriding that by inferring 3D from the presence
of a GLB. Two Monday Greens dishes are set that way. `data-is3d` states it now.

---

## The line Temo drew, made structural

> "make sure to differentiate what are normal website features and what are template
> additions, like add to cart, category sorted, 3d on top, 3d and AR view, show to waiter,
> view the cart, these and some others are baisc features not template specific."

**Platform features** — add to cart, view the cart, show to waiter, category filtering, 3D
ordered first, 3D and AR view, photo expansion, variants, add-ons, day/night, language —
live in `ported/platform.js` and `ported/page.js`. Nothing in either file reads
`data-template`. There is no switch for a template to turn a feature off, because there is
no switch.

**Template additions** — palette, fonts, hero, card shape, editorial sections — are CSS.

---

## Copied, not reinvented

Three extractors take the real thing out of `C:\Users\temot\BetaReal scaleable\index.html`,
so none of it can drift by being retyped:

| generator | output | what |
|---|---|---|
| `extract_css.py` | `ported/full.css` | the entire stylesheet, verbatim |
| `extract_chrome.py` | `ported/chrome.html` | modal, XR overlay, lightbox, basket, staff QR |
| `extract_ui.py` | `ported/ui.js` + `app/src/lib/ui.json` | all 42 strings, en/ka/ru |

`build_viewer.py` concatenates `ui, xr, shim, platform, viewer, hero, page, init` into
`app/public/viewer.js`. `platform.js` sits before `viewer.js` on purpose: viewer.js calls
`addToBasket` and `_variantsHtml` by name, and those used to be the stubs.

---

## Why 392 checks were green

They were not wrong. They were checking the wrong thing.

- `check_render.py` drives `menu/render/render.mjs` — a **different renderer** from the one
  the Astro app uses, so it asserted facts about a page nobody was served.
- Everything else asserted that FILES existed and matched their sources. `shim.js` was
  present, correct, byte-identical — and stubbed.
- Two checks asserted the stubs *should* exist. **A check that asserts a stub exists will
  defend that stub forever.**

`check_features.py` is the answer: 130 checks, each naming a feature a diner uses, run
against the real `markup.js`, the real built `viewer.js` and the real `chrome.html`. Both
mutation tests turn it red — remove the cart button, re-stub `addToBasket`.

**Add a check there whenever a feature is added. If a feature can be deleted without
turning one of them red, it was never really shipped.**

### And the second rule, which cost a whole extra round

The first version of the category check counted `[...cards].filter(c => !c.hidden)`. It was
green, every time, while nothing moved on screen - because it was **reading back the
attribute the filter had just written.** A check that asserts your own assignment happened
is not a test of anything; it is an echo.

Same trap in the browser, one level down: `getComputedStyle(el).display` on an element
*inside* a `display:none` ancestor still returns that element's own value, not `none`. The
honest signal is `el.getClientRects().length` - empty for anything not actually laid out.

So: **check the effect, never the input.** The category checks now prove it from the CSS
cascade - for every element the filter hides, either the template never gives it an
unconditional `display`, or `platform.css` overrides the hidden state with `!important` -
and both mutations (drop the `!important`, forget one selector) turn them red.

394 checks pass across seven suites.

---

## Also new

`/w/<slug>` — the staff page the order QR points at. Ids and quantities travel in the URL
fragment, never prices; every price is re-resolved against the live menu, so a stale scan
cannot undercharge and a URL cannot be edited into a cheaper bill.

---

## State of everything else, 2026-09-07

**Deployed and verified live:** the menu on Cloudflare Workers,
`betareal-menu.betareal-ar.workers.dev`. MG renders in its own teal palette, the basket
totals, the filter filters, 3D leads, Georgian switches throughout, a photo comes back
28 KB and immutable, and `_worker.js` 404s to the public.

**Not deployed:** the admin (Next 16, needs OpenNext — fall back to Vercel if it fights).
The bridge and the optimiser still run on Temo's PC.

**Never run:** the 3D generation loop, end to end. Still the biggest untested thing, and
now the biggest one.

**Domain:** `betareal.ge` is live in a teammate's Cloudflare account. Moving it is a
production migration — see the runbook artifact. Not a blocker; `workers.dev` is fine.

**Page weight:** 414 KB, of which ~356 KB is the platform's entire stylesheet, inlined
verbatim. Trimming it is a real optimisation and the honest way is to ask a browser which
rules matched — not to guess selectors, which produced four "renders but looks wrong" bugs
already.
