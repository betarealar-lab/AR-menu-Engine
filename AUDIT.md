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
