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
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  --project "$PROJECT_ID"

# Cloud Run's stable, predictable hostname is
# "<service>-<project-number>.<region>.run.app" (as opposed to the
# randomized "*.a.run.app" alias it also assigns). Computing it up front
# lets us include it in ALLOWED_HOSTS/ALLOWED_ORIGINS on the very first
# deploy, so the app's own DNS-rebinding/CORS protection doesn't reject
# requests sent to its own public URL.
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')
PREDICTABLE_HOST="${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app"

ALLOWED_HOSTS="$PREDICTABLE_HOST"
ALLOWED_ORIGINS="https://${PREDICTABLE_HOST}"
if [[ -n "$EXTRA_ALLOWED_HOSTS" ]]; then
  ALLOWED_HOSTS="${ALLOWED_HOSTS},${EXTRA_ALLOWED_HOSTS}"
fi
if [[ -n "$EXTRA_ALLOWED_ORIGINS" ]]; then
  ALLOWED_ORIGINS="${ALLOWED_ORIGINS},${EXTRA_ALLOWED_ORIGINS}"
fi

echo "==> Deploying $SERVICE_NAME to Cloud Run ($REGION), building from source"
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

echo "==> Done. Service URL:"
gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format 'value(status.url)'
