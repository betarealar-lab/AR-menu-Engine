#!/usr/bin/env python3
r"""BetaReal Scan Studio - judge whether an AI model of a dish is good enough to show a guest.

    python studio.py                    laptop, local disk
    python studio.py --port 8765        http://localhost:8765

Hosted, it reads R2 and Meshy credentials from the environment and several people share
one key. Locally it falls back to a folder, so nothing has to change to work offline.

A VARIANT is one angle strategy for one dish - ring-25, ring-45, three-plus-top. The same
dish shot four ways is four experiments, and which angles win is the open question the
engine comparison cannot answer.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import csv
import io
import json
import os
import shutil
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import dataset
import engines
import optimize
import storage
from config import load_env
from engines import Job

ROOT = Path(__file__).resolve().parent
SLOTS = dataset.SLOTS

# Why a dish failed. The real output: after ~30 dishes these say which food is scannable,
# what the capture guide must warn about, and which venues to sell to.
FAULTS = [
    "glare / specular sauce", "thin or fine structure", "transparent / liquid",
    "dark or low contrast", "cluttered background", "deep bowl, hidden interior",
    "tall or stacked", "uniform texture", "reflective tableware", "inconsistent grade",
]

RUNNING: set[tuple[str, ...]] = set()
RUN_LOCK = threading.Lock()


def _model_key(rec: dict, stage: str) -> str:
    """Which GLB to hand back.

    `ship` is the default and the point of the whole exercise: review must load the
    optimised, real-size file, because that is what a guest gets. A master that looks
    perfect while the optimiser has eaten the garnish is a false pass, and at ~216 MB of
    VRAM against ~52 MB it is also what drops the tab on a mid-range Android.

    `master` stays reachable so a contested verdict can be checked against the original -
    the only honest way to tell "the engine got it wrong" from "the optimiser did".
    """
    cat = rec.get("catalog_keys") or {}
    if stage == "master":
        return rec.get("model_key", "")
    return cat.get("draco") or cat.get("opt") or rec.get("model_key", "")


def users() -> dict[str, str]:
    """STUDIO_USERS='temo:pass,niko:pass'. Empty means open - fine on a laptop, never hosted."""
    raw = os.environ.get("STUDIO_USERS", "").strip()
    out = {}
    for pair in raw.split(","):
        if ":" in pair:
            n, _, p = pair.partition(":")
            out[n.strip()] = p.strip()
    return out


class Handler(BaseHTTPRequestHandler):
    engine_name: str
    out_dir: Path

    def log_message(self, fmt, *a):
        pass

    # ---------- auth ----------

    def whoami(self) -> str | None:
        """Returns the username, or None if the request should be challenged."""
        accounts = users()
        if not accounts:
            return "local"
        hdr = self.headers.get("Authorization", "")
        if hdr.startswith("Basic "):
            try:
                name, _, pw = base64.b64decode(hdr[6:]).decode().partition(":")
            except (binascii.Error, UnicodeDecodeError):
                return None
            if accounts.get(name) and accounts[name] == pw:
                return name
        return None

    def challenge(self) -> None:
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="BetaReal Scan Studio"')
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---------- plumbing ----------

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json")

    def _read(self) -> dict:
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def _q(self) -> dict:
        return {k: v[0] for k, v in
                urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).items()}

    # ---------- GET ----------

    def do_GET(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        # The platform's health probe cannot send credentials, so it has to sit in front
        # of the auth check. It reveals nothing - a literal "ok" and the storage mode.
        if path == "/healthz":
            # Storage backend and optimiser toolchain, both non-sensitive, so a deploy can
            # be verified from outside without handing anyone a login.
            body = f"ok storage={storage.backend().kind} optimizer={optimize.toolchain() or 'none'}"
            return self._send(200, body.encode(), "text/plain")
        who = self.whoami()
        if who is None:
            return self.challenge()
        try:
            if path == "/":
                return self._send(200, (ROOT / "web" / "studio.html").read_bytes(),
                                  "text/html; charset=utf-8")
            if path == "/api/meta":
                return self._json({
                    "faults": FAULTS, "slots": SLOTS, "slot_role": dataset.SLOT_ROLE,
                    "shapes": dataset.SHAPES, "scale_axes": dataset.SCALE_AXES,
                    "engines": [{"name": n, "credits": engines.build(n).cost_per_job,
                                 "uncertain": getattr(engines.build(n), "cost_uncertain", False)}
                                for n in engines.REGISTRY],
                    "default_engine": self.engine_name,
                    "storage": storage.describe(), "you": who,
                    "optimizer": optimize.describe(),
                })
            if path == "/api/dishes":
                return self._json({"dishes": self._dishes()})
            if path == "/api/library":
                return self._json({"items": self._library()})
            if path == "/thumb":
                q = self._q()
                rec = dataset.record(q["dish"], q.get("variant", "default"))
                return self._serve(dataset.MODELS,
                                   rec.get("master_keys", {}).get("png", ""), "image/png")
            if path == "/api/dish":
                q = self._q()
                return self._json(self._detail(q["dish"], q.get("variant", "default")))
            if path == "/frame":
                q = self._q()
                key = dataset.frame_key(q["dish"], q["variant"], int(q["slot"]))
                return self._serve(dataset.PHOTOS, key, "image/jpeg")
            if path == "/model":
                q = self._q()
                rec = dataset.record(q["dish"], q.get("variant", "default"))
                return self._serve(dataset.MODELS, _model_key(rec, q.get("stage", "ship")),
                                   "model/gltf-binary")
            if path == "/api/export":
                return self._send(200, self._csv().encode(), "text/csv; charset=utf-8")
            self._send(404, b"not found", "text/plain")
        except Exception as e:  # noqa: BLE001
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    # ---------- POST ----------

    def do_POST(self) -> None:
        who = self.whoami()
        if who is None:
            return self.challenge()
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self._read()
            dish, variant = body.get("dish", ""), body.get("variant", "default")

            if path == "/api/upload":
                raw = body["data"].split(",", 1)[-1]
                rec = dataset.save_frame(dish, variant, int(body["slot"]),
                                         base64.b64decode(raw), body.get("name", ""), who)
                return self._json(self._shape(rec))
            if path == "/api/clear-frame":
                return self._json(self._shape(
                    dataset.clear_frame(dish, variant, int(body["slot"]))))
            if path == "/api/delete":
                dataset.delete(dish, body.get("only_variant"))
                return self._json({"ok": True})
            if path == "/api/verdict":
                rec = dataset.record(dish, variant)
                rec.update(verdict=body.get("verdict", ""), faults=body.get("faults", []),
                           note=body.get("note", ""), judged_by=who,
                           judged_utc=dataset._now())
                dataset.write(rec)
                return self._json({"ok": True})
            if path == "/api/scale":
                # Setting a size re-runs the optimiser, because scale is baked into the
                # shipped file rather than applied by the viewer. Five seconds, no credits.
                rec = dataset.record(dish, variant)
                cm = float(body.get("cm") or 0)
                axis = body.get("axis", "width")
                if cm and axis not in dataset.SCALE_AXES:
                    return self._json({"error": f"unknown dimension {axis!r}"}, 400)
                if cm and not 1 <= cm <= 200:
                    return self._json({"error": "A dish is between 1 and 200 cm."}, 400)
                rec["scale"] = {"axis": axis, "cm": cm, "shape": body.get("shape", ""),
                                "set_by": who, "set_utc": dataset._now()} if cm else {}
                if rec.get("model_key") and rec["status"] not in ("running", "optimising"):
                    rec["status"] = "optimising"
                    dataset.write(rec)
                    threading.Thread(target=self._optimize,
                                     args=(dish, variant, who), daemon=True).start()
                else:
                    dataset.write(rec)
                return self._json(self._shape(dataset.record(dish, variant)))
            if path == "/api/optimize":
                rec = dataset.record(dish, variant)
                if not rec.get("model_key"):
                    return self._json({"error": "Nothing generated yet."}, 400)
                if rec["status"] in ("running", "optimising"):
                    return self._json({"status": rec["status"]})
                rec.update(status="optimising", export_error="")
                dataset.write(rec)
                threading.Thread(target=self._optimize,
                                 args=(dish, variant, who), daemon=True).start()
                return self._json({"ok": True})
            if path == "/api/generate":
                key = (dataset.slug(dish), dataset.slug(variant))
                rec = dataset.record(dish, variant)
                # Meshy takes 1-4 images. Four is better, one is a real generation, and
                # refusing three because it is not four just wastes a dish someone shot.
                if not rec["frames"]:
                    return self._json({"error": "Upload at least one frame first."}, 400)
                with RUN_LOCK:
                    if key in RUNNING:
                        return self._json({"status": "running"})
                    RUNNING.add(key)
                rec.update(status="running", error="", model_key="")
                dataset.write(rec)
                threading.Thread(target=self._generate,
                                 args=(dish, variant, body.get("engine"), who),
                                 daemon=True).start()
                return self._json({"ok": True})
            self._send(404, b"not found", "text/plain")
        except Exception as e:  # noqa: BLE001
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    # ---------- work ----------

    def _generate(self, dish: str, variant: str, engine_name: str | None, who: str) -> None:
        name = engine_name or self.engine_name
        key = (dataset.slug(dish), dataset.slug(variant))
        # Per variant: the finally clause empties this directory, and two dishes
        # generating at once would delete each other's staged frames mid-call.
        tmp = self.out_dir / "_run" / f"{key[0]}--{key[1]}"
        try:
            engine = engines.build(name)
            # Engines take file paths, so stage the frames locally for the call only.
            tmp.mkdir(parents=True, exist_ok=True)
            paths = []
            for i, blob in enumerate(dataset.frames(dish, variant)):
                p = tmp / f"{key[0]}-{key[1]}-{i}.jpg"
                p.write_bytes(blob)
                paths.append(p)

            result = engine.generate(Job(dish=key[0], images=paths), tmp)

            rec = dataset.record(dish, variant)
            rec["engine"] = name
            rec["seconds"] = result.seconds
            rec["generated_by"] = who
            if result.ok:
                masters = {}
                for ext, path in result.files.items():
                    kind = "png" if ext == "thumb" else ext
                    masters[kind] = dataset.save_model(dish, variant, name, kind,
                                                       Path(path).read_bytes())
                rec["master_keys"] = masters
                rec["model_key"] = masters.get("glb", "")
                rec["status"] = "optimising"
            else:
                rec.update(status="failed", error=result.error)
            dataset.write(rec)
            # Optimise straight away rather than waiting for approval. Already on a
            # background thread, five seconds, no credits - and it means review loads
            # the thing that will actually ship instead of a ~200 MB master.
            if result.ok:
                self._optimize(dish, variant, who)
        except Exception as e:  # noqa: BLE001
            rec = dataset.record(dish, variant)
            rec.update(status="failed", error=f"{type(e).__name__}: {e}")
            dataset.write(rec)
        finally:
            with RUN_LOCK:
                RUNNING.discard(key)
            for f in tmp.glob("*"):
                try: f.unlink()
                except OSError: pass

    def _serve(self, bucket: str, key: str, ctype: str) -> None:
        """Redirect to a signed R2 URL where possible, stream the bytes where not.

        The redirect keeps model and photo traffic off the app server entirely - R2 egress
        is free, the host's bandwidth allowance is not. Local disk has nothing to sign
        against, so it falls back to streaming.
        """
        if not key:
            return self._send(404, b"not found", "text/plain")
        url = storage.backend().signed_url(bucket, key)
        if url:
            self.send_response(302)
            self.send_header("Location", url)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        blob = storage.backend().get(bucket, key)
        return self._send(200, blob, ctype) if blob else                self._send(404, b"not found", "text/plain")

    def _optimize(self, dish: str, variant: str, who: str) -> None:
        """Master -> the files a menu ships, at real-world size.

        Runs automatically after generation, again whenever the scale changes, and by
        hand from the rail. Always lands on `review`: if it fails, the master is still
        there and still judgeable, it just is not shippable yet.

        Only one run per variant at a time, and a size typed WHILE one is running is not
        lost - the loop re-reads the record afterwards and runs again if the number moved.
        Without that, changing 28 to 35 mid-run would save the 35, ship the 28, and show
        no sign of the disagreement.
        """
        key = (dataset.slug(dish), dataset.slug(variant), "opt")
        with RUN_LOCK:
            if key in RUNNING:
                return
            RUNNING.add(key)
        # Per variant, not shared: two dishes optimising at once would otherwise write
        # into one directory and rmtree it from under each other.
        tmp = self.out_dir / "_opt" / f"{key[0]}--{key[1]}"
        try:
            for _ in range(3):
                rec = dataset.record(dish, variant)
                applied = rec.get("scale") or {}
                if not self._optimize_once(dish, variant, who, rec, applied, tmp):
                    return
                after = dataset.record(dish, variant)
                if (after.get("scale") or {}) == applied:
                    return
                # The size moved while that pass ran. Go back to `optimising` before
                # running again, so the page keeps polling instead of showing a file
                # it is about to replace.
                after["status"] = "optimising"
                dataset.write(after)
            # Three passes and the size is still moving under us. Stop chasing it, but
            # never leave the record saying `optimising` with nothing running - that is
            # a spinner the page polls forever.
            rec = dataset.record(dish, variant)
            rec["status"] = "review"
            dataset.write(rec)
        except Exception as e:  # noqa: BLE001
            rec = dataset.record(dish, variant)
            rec.update(status="review", export_error=f"{type(e).__name__}: {e}")
            dataset.write(rec)
        finally:
            with RUN_LOCK:
                RUNNING.discard(key)
            shutil.rmtree(tmp, ignore_errors=True)

    def _optimize_once(self, dish: str, variant: str, who: str, rec: dict,
                       scale: dict, tmp: Path) -> bool:
        """One pass. False means stop - it failed and the record already says so."""
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True, exist_ok=True)
        master = tmp / "master.glb"
        master.write_bytes(dataset.read_model(rec["model_key"]) or b"")

        res = optimize.run(master, tmp / "out", scale=scale or None)
        rec = dataset.record(dish, variant)
        if not res.ok:
            rec.update(status="review", export_error=res.error)
            dataset.write(rec)
            return False

        catalog = {}
        for kind, path in res.files.items():
            name = {"draco": "model_draco.glb", "opt": "model_opt.glb"}.get(kind, path.name)
            catalog[kind] = dataset.save_catalog(dish, variant, name, path.read_bytes())
        # Meshy already returns a USDZ; carry it into the catalogue rather than
        # converting one ourselves, since Linux has no reliable USDZ writer.
        if rec.get("master_keys", {}).get("usdz"):
            blob = dataset.read_model(rec["master_keys"]["usdz"])
            if blob:
                catalog["usdz"] = dataset.save_catalog(dish, variant, "model.usdz", blob)

        rec.update(status="review", catalog_keys=catalog,
                   export_stats=res.stats, catalogued_utc=dataset._now(),
                   catalogued_by=who, export_error="")
        dataset.write(rec)
        return True

    # ---------- shaping ----------

    def _shape(self, rec: dict) -> dict:
        rec = dict(rec)
        rec["filled"] = len(rec["frames"])
        rec["frames"] = {i: rec["frames"].get(str(i)) for i in range(4)}
        rec["all_variants"] = dataset.variants_of(rec["dish"]) or [rec["variant"]]
        return rec

    def _dishes(self) -> list[dict]:
        out = []
        for d in dataset.dishes():
            vs = dataset.variants_of(d)
            recs = [dataset.record(d, v) for v in vs]
            out.append({"dish": d, "variants": vs or ["default"],
                        "judged": sum(1 for r in recs if r.get("verdict")),
                        "shipping": sum(1 for r in recs if r.get("catalog_keys"))})
        return out

    def _library(self) -> list[dict]:
        """Everything ever made, newest first - the answer to "what have we already done".

        Reads one record per dish+variant. Fine at the scale a single kitchen produces;
        if this ever gets slow, the fix is an index object rather than a fan-out read.
        """
        out = []
        for rec in dataset.catalogue():
            st = rec.get("export_stats") or {}
            out.append({
                "dish": rec.get("dish"), "variant": rec.get("variant"),
                "status": rec.get("status"), "verdict": rec.get("verdict"),
                "faults": rec.get("faults", []), "engine": rec.get("engine"),
                "frames": len(rec.get("frames", {})),
                "has_thumb": bool(rec.get("master_keys", {}).get("png")),
                "has_model": bool(rec.get("model_key")),
                # Shippable is a fact about what exists, not a flag anyone sets.
                "shipping": bool(rec.get("catalog_keys")),
                "scale": rec.get("scale") or {},
                "draco_mb": round(st.get("draco_bytes", 0) / 1048576, 2) or None,
                "shrink": st.get("shrink"),
                "judged_by": rec.get("judged_by"), "judged_utc": rec.get("judged_utc"),
                "created_utc": rec.get("created_utc"),
                "catalogued_utc": rec.get("catalogued_utc"),
            })
        out.sort(key=lambda r: (r.get("catalogued_utc") or r.get("judged_utc")
                                or r.get("created_utc") or ""), reverse=True)
        return out

    def _detail(self, dish: str, variant: str) -> dict:
        return self._shape(dataset.record(dish, variant))

    def _csv(self) -> str:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["dish", "variant", "engine", "status", "verdict", "faults", "note",
                    "seconds", "scale_axis", "scale_cm", "draco_bytes", "shipping",
                    "judged_by", "judged_utc", "model_key", "error"])
        for r in dataset.catalogue():
            sc, st = r.get("scale") or {}, r.get("export_stats") or {}
            w.writerow([r.get("dish"), r.get("variant"), r.get("engine"), r.get("status"),
                        r.get("verdict"), "; ".join(r.get("faults", [])), r.get("note"),
                        r.get("seconds"), sc.get("axis", ""), sc.get("cm", ""),
                        st.get("draco_bytes", ""), bool(r.get("catalog_keys")),
                        r.get("judged_by"), r.get("judged_utc"),
                        r.get("model_key"), r.get("error")])
        return buf.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "out")
    ap.add_argument("--engine", default="meshy-7")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8765)))
    ap.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    a = ap.parse_args()

    load_env()
    Handler.engine_name = a.engine
    Handler.out_dir = a.out

    accounts = users()
    print("BetaReal Scan Studio")
    print(f"  storage : {storage.describe()}")
    print(f"  engine  : {a.engine}")
    print(f"  optimizer: {optimize.describe()}")
    print(f"  users   : {', '.join(accounts) if accounts else 'OPEN - no auth (set STUDIO_USERS)'}")
    print(f"  listen  : http://{a.host}:{a.port}")
    if a.host != "127.0.0.1" and not accounts:
        print("\n  !! Reachable beyond this machine with no password. Set STUDIO_USERS.")
    print("\n  Ctrl+C to stop.")
    try:
        ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
