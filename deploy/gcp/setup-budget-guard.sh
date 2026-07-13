#!/usr/bin/env bash
# Sets up an automated billing kill-switch for the Sofia Data MCP Cloud Run
# service: when GCP-reported spend reaches the configured budget, a Cloud
# Function scales the Cloud Run service's max instances to 0 (stopping it
# from serving traffic / consuming billable instance time).
#
# NOTE: GCP budgets do not have a "hard stop" primitive. This script wires
# together the closest reliable equivalent:
#   Billing Budget --(Pub/Sub notification)--> Cloud Function --(Admin API)--> Cloud Run maxInstances=0
#
# Usage:
#   export GCP_PROJECT_ID=my-project
#   export GCP_BILLING_ACCOUNT_ID=XXXXXX-XXXXXX-XXXXXX
#   ./deploy/gcp/setup-budget-guard.sh
#
# Requires: gcloud CLI authenticated with Billing Account Administrator and
# Project Owner/Editor permissions.

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to your GCP project id}"
BILLING_ACCOUNT_ID="${GCP_BILLING_ACCOUNT_ID:?Set GCP_BILLING_ACCOUNT_ID (see: gcloud billing accounts list)}"
REGION="${GCP_REGION:-europe-west1}"
SERVICE_NAME="${SERVICE_NAME:-sofia-data-mcp}"
BUDGET_AMOUNT="${BUDGET_AMOUNT:-2}"
BUDGET_CURRENCY="${BUDGET_CURRENCY:-USD}"
TOPIC_NAME="${TOPIC_NAME:-sofia-data-mcp-budget-alerts}"
FUNCTION_NAME="${FUNCTION_NAME:-sofia-data-mcp-budget-guard}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> Enabling required APIs"
gcloud services enable \
  billingbudgets.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  pubsub.googleapis.com \
  --project "$PROJECT_ID"

echo "==> Creating Pub/Sub topic for budget notifications (idempotent)"
gcloud pubsub topics create "$TOPIC_NAME" --project "$PROJECT_ID" 2>/dev/null || \
  echo "    Topic already exists, continuing."

# The billing account's own service agent is what actually publishes budget
# notification messages, not your user account — it needs explicit publish
# rights on the topic or notifications will silently fail to be delivered.
BILLING_ACCOUNT_NUMBER="${BILLING_ACCOUNT_ID//-/}"
BILLING_SERVICE_AGENT="service-${BILLING_ACCOUNT_NUMBER}@gcp-sa-cloudbilling.iam.gserviceaccount.com"
echo "==> Granting billing service agent (${BILLING_SERVICE_AGENT}) publish rights on the topic"
gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${BILLING_SERVICE_AGENT}" \
  --role roles/pubsub.publisher

echo "==> Deploying budget-guard Cloud Function"
gcloud functions deploy "$FUNCTION_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --runtime nodejs20 \
  --source "$REPO_ROOT/deploy/gcp/budget-guard" \
  --entry-point budgetGuard \
  --trigger-topic "$TOPIC_NAME" \
  --set-env-vars "GCP_PROJECT_ID=$PROJECT_ID,GCP_REGION=$REGION,SERVICE_NAME=$SERVICE_NAME" \
  --gen2 \
  --no-allow-unauthenticated

echo "==> Granting the function's service account permission to update Cloud Run services"
FUNCTION_SA=$(gcloud functions describe "$FUNCTION_NAME" \
  --project "$PROJECT_ID" --region "$REGION" --gen2 \
  --format 'value(serviceConfig.serviceAccountEmail)')

gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" \
  --member "serviceAccount:${FUNCTION_SA}" \
  --role roles/run.developer

echo "==> Creating billing budget of ${BUDGET_AMOUNT} ${BUDGET_CURRENCY}, linked to the Pub/Sub topic"
gcloud billing budgets create \
  --billing-account "$BILLING_ACCOUNT_ID" \
  --display-name "${SERVICE_NAME}-budget" \
  --budget-amount "${BUDGET_AMOUNT}${BUDGET_CURRENCY}" \
  --filter-projects "projects/${PROJECT_ID}" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --notifications-rule-pubsub-topic "projects/${PROJECT_ID}/topics/${TOPIC_NAME}"

echo "==> Done."
echo "    Budget alerts >= 100% of \$${BUDGET_AMOUNT} will scale '${SERVICE_NAME}' to 0 instances."
echo "    After spend resets and the issue is investigated, restore service with:"
echo "      ./deploy/gcp/restore-service.sh"
