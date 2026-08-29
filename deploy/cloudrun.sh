#!/usr/bin/env bash
# Deploy the Scan Studio to Cloud Run.
#
#   bash deploy/cloudrun.sh
#
# Needs `gcloud` and one interactive login first (this script will not do it for you):
#
#   gcloud auth login
#   gcloud config set project <your-project-id>
#
# It builds from source with Cloud Build, so **Docker is not needed locally** - which
# matters, because it is not installed on Temo's machine and the Dockerfile has therefore
# never been built there.
#
# ── why each flag is here ───────────────────────────────────────────
#
# --memory 2Gi        The whole reason for moving. Measured peak RSS of the geometry pass
#                     on a real 1.9M-triangle Meshy master is 648 MB; Render's 512 MB
#                     container was OOM-killed by it and the job vanished without an
#                     error. 2 GiB fits masters up to ~8.7M triangles (see limits.py).
#
# --cpu 1             The pipeline is 2.5s of real CPU. One core is plenty; the old
#                     0.1-CPU tier was never the problem, memory was.
#
# --no-cpu-throttling Belt and braces. Jobs now run inside their request (JOBS=inline),
#                     where CPU is allocated anyway, but this stops a throttled instance
#                     from stalling anything that still runs between requests.
#
# --timeout 900       Generation is ~175s of Meshy polling and happens inside the
#                     request. 900s leaves room for a slow one without letting a truly
#                     stuck run hold an instance for an hour.
#
# --max-instances 1   REQUIRED until ROADMAP 1.2. The in-flight job set lives in this
#                     process's memory, so two instances would happily run the same dish
#                     twice and overwrite each other's output. Raise this only after the
#                     `jobs` table exists.
#
# --min-instances 0   Scale to zero. Idle costs nothing; a cold start is a few seconds,
#                     against Render free's ~50s.
#
# --concurrency 20    Five people and a health probe. Well under the default 80, and it
#                     keeps two big optimises from landing on one instance at once.
set -euo pipefail

SERVICE="${SERVICE:-ar-menu-engine}"
REGION="${REGION:-europe-west1}"       # closest to Tbilisi of the cheap EU regions
ENV_FILE="${ENV_FILE:-deploy/env.yaml}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v gcloud >/dev/null || {
  echo "gcloud not found. Install the Google Cloud CLI, then:"
  echo "  gcloud auth login && gcloud config set project <project-id>"
  exit 1
}

PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
[ -n "$PROJECT" ] && [ "$PROJECT" != "(unset)" ] || {
  echo "No project set.  gcloud config set project <project-id>"
  exit 1
}

[ -f "$ROOT/$ENV_FILE" ] || {
  echo "Missing $ENV_FILE. Generate it from .env (it is gitignored, like .env):"
  echo "  python deploy/make_env_yaml.py"
  exit 1
}

echo "Deploying $SERVICE to $REGION in project $PROJECT"
gcloud run deploy "$SERVICE" \
  --source "$ROOT" \
  --region "$REGION" \
  --platform managed \
  --memory 2Gi \
  --cpu 1 \
  --no-cpu-throttling \
  --timeout 900 \
  --max-instances 1 \
  --min-instances 0 \
  --concurrency 20 \
  --env-vars-file "$ROOT/$ENV_FILE" \
  --allow-unauthenticated

# --allow-unauthenticated means "no Google IAM in front of it". The app's own HTTP basic
# auth (STUDIO_USERS) is what protects it, exactly as on Render, so the team keeps
# signing in with the shared credentials rather than needing Google accounts. /healthz
# answers before that check, which is what makes the deploy verifiable from outside.

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "  $URL"
curl -fsS "$URL/healthz" && echo
