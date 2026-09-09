# Audit — 2026-09-09

A pass over the whole product looking for what is missing or wrong, written while fixing
it. Companion to [RISKS.md](RISKS.md), which is about the business; this is about the code
a restaurant owner and their diners actually touch.

**How this was done.** Not by reading files hoping to spot something. Two bug *classes*
produced every serious failure of the previous day, so the audit started by sweeping for
more of each, then widened. That is why the fixes below come in families rather than
one-offs, and why each one ships with a check that catches the class, not the instance.

Every finding is marked:

| | |
|---|---|
| **fixed** | changed, checked, deployed |
| **open** | real, not done, with a reason |
| **verified** | looked wrong, is not, and here is why so nobody "fixes" it |

---

## 1. Values the admin collected and threw away

### fixed — a dish photo never reached the database

`saveItem` built its row object without `photo_key`. An owner picked a photo, watched it
upload, saw the preview, pressed Save, got no error — and the pointer was dropped. The
file sat in R2 with nothing referencing it, and the dish had no photo when the screen
reloaded.

This is the single most common thing a restaurant owner does. It survived every check in
the repo because every check reaches the database through PostgREST, where the column
round-trips perfectly; the bug was four lines of TypeScript above it. MG and Corner have
photos because they were imported, not because this ever worked.

The form only ever held the display URL, so the writer had no key to write. `photo_key`
now travels beside it, is loaded back so a save cannot clear it, and both halves are
cleared when the owner removes the photo.

### fixed — the AR scale input wrote nowhere

Same shape, smaller audience: super-admin only, which is why nobody hit it. The loader
hardcoded `ar_scale: 1` and `saveItem` had no such field, so the input accepted a number
and discarded it.

It is a real field. It lives on `models`, `public_menu` emits it, `markup.js` renders
`data-ar-scale`, and it is the only correction available for an uploaded `.glb` authored
in the wrong unit — which became a thing that can happen the day model upload shipped. It
now has `saveItemScale`, beside `saveItemView`, and for the same reason: it describes the
mesh, so a second dish pointing at that mesh inherits it.

The hint was also untrue. "1.0 = default (25cm)" came from the platform, where every model
was normalised to 25 cm; ours are baked at real size by `optimize.scale_factor()`.

### the check that catches the next one

`check_admin.py` now reads the admin's own source and compares two sets: the columns the
loader `SELECT`s out of `items` and the columns the writer puts back. Anything read and
never written must be named with a reason. The joined model's columns get the same pass
against every writer in the data layer — which is where `ar_scale` was hiding.

Both halves were proven to go red by reintroducing the exact bug before restoring it. A
check that has never failed is not known to work.

---

## 2. Failures the screens reported as success

### fixed — the theme editor said "Saved" when the save had failed

`save()` discarded the error from `saveThemeConfig` and then did three things that each
*assert* the write happened: it moved the saved snapshot, which makes `dirty` false, which
disarms both leave guards and greys out the Save button — and then it said "Saved".

An owner whose token had expired would have spent twenty minutes on a palette, been told
it was safe, walked away past two warnings that no longer fired, and found the old colours
on reload. The draft only ever lived in React state, so there was nothing to recover.

This is worse than a silent failure: the screen destroys the recovery path while reporting
success. `reset()`, ten lines below, has always handled its error correctly. This was the
button people actually press.

### fixed — three more of the same shape

- **the template buttons** wrote the new template, ignored the failure, and left the
  button lit on a template the restaurant is not on. Now rolls back.
- **the dish save** wrote the camera angle and the AR scale onto the model and said "Dish
  updated" either way. A menu that quietly kept the old framing is something an owner
  finds out about from a diner. Now says so — without reopening the modal, because the
  dish itself really is saved by then.
- **`setup_done`** is left alone deliberately, and now says why: that flag only decides
  whether the wizard is shown again, and failing there would trap an owner on a wizard
  they have finished.

### the check that catches the next one

A data-layer call that returns an error must have that return value bound to something.
Anything deliberately dropped is listed with its reason. Proven by reintroducing the theme
bug, which it caught at the exact line.

---

## 3. What a diner sees when there is nothing to show

### fixed — the failure page was two bare strings

A phone held over a QR code, in a restaurant, with somebody waiting, got:

```
No menu for "cornerr"                 404, text/plain, English
Menu unavailable: <postgres error>    503, text/plain, English
```

Three things wrong, in the order they matter.

**It reflects on the restaurant.** The diner does not know BetaReal exists. They scanned
the code on their own table and got raw black text, which reads as *this restaurant's
thing is broken* — and the one useful instruction, ask a member of staff, was not there.

**English only**, in Tbilisi, on the surface with the widest audience in the product.

**The 503 printed the exception.** `loadMenu` throws whatever the database said, so a
permissions or connection failure would have shown an anonymous visitor a PostgREST error
naming our tables.

Now a styled bilingual page, Georgian first, no branding — a diner who cannot see a menu
is not a sales opportunity, and putting our name on a restaurant's failure would be the
one thing worse than the plain text. Inline styles and no script, because this has to
render when the thing that serves stylesheets may be what is broken. `no-store`, so a
broken menu is never cached in place of a working one. The reason goes to the Worker log.

### verified — a printed QR cannot be orphaned by a rename

The obvious way to reach that 404 in real life would be an owner changing their slug after
the codes are on the tables. They cannot: `slug` is set once, at creation, on the
super-admin tenants screen, and no screen in the admin can edit it afterwards.

---

## 4. Open

### open — nothing ever deletes from R2

The web apps have no delete path at all. Replacing a dish photo, removing one, or deleting
the dish leaves the object in the bucket forever, still readable at its URL.

**Cost is not the problem.** Photos are WebP at a few hundred KB; ten thousand orphans is
about $0.05 a month.

**The problem is that "remove" does not remove.** An owner who takes down a photo — wrong
dish, bad shot, a customer's face in the background — has no way to actually unpublish it.
The URL is a UUID path plus a content hash, so it is not enumerable, but that is obscurity,
not deletion.

**And it must not be fixed naively.** `copy_tenant` copies the *key*, not the bytes, so two
tenants share one object. Deleting the file when a dish is deleted would blank the same
photo on every copy made from that restaurant. Any real fix needs reference counting or
copy-on-write first. Left alone, on purpose, and written down here so nobody "tidies" it.


---

## 5. What an owner is told when a generation fails

This path had never run. One model request has ever been made in production and it worked,
so everything below was written, deployed, and never seen by anybody.

### fixed — a failure was filed under "Building", forever

The panel rendered whenever any request existed and was headed **Building**. A restaurant
whose only generation had failed saw an animated finished dish under that word, with a
grey pill reading "did not work", permanently.

The reason was marked `hidden md:inline` — invisible on a phone, which is what an owner
has in their hand. And the single control on the row, Cancel, was hidden precisely for
failed rows, so there was nothing to do with it.

Failures now get their own block, headed *Did not work*, with the reason on screen at
every width, and a line saying what usually causes it and what it cost.

### the trap in the obvious fix

The obvious fix is a Dismiss button. It would be wrong.

An owner may write exactly one column on `model_requests` — `state` — and exactly two
values, `pending` and `cancelled`. So Dismiss has to cancel. And `model_requests_used`
counts every state **except** `cancelled`. A dismiss button would therefore refund the
generation it just spent: the retry loop that the comment in `0007_model_requests.sql`
says must not exist.

So there is no dismiss. The row stays, the cost is stated plainly, and putting a slot back
is a super admin raising the quota — a decision by a person who knows whose fault the
failure was. `check_admin.py` now proves the refund empirically, with a real token, so the
next person to look at that dead-end row and reach for the obvious fix finds the reason
first.

### verified — the admin is genuinely built for a phone

Sweeping for more of the `hidden md:` pattern found no other information withheld on
small screens: `AdminShell` has a real mobile header and bottom nav, `Sidebar` has its
toggle, and the one remaining case is a table's column headings, hidden because the row
beneath them stacks.

## 6. Small things, first-run

### fixed — the setup wizard's dish rows had no labels

Three inputs — dish, price, category — stacked on a phone with the column headings hidden,
leaving them distinguishable only by placeholders, and a placeholder is gone the moment
somebody types. This is the first screen a new restaurant ever fills in.

They also had no label of any kind, so a screen reader announced "edit text" three times.
Now labelled, visible below the `sm` breakpoint and carrying the accessible name at every
width.

---

## 7. The screen whose whole purpose is paper

### fixed — the QR screen could not be printed

Its own header calls it *the physical delivery vehicle*. It offered one **Download SVG**
button per code, so an owner wanting thirty table cards clicked Download thirty times and
then had to lay them out themselves.

And Ctrl+P did not rescue them. The admin had **no print styles at all**, and its shell
actively defeats printing: `md:h-screen md:overflow-hidden` on the root with the scroll on
`<main>`. A fixed-height clipped container meeting a paged medium prints exactly one
screenful — so a request for thirty table codes produced the first six and a cut-off
seventh, with the sidebar and bottom nav printed around them.

Now there is a **Print codes** button and a print stylesheet: the shell is unclipped, the
navigation dropped, the theme forced to black on white because a QR needs contrast and ink
costs money, and every code marked `break-inside: avoid` so a card survives being cut out.
Each table card prints the restaurant's name under it — on paper the card *is* the whole
context, and a code alone on a table tells staff nothing. The restaurant's own code prints
too, so Print gives a usable sheet even when nobody asked for table codes.

**Verified in the built CSS, not assumed.** Tailwind's `print:` variant and the hand-written
`@media print` block were both checked in the compiled output — the two `print:block`
elements would have silently stayed hidden if the variant had not been generated.

---

## 8. A dish that promised 3D it could not deliver

### fixed — four places claimed 3D from intent alone

`is_3d` is the owner's *intent*. Whether there is a model to show is a different question,
and four places asked only the first:

- the **3D category pill** in the category bar
- membership of the **3D section** at the top of the menu
- the **3D badge** on the card
- the **VIEW IN 3D button**

So a dish whose model was missing rendered every one of them and then did nothing when a
diner tapped it — on the product's headline feature, on the surface a diner sees.

**Correction to my first reading of this.** I initially wrote that an archived or rejected
model would leave a live dish advertising 3D. It would not: `loadMenu` in `menu.js` already
computes `is_3d: !!r.is_3d && !!(glb || usdz)`, so a model that `public_menu` stripped
arrives with the intent already cleared. The guard in `markup.js` is not a repair of that —
it is the same rule stated where the markup is built, for the two ways round the loader:
`render.mjs`, a different renderer with its own loader, and any future caller that hands
this module an item it assembled itself.

The first version of the predicate was also wrong in the other direction. It tested
`item.model` alone, which would have switched 3D **off** for a dish with only a USDZ — and
iOS Quick Look takes the USDZ and nothing else, so that is exactly the dish that most needs
it. No model in the library is in that state (all ten have both files), so nothing live was
affected, and the predicate now matches `loadMenu`'s so it stays true by agreement rather
than by luck. Both directions have a fixture and both turn the suite red.

All four sites now use one predicate, `offers3d(item)`. The reverse case is deliberately
untouched: a dish can have a model with `is_3d` off, which is the owner choosing to show it
as a photo dish, and two of Monday Greens' dishes are set that way.

### the old checks already knew

No live menu is in that state: all three restaurants' 3D dishes have live models today.

Adding a fixture dish in this state and reverting the fix turns **seven** checks red — and
three of them are checks that already existed.
*"...and only one of them wears the 3D-block badge"*, *"...and no AR button"*: the suite had
encoded the right rule all along and simply had no dish in that state to catch it out.

---

## 9. Stored XSS: an owner could put script on their diners' phones

**This is the most serious thing the audit found.** Fixed and deployed.

Every owner-controlled string on the menu goes one of two ways: into markup, where `e()`
escapes it, or into a `<style>` block, where `e()` is not the right tool and was never
applied. The CSS path is guarded by allow-lists instead — and one of them was the wrong
shape.

The hero image URL was checked with:

```js
/^[^"'\\s]+$/    // no quote, no apostrophe, no backslash, no whitespace
```

That forbids closing the `url("` string, which is the **CSS** problem. It permits `<`, `>`
and `/`, which is the **HTML** one. An HTML parser ends a `<style>` element at `</style>`
whatever the CSS around it is doing, so:

```
hero_image_url = x</style><script>alert(1)</script>
```

contains none of the four banned characters and executes on the diner's phone. Stored,
served from the restaurant's own menu, on a page that asks people to order food — the
natural payload is a fake card form, not an alert.

**Reachable by any owner.** They can PATCH their own tenant's settings directly with their
token; RLS lets a member write their own tenant, as it must. The victims are that
restaurant's diners.

**A blocklist was the wrong shape.** There is no version of it that stays correct, because
it has to know every character that means something to two parsers at once. The value is
now matched as a *URL* — an absolute `https://` URL or a rooted path, and in both cases
only characters that belong in one. Both live restaurants' values pass unchanged.

Six checks cover it, one per owner-controlled value that reaches CSS — the hero, the fonts,
the hero height, the palette, and the font links — plus two that the real shapes still
render, because a guard that drops everything is not a fix. Restoring the exact original
regex turns the hero check red and prints the payload verbatim.

### verified — the other injection surfaces hold

- **The waiter's page** inlines the entire price book as JSON inside a `<script>`. It
  already escapes every `<` to `\u003c`, which is the correct mitigation for exactly this.
  The diner page does the same for its runtime config.
- **Dish names, descriptions, categories, hero and logo images in markup** all go through
  `e()`.
- **The palette** uses a tight allow-list that excludes `<`, `;` and braces, so a colour
  cannot close a declaration, open a rule, or leave the style element.

---

## 10. A privileged side effect that happened before the authorisation check

### fixed — anyone signed in could force an account into existence

`/api/members` runs with the service key, which bypasses RLS, so it has to authorise its
own caller. It did — through `add_tenant_member`, called as the signed-in user, which
refuses correctly. Nobody was ever added to a restaurant they had no right to.

The bug was the **order**. By the time that refusal happened, the route had already created
a confirmed auth account with the service key, and the account stayed. Any signed-in user
could post a stranger's email address with any tenant id, collect a `403`, and have made
that address exist.

It is not a takeover: no password is set, and the recovery link is generated only on the
success path. What it does is let anybody pollute `auth.users` and, more usefully to an
attacker, **take an email address out of circulation** — the real person can no longer sign
up, because `createUser` in the signup route then fails with "already registered".

Demonstrated before fixing: a throwaway attacker, a restaurant they were not in, a stranger's
address. `403`, and the account existed. Fixed by asking the database the same question
`add_tenant_member` will, as the same user, *before* the service key touches anything —
`tenants_read` is `is_member_of(id)`, which is membership or super admin. One authority,
consulted twice, rather than a second rule written in the route that could drift from the
first.

Three checks in `check_admin.py`, which needed a second cookie jar to run: the routes
authenticate by cookie and the suite only had the owner's.

### verified — every other privileged route authorises first

Seven routes hold the service key. `account-log` and `admin-links` gate on
`requireSuperAdmin()` as their first act; `branches` and `tenants` check `is_super_admin()`
at the top of each handler and reach the service key only from helpers called afterwards;
`signup` is deliberately unauthenticated and gated by an invite code instead.

### open — four privileged routes nothing calls

`/api/branches`, `/api/tenants`, `/api/admin-links` and `/api/account-log` have **zero call
sites**, and `/api/categories/reorder` is referenced only by a comment explaining why it is
bypassed. They belong to an older schema — `brands`, `restaurants`, integer ids — and none
of those tables exist.

They are inert today: unauthenticated they answer `401`, and to an ordinary signed-in user
`branches` fails on the missing table while `tenants` and `account-log` answer `403`. But
they are dead code carrying the RLS bypass into the deployed Worker, and one of them is
built around a `storeInitialPassword` helper — a pattern nobody should inherit from a file
they assumed was live.
