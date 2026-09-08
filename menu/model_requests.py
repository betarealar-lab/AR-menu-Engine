#!/usr/bin/env python3
"""The bridge: a restaurant's request becomes engine work, and the result becomes a model.

    python menu/model_requests.py --once      # one pass, then exit
    python menu/model_requests.py --watch     # keep going
    python menu/model_requests.py --status    # what is in flight, spend nothing

Named after the table and NOT `requests.py`, which is what it was called for about an
hour. Python puts a script's own directory first on `sys.path`, so a module called
`requests` sitting in `menu/` shadows the HTTP library for every other script in this
folder - `make_admin.py` and `import_live.py` both died on
`module 'requests' has no attribute 'get'`, which names the symptom and hides the cause
completely. Nothing in here may be called `requests`, `json`, `types`, `email` or
`logging`.

This is the ONLY file that knows both halves of the system. On one side, `model_requests`
in Postgres - what a restaurant asked for. On the other, `dataset` and `jobs` - how a model
actually gets made. The menu platform has never heard of a lease or a credit; the engine
has never heard of a tenant. Everything either of them needs to know about the other passes
through here.

That is deliberate and it is the part worth protecting. The engine is going to be replaced
- a second one, a self-hosted one at a fraction of the cost, a re-run of every dish through
something better next year. Each of those is a change to this file and to `engines/`, and
to nothing in `app/`.

**It never approves anything.** A request reaches `approved` through the quota trigger in
0007 and no other way, so a bug here can waste a pass, not 30 credits.

Four passes, on purpose:

    multiview() queued capture task -> three predicted frames -> captures rows -> done
    pull()      approved -> frames in the dataset -> a generate job -> running
                approved rescale -> size on the record -> an optimise job -> running
    collect()   running  -> reads what the engine produced -> a models row -> done

Multiview and rescale are here and not in the admin because the image-model key and the
optimiser live on this side. The admin asks by writing a row, the same way it asks for a
model, and never learns what either costs.

Split because they fail differently. `pull` failing means we have not started; `collect`
failing means we have already paid and must not lose the result. Neither can leave a
request in a state the other cannot pick up: pull marks `running` only after the job is on
the queue, so a crash in between leaves it `approved` and the next pass re-enqueues - which
`jobs.exists` makes free.
"""
from __future__ import annotations

import argparse
import datetime
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import dataset                                                # noqa: E402
import jobs                                                   # noqa: E402
import storage                                                # noqa: E402
from config import load_env                                   # noqa: E402

WHO = "self-serve"

# What a restaurant is told when a generation fails. Deliberately not the engine's error:
# "MESHY_TASK_FAILED: texture bake timeout" is true and useless, and a restaurant owner
# reading it learns only that we do not think about them.
FAILED_NOTE = ("We could not build this one from these photos. Try again with more even "
               "light and the whole dish in frame.")


def _conn():
    import psycopg
    url = os.environ.get("SUPABASE_DB_URL", "")
    if not url:
        raise SystemExit("SUPABASE_DB_URL is not set. Check: python preflight.py --supabase")
    return psycopg.connect(url, connect_timeout=25)


def _slot_of(key: str, fallback: int) -> int:
    """Which of the four angles this photo is.

    Read out of the key rather than trusted from its position: `capture.js` puts the slot
    name in the filename precisely so a frame is identifiable on its own, and an owner who
    photographed only the front and the back would otherwise have the back stored as
    `right` - which is worse than a missing frame, because the engine believes it.
    """
    name = key.rsplit("/", 1)[-1]
    for i, slot in enumerate(dataset.SLOTS):
        if name.endswith(f"-{slot}.jpg"):
            return i
    return fallback


def pull(limit: int = 10, verbose: bool = True) -> int:
    """Approved requests -> frames in the dataset -> a generate job. Returns how many."""
    started = 0
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("""
            select id, tenant_id, dish, variant, title, photo_keys,
                   kind, scale_cm, scale_axis, width_cm, length_cm, height_cm
              from model_requests
             where state = 'approved'
             order by requested_utc
             limit %s
        """, (limit,))
        rows = cur.fetchall()

        for (req_id, tenant_id, dish, variant, title, photo_keys,
             kind, scale_cm, scale_axis, width_cm, length_cm, height_cm) in rows:
            if verbose:
                print(f"  {title or dish} ({kind})")

            # The size, onto the engine's record before anything runs. The optimiser bakes
            # it into the shipped file (optimize.py), so it has to be there first - and it
            # is the single most common reason a model has to be remade.
            if scale_cm:
                rec = dataset.record(dish, variant)
                rec["scale"] = {"axis": scale_axis or "width", "cm": float(scale_cm),
                                "shape": "", "set_by": WHO, "set_utc": dataset._now()}
                # All three, as the owner said them. The optimiser bakes the primary; the
                # rest wait for the day it compares and warns (0013).
                rec["dims"] = {k: float(v) for k, v in
                               (("width", width_cm), ("length", length_cm),
                                ("height", height_cm)) if v}
                dataset.write(rec)

            if kind == "rescale":
                # Wrong size is an optimise problem, not a generation problem. No photos to
                # pull, no credits to spend: the master exists, and it is re-optimised at
                # the new size. Five seconds, free.
                rec = dataset.record(dish, variant)
                if not rec.get("model_key"):
                    cur.execute("""update model_requests
                                      set state = 'failed', finished_utc = now(),
                                          note = 'There is no model to resize yet.'
                                    where id = %s""", (req_id,))
                    conn.commit()
                    continue
                if not jobs.exists("optimise", dish, variant):
                    rec.update(status="optimising", stage="queued",
                               optimising_since=dataset._now())
                    dataset.write(rec)
                    jobs.enqueue("optimise", dish, variant, who=WHO,
                                 triangles=int(rec.get("master_triangles") or 0))
                cur.execute("update model_requests set state = 'running' where id = %s",
                            (req_id,))
                conn.commit()
                started += 1
                continue

            # Idempotent by construction. A crash after enqueue and before the update
            # leaves the request `approved`, and this is what stops the next pass paying
            # for the same dish twice.
            if jobs.exists("generate", dish, variant):
                if verbose:
                    print("    already queued - marking running")
                cur.execute("update model_requests set state = 'running' where id = %s",
                            (req_id,))
                conn.commit()
                started += 1
                continue

            # The admin's studio keeps frames in `captures` and sends the request with the
            # keys copied in; older requests carried keys only. Either is fine, and the
            # library is consulted when the request itself is empty.
            if not photo_keys:
                cur.execute("""select key from captures
                                where tenant_id = %s and dish = %s and variant = %s
                                order by slot""", (tenant_id, dish, variant))
                photo_keys = [r[0] for r in cur.fetchall()]

            b = storage.backend()
            saved = 0
            for i, key in enumerate(photo_keys or []):
                data = b.get(dataset.PHOTOS, key)
                if not data:
                    # A missing photo is not a reason to spend credits on a worse model.
                    if verbose:
                        print(f"    missing photo {key}")
                    continue
                dataset.save_frame(dish, variant, _slot_of(key, i), data,
                                   source_name=key.rsplit("/", 1)[-1], by=WHO)
                saved += 1

            if not saved:
                cur.execute("""update model_requests
                                  set state = 'failed', note = %s, finished_utc = now()
                                where id = %s""",
                            ("We could not read the photos for this dish.", req_id))
                conn.commit()
                continue

            if title:
                dataset.rename(dish, title)

            jobs.enqueue("generate", dish, variant, requested_by=WHO,
                         tenant_id=str(tenant_id), request_id=str(req_id))
            cur.execute("update model_requests set state = 'running' where id = %s",
                        (req_id,))
            conn.commit()
            started += 1
            if verbose:
                print(f"    queued with {saved} photo(s)")

    return started


def collect(verbose: bool = True) -> int:
    """Running requests whose model is ready -> a `models` row the owner can approve.

    The model lands as a DRAFT, never attached to anything. DECISIONS §9.4: the owner's
    yes is the only thing that puts a model in front of a diner, and a bridge that
    attached its own output would be making that decision for them.
    """
    done = 0
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("""
            select id, tenant_id, item_id, dish, variant, title, kind
              from model_requests where state = 'running'
        """)
        for req_id, tenant_id, item_id, dish, variant, title, kind in cur.fetchall():
            rec = dataset.record(dish, variant)
            catalog = rec.get("catalog_keys") or {}
            status = rec.get("status") or ""

            # A rescale is still optimising until its status says otherwise; a fresh
            # catalogue from BEFORE it ran would otherwise be mistaken for the result.
            if kind == "rescale" and status == "optimising":
                continue

            if status in ("failed", "cancelled"):
                if verbose:
                    print(f"  {title or dish}: {status}")
                cur.execute("""update model_requests
                                  set state = 'failed', note = %s, finished_utc = now()
                                where id = %s""", (FAILED_NOTE, req_id))
                conn.commit()
                continue

            # Shippable is a fact about the object graph, not a flag: a variant is ready
            # when it HAS catalogue files. `draco` is the one a diner downloads, so its
            # absence means there is nothing to ship even if the rest arrived.
            if not catalog.get("draco"):
                continue

            scale = rec.get("scale") or {}
            dims = rec.get("dims") or {}
            cur.execute("""
                insert into models (tenant_id, title, dish, variant,
                                    draco_key, usdz_key, poster_key,
                                    scale_cm, scale_axis, width_cm, length_cm, height_cm,
                                    tenant_state)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'draft')
                on conflict (tenant_id, dish, variant) do update
                   set draco_key = excluded.draco_key,
                       usdz_key = excluded.usdz_key,
                       poster_key = excluded.poster_key,
                       scale_cm = excluded.scale_cm,
                       scale_axis = excluded.scale_axis,
                       width_cm = excluded.width_cm,
                       length_cm = excluded.length_cm,
                       height_cm = excluded.height_cm,
                       -- A rebuilt model goes back to draft. It is a different model, and
                       -- an owner who approved the last one has not seen this one.
                       tenant_state = 'draft',
                       decided_utc = null, decided_by = null
                returning id
            """, (tenant_id, title or rec.get("title") or "", dish, variant,
                  catalog.get("draco"), catalog.get("usdz"),
                  (rec.get("master_keys") or {}).get("png"),
                  scale.get("cm"), scale.get("axis"),
                  dims.get("width"), dims.get("length"), dims.get("height")))
            model_id = cur.fetchone()[0]

            cur.execute("""update model_requests
                              set state = 'done', model_id = %s, engine = %s,
                                  note = '', finished_utc = now()
                            where id = %s""",
                        (model_id, rec.get("engine") or "", req_id))
            conn.commit()
            done += 1
            if verbose:
                print(f"  {title or dish}: ready, waiting for the owner")

    return done


def multiview(verbose: bool = True) -> int:
    """Queued capture tasks -> three predicted frames -> captures rows the owner can see.

    Free for the owner and once per dish (0012: the unique index has no state filter).
    The image model's own cost - three to twelve credits - is ours, and it is recorded on
    the task so we know what "free" is costing.
    """
    from engines import images

    done = 0
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("""
            select t.id, t.tenant_id, t.dish, t.variant, t.source_slot
              from capture_tasks t where t.state = 'queued'
             order by t.requested_utc
             limit 5
        """)
        for task_id, tenant_id, dish, variant, source in cur.fetchall():
            cur.execute("update capture_tasks set state = 'running' where id = %s",
                        (task_id,))
            conn.commit()

            cur.execute("""select slot, key from captures
                            where tenant_id = %s and dish = %s and variant = %s""",
                        (tenant_id, dish, variant))
            frames = dict(cur.fetchall())
            if source not in frames:
                cur.execute("""update capture_tasks set state = 'failed', finished_utc = now(),
                                  note = 'The photo it was meant to work from is gone.'
                                where id = %s""", (task_id,))
                conn.commit()
                continue
            # A real photograph beats a predicted one every time, and this must never
            # quietly overwrite one. Only EMPTY slots are filled.
            empty = [i for i in range(4) if i not in frames]
            if not empty:
                cur.execute("""update capture_tasks set state = 'failed', finished_utc = now(),
                                  note = 'All four angles already have photos.'
                                where id = %s""", (task_id,))
                conn.commit()
                continue

            b = storage.backend()
            blob = b.get(dataset.PHOTOS, frames[source])
            if not blob:
                cur.execute("""update capture_tasks set state = 'failed', finished_utc = now(),
                                  note = 'The photo could not be read.' where id = %s""",
                            (task_id,))
                conn.commit()
                continue

            views, err = images.multiview(blob)
            if err or not views:
                if verbose:
                    print(f"  multiview {dish}: {err}")
                cur.execute("""update capture_tasks set state = 'failed', finished_utc = now(),
                                  note = %s where id = %s""",
                            ("We could not predict the other angles from that photo. "
                             "Try a clearer one, or add the photos yourself.", task_id))
                conn.commit()
                continue

            # Into the tenant's own capture prefix, keyed like the admin keys its uploads,
            # so a predicted frame and a photographed one live side by side and the
            # library can show both - with `generated` telling them apart.
            import hashlib
            for slot, view in zip(empty, views):
                digest = hashlib.sha256(view).hexdigest()[:16]
                key = f"t/{tenant_id}/photo/{digest}-{dataset.SLOTS[slot]}.jpg"
                b.put(dataset.PHOTOS, key, view, "image/jpeg")
                cur.execute("""
                    insert into captures (tenant_id, dish, variant, slot, key, generated)
                    values (%s, %s, %s, %s, %s, true)
                    on conflict (tenant_id, dish, variant, slot) do nothing
                """, (tenant_id, dish, variant, slot, key))

            cur.execute("""update capture_tasks set state = 'done', finished_utc = now()
                            where id = %s""", (task_id,))
            conn.commit()
            done += 1
            if verbose:
                print(f"  multiview {dish}: {min(len(views), len(empty))} angle(s) predicted")
    return done


def status() -> None:
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("""select state, count(*) from model_requests
                       group by state order by state""")
        rows = cur.fetchall()
        if not rows:
            print("  no requests")
        for state, n in rows:
            print(f"  {state:<10} {n}")
        cur.execute("""
            select t.name, t.model_quota, model_requests_used(t.id)
              from tenants t
             where exists (select 1 from model_requests r where r.tenant_id = t.id)
             order by t.name
        """)
        for name, quota, used in cur.fetchall():
            print(f"  {name}: {used}/{quota} used")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true", help="one pass, then exit")
    ap.add_argument("--watch", action="store_true", help="keep going")
    ap.add_argument("--status", action="store_true", help="what is in flight")
    ap.add_argument("--every", type=int, default=30, help="seconds between passes")
    ap.add_argument("--limit", type=int, default=10,
                    help="most requests to start in one pass")
    ap.add_argument("--log", type=Path, default=None,
                    help="append output here as well - used when started at logon, "
                         "where there is no console to print to")
    a = ap.parse_args()

    if a.log:
        # Started hidden at logon there is nowhere for print() to go. Without this the
        # installer's launcher passed `--log`, argparse rejected the unknown flag, and the
        # bridge exited instantly every time - which looked exactly like "the bridge is not
        # running" with nothing anywhere saying why.
        a.log.parent.mkdir(parents=True, exist_ok=True)
        sys.stdout = sys.stderr = open(a.log, "a", encoding="utf-8", buffering=1)
        stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"{chr(10)}=== bridge started {stamp} ===")

    load_env()
    if a.status:
        status()
        return 0
    if not (a.once or a.watch):
        ap.error("pick --once, --watch or --status")

    while True:
        print("multiview")
        predicted = multiview()
        print("pulling")
        started = pull(limit=a.limit)
        print("collecting")
        finished = collect()
        print(f"{predicted} predicted, {started} started, {finished} finished")
        if a.once:
            return 0
        time.sleep(a.every)


if __name__ == "__main__":
    raise SystemExit(main())
