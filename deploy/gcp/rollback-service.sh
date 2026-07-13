#!/usr/bin/env bash
# Rolls back the Cloud Run service to a previously-known-good revision by
# shifting 100% of traffic to it. Used automatically by the deploy workflow
# when the post-deploy e2e smoke test fails against a freshly deployed
# revision; can also be run manually.
#
# Usage:
#   export GCP_PROJECT_ID=my-project
#   export PREVIOUS_REVISION=sofia-data-mcp-00042-abc
#   ./deploy/gcp/rollback-service.sh
#
# Note: this only re-routes traffic; it does not delete the bad revision, so
# it remains available for inspection/debugging.

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to your GCP project id}"
REGION="${GCP_REGION:-europe-west1}"
SERVICE_NAME="${SERVICE_NAME:-sofia-data-mcp}"
PREVIOUS_REVISION="${PREVIOUS_REVISION:?Set PREVIOUS_REVISION to the revision name to roll back to}"

echo "==> Rolling back '${SERVICE_NAME}' to revision '${PREVIOUS_REVISION}'"
gcloud run services update-traffic "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --to-revisions "${PREVIOUS_REVISION}=100"

echo "==> Done. '${SERVICE_NAME}' is now serving 100% traffic from '${PREVIOUS_REVISION}'."
echo "    The failed revision is still deployed (not deleted) for inspection."
