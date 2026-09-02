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
        # Spending 30 credits to discover the optimiser cannot open the result is the
        # worst order to learn it in, so the picker must carry the warning itself.
        check("engines declare what they will return",
              all("expect_triangles" in e for e in meta.get("engines", [])))
        check("engines say whether this host can finish the job",
              all("cannot_optimise" in e for e in meta.get("engines", [])))

        print("\n== the page ==")
        status, raw = api("/", raw=True)
        page = raw.decode("utf-8", "replace")
        check("page serves", status == 200 and len(page) > 20000, f"{len(page)} bytes")
        # This has now taken the whole UI down twice - once for #export-model, once for
        # #multiview - so it is checked generally rather than by name. Anything inside
        # <template id="tpl-bench"> does not exist when the script is parsed, so binding
        # to it directly sets a property on null, throws, and kills every line after it
        # including boot(). Those controls must go through the delegated click listener.
        import re as _re
        _tpl = page[page.index('<template id="tpl-bench">'):page.index("</template>")]
        _tpl_ids = set(_re.findall(r'id="([\w-]+)"', _tpl))
        _script = page[page.index("<script>"):]
        _bound = [m for m in _re.findall(r"\$\('#([\w-]+)'\)\s*\.on\w+", _script)
                  if m in _tpl_ids]
        check("nothing inside the template is bound at parse time", not _bound, str(_bound))
        check("[hidden] beats a class that sets display",
              "[hidden]{display:none !important}" in page)
        check("model-viewer is loaded", "model-viewer.min.js" in page)
        check("the viewer reports its own failures", "watchViewer" in page)
        # A 70 MB master must never be handed to a browser just because a tab was clicked.
        check("a heavy master is not auto-previewed", "MASTER_AUTOLOAD_BYTES" in page)
        check("the picker warns before the credits are spent",
              "paintEngineWarning" in page)
        # Measured at 390x780 before this existed: the header wrapped to five rows and
        # took 29% of the screen. These are the three pieces that stop it recurring.
        check("phones get a bottom tab bar", 'id="tabbar"' in page)
        check("the header is one scrolling row on phones",
              "header{flex-wrap:nowrap;overflow-x:auto" in page)
        check("the viewport meta is present and covers the notch",
              'name="viewport"' in page and "viewport-fit=cover" in page)
        check("touch gets 44px targets", "min-height:44px" in page)
        # The desktop layout is an app shell: body clipped, each pane scrolling inside
        # its own box. On a phone that leaves nowhere to scroll and the content below
        # the fold is unreachable, which is exactly what happened.
        check("the page itself scrolls on phones",
              "html,body{height:auto;overflow:visible}" in page)
        check("and the header stays put while it does",
              "header{position:sticky;top:0" in page)
        check("the shipping files row is named in plain words",
              "Shipping files" in page and ">Catalogue<" not in page)

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

        print("\n== not destroying a good model by accident ==")
        try:
            api("/api/generate", {"dish": dish, "variant": variant, "engine": "meshy-7"})
            check("generating over an existing model is refused", False)
        except urllib.error.HTTPError as e:
            body = json.loads(e.read())
            check("generating over an existing model is refused", e.code == 409,
                  body.get("error", "")[:60])
            check("and says the current model would be lost",
                  "REPLACES" in body.get("error", "") and body.get("needs_replace") is True)
        check("Run engine is disabled once a model exists", "hasModel" in page)
        check("Regenerate exists as the deliberate path", 'id="regen"' in page)

        print("\n== creating a dish, and the optimiser settings ==")
        made = api("/api/new-dish", {"dish": "brand new dish", "variant": "default"})
        check("a new dish is created server-side", made.get("dish") == "brand new dish")
        # It has to EXIST, or the rail goes on showing the previous selection - which
        # is exactly what "New dish does nothing" looked like.
        listed = [r["dish"] for r in api("/api/dishes")["dishes"]]
        check("and appears in the dish list", dataset.slug("brand new dish") in listed,
              str(listed))
        try:
            api("/api/new-dish", {"dish": dish, "variant": variant})
            check("it refuses to overwrite an existing dish", False)
        except urllib.error.HTTPError as e:
            check("it refuses to overwrite an existing dish", e.code == 409)

        check("meta offers triangle targets", len(meta.get("triangle_targets", [])) >= 3)
        # 4096 is temporarily available for comparison on real dishes. 8192 is not, and
        # must not become available by accident: a 8192px map is ~256 MB of video memory
        # on a phone, against 64 MB at 4096 and 16 MB at 2048.
        check("8k is never a shipped texture size",
              8192 not in meta.get("texture_targets", []),
              str(meta.get("texture_targets")))
        check("Auto is offered as a triangle target",
              0 in meta.get("triangle_targets", []),
              str(meta.get("triangle_targets")))
        out = api("/api/settings", {"dish": dish, "variant": variant,
                                    "triangles": 20000, "texture": 1024})
        check("settings are stored", out["optimise"] == {"triangles": 20000, "texture": 1024},
              str(out.get("optimise")))
        d2 = wait_for(dish, variant)
        st2 = d2["export_stats"]
        check("and applied to the shipped file",
              st2.get("target_triangles") == 20000 and st2.get("target_texture") == 1024,
              f"{st2.get('target_triangles')} tris / {st2.get('target_texture')}px")
        check("a smaller target makes a smaller file", st2["draco_bytes"] < 3_000_000,
              f"{st2['draco_bytes'] / 1048576:.2f} MB")
        try:
            api("/api/settings", {"dish": dish, "variant": variant, "texture": 8192})
            check("an 8k shipped texture is refused", False)
        except urllib.error.HTTPError as e:
            check("an 8k shipped texture is refused", e.code == 400,
                  json.loads(e.read())["error"])
        # Auto lets meshoptimizer cut until the surface suffers rather than hitting a
        # number somebody guessed. On the real master it lands near 15,600 triangles -
        # far fewer than the 40,000 default, for a marginally SMALLER file, because
        # textures dominate the payload and geometry barely moves it.
        api("/api/settings", {"dish": dish, "variant": variant,
                              "triangles": -1, "texture": 2048})
        d3 = wait_for(dish, variant)
        st3 = d3["export_stats"]
        check("auto is recorded as auto", st3.get("auto_triangles") is True)
        check("auto cuts further than the 40k default",
              0 < st3.get("result_triangles", 0) < 40_000,
              f"{st3.get('result_triangles'):,} triangles")
        api("/api/settings", {"dish": dish, "variant": variant,
                              "triangles": 40000, "texture": 2048})
        wait_for(dish, variant)

        print("\n== photos have their own shelf ==")
        shelf = api("/api/photos")["items"]
        row = next((r for r in shelf if r["dish"] == dish), None)
        check("the photo shelf lists the dish", bool(row))
        check("it counts photographed frames", bool(row and row["real"] == 1),
              str(row and row["real"]))
        check("and none are predicted yet", bool(row and row["predicted"] == 0))
        check("each frame says whether it was generated",
              bool(row and row["shots"] and "generated" in row["shots"][0]))
        check("the page has a Photos view", 'id="view-photos"' in page)
        check("predicted frames are marked on the bench", "cell.predicted" in page)
        check("multi-view is offered under the plate", 'id="multiview"' in page)

        # It must never overwrite a real photograph with a guess. With two frames
        # loaded there is nothing to predict and the call has to refuse - which is also
        # how this test avoids spending credits.
        buf2 = io.BytesIO()
        Image.new("RGB", (900, 900), (30, 60, 90)).save(buf2, "JPEG")
        api("/api/upload", {"dish": dish, "variant": variant, "slot": 1,
                            "data": "data:image/jpeg;base64,"
                                    + base64.b64encode(buf2.getvalue()).decode(),
                            "name": "right.jpg"})
        try:
            api("/api/multiview", {"dish": dish, "variant": variant})
            check("multi-view refuses when real photos already exist", False)
        except urllib.error.HTTPError as e:
            check("multi-view refuses when real photos already exist", e.code == 400,
                  json.loads(e.read())["error"])
        api("/api/clear-frame", {"dish": dish, "variant": variant, "slot": 1})

        print("\n== archiving ==")
        out = api("/api/archive", {"dish": dish, "variant": variant, "archived": True})
        check("a dish can be archived", out.get("archived") is True)
        shelf = api("/api/library")["items"]
        row = next((r for r in shelf if r["dish"] == dish), None)
        check("the library reports it archived", bool(row and row["archived"]))
        # The card was a <button> containing two more <button>s - invalid HTML, which
        # browsers unnest, which is why the actions took a whole row of every card.
        check("library cards are not nested buttons",
              '<button class="card' not in page and '<div class="card' in page)
        check("card actions float over the thumbnail", ".cardacts{position:absolute" in page)
        # Archiving hides; it must never destroy. The files have to survive it.
        code, blob = api(f"/model?dish={dish}&variant={variant}&stage=ship", raw=True)
        check("archiving keeps the files", code == 200 and blob[:4] == b"glTF")
        api("/api/archive", {"dish": dish, "variant": variant, "archived": False})
        check("and it can be brought back",
              api(f"/api/dish?dish={dish}&variant={variant}").get("archived") is False)

        print("\n== cancelling ==")
        try:
            api("/api/cancel", {"dish": dish, "variant": variant})
            check("cancelling an idle dish is refused", False)
        except urllib.error.HTTPError as e:
            check("cancelling an idle dish is refused", e.code == 400,
                  json.loads(e.read())["error"])
        rec = dataset.record(dish, variant)
        was = dict(rec)
        rec.update(status="running", task_id="pretend-task", stage="generating 50%",
                   submitted_utc=dataset._now())
        dataset.write(rec)
        out = api("/api/cancel", {"dish": dish, "variant": variant})
        check("a running dish can be cancelled", out["status"] == "cancelled", out["status"])
        check("it warns that credits may already be spent",
              "credits" in (out.get("error") or ""), out.get("error", ""))
        check("progress fields are cleared", not out["stage"] and not out["optimising_since"])
        dataset.write(was)
        check("the confirm names the cost before spending",
              "This spends ${cost} credits" in page or "spends ${cost} credits" in page)

        print("\n== downloading the files ==")
        code, zipped = api(f"/download?dish={dish}&variant={variant}", raw=True)
        check("download returns a zip", code == 200 and zipped[:2] == b"PK",
              f"{len(zipped) / 1048576:.2f} MB")
        import zipfile as _zip, io as _io
        with _zip.ZipFile(_io.BytesIO(zipped)) as z:
            names = [n.split("/")[-1] for n in z.namelist()]
        check("it holds all three shipping files",
              {"model_opt.glb", "model_draco.glb", "model.usdz"} <= set(names), str(names))
        check("and a readme explaining which is which", "README.txt" in names)
        check("the master is not included by default", "model.glb" not in names)
        code, withm = api(f"/download?dish={dish}&variant={variant}&master=1", raw=True)
        with _zip.ZipFile(_io.BytesIO(withm)) as z:
            names2 = [n.split("/")[-1] for n in z.namelist()]
        check("asking for the master includes it", "model.glb" in names2,
              f"{len(withm) / 1048576:.2f} MB")

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
        # The button read a JSON field the endpoint never returned, so Export silently
        # did nothing for weeks. It is CSV, and it must arrive as a downloadable file.
        check("export is not JSON", not csv.lstrip().startswith(b"{"))
        check("export has a row for the dish", dish.encode() in csv or
              dataset.slug(dish).encode() in csv)
        check("the button downloads rather than parsing JSON",
              "a.download" in page and "(await api('/api/export')).csv" not in page)
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
