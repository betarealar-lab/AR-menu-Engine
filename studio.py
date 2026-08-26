#!/usr/bin/env python3
r"""BetaReal Scan Studio - judge whether an AI model of a dish is good enough to show a guest.

    python studio.py            ->  http://localhost:8765

Nothing is scanned from a drive and nothing is watched. You make a dish, drop four
photos into it, run an engine, and record a verdict. Frames land in dataset/ the moment
they are uploaded, so the same dish can be re-run against a different engine later on
byte-identical input.

A VARIANT is one angle strategy for one dish - ring-25, ring-45, three-plus-top. The same
dish shot four ways is four experiments, and that comparison is the open question the
engine comparison cannot answer.
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import dataset
import engines
from config import load_env
from engines import Job

ROOT = Path(__file__).resolve().parent
SLOTS = dataset.SLOTS

# Why a dish failed. This is the real output: after ~30 dishes these say which food is
# scannable, what the capture guide must warn about, and which venues to sell to.
FAULTS = [
    "glare / specular sauce",
    "thin or fine structure",
    "transparent / liquid",
    "dark or low contrast",
    "cluttered background",
    "deep bowl, hidden interior",
    "tall or stacked",
    "uniform texture",
    "reflective tableware",
    "inconsistent grade",
]

LOCK = threading.Lock()


class Store:
    """Verdicts and run state, keyed by dish+variant, in one JSON file."""

    def __init__(self, path: Path):
        self.path = path
        self.data: dict = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    def rec(self, dish: str, variant: str) -> dict:
        return self.data.setdefault(dish, {}).setdefault(variant, {
            "status": "empty", "verdict": "", "faults": [], "note": "",
            "engine": "", "model": "", "seconds": 0, "error": "",
        })

    def variants(self, dish: str) -> dict:
        return self.data.setdefault(dish, {})

    def drop(self, dish: str, variant: str | None) -> None:
        if variant:
            self.data.get(dish, {}).pop(variant, None)
        else:
            self.data.pop(dish, None)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2), encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    dataset_dir: Path
    out_dir: Path
    store: Store
    engine_name: str

    def log_message(self, fmt, *a):
        pass

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
        try:
            if path == "/":
                return self._send(200, (ROOT / "web" / "studio.html").read_bytes(),
                                  "text/html; charset=utf-8")
            if path == "/api/meta":
                return self._json({
                    "faults": FAULTS, "slots": SLOTS, "slot_role": dataset.SLOT_ROLE,
                    "engines": [{"name": n, "credits": engines.build(n).cost_per_job,
                                 "uncertain": getattr(engines.build(n), "cost_uncertain", False)}
                                for n in engines.REGISTRY],
                    "default_engine": self.engine_name,
                })
            if path == "/api/dishes":
                return self._json({"dishes": self._dishes()})
            if path == "/api/dish":
                q = self._q()
                return self._json(self._detail(q["dish"], q.get("variant", "default")))
            if path == "/frame":
                q = self._q()
                p = dataset.frame_path(self.dataset_dir, q["dish"], q["variant"], int(q["slot"]))
                if not p or not p.is_file():
                    return self._send(404, b"no frame", "text/plain")
                return self._send(200, p.read_bytes(), "image/jpeg")
            if path == "/model":
                q = self._q()
                with LOCK:
                    rec = self.store.rec(q["dish"], q.get("variant", "default"))
                p = Path(rec.get("model", ""))
                if not p.is_file():
                    return self._send(404, b"no model", "text/plain")
                return self._send(200, p.read_bytes(), "model/gltf-binary")
            if path == "/api/export":
                return self._json({"csv": str(self._export())})
            self._send(404, b"not found", "text/plain")
        except Exception as e:  # noqa: BLE001
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    # ---------- POST ----------

    def do_POST(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self._read()
            dish = body.get("dish", "")
            variant = body.get("variant", "default")

            if path == "/api/upload":
                return self._json(self._upload(dish, variant, body))
            if path == "/api/clear-frame":
                dataset.clear_frame(self.dataset_dir, dish, variant, int(body["slot"]))
                return self._json(self._detail(dish, variant))
            if path == "/api/delete":
                dataset.delete(self.dataset_dir, dish, body.get("only_variant"))
                with LOCK:
                    self.store.drop(dish, body.get("only_variant"))
                    self.store.save()
                return self._json({"ok": True})
            if path == "/api/verdict":
                with LOCK:
                    rec = self.store.rec(dish, variant)
                    rec["verdict"] = body.get("verdict", "")
                    rec["faults"] = body.get("faults", [])
                    rec["note"] = body.get("note", "")
                    self.store.save()
                return self._json({"ok": True})
            if path == "/api/generate":
                stored = dataset.frames(self.dataset_dir, dish, variant)
                if len(stored) < 4:
                    return self._json({"error": f"Needs 4 frames. {len(stored)} uploaded."}, 400)
                with LOCK:
                    rec = self.store.rec(dish, variant)
                    if rec["status"] == "running":
                        return self._json({"status": "running"})
                    rec.update(status="running", error="", model="")
                    self.store.save()
                threading.Thread(target=self._generate,
                                 args=(dish, variant, body.get("engine")),
                                 daemon=True).start()
                return self._json({"ok": True})
            self._send(404, b"not found", "text/plain")
        except Exception as e:  # noqa: BLE001
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    # ---------- work ----------

    def _upload(self, dish: str, variant: str, body: dict) -> dict:
        """One frame, already downscaled to 2048px JPEG by the browser - the same size
        the engine would reduce it to anyway, so nothing is lost by storing this."""
        raw = body["data"].split(",", 1)[-1]
        dataset.save_frame(self.dataset_dir, dish, variant, int(body["slot"]),
                           base64.b64decode(raw), body.get("name", ""))
        with LOCK:
            rec = self.store.rec(dish, variant)
            if rec["status"] in ("empty", ""):
                rec["status"] = "ready"
            self.store.save()
        return self._detail(dish, variant)

    def _generate(self, dish: str, variant: str, engine_name: str | None) -> None:
        name = engine_name or self.engine_name
        try:
            engine = engines.build(name)
            out = self.out_dir / dataset.slug(dish) / dataset.slug(variant) / name
            job = Job(dish=dataset.slug(dish),
                      images=dataset.frames(self.dataset_dir, dish, variant))
            result = engine.generate(job, out)
            with LOCK:
                rec = self.store.rec(dish, variant)
                rec["engine"] = name
                rec["seconds"] = result.seconds
                if result.ok:
                    rec.update(status="done", model=str(result.files["glb"]))
                else:
                    rec.update(status="failed", error=result.error)
                self.store.save()
        except Exception as e:  # noqa: BLE001
            with LOCK:
                self.store.rec(dish, variant).update(
                    status="failed", error=f"{type(e).__name__}: {e}")
                self.store.save()

    def _dishes(self) -> list[dict]:
        out = []
        for dish in dataset.dishes(self.dataset_dir):
            variants = dataset.variants_of(self.dataset_dir, dish)
            with LOCK:
                recs = self.store.variants(dish)
            out.append({
                "dish": dish,
                "variants": variants or ["default"],
                "judged": sum(1 for v in recs.values() if v.get("verdict")),
                "done": sum(1 for v in recs.values() if v.get("status") == "done"),
            })
        return out

    def _detail(self, dish: str, variant: str) -> dict:
        meta = dataset.manifest(self.dataset_dir, dish, variant)
        with LOCK:
            rec = dict(self.store.rec(dish, variant))
        rec.update(
            dish=dish, variant=variant,
            frames={i: meta["frames"].get(str(i)) for i in range(4)},
            filled=len(meta["frames"]),
            all_variants=dataset.variants_of(self.dataset_dir, dish) or [variant],
        )
        return rec

    def _export(self) -> Path:
        p = self.out_dir / "verdicts.csv"
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["dish", "variant", "engine", "status", "verdict", "faults",
                        "note", "seconds", "model", "error"])
            with LOCK:
                for dish, variants in sorted(self.store.data.items()):
                    for variant, r in sorted(variants.items()):
                        w.writerow([dish, variant, r.get("engine", ""), r.get("status", ""),
                                    r.get("verdict", ""), "; ".join(r.get("faults", [])),
                                    r.get("note", ""), r.get("seconds", 0),
                                    r.get("model", ""), r.get("error", "")])
        return p


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", type=Path, default=ROOT / "dataset")
    ap.add_argument("--out", type=Path, default=ROOT / "out")
    ap.add_argument("--engine", default="meshy-7")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()

    load_env()
    Handler.dataset_dir = a.dataset
    Handler.out_dir = a.out
    Handler.store = Store(a.out / "studio.json")
    Handler.engine_name = a.engine

    print("BetaReal Scan Studio")
    print(f"  dataset : {a.dataset}")
    print(f"  engine  : {a.engine}")
    print(f"  open    : http://localhost:{a.port}")
    print("\n  Ctrl+C to stop.")
    try:
        ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
