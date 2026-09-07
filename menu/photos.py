#!/usr/bin/env python3
"""Dish photos, at the size a phone actually draws them.

    python menu/photos.py --tenant mg --dry-run
    python menu/photos.py --tenant mg
    python menu/photos.py --all

**The measurement first, because the fix is only as good as the number.** Temo, on the
deployed menu: "loading the photos takes forever." Monday Greens ships 135 photos across
170 dishes:

    source            1200 x 675, ~150 KB each          ~20 MB for one menu
    drawn at          430 px wide (the card slot)       ~8x more pixels than shown
    served from       pub-....r2.dev and Wolt's CDN     cross-origin, extra connections
    Cache-Control     absent on the r2.dev objects      tomorrow's visit re-downloads it

So the page is not slow because of the number of requests, or lazy-loading, or the CSS.
It is slow because it is sending eight times the picture, from somebody else's origin,
uncacheably.

**What this does.** Fetches each photo once, re-encodes it to 860 px wide WebP - 2x the
430 px slot, so it stays crisp on a retina phone - and writes it into our own photos
bucket. `items.photo_key` is repointed at the new key and the original URL is kept in
`photo_source_url` (0016), so nothing is lost and the batch is reversible.

After that a photo is served by our Worker from `/a/<key>`: same origin as the menu, so
the connection is already open, and `immutable` because the key contains a hash of the
source - a changed photo is a different key, so the cache never has to be told anything.

**What it is NOT.** Not a resize on the fly. Cloudflare can do that with Image Resizing,
which is a paid zone feature and unavailable on `workers.dev`, and it would put a
transform in the request path of every diner forever. Doing it once, at publish time, is
both cheaper and the shape the self-serve product needs anyway: an owner will upload a
photo from their phone and we will serve a derivative of it.

Costs nothing but bandwidth. Touches no Meshy credits, no models, and no live page until
the tenant is republished.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import storage                                    # noqa: E402
from menu.publish import connect                  # noqa: E402

# 2x the 430 px card slot. Not 3x: at this subject matter - a plate, photographed close -
# the third multiple is invisible on a phone and costs another 60% in bytes.
MAX_W = 860
# 78 is where WebP stops being distinguishable from the source on food photography and
# starts costing real bytes. Checked by eye on a plate with fine texture, which is the
# hardest case a menu has.
QUALITY = 78
UA = "BetaReal/1.0 (+https://betareal.ge)"
TIMEOUT = 30


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def encode(raw: bytes) -> tuple[bytes, tuple[int, int], tuple[int, int]]:
    """Downscaled WebP, plus the size before and after."""
    from PIL import Image

    im = Image.open(io.BytesIO(raw))
    before = im.size
    # EXIF orientation, applied before anything else. A photo taken on a phone held
    # sideways is stored upright with a rotation flag, and every tool that ignores the flag
    # produces a menu full of dishes lying on their side.
    try:
        from PIL import ImageOps
        im = ImageOps.exif_transpose(im)
    except Exception:
        pass
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
    if im.width > MAX_W:
        h = round(im.height * MAX_W / im.width)
        im = im.resize((MAX_W, h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=QUALITY, method=6)
    return buf.getvalue(), before, im.size


def key_for(tenant_slug: str, source: str) -> str:
    """`p/<tenant>/<hash>.webp`.

    The hash is of the SOURCE URL, so re-running is free and idempotent, and a photo that
    has genuinely changed lands on a different key - which is what makes it safe to serve
    every one of these `immutable`.
    """
    h = hashlib.sha1(source.encode("utf-8")).hexdigest()[:16]
    return f"p/{tenant_slug}/{h}.webp"


def rows(cur, slug: str | None):
    cur.execute("""
        select i.id, t.slug, i.photo_key
        from items i join tenants t on t.id = i.tenant_id
        where i.photo_key is not null
          and i.photo_source_url is null
          and i.photo_key ~ '^https?://'
          and (%s::text is null or t.slug = %s)
        order by t.slug, i.position
    """, (slug, slug))
    return cur.fetchall()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tenant", help="slug; omit with --all for every tenant")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and measure, write nothing")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    if not a.tenant and not a.all:
        ap.error("pass --tenant <slug> or --all")

    back = storage.backend()

    # The worklist first, then the connection is CLOSED. Downloading and re-encoding 190
    # photos takes several minutes, and holding a Postgres connection open across it does
    # not work: Supabase's pooler drops an idle client and the whole batch dies on COMMIT
    # with "server closed the connection unexpectedly" - which is exactly what the first
    # run of this did, after all the work was already done.
    with connect() as conn, conn.cursor() as cur:
        todo = rows(cur, a.tenant)
    if a.limit:
        todo = todo[:a.limit]
    if not todo:
        print("nothing to do - every photo is already ours")
        return 0
    print(f"{len(todo)} photos to downscale  ({storage.describe()})")
    print(f"  target {MAX_W}px wide, WebP q{QUALITY}\n")

    got = saved = 0
    failed: list[str] = []
    done: list[tuple[str, str, str]] = []       # (key, source, item_id)
    for i, (item_id, slug, source) in enumerate(todo, 1):
        key = key_for(slug, source)
        try:
            raw = fetch(source)
            out, before, after = encode(raw)
        except Exception as exc:
            # A photo that will not fetch or decode keeps the URL it has. A menu with one
            # slow picture beats a menu with one missing dish.
            failed.append(f"{source[-40:]}: {exc}")
            continue
        got += len(raw)
        saved += len(raw) - len(out)
        pct = 100 - round(100 * len(out) / max(1, len(raw)))
        print(f"  [{i:>3}/{len(todo)}] {slug:<8} "
              f"{before[0]}x{before[1]} {len(raw)//1024:>4} KB  ->  "
              f"{after[0]}x{after[1]} {len(out)//1024:>3} KB  (-{pct}%)")
        if a.dry_run:
            continue
        # Uploaded before the row is repointed, and keyed by a hash of the source, so a
        # crash anywhere in this loop leaves objects that the next run simply overwrites -
        # never a row pointing at a key that does not exist yet.
        back.put("photos", key, out, "image/webp")
        done.append((key, source, item_id))

    if done:
        with connect() as conn, conn.cursor() as cur:
            for key, source, item_id in done:
                # photo_key and photo_source_url in ONE statement: there is no moment at
                # which the original has been replaced and not yet recorded.
                cur.execute(
                    "update items set photo_key = %s, photo_source_url = %s where id = %s",
                    (key, source, item_id))
            conn.commit()
        print(f"\n{len(done)} rows repointed")

    print(f"\n{got/1e6:.1f} MB in, {(got-saved)/1e6:.1f} MB out "
          f"- {100*saved//max(1,got)}% less for a diner to download")
    if failed:
        print(f"\n{len(failed)} could not be processed and kept their original URL:")
        for f in failed[:10]:
            print(f"  {f}")
    if a.dry_run:
        print("\n(dry run - nothing written. Drop --dry-run to apply, then republish.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
