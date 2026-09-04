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

Configure by environment: R2_ENDPOINT (paste the URL Cloudflare gives you) or
R2_ACCOUNT_ID, plus the key pair. With neither, local disk is used, so the laptop
workflow keeps working with no flags.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from config import load_env

_client = None


def endpoint() -> str:
    """The S3 endpoint for this account.

    Cloudflare never labels an "Account ID" field on the token screen - it is the first
    chunk of the endpoint URL it hands you. So take R2_ENDPOINT pasted verbatim if it is
    set, and fall back to building it from R2_ACCOUNT_ID. Either works; the first one
    saves reading a URL apart by eye, and it carries jurisdiction endpoints
    (`<id>.eu.r2.cloudflarestorage.com`) correctly for free.
    """
    ep = os.environ.get("R2_ENDPOINT", "").strip().rstrip("/")
    if ep:
        return ep if ep.startswith("http") else f"https://{ep}"
    return f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"


def _r2():
    """Lazily build the S3 client. R2 is S3-compatible, so boto3 talks to it directly."""
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config
        _client = boto3.client(
            "s3",
            endpoint_url=endpoint(),
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

    def stream(self, bucket: str, key: str):
        """(file-like, size) for reading an object in chunks, or (None, 0) if absent.

        Used to serve models to the browser from our own origin. The obvious alternative
        - redirect to a signed R2 URL - is what the Studio did until 2026-08-29, and it
        silently broke the 3D viewer: R2 answers a signed request with the bytes but with
        no Access-Control-Allow-Origin header, so the browser fetches it, discards it,
        and shows an empty panel. Nothing appears in the network tab as an error.
        Same-origin bytes have no such rule to break.
        """
        data = self.get(bucket, key)
        if data is None:
            return None, 0
        import io as _io
        return _io.BytesIO(data), len(data)

    def put_if_absent(self, bucket: str, key: str, data: bytes,
                      content_type: str = "application/octet-stream") -> bool:
        """Write only if nothing is there. True if this caller created it.

        The one primitive a queue actually needs: of two workers racing for the same
        job, exactly one must win. Everything in jobs.py rests on this being atomic
        rather than a read followed by a write, which is a race with extra steps.
        """
        raise NotImplementedError

    def download(self, bucket: str, key: str, dest: Path) -> bool:
        """Object straight to a file, never through a bytes object.

        `get` is fine for records and photos. It is not fine for a 70 MB master: that
        allocation, plus the copy every reader then makes of it, is most of a 512 MB
        container before Node has even started. Render OOM-killed the instance mid-run
        on 2026-08-29 and the job vanished without writing an error, because a killed
        process cannot write anything. Anything master-sized goes through here.
        """
        data = self.get(bucket, key)
        if data is None:
            return False
        dest.write_bytes(data)
        return True

    def signed_url(self, bucket: str, key: str, seconds: int = 900) -> str | None:
        """A direct, time-limited URL, or None if this backend cannot make one."""
        return None

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

    def stream(self, bucket, key):
        p = self._p(bucket, key)
        if not p.is_file():
            return None, 0
        return open(p, "rb"), p.stat().st_size

    def put_if_absent(self, bucket, key, data, content_type="application/octet-stream"):
        # "x" is the filesystem's own atomic create: it fails if the path exists, and
        # the check and the create are one operation rather than two.
        p = self._p(bucket, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(p, "xb") as fh:
                fh.write(data)
            return True
        except FileExistsError:
            return False

    def download(self, bucket, key, dest):
        p = self._p(bucket, key)
        if not p.is_file():
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, dest)
        return True

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

    def stream(self, bucket, key):
        try:
            r = _r2().get_object(Bucket=self._b(bucket), Key=key)
            return r["Body"], int(r.get("ContentLength") or 0)
        except Exception:
            return None, 0

    def put_if_absent(self, bucket, key, data, content_type="application/octet-stream"):
        """R2 honours S3 conditional writes. Verified against the real bucket:

            IfNoneMatch="*"   first write  -> OK
                              second write -> PreconditionFailed

        which is what makes a database unnecessary for the job queue.
        """
        try:
            _r2().put_object(Bucket=self._b(bucket), Key=key, Body=data,
                             ContentType=content_type, IfNoneMatch="*")
            return True
        except Exception as e:                                   # noqa: BLE001
            code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
            if code in ("PreconditionFailed", "ConditionalRequestConflict"):
                return False
            raise

    def download(self, bucket, key, dest):
        """Streamed in chunks by boto3 - peak memory is the chunk, not the object."""
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as fh:
                _r2().download_fileobj(self._b(bucket), key, fh)
            return True
        except Exception:
            dest.unlink(missing_ok=True)
            return False

    def delete_prefix(self, bucket, prefix):
        keys = self.list_keys(bucket, prefix)
        for i in range(0, len(keys), 1000):
            _r2().delete_objects(Bucket=self._b(bucket),
                                 Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]]})

    def signed_url(self, bucket, key, seconds=900):
        """Hand the browser a direct R2 link instead of streaming bytes through the app.

        R2 egress is free; the app server's bandwidth is not. Proxying a 5 MB model
        through the container spends the host's allowance on something the object store
        would serve for nothing - and adds a hop for every frame thumbnail too.
        """
        try:
            return _r2().generate_presigned_url(
                "get_object",
                Params={"Bucket": self._b(bucket), "Key": key},
                ExpiresIn=seconds)
        except Exception:
            return None

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
    if os.environ.get("R2_ENDPOINT") or os.environ.get("R2_ACCOUNT_ID"):
        return R2Backend()
    return LocalBackend(local_root or Path(__file__).resolve().parent / "store")


def describe() -> str:
    b = backend()
    if b.kind == "r2":
        host = endpoint().split("//")[-1]
        return f"R2 @ {host} | photos={b.buckets['photos']} | models={b.buckets['models']}"
    return f"local disk | {b.root}"
