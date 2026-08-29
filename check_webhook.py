"""The webhook path, end to end, with a stub engine. Spends no credits.

    python check_webhook.py --master path/to/a/meshy-master.glb

Proves the six things that matter about handing work to an engine and being called
back: submit returns immediately, the ticket is recorded and indexed before anything
else can happen, a forged callback is refused, a real one completes the dish, a
DUPLICATE one changes nothing, and a callback that never arrives is recovered anyway.

The last two are the ones worth having a test for. Queues deliver at least once, so a
job must survive being run twice; and a webhook is someone else's network, so the
system cannot depend on one arriving.

Like check.py it runs on a temp copy with no .env, so it cannot reach production.
"""
import base64, io, json, os, shutil, subprocess, sys, tempfile, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent
MASTER = (Path(sys.argv[sys.argv.index("--master") + 1])
          if "--master" in sys.argv else None)
PORT = 8840
BASE = f"http://127.0.0.1:{PORT}"
SECRET = "test-secret-abc123"
RESULTS = []

STUB = '''
# --- SCRATCH ONLY --------------------------------------------------
import shutil as _sh, time as _t
from pathlib import Path as _P
from .base import Engine as _E, Result as _R

_STATE = {"submitted_at": None, "delay": 0.0}

class _Stub(_E):
    name, variant, cost_per_job = "stub", "stub", 0

    def start(self, job):
        _STATE["submitted_at"] = _t.time()
        r = _R(engine="stub", variant="stub", dish=job.dish, ok=False)
        r.task_id = "stub-task-0001"
        return r

    def collect(self, task_id, dish, out_dir):
        r = _R(engine="stub", variant="stub", dish=dish, ok=False)
        r.task_id = task_id
        started = _STATE["submitted_at"] or 0
        if _t.time() - started < _STATE["delay"]:
            r.pending = True
            r.progress = 42
            return r
        out_dir.mkdir(parents=True, exist_ok=True)
        dst = out_dir / (dish + ".glb")
        _sh.copyfile(r"MASTER_PATH", dst)
        r.files = {"glb": dst}
        r.seconds = 175.1
        r.ok = True
        return r

REGISTRY["stub"] = lambda: _Stub()
'''


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok)))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  -- {detail}" if detail else ""))


def api(path, body=None, raw=False, expect=None):
    if "?" in path:
        head, _, q = path.partition("?")
        path = head + "?" + urllib.parse.urlencode(dict(x.split("=", 1) for x in q.split("&")))
    req = urllib.request.Request(
        BASE + path, json.dumps(body).encode() if body is not None else None,
        {"Content-Type": "application/json"} if body is not None else {})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            data = r.read()
            return (r.status, data) if raw else json.loads(data)
    except urllib.error.HTTPError as e:
        if expect is not None:
            return (e.code, e.read()) if raw else {"_status": e.code}
        raise


def hook(secret, task_id):
    req = urllib.request.Request(f"{BASE}/hook/{secret}",
                                 json.dumps({"id": task_id}).encode(),
                                 {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def wait_status(dish, variant, want, limit=180):
    end = time.time() + limit
    while time.time() < end:
        d = api(f"/api/dish?dish={dish}&variant={variant}")
        if d["status"] in want:
            return d
        time.sleep(1)
    return api(f"/api/dish?dish={dish}&variant={variant}")


def main():
    if not MASTER or not MASTER.is_file():
        print("usage: python check_webhook.py --master <a-meshy-master.glb>")
        return 2
    app = Path(tempfile.mkdtemp(prefix="hooktest-"))
    (app / "web").mkdir(parents=True, exist_ok=True)
    for f in ("studio.py", "glb.py", "optimize.py", "dataset.py", "storage.py",
              "config.py", "limits.py", "usdz.py"):
        shutil.copy(REPO / f, app / f)
    shutil.copy(REPO / "web" / "studio.html", app / "web" / "studio.html")
    shutil.copytree(REPO / "engines", app / "engines", dirs_exist_ok=True)
    init = app / "engines" / "__init__.py"
    init.write_text(init.read_text(encoding="utf-8")
                    + STUB.replace("MASTER_PATH", str(MASTER).replace("\\", "\\\\")),
                    encoding="utf-8")

    env = dict(os.environ, PYTHONIOENCODING="utf-8", MESHY_WEBHOOK_SECRET=SECRET)
    for k in list(env):
        if k.startswith("R2_") or k == "STUDIO_USERS":
            env.pop(k)
    proc = subprocess.Popen([sys.executable, "studio.py", "--port", str(PORT),
                             "--engine", "stub", "--out", "out"],
                            cwd=str(app), env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen(BASE + "/healthz", timeout=2).read()
                break
            except Exception:
                time.sleep(0.5)

        dish, variant = "hook dish", "default"
        buf = io.BytesIO()
        from PIL import Image
        Image.new("RGB", (900, 700), (40, 80, 60)).save(buf, "JPEG")
        api("/api/upload", {"dish": dish, "variant": variant, "slot": 0,
                            "data": "data:image/jpeg;base64," +
                                    base64.b64encode(buf.getvalue()).decode(),
                            "name": "f.jpg"})

        print("\n== submit and let go ==")
        t = time.time()
        api("/api/generate", {"dish": dish, "variant": variant, "engine": "stub"})
        elapsed = time.time() - t
        d = api(f"/api/dish?dish={dish}&variant={variant}")
        check("generate returns immediately", elapsed < 5, f"{elapsed:.2f}s")
        check("status is running", d["status"] == "running", d["status"])
        check("the ticket is recorded", d["task_id"] == "stub-task-0001", d["task_id"])
        check("submitted time recorded", bool(d["submitted_utc"]))
        check("no model yet", not d["model_key"])

        print("\n== a forged callback ==")
        check("wrong secret is refused", hook("not-the-secret", "stub-task-0001") == 404)
        d = api(f"/api/dish?dish={dish}&variant={variant}")
        check("and changed nothing", d["status"] == "running" and not d["model_key"])

        print("\n== the real callback ==")
        code = hook(SECRET, "stub-task-0001")
        check("callback answered under 400", code == 200, str(code))
        d = wait_status(dish, variant, ("review", "failed"))
        st = d["export_stats"]
        check("dish completes", d["status"] == "review", d.get("error") or d.get("export_error"))
        check("master stored", bool(d["model_key"]))
        check("all three files built",
              sorted(d["catalog_keys"]) == ["draco", "opt", "usdz"], str(sorted(d["catalog_keys"])))
        check("usdz matches the glb",
              st.get("result_triangles") == st.get("usdz_triangles"))

        print("\n== a duplicate callback ==")
        before = dict(d["catalog_keys"])
        check("duplicate answered", hook(SECRET, "stub-task-0001") == 200)
        time.sleep(4)
        d2 = api(f"/api/dish?dish={dish}&variant={variant}")
        check("nothing regenerated", d2["catalog_keys"] == before and d2["status"] == "review")

        print("\n== a callback that never arrives ==")
        dish2 = "silent dish"
        api("/api/upload", {"dish": dish2, "variant": variant, "slot": 0,
                            "data": "data:image/jpeg;base64," +
                                    base64.b64encode(buf.getvalue()).decode(),
                            "name": "f.jpg"})
        api("/api/generate", {"dish": dish2, "variant": variant, "engine": "stub"})
        d = api(f"/api/dish?dish={dish2}&variant={variant}")
        check("submitted and waiting", d["status"] == "running")
        # Age the submission past the nudge threshold without waiting for real time.
        sys.path.insert(0, str(app))
        os.chdir(app)
        import dataset, datetime
        rec = dataset.record(dish2, variant)
        rec["submitted_utc"] = (datetime.datetime.now(datetime.timezone.utc)
                                - datetime.timedelta(minutes=5)).isoformat(timespec="seconds")
        dataset.write(rec)
        api(f"/api/dish?dish={dish2}&variant={variant}")        # this poll is the nudge
        d = wait_status(dish2, variant, ("review", "failed"))
        check("recovered without any callback", d["status"] == "review",
              d.get("error") or d.get("export_error"))
        check("and produced the files", sorted(d["catalog_keys"]) == ["draco", "opt", "usdz"])
    finally:
        proc.terminate()
        os.chdir(REPO)
        shutil.rmtree(app, ignore_errors=True)

    print("\n" + "=" * 56)
    bad = [n for n, ok in RESULTS if not ok]
    print(f"{len(RESULTS) - len(bad)}/{len(RESULTS)} passed")
    for n in bad:
        print("  FAILED:", n)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
