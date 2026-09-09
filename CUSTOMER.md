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
