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


class Engine:
    """Base class. Subclass, set `name`, implement `generate`."""

    name = "engine"
    variant = "default"
    cost_per_job = 0  # credits; drives the spend estimate shown before any call

    @property
    def label(self) -> str:
        return f"{self.name}:{self.variant}"

    def generate(self, job: Job, out_dir: Path) -> Result:
        raise NotImplementedError
