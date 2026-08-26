"""Where frames, models and records live.

One interface, two backends. On a laptop it writes to a folder; hosted, it writes to
Cloudflare R2. Nothing above this module knows or cares which.

That distinction matters more than it looks: a hosted container has an ephemeral
filesystem, so anything written to local disk disappears on the next deploy. A teammate
would upload thirty photos, we would redeploy, and the photos would be gone. R2 is not an
optimisation here - it is the difference between a shared tool and a trap.

Two buckets, because the two kinds of data have opposite economics:

    photos  cold, private   ~100 MB per dish, written once, read almost never.
                            This is the training corpus - the moat - and it ends up
                            roughly 100x larger than everything the product serves.
    models  hot, public     ~2 MB each, served to diners constantly, zero egress on R2.

Configure by environment. If R2_ACCOUNT_ID is absent, local disk is used, so the laptop
workflow keeps working with no flags.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from config import load_env

_client = None


def _r2():
    """Lazily build the S3 client. R2 is S3-compatible, so boto3 talks to it directly."""
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config
        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )
    return _client


class Backend:
    kind = "?"

    def put(self, bucket: str, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, bucket: str, key: str) -> bytes | None: ...
    def delete_prefix(self, bucket: str, prefix: str) -> None: ...
    def list_keys(self, bucket: str, prefix: str) -> list[str]: ...

    def children(self, bucket: str, prefix: str) -> list[str]:
        """Immediate folder names under a prefix - how dishes and variants are listed."""
        out = set()
        cut = len(prefix)
        for k in self.list_keys(bucket, prefix):
            rest = k[cut:].lstrip("/")
            if "/" in rest:
                out.add(rest.split("/", 1)[0])
        return sorted(out)


class LocalBackend(Backend):
    kind = "local"

    def __init__(self, root: Path):
        self.root = root

    def _p(self, bucket: str, key: str) -> Path:
        return self.root / bucket / key

    def put(self, bucket, key, data, content_type="application/octet-stream"):
        p = self._p(bucket, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, bucket, key):
        p = self._p(bucket, key)
        return p.read_bytes() if p.is_file() else None

    def delete_prefix(self, bucket, prefix):
        p = self._p(bucket, prefix)
        if p.is_dir():
            shutil.rmtree(p)
        elif p.is_file():
            p.unlink()

    def list_keys(self, bucket, prefix):
        base = self._p(bucket, prefix)
        if not base.is_dir():
            return []
        root = self.root / bucket
        return sorted(str(f.relative_to(root)).replace("\\", "/")
                      for f in base.rglob("*") if f.is_file())


class R2Backend(Backend):
    kind = "r2"

    def __init__(self):
        self.buckets = {
            "photos": os.environ.get("R2_BUCKET_PHOTOS", "betareal-photos"),
            "models": os.environ.get("R2_BUCKET_MODELS", "betareal-models"),
        }

    def _b(self, bucket: str) -> str:
        return self.buckets.get(bucket, bucket)

    def put(self, bucket, key, data, content_type="application/octet-stream"):
        _r2().put_object(Bucket=self._b(bucket), Key=key, Body=data, ContentType=content_type)

    def get(self, bucket, key):
        try:
            return _r2().get_object(Bucket=self._b(bucket), Key=key)["Body"].read()
        except Exception:      # NoSuchKey and friends - absence is not an error here
            return None

    def delete_prefix(self, bucket, prefix):
        keys = self.list_keys(bucket, prefix)
        for i in range(0, len(keys), 1000):
            _r2().delete_objects(Bucket=self._b(bucket),
                                 Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]]})

    def list_keys(self, bucket, prefix):
        out, token = [], None
        while True:
            kw = {"Bucket": self._b(bucket), "Prefix": prefix, "MaxKeys": 1000}
            if token:
                kw["ContinuationToken"] = token
            r = _r2().list_objects_v2(**kw)
            out += [o["Key"] for o in r.get("Contents", [])]
            if not r.get("IsTruncated"):
                return sorted(out)
            token = r["NextContinuationToken"]


def backend(local_root: Path | None = None) -> Backend:
    load_env()
    if os.environ.get("R2_ACCOUNT_ID"):
        return R2Backend()
    return LocalBackend(local_root or Path(__file__).resolve().parent / "store")


def describe() -> str:
    b = backend()
    if b.kind == "r2":
        return f"R2 · photos={b.buckets['photos']} · models={b.buckets['models']}"
    return f"local disk · {b.root}"
