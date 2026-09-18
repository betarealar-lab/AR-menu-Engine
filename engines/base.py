"""The engine interface.

The point of this module is that nothing else in BetaReal ever names a vendor.
Meshy today, self-hosted Hunyuan tomorrow, our own hybrid pipeline after that —
swapping them is a change to one string, not a rewrite.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Job:
    """One dish, ready to generate."""

    dish: str
    images: list[Path]
    # images are in CAPTURE order. images[0] is the front view — meshy-7 treats
    # the first image as the primary view, so the capture guide has to preserve
    # this ordering all the way from the phone.


@dataclass
class Result:
    engine: str
    variant: str
    dish: str
    ok: bool
    task_id: str = ""
    seconds: float = 0.0
    credits: int = 0
    files: dict[str, Path] = field(default_factory=dict)
    error: str = ""
    # Still working - not a success and not a failure. Only `collect` sets this.
    pending: bool = False
    progress: int = 0
    # When the ENGINE deletes its copy. Meshy keeps API output for 3 days on Pro plans;
    # after that the task and every download URL are gone and the credits with them. Our
    # own storage is the only copy from then on, so this is a real deadline, not trivia.
    expires_utc: str = ""
    # The failure is about capacity or the network, not about this dish. Retrying the
    # same job later is expected to work; retrying a `retryable=False` failure just
    # spends credits reproducing the same bad result.
    retryable: bool = False


class Engine:
    """Base class. Subclass, set `name`, implement `generate`."""

    name = "engine"
    variant = "default"
    cost_per_job = 0  # credits; drives the spend estimate shown before any call

    # Roughly what this configuration returns, so a host can work out whether it will be
    # able to optimise the result BEFORE the credits are spent. Both are estimates - the
    # engine is generative and does not promise a triangle count - so they are used only
    # to warn, never to refuse.
    expect_triangles = 0
    expect_megapixels = 0.0

    @property
    def label(self) -> str:
        return f"{self.name}:{self.variant}"

    def generate(self, job: Job, out_dir: Path) -> Result:
        """Submit and wait. Simple, and the only option where nothing can call us back.

        Prefer `start` + `collect` anywhere the engine can notify us: waiting costs a
        whole process for minutes at a time, and on a platform that bills running
        containers - or reclaims idle ones - that is both the largest line on the bill
        and the way work gets lost.
        """
        raise NotImplementedError

    # ── the asynchronous pair ───────────────────────────────────────
    #
    # Split deliberately. `start` hands the job over and returns a ticket; `collect`
    # turns that ticket into files once the engine says it is done. Between the two,
    # nothing of ours is running. An engine that cannot notify us can still implement
    # `generate` alone, and the Studio falls back to waiting.

    def start(self, job: Job) -> Result:
        """Submit and return immediately. `task_id` is set; `files` is empty."""
        raise NotImplementedError

    def collect(self, task_id: str, dish: str, out_dir: Path,
                on_stage=None) -> Result:
        """Ask about a ticket and bring back the files if they are ready.

        `on_stage(str)` is optional and advisory: call it when the phase changes, so a
        caller can tell somebody what is happening. The one that matters is the switch
        from waiting to DOWNLOADING - a finished master is 120-140 MB, which is minutes
        on a home connection, and a screen that still says "generating 94%" through all
        of it looks stuck on work that is already done.
        """
        """Ask the engine about a ticket and download whatever is ready.

        `ok` means finished and downloaded. `error` set means finished badly. Neither
        means still working - ask again later.
        """
        raise NotImplementedError
