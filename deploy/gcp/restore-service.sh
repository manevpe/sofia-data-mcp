#!/usr/bin/env bash
# Restores the Cloud Run service after the budget-guard function has scaled
# it to zero instances. Run this manually once you've reviewed spend and are
# ready to bring the service back online.
#
# Usage:
#   export GCP_PROJECT_ID=my-project
#   ./deploy/gcp/restore-service.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to your GCP project id}"
REGION="${GCP_REGION:-europe-west1}"
SERVICE_NAME="${SERVICE_NAME:-sofia-data-mcp}"
MAX_INSTANCES="${MAX_INSTANCES:-1}"

echo "==> Restoring '${SERVICE_NAME}' to max-instances=${MAX_INSTANCES}"
gcloud run services update "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --max-instances "$MAX_INSTANCES"

echo "==> Done. Check current spend before restoring: https://console.cloud.google.com/billing"
