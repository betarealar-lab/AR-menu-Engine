"""Cut the dish out of its photograph before the engine ever sees the rest of the room.

**Why this is ours and not a flag we send.** Temo, after his first real generation:

    "even the table/turntable showed up with this generation. just auto object masking
     option seems good."

Meshy's website has a background remover. Its API does not: the create-task body for
`multi-image-to-3d` has `image_enhancement`, `remove_lighting`, texture and remesh
options, and nothing for masking, segmentation or background removal. Their own guidance
is to prepare clean images first. So there was no switch to turn on - the choice was to do
it here or not at all, and "not at all" costs 30 credits every time a slate board or a
turntable ends up welded to the dish.

Doing it on our side is better than the flag would have been, for the reason the whole
`engines/` split exists: the engine is going to be replaced - a second one, a self-hosted
one, a re-run of every dish through something better next year - and a masked photo is a
better input to all of them. This does not move when the engine does.

**OFF by default, and that is a correction.** It shipped on, and Temo looked at the result:

    "i want plates to remain but for turn tables to be removed. u get me that board is
     good."

He is right and this cannot do that. rembg finds THE salient object; it has no notion of
"the plate is part of the dish but the thing the plate is standing on is not". On his
sushi it removed the slate board along with the turntable in three frames out of four,
and in the fourth it kept both - the object box ran to the very bottom edge of the frame,
pedestal included. Neither answer is the one he asked for, and the two are not even the
same answer.

So it is opt-in now: `BETAREAL_MASK=1`, or `mask=True` passed in. Left on, it would be
quietly making every dish worse for the case he actually has.

**The two things that DO get a turntable out of a model, in order of how well they work:**

  1. Do not photograph it. Shoot from slightly above so the pedestal is behind the plate
     rather than under it, or stand the dish on the table itself. This is free, it works
     every time, and it is already what `docs/` says about capture.
  2. Look at the cut before spending 30 credits. The Studio can show these four PNGs
     beside the originals and let an owner accept or skip per dish. That is the real fix
     and it is a screen, not an algorithm.

**It never fails a generation.** A photo it cannot cut is passed through untouched. A
worse input is a worse model; an exception here would be a lost job and lost credits.

    from engines import mask
    cut = mask.cutout(paths)   # -> new paths; a no-op unless BETAREAL_MASK is set
"""
from __future__ import annotations

import os
from pathlib import Path

# The alpha below which a pixel is background. Not 0: the matte is soft at the edges, and
# a hard cut there leaves a halo of table-coloured pixels around the dish that the engine
# then reconstructs as geometry.
ALPHA_FLOOR = 12

# If less than this much of the frame survives, the cut is not believable - a matte that
# keeps 2% of the picture has usually found a highlight rather than the dish. Below it the
# original is used, because a photograph of a dish on a table beats a photograph of
# nothing.
MIN_KEPT = 0.02

# And above this, nothing was really removed, so there is no point paying for the PNG:
# a cut that keeps 99% of the frame found no background to take away.
MAX_KEPT = 0.99

# How far the kept-fraction may vary across one dish's photos before the set is called
# inconsistent. From the first real case: 20/21/35/20 per cent, where the 35 was a slate
# board that three other angles had dropped.
SPREAD_WARN = 0.12


def available() -> bool:
    """Can this machine cut at all? `rembg` pulls a ~170 MB ONNX model on first use."""
    try:
        import rembg  # noqa: F401
        return True
    except Exception:
        return False


def cutout(paths: list[Path], out_dir: Path | None = None,
           verbose: bool = True) -> list[Path]:
    """Background removed, as PNGs beside the originals. Originals are never modified.

    Returns a list the same length and order as `paths` - a photo that could not be cut
    is returned as itself, so a caller can always zip the two together.
    """
    # Opt-in. See the header: on by default it removed serving boards that belong to the
    # dish, which is worse than leaving the background alone.
    if not os.environ.get("BETAREAL_MASK"):
        return paths
    if not available():
        if verbose:
            print("    masking skipped: rembg is not installed")
        return paths

    from rembg import remove
    from PIL import Image

    out: list[Path] = []
    kept_all: list[float] = []
    for p in paths:
        try:
            dest = (out_dir or p.parent) / f"{p.stem}-cut.png"
            cut = remove(p.read_bytes())
            dest.write_bytes(cut)

            # How much of the frame survived. The check is on the RESULT rather than on
            # rembg's confidence, because a matte can be returned happily and still be
            # wrong, and the only thing that matters is whether what is left looks like a
            # dish rather than a speck or the whole room.
            with Image.open(dest) as im:
                if im.mode != "RGBA":
                    raise ValueError(f"expected RGBA, got {im.mode}")
                alpha = im.getchannel("A")
                total = im.width * im.height
                kept = sum(alpha.histogram()[ALPHA_FLOOR:]) / total

            if not (MIN_KEPT <= kept <= MAX_KEPT):
                dest.unlink(missing_ok=True)
                if verbose:
                    print(f"    {p.name}: kept {kept:.0%} - not a believable cut, "
                          f"sending the original")
                out.append(p)
                continue

            if verbose:
                print(f"    {p.name}: background removed, {kept:.0%} of the frame is dish")
            kept_all.append(kept)
            out.append(dest)
        except Exception as e:  # noqa: BLE001
            # Never fatal. A photo that will not cut is a photo we send as it is - a worse
            # model is recoverable, a job that died before it started is 30 credits and a
            # person waiting.
            if verbose:
                print(f"    {p.name}: could not mask ({type(e).__name__}), "
                      f"sending the original")
            out.append(p)

    # ── do the four views agree about what the dish IS? ───────────────────────────────
    #
    # This is the failure worth catching, and it is not "the cut was bad" - it is "the
    # cuts disagree". On the first real dish three angles dropped the slate board and one
    # kept it, so the engine was being handed four photographs that do not describe the
    # same object and asked to reconcile them. That is a worse input than four consistent
    # photographs WITH the board in every one.
    #
    # There is no reliable way to force an off-the-shelf matting model to make the same
    # call from four angles, so this does not pretend to fix it. It measures it and says
    # so, before the credits are spent, in the log a person reads when a model comes out
    # wrong. `SPREAD_WARN` is set from the one real case: 20/21/35/20 per cent.
    if verbose and len(kept_all) >= 2:
        spread = max(kept_all) - min(kept_all)
        if spread >= SPREAD_WARN:
            worst = 1 + kept_all.index(max(kept_all))
            print(f"    NOTE: the cuts disagree - {' '.join(f'{k:.0%}' for k in kept_all)}"
                  f" of each frame kept. Photo {worst} kept much more than the rest, which"
                  f" usually means a serving board or a stand was read as part of the dish."
                  f" The model may come out with it attached.")
    return out
