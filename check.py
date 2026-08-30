#!/usr/bin/env python3
"""Every path in the Scan Studio, exercised against a throwaway local store.

    python check.py --master path/to/a/meshy-master.glb

Run it before pushing anything that touches the pipeline. It starts a real server on a
spare port, drives it over HTTP exactly as the browser does, and checks the artefacts
rather than the intentions: that all three files are produced, that the GLB and the USDZ
carry the same triangle count and the same real-world size, that a wedged record can be
restarted, that a container too small for a job refuses it instead of being killed by it.

**It never touches R2.** The app is copied to a temp directory without `.env`, so the run
cannot reach production storage no matter what is configured. The directory is deleted
afterwards.

Without `--master` the geometry tests are skipped - there is nothing to optimise. Use any
Meshy master; a real one is the point, because every bug worth catching here came from a
real file being bigger than someone assumed.
"""
from __future__ import annotations

import base64
import datetime
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent
PORT = int(os.environ.get("CHECK_PORT", "8830"))
BASE = f"http://127.0.0.1:{PORT}"
RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok, detail: str = "") -> bool:
    RESULTS.append((name, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  -- {detail}" if detail else ""))
    return bool(ok)


def api(path: str, body=None, raw: bool = False):
    if "?" in path:
        head, _, query = path.partition("?")
        path = head + "?" + urllib.parse.urlencode(
            dict(pair.split("=", 1) for pair in query.split("&")))
    req = urllib.request.Request(
        BASE + path,
        json.dumps(body).encode() if body is not None else None,
        {"Content-Type": "application/json"} if body is not None else {})
    with urllib.request.urlopen(req, timeout=900) as r:
        data = r.read()
        return (r.status, data) if raw else json.loads(data)


def wait_for(dish: str, variant: str, limit: int = 600) -> dict:
    end = time.time() + limit
    while time.time() < end:
        d = api(f"/api/dish?dish={dish}&variant={variant}")
        if d["status"] in ("review", "failed"):
            return d
        time.sleep(2)
    return api(f"/api/dish?dish={dish}&variant={variant}")


def finish() -> int:
    print("\n" + "=" * 62)
    bad = [n for n, ok, _ in RESULTS if not ok]
    print(f"{len(RESULTS) - len(bad)}/{len(RESULTS)} passed")
    for n in bad:
        print(f"  FAILED: {n}")
    return 1 if bad else 0


def main() -> int:
    master = None
    if "--master" in sys.argv:
        master = Path(sys.argv[sys.argv.index("--master") + 1])
        if not master.is_file():
            print(f"--master {master} does not exist")
            return 2

    app = Path(tempfile.mkdtemp(prefix="studio-check-"))
    (app / "web").mkdir(parents=True, exist_ok=True)
    for f in ("studio.py", "glb.py", "optimize.py", "dataset.py", "storage.py",
              "config.py", "limits.py", "usdz.py"):
        shutil.copy(REPO / f, app / f)
    shutil.copy(REPO / "web" / "studio.html", app / "web" / "studio.html")
    shutil.copytree(REPO / "engines", app / "engines", dirs_exist_ok=True)

    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    for key in list(env):
        if key.startswith("R2_") or key == "STUDIO_USERS":
            env.pop(key)
    proc = subprocess.Popen(
        [sys.executable, "studio.py", "--port", str(PORT), "--out", "out"],
        cwd=str(app), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen(BASE + "/healthz", timeout=2).read()
                break
            except Exception:
                time.sleep(0.5)

        print("\n== health and metadata ==")
        _, raw = api("/healthz", raw=True)
        health = raw.decode()
        check("healthz answers without credentials", health.startswith("ok"), health)
        check("healthz reports storage", "storage=local" in health)
        check("healthz reports the optimiser", "optimizer=" in health)
        check("healthz reports the memory ceiling", "memory=" in health)
        meta = api("/api/meta")
        check("meta lists the four shapes", len(meta.get("shapes", [])) == 4)
        check("meta lists the three axes",
              meta.get("scale_axes") == ["width", "length", "height"])
        check("meta lists the fault tags", len(meta.get("faults", [])) >= 10)
        check("meta lists engines", any(e["name"] == "meshy-7" for e in meta.get("engines", [])))

        print("\n== the page ==")
        status, raw = api("/", raw=True)
        page = raw.decode("utf-8", "replace")
        check("page serves", status == 200 and len(page) > 20000, f"{len(page)} bytes")
        # These two are regressions that each took the whole UI down once.
        check("no parse-time binding on a templated button",
              "$('#export-model').onclick" not in page)
        check("[hidden] beats a class that sets display",
              "[hidden]{display:none !important}" in page)
        check("model-viewer is loaded", "model-viewer.min.js" in page)
        check("the viewer reports its own failures", "watchViewer" in page)

        if not master:
            print("\n(no --master given; skipping every geometry test)")
            return finish()

        print("\n== frames ==")
        sys.path.insert(0, str(app))
        os.chdir(app)
        import dataset

        dish, variant = "check dish", "ring-40"
        key = dataset.save_model(dish, variant, "meshy-7", "glb", master.read_bytes())
        rec = dataset.blank(dish, variant)
        rec.update(status="review", model_key=key, master_keys={"glb": key},
                   engine="meshy-7", seconds=175.1)
        dataset.write(rec)

        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (1200, 900), (90, 70, 50)).save(buf, "JPEG")
        uri = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        d = api("/api/upload", {"dish": dish, "variant": variant, "slot": 0,
                                "data": uri, "name": "front.jpg"})
        check("upload records a frame", d["filled"] == 1)
        status, blob = api(f"/frame?dish={dish}&variant={variant}&slot=0", raw=True)
        check("frame streams back as a JPEG",
              status == 200 and blob[:2] == b"\xff\xd8", f"{len(blob)} bytes")

        print("\n== input that should be refused ==")
        for label, body in (
            ("unknown dimension", {"axis": "diameter", "cm": 20}),
            ("a 9-metre dish", {"axis": "width", "cm": 900}),
        ):
            try:
                api("/api/scale", {"dish": dish, "variant": variant, **body})
                check(f"{label} rejected", False)
            except urllib.error.HTTPError as e:
                check(f"{label} rejected", e.code == 400, json.loads(e.read())["error"])
        try:
            api("/api/optimize", {"dish": "nothing here", "variant": "default"})
            check("optimise with no master rejected", False)
        except urllib.error.HTTPError as e:
            check("optimise with no master rejected", e.code == 400,
                  json.loads(e.read())["error"])

        print("\n== the optimiser, at a real size ==")
        started = time.time()
        api("/api/scale", {"dish": dish, "variant": variant, "shape": "flat-plated",
                           "axis": "width", "cm": 26})
        d = wait_for(dish, variant)
        seconds = time.time() - started
        st = d["export_stats"]
        check("lands on review", d["status"] == "review", d.get("export_error", ""))
        check("no export error", not d["export_error"], d["export_error"])
        check("all three files catalogued",
              sorted(d["catalog_keys"]) == ["draco", "opt", "usdz"],
              str(sorted(d["catalog_keys"])))
        check("draco is under 4 MB", st["draco_bytes"] < 4_000_000,
              f"{st['draco_bytes'] / 1048576:.2f} MB")
        check("usdz is under 10 MB", st.get("usdz_bytes", 0) < 10_000_000,
              f"{st.get('usdz_bytes', 0) / 1048576:.2f} MB")
        # A texture at the target resolution can still be a 7.9 MB lossless PNG. The
        # byte budget is what stops one shipping.
        check("no single texture ships over the byte budget",
              st.get("texture_bytes_after", 0) < 8_000_000,
              f"{st.get('texture_bytes_after', 0) / 1048576:.2f} MB total")
        check("usdz built without error", not st.get("usdz_error"), st.get("usdz_error", ""))
        # The bug this exists to catch: iOS shipping a different model from everyone else.
        check("glb and usdz agree on triangles",
              st["result_triangles"] == st.get("usdz_triangles"),
              f"{st['result_triangles']} vs {st.get('usdz_triangles')}")
        glb_w = round(max(st["size_after"][0], st["size_after"][2]) * 100, 1)
        usdz_w = round(max(st["usdz_size_m"][0], st["usdz_size_m"][2]) * 100, 1)
        check("glb is exactly the requested width", abs(glb_w - 26.0) < 0.05, f"{glb_w} cm")
        check("usdz is exactly the requested width", abs(usdz_w - 26.0) < 0.05, f"{usdz_w} cm")
        check("it sits on the table", abs(st["size_after"][1]) > 0)
        check("progress fields cleared when done",
              d["stage"] == "" and d["optimising_since"] == "")
        check("finishes well inside a request", seconds < 120, f"{seconds:.1f}s")

        print("\n== what the browser is handed ==")
        for stage, floor, ceiling in (("ship", 1_000_000, 8_000_000),
                                      ("master", 20_000_000, 200_000_000)):
            status, blob = api(f"/model?dish={dish}&variant={variant}&stage={stage}", raw=True)
            check(f"/model?stage={stage} streams a GLB from our own origin",
                  status == 200 and blob[:4] == b"glTF" and floor < len(blob) < ceiling,
                  f"{len(blob) / 1048576:.2f} MB")

        print("\n== recovery from a killed worker ==")
        rec = dataset.record(dish, variant)
        stale = (datetime.datetime.now(datetime.timezone.utc)
                 - datetime.timedelta(minutes=25)).isoformat(timespec="seconds")
        rec.update(status="optimising", stage="geometry", optimising_since=stale,
                   catalog_keys={}, export_stats={})
        dataset.write(rec)
        check("a wedged record reads as optimising",
              api(f"/api/dish?dish={dish}&variant={variant}")["status"] == "optimising")
        api("/api/optimize", {"dish": dish, "variant": variant})
        d = wait_for(dish, variant)
        check("the ghost is restarted and completes",
              d["status"] == "review" and bool(d["catalog_keys"]))

        print("\n== the memory guard ==")
        import limits
        os.environ["MEMORY_LIMIT_MB"] = "512"
        message = limits.check_optimise(1_902_278, 37.7)
        check("a 512 MB box refuses a raw 1.9M-triangle master", bool(message))
        check("the refusal names what it needs and what it has",
              "512 MB" in message and " MB and this container" in message, message[:70])
        check("and names the fix", "meshy-7-lean" in message)
        # The whole point of the lean preset: the same box does the same dish.
        check("the same box accepts a real lean master",
              not limits.check_optimise(156_397, 12.6))
        # Every measurement taken so far must come in UNDER the estimate, or the guard
        # will one day wave through a job that kills the container.
        for tris, mpx, measured in ((40_272, 12.6, 212.8), (150_272, 12.6, 192.7),
                                    (156_397, 12.6, 314.8), (300_538, 37.7, 440.2),
                                    (1_902_278, 37.7, 648.5)):
            check(f"estimate covers the {tris:,}-triangle measurement",
                  limits.estimate_optimise_mb(tris, mpx) >= measured,
                  f"{limits.estimate_optimise_mb(tris, mpx):.0f} vs {measured}")
        os.environ["MEMORY_LIMIT_MB"] = "2048"
        check("a 2 GB box accepts either", not limits.check_optimise(1_902_278, 37.7))
        os.environ.pop("MEMORY_LIMIT_MB", None)

        print("\n== renaming ==")
        api("/api/rename", {"dish": dish, "title": "Chicken Shqmeruli"})
        d = api(f"/api/dish?dish={dish}&variant={variant}")
        check("title is stored", d.get("title") == "Chicken Shqmeruli", d.get("title", ""))
        listed = next((r for r in api("/api/dishes")["dishes"]
                       if r["dish"] == dataset.slug(dish)), None)
        check("the dish list shows the new name",
              bool(listed and listed.get("title") == "Chicken Shqmeruli"))
        shelf = next((r for r in api("/api/library")["items"] if r["dish"] == dish), None)
        check("the library shows the new name",
              bool(shelf and shelf.get("title") == "Chicken Shqmeruli"))
        # A rename must not move storage, or every URL a live menu points at would rot.
        code, blob = api(f"/model?dish={dish}&variant={variant}&stage=ship", raw=True)
        check("renaming does not move the stored model",
              code == 200 and blob[:4] == b"glTF")
        api("/api/rename", {"dish": dish, "title": ""})
        check("a name can be cleared again",
              api(f"/api/dish?dish={dish}&variant={variant}").get("title") == "")

        print("\n== the record ==")
        status, csv = api("/api/export", raw=True)
        header = csv.decode().splitlines()[0]
        check("csv carries the size and the payload",
              status == 200 and "scale_cm" in header and "draco_bytes" in header)
        row = next((r for r in api("/api/library")["items"] if r["dish"] == dish), None)
        check("library marks it shipping", bool(row and row["shipping"]))
        check("library shows the size", bool(row and row["scale"].get("cm") == 26))
    finally:
        proc.terminate()
        os.chdir(REPO)
        shutil.rmtree(app, ignore_errors=True)

    return finish()


if __name__ == "__main__":
    raise SystemExit(main())
