#!/usr/bin/env bash
# Deploys the Sofia Data MCP http-server to Google Cloud Run, built directly
# from the repo's Dockerfile via Cloud Build, with cost-safety limits:
#   - max instances capped at 1 (no runaway scale-out)
#   - modest CPU/memory (256Mi / 1 vCPU)
#   - request timeout matches the app's own REQUEST_TIMEOUT_MS
#
# Usage:
#   export GCP_PROJECT_ID=my-project
#   ./deploy/gcp/deploy-cloud-run.sh
#
# Requires: gcloud CLI, authenticated (`gcloud auth login`), billing enabled
# on the project, and the Cloud Run + Cloud Build APIs enabled (the script
# enables them if missing).

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to your GCP project id}"
REGION="${GCP_REGION:-europe-west1}"
SERVICE_NAME="${SERVICE_NAME:-sofia-data-mcp}"
MAX_INSTANCES="${MAX_INSTANCES:-1}"
CPU="${CPU:-1}"
MEMORY="${MEMORY:-256Mi}"
# Extra comma-separated hosts/origins to allow beyond Cloud Run's own
# generated hostname (e.g. a custom domain mapped to this service).
EXTRA_ALLOWED_HOSTS="${EXTRA_ALLOWED_HOSTS:-}"
EXTRA_ALLOWED_ORIGINS="${EXTRA_ALLOWED_ORIGINS:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> Enabling required APIs (idempotent)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com cloudresourcemanager.googleapis.com \
  --project "$PROJECT_ID"

# The app's own DNS-rebinding/CORS protection needs to allowlist the exact
# hostname Cloud Run assigns this service, so requests to its own public URL
# aren't rejected. That hostname is NOT the "<service>-<project-number>.
# <region>.run.app" form one might expect from older Cloud Run docs -- this
# project's region/generation assigns a hashed alias instead (e.g.
# "<service>-<hash>-<region-code>.a.run.app"), so it must be read back from
# an existing deployment rather than constructed. On the very first deploy
# (service doesn't exist yet) this is empty; we patch it in with a follow-up
# `services update` once the real hostname is known, further down.
EXISTING_SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format 'value(status.url)' 2>/dev/null || echo "")

ALLOWED_HOSTS=""
ALLOWED_ORIGINS=""
if [[ -n "$EXISTING_SERVICE_URL" ]]; then
  EXISTING_HOST="${EXISTING_SERVICE_URL#https://}"
  ALLOWED_HOSTS="$EXISTING_HOST"
  ALLOWED_ORIGINS="https://${EXISTING_HOST}"
fi
if [[ -n "$EXTRA_ALLOWED_HOSTS" ]]; then
  ALLOWED_HOSTS="${ALLOWED_HOSTS:+${ALLOWED_HOSTS},}${EXTRA_ALLOWED_HOSTS}"
fi
if [[ -n "$EXTRA_ALLOWED_ORIGINS" ]]; then
  ALLOWED_ORIGINS="${ALLOWED_ORIGINS:+${ALLOWED_ORIGINS},}${EXTRA_ALLOWED_ORIGINS}"
fi

echo "==> Deploying $SERVICE_NAME to Cloud Run ($REGION), building from source"

# Capture the revision currently serving traffic *before* this deploy, so a
# failed post-deploy smoke test can roll back to it. Empty on the very first
# deploy (service doesn't exist yet), which is fine — there's nothing to roll
# back to in that case.
PREVIOUS_REVISION=$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format 'value(status.latestReadyRevisionName)' 2>/dev/null || echo "")

gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source "$REPO_ROOT" \
  --allow-unauthenticated \
  --max-instances "$MAX_INSTANCES" \
  --min-instances 0 \
  --cpu "$CPU" \
  --memory "$MEMORY" \
  --timeout 30 \
  --concurrency 20 \
  --set-env-vars "SOFIA_CKAN_BASE_URL=https://urbandata.sofia.bg,HOST=0.0.0.0,MCP_HTTP_PATH=/mcp,REQUEST_TIMEOUT_MS=30000,PREVIEW_MAX_BYTES=262144,MAX_SEARCH_RESULTS=50,CACHE_TTL_MS=300000,ALLOWED_HOSTS=${ALLOWED_HOSTS},ALLOWED_ORIGINS=${ALLOWED_ORIGINS}"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format 'value(status.url)')

# On the very first deploy, ALLOWED_HOSTS/ALLOWED_ORIGINS above were empty
# because the service (and its hostname) didn't exist yet. Now that it does,
# patch them in with the real hostname so this and all future deploys allow
# requests to the service's own public URL. On subsequent deploys this is a
# no-op update (same hostname, same value) but harmless.
ACTUAL_HOST="${SERVICE_URL#https://}"
FINAL_ALLOWED_HOSTS="$ACTUAL_HOST"
FINAL_ALLOWED_ORIGINS="https://${ACTUAL_HOST}"
if [[ -n "$EXTRA_ALLOWED_HOSTS" ]]; then
  FINAL_ALLOWED_HOSTS="${FINAL_ALLOWED_HOSTS},${EXTRA_ALLOWED_HOSTS}"
fi
if [[ -n "$EXTRA_ALLOWED_ORIGINS" ]]; then
  FINAL_ALLOWED_ORIGINS="${FINAL_ALLOWED_ORIGINS},${EXTRA_ALLOWED_ORIGINS}"
fi
if [[ "$FINAL_ALLOWED_HOSTS" != "$ALLOWED_HOSTS" ]]; then
  echo "==> Patching ALLOWED_HOSTS/ALLOWED_ORIGINS with the confirmed service hostname"
  gcloud run services update "$SERVICE_NAME" \
    --project "$PROJECT_ID" --region "$REGION" \
    --update-env-vars "ALLOWED_HOSTS=${FINAL_ALLOWED_HOSTS},ALLOWED_ORIGINS=${FINAL_ALLOWED_ORIGINS}"
fi

echo "==> Done. Service URL:"
echo "$SERVICE_URL"

# Expose outputs to subsequent GitHub Actions steps (e.g. a post-deploy e2e
# smoke test, or a rollback step on failure), if running in that context.
# No-op locally.
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "service_url=$SERVICE_URL" >> "$GITHUB_OUTPUT"
  echo "previous_revision=$PREVIOUS_REVISION" >> "$GITHUB_OUTPUT"
fi
