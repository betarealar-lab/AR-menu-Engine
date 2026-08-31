#!/usr/bin/env python3
"""Pull a dish's files out of R2 and compare them, for inspection in a real 3D tool.

    python pull.py "chicken-balls-in-shqmeruli-sauce" raw-full
    python pull.py "some dish" default --out "C:\\Users\\temot\\Desktop\\check"

Downloads the master and everything that ships, then reports what should be identical
between them. The GLB and the USDZ are built from the same optimised file, so any
disagreement in triangle count, bounding box or texture count is a bug in the converter -
and those are exactly the things a person looking at a render will not notice.

What it cannot check is the half that matters to a diner: whether the textures are mapped
the right way round, whether the normals make the sauce look wet or plastic, whether the
thing is recognisably the dish. That needs eyes, which is why this puts the files
somewhere convenient rather than just printing numbers.

Costs nothing and changes nothing - it only reads.
"""
from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

import dataset
import glb
import storage
from config import load_env

try:
    from pxr import Usd, UsdGeom, UsdShade
    HAVE_USD = True
except ImportError:
    HAVE_USD = False


def describe_glb(path: Path) -> dict:
    b = glb.bounds(path)
    return {
        "file": path.name,
        "mb": round(path.stat().st_size / 1048576, 2),
        "triangles": glb.count_triangles(path),
        "megapixels": glb.megapixels(path),
        "textures": [(t.get("size"), t.get("format")) for t in glb.summarize(path)],
        "size_cm": [round((b["max"][i] - b["min"][i]) * 100, 1) for i in range(3)] if b else [],
        "floor_y": round(b["min"][1], 4) if b else None,
    }


def describe_usdz(path: Path) -> dict:
    out = {"file": path.name, "mb": round(path.stat().st_size / 1048576, 2)}
    with zipfile.ZipFile(path) as z:
        out["contents"] = sorted(
            (i.filename, round(i.file_size / 1048576, 2)) for i in z.infolist())
    if not HAVE_USD:
        return out
    stage = Usd.Stage.Open(str(path))
    meshes = [p for p in stage.Traverse() if p.IsA(UsdGeom.Mesh)]
    tris = 0
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    bound = 0
    for m in meshes:
        g = UsdGeom.Mesh(m)
        idx = g.GetFaceVertexIndicesAttr().Get() or []
        tris += len(idx) // 3
        pts = g.GetPointsAttr().Get() or []
        ext = g.ComputeExtent(pts)
        if ext:
            for a in range(3):
                lo[a] = min(lo[a], ext[0][a])
                hi[a] = max(hi[a], ext[1][a])
        mat, _ = UsdShade.MaterialBindingAPI(m).ComputeBoundMaterial()
        bound += 1 if mat else 0
        out.setdefault("subdivision", str(g.GetSubdivisionSchemeAttr().Get()))
        out.setdefault("has_st", bool(UsdGeom.PrimvarsAPI(m).GetPrimvar("st")))
    out.update({
        "triangles": tris,
        "meshes": len(meshes),
        "materials_bound": bound,
        "up_axis": str(UsdGeom.GetStageUpAxis(stage)),
        "metres_per_unit": UsdGeom.GetStageMetersPerUnit(stage),
        "size_cm": [round((hi[i] - lo[i]) * 100, 1) for i in range(3)] if hi[0] > -1e30 else [],
        "floor_y": round(lo[1], 4) if hi[0] > -1e30 else None,
    })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dish")
    ap.add_argument("variant", nargs="?", default="default")
    ap.add_argument("--out", type=Path,
                    default=Path.home() / "Desktop" / "BetaReal-inspect")
    ap.add_argument("--master", action="store_true",
                    help="also pull the raw master (large, and not what ships)")
    a = ap.parse_args()

    load_env()
    rec = dataset.record(a.dish, a.variant)
    if not rec.get("model_key"):
        print(f"No model for {a.dish} / {a.variant}")
        return 1

    folder = a.out / f"{dataset.slug(a.dish)}--{dataset.slug(a.variant)}"
    folder.mkdir(parents=True, exist_ok=True)
    b = storage.backend()

    wanted = dict(rec.get("catalog_keys") or {})
    if a.master:
        wanted["MASTER"] = rec["model_key"]
    if not wanted:
        print("Nothing catalogued yet - run worker.py first.")
        return 1

    print(f"Pulling into {folder}\n")
    pulled: dict[str, Path] = {}
    for kind, key in wanted.items():
        dst = folder / Path(key).name
        if b.download("models", key, dst):
            pulled[kind] = dst
            print(f"  {kind:7} {dst.name:22} {dst.stat().st_size / 1048576:7.2f} MB")
        else:
            print(f"  {kind:7} MISSING in storage: {key}")

    print("\n--- what should match between the GLB and the USDZ ---")
    rows = []
    for kind, path in pulled.items():
        if path.suffix.lower() == ".glb":
            rows.append((kind, describe_glb(path)))
        elif path.suffix.lower() == ".usdz":
            rows.append((kind, describe_usdz(path)))

    for kind, info in rows:
        print(f"\n  [{kind}] {info['file']}  {info['mb']} MB")
        for field in ("triangles", "size_cm", "floor_y", "megapixels", "textures",
                      "meshes", "materials_bound", "up_axis", "metres_per_unit",
                      "subdivision", "has_st"):
            if field in info:
                print(f"      {field:16} {info[field]}")
        if "contents" in info:
            for name, mb in info["contents"]:
                print(f"      inside          {name}  {mb} MB")

    glbs = [i for k, i in rows if "triangles" in i and i["file"].endswith(".glb")]
    usdzs = [i for k, i in rows if i["file"].endswith(".usdz") and "triangles" in i]
    if glbs and usdzs:
        g, u = glbs[0], usdzs[0]
        print("\n--- verdict ---")
        same_tris = g["triangles"] == u["triangles"]
        same_size = all(abs(x - y) < 0.2 for x, y in zip(g["size_cm"], u["size_cm"]))
        # `x or 1` looked like a None guard and was a bug: 0.0 is falsy, so a model
        # sitting exactly on the floor - the correct answer - became 1 and failed.
        def seated(v):
            return v is not None and abs(v) < 1e-3
        both_seated = seated(g["floor_y"]) and seated(u["floor_y"])
        print(f"  triangles match     {same_tris}   ({g['triangles']:,} vs {u['triangles']:,})")
        print(f"  real size matches   {same_size}   ({g['size_cm']} vs {u['size_cm']} cm)")
        print(f"  both sit on y=0     {both_seated}")
        if same_tris and same_size and both_seated:
            print("\n  The measurable half agrees. What is left needs eyes: textures the")
            print("  right way up, normals not plastic, and whether it looks like the dish.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
