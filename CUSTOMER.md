# From the customer's side — 2026-09-09

What the product is like to *use*, as opposed to whether it works. Companion to
[AUDIT.md](AUDIT.md), which is about defects; this is about friction, and most of what is
below is not broken at all.

Two customers, and they want opposite things:

- **the owner** — a restaurant in Tbilisi, paying ₾300, doing this between services, on a
  phone, in Georgian
- **the diner** — thirty seconds, one hand, someone else's wifi, and no reason to care that
  we exist

Every finding below is grounded in something checked against the real database or the real
code, not in an opinion about what restaurants are like.

---

## 1. The one that matters more than everything else

### An owner cannot get their menu in

**Monday Greens has 170 dishes across 26 categories. Corner has 58 across 13. Both were put
there by an import we ran for them.** There is no import in the product:

- the setup wizard offers **three rows**, and says *"Import from a file · coming soon"*
- the menu editor adds **one dish at a time**, through a modal
- nothing in `admin/` mentions CSV, XLSX, or paste — checked

So a restaurant that signs up self-serve, today, types 170 dishes one modal at a time. At a
generous thirty seconds each — open, name, price, category, save — that is **eighty-five
minutes of unbroken data entry** before they have a menu at all, and double that if they
want the Georgian names too.

This is the difference between "self-serve" and self-serve. Every other item on this page is
worth less than this one, and the two paying restaurants have not felt it *because we did
the typing for them* — which is exactly the kind of thing that stays invisible until the
first customer we do not hand-hold.

**What it needs.** Paste a menu in, see it parsed into rows, fix what came out wrong,
import. Not a file format: a text box. Every restaurant already has its menu as *text*
somewhere — a Word file, a PDF, a Google Doc, an old website — and pasting beats uploading
because it works from a phone and needs no export step.

Recommended as the next feature, ahead of anything else here.

---

## 2. Fixed today

### A dish could not be marked sold out without opening it

The most frequent thing that happens to a restaurant menu is *"we are out of the sea
bass"*. It happens during service, on a phone, with a table waiting.

The visibility pill in the dish list was a `<span>`. Hiding a dish meant: open the row,
find the toggle in the modal, save, wait for the whole list to reload. Four steps and a
full round trip for one boolean.

The pill is the switch now — it was already showing the state in the right place, it just
could not be pressed. Optimistic, so it feels instant, and it puts the row back and says so
if the write fails, because a dish that *looks* hidden and is not is worse than one that
never changed.

Its own writer, deliberately, rather than reusing `saveItem`: that one sends the whole row,
so a half-finished edit sitting in someone's form could have been published to the menu by
a sold-out tap.

### The admin was half in English

Covered in [AUDIT.md §15](AUDIT.md) — 127 owner-facing strings had never been through i18n,
including the whole setup wizard and the whole 3D Studio. Now zero.

### A phone could not offer the photo gallery

`capture="environment"` replaces the file picker with the camera. An owner who had
photographed a dish properly and moved the files to their phone could not select them.

---

## 3. Worth knowing, deliberately not changed

### Every edit is live the instant it saves

The diner page calls `public_menu(slug)`, which reads the live tables. There is no draft.
A price typed wrong is on a diner's phone before the owner has looked away from it, and
there is no undo.

The `publications` and `live_publication` tables exist, with four and two rows, and
describe a versioned snapshot with the version as an edge cache key — an earlier
architecture that nothing now uses.

**Not changed, on purpose.** For a restaurant of this size instant is the right default:
fixing a wrong price should be one action, not two. A draft/publish flow adds a step to
every edit in order to protect against a rarer one. Worth revisiting only if an owner
actually asks — and worth knowing that the schema for it is already there.

### Three free models, then a conversation

Over quota, a request goes to `pending` and waits for one of us. That is a deliberate
gate — a human decides before thirty credits are spent — but it means the growth path
from a restaurant's fourth model onward runs through us answering. Fine at two customers.
It is the second thing to break at twenty.

---

## 4. Smaller, in the order I would do them

1. **Bulk price edit.** Seasonal changes mean opening each dish. A column of editable
   prices in the list would cover the most common bulk edit without a general import.
2. **Duplicate a dish.** "Same but large" is a variant, and the variants field handles it —
   but a second nearly-identical dish is still typed from scratch.
3. **Reorder by dragging on a phone.** `reorder()` exists and the list supports it on a
   desktop; the touch path is untested.
4. **The owner's own preview.** The theme editor previews the look. There is no "see my
   menu as a diner" from the menu editor — the QR screen is the closest thing, and it is a
   different screen.

---

## 5. The diner, briefly

Little to fix, and this is the surface that decides whether the product is worth ₾300.

- **Fast.** Monday Greens is 417 KB of HTML that arrives as **53 KB brotli in 0.29 s**.
  Corner, 35 KB. Nothing is fetched to draw the menu — the dishes are in the markup.
- **Honest now.** A dish no longer advertises 3D it cannot show, and a broken menu is a
  real page in Georgian rather than a Postgres error.
- **The one number that matters** is still how many diners tap into 3D. That is a content
  and motivation question, not a code one, and the analytics answer it per dish — which is
  what "Build these next" on the home screen is for.

---

## 6. Sizes and extras — built 2026-09-09

`variants` and `addons` are two different things, and both were invisible in the admin.

| | **Sizes** (`variants`) | **Extras** (`addons`) |
|---|---|---|
| the diner | `radiogroup` — picks **one** | multi-select — picks **any** |
| the price | **replaces** the dish price | **adds**, shown as `+3 ₾` |
| the basket | one line | each combination is its own line |
| in the wild | Glass/Bottle, Small/Large, Cup/Teapot | extra cheese, spicy |

**What was wrong.** `variants` were carried through the item form invisibly — on the type,
initialised, loaded, saved — with no UI anywhere. Thirty of Monday Greens' dishes have
them, so **an owner could not change their own bottle price.** `addons` was worse: the
column exists, the diner's renderer draws them, and the admin never even read the field.

### The four rules that make it safe at scale

Each is a way this goes wrong quietly.

**Unknown keys are preserved.** `platform.js` reads `image_url` off a variant. An editor
that rebuilt these objects from the fields it knows about would delete it, and nothing
would say so. Every edit spreads the existing object.

**A label lives under its language code.** The storage shape is flat — `{en, ka, price}` —
so a third language is a *key*, not a migration of sixty live objects and every reader.
Both renderers used to hardcode two (`lang !== "en" && v.ka ? v.ka : v.en`), which on a
Russian menu would have shown the dish name in Russian and the size label in **Georgian**.
There were **five** such sites, and the check found the two I missed — including the basket
lines, which are what the waiter's QR carries.

**The editor is driven by `tenants.languages`**, not a constant. A restaurant that adds
Russian gets a third label box with no code change.

**The first size is the dish's price.** A dish with sizes has no price of its own: its card
shows one, the first size is selected by default, and if they disagree the card advertises
a number no diner can select. The plain price box is disabled while sizes exist, and the
editor says which number will show.

### It found a live wrong price

Every Mgaloblishvili wine has `price_minor` equal to its Glass price — except one:

```
Mgaloblishvili tvishi(Glass)   card 28 ₾   Glass 16 ₾   Bottle 48 ₾
```

The card advertises **28 ₾**, the selected pill says **16 ₾**, and `platform.js` charges the
variant — so the basket says 16. **Not changed:** which number is right is the
restaurant's call. Worth asking Monday Greens.

### Checked

Fourteen checks in `check_admin.py`, plus nine unit tests on the cleaner — run against
**Monday Greens' real thirty variant sets**, which come back byte-identical, `image_url`
and all. The cleaner is plain JS beside its own tests *and imported by the data layer and
the editor*, because a tested copy nothing runs proves nothing.

---

## 7. Teaching the shot — 2026-09-09

**The most expensive thing in the product is a photo taken wrong**, and nothing said how to
take one. The Studio's entire guidance was a single line about even light.

Almost every way a model comes out wrong is decided at capture time. Each one is free to
avoid and **30 credits to discover.** The engine is trained on evenly spaced views of an
object, so four photos of the pretty side produce a confident, wrong model — and an owner
had no way to know that.

### What an owner sees now

**A guide, the first time.** Opens by itself on the capture screen, remembered per
restaurant, and reachable from a *How to photograph* link forever after. Four numbered
turns — **0° / 90° / 180° / 270°** — then the rules that hold across all four, then the
four things that go wrong most often.

**A line that changes with every photo.** Under the slots: *"Photo 2 of 4: turn the plate a
quarter turn. Turn the plate, not yourself — the background and the framing must stay
exactly the same. Same height, same distance, same light as the others."*

It follows the first **empty** slot rather than the count, so somebody who fills 1, 3 and 4
is told about 2. And because it says something different every time, it can appear on
every upload without becoming wallpaper.

### The rules are the protocol, not photography advice

Straight from `betareal-capture-protocol`:

- **Four quarter turns, evenly spaced** — not four angles of the best-looking side
- **One height in all four** — consistency beats the exact angle
- **Soft light, no flash, not beside a window** — glare is the geometry stage's weakness
- **A plain background, the same one throughout**
- **One edit, copied to all four** — grading each frame separately feeds inconsistent
  colour to the texture stage and bakes patchiness into the material. This is the trap in
  our own workflow, now told to the owner before it costs them.

**Turn the plate, not yourself** is a deliberate translation of "evenly spaced azimuths".
It is easier to do standing in a restaurant *and* it keeps the background and framing
identical — which the model also wants. Same result, less to get wrong.

Sixteen checks, and every line exists in Georgian.

### open — menu import is scaffolded and switched off

`lib/menuImport.ts` and `/api/menu-import` exist, define the shape, and answer **501**.
There is no `ANTHROPIC_API_KEY` and no feature flag, so nothing renders and nothing is
billed.

The shape is the decision, and it is the same whichever way the file is read:

```
a file  →  rows  →  a screen where the owner fixes what came out wrong  →  saved
```

Everything upstream of `DraftRow[]` is interchangeable — a spreadsheet, a PDF text layer, a
vision model, or a person typing. Everything downstream is one code path. That is why
manual entry and AI import are one feature rather than two.

**Cost, so the decision is a number:** a menu page photo is ~4,200 tokens. Monday Greens'
170 dishes across eight pages is roughly 35,000 in and 12,000 out — **about $0.19 on
Sonnet 5, once, for the whole menu.** Against ₾300 setup and 30 credits per model that is
noise, but it is a real line and it is Temo's call.
