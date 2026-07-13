#!/usr/bin/env bash
# One-time setup of Workload Identity Federation so GitHub Actions can deploy
# to Cloud Run without any long-lived service account keys.
#
# Creates:
#   - A Workload Identity Pool + OIDC provider trusting
#     token.actions.githubusercontent.com, restricted to this repo.
#   - A dedicated deploy service account with the minimum roles needed to
#     build (Cloud Build) and deploy (Cloud Run) the service.
#   - An IAM binding allowing GitHub Actions workflows running in
#     manevpe/sofia-data-mcp (on any branch, tighten via --attribute-condition
#     if desired) to impersonate that service account.
#
# Usage:
#   export GCP_PROJECT_ID=my-project
#   ./deploy/gcp/setup-workload-identity.sh
#
# After running, add these as GitHub Actions secrets/variables in the repo
# (Settings > Secrets and variables > Actions):
#   GCP_PROJECT_ID                  = your project id
#   GCP_WORKLOAD_IDENTITY_PROVIDER  = printed at the end of this script
#   GCP_DEPLOY_SERVICE_ACCOUNT      = printed at the end of this script

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to your GCP project id}"
GITHUB_REPO="${GITHUB_REPO:-manevpe/sofia-data-mcp}"
POOL_ID="${POOL_ID:-github-actions-pool}"
PROVIDER_ID="${PROVIDER_ID:-github-actions-provider}"
DEPLOY_SA_NAME="${DEPLOY_SA_NAME:-sofia-data-mcp-deployer}"
DEPLOY_SA_EMAIL="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Enabling required APIs"
gcloud services enable \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  --project "$PROJECT_ID"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')

echo "==> Creating Workload Identity Pool (idempotent)"
gcloud iam workload-identity-pools create "$POOL_ID" \
  --project "$PROJECT_ID" \
  --location "global" \
  --display-name "GitHub Actions" 2>/dev/null || \
  echo "    Pool already exists, continuing."

echo "==> Creating OIDC provider trusting token.actions.githubusercontent.com, restricted to ${GITHUB_REPO}"
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project "$PROJECT_ID" \
  --location "global" \
  --workload-identity-pool "$POOL_ID" \
  --display-name "GitHub Actions provider" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition "assertion.repository=='${GITHUB_REPO}'" \
  --issuer-uri "https://token.actions.githubusercontent.com" 2>/dev/null || \
  echo "    Provider already exists, continuing."

echo "==> Creating deploy service account (idempotent)"
gcloud iam service-accounts create "$DEPLOY_SA_NAME" \
  --project "$PROJECT_ID" \
  --display-name "Sofia Data MCP GitHub Actions deployer" 2>/dev/null || \
  echo "    Service account already exists, continuing."

echo "==> Granting the deploy service account the minimum roles needed to build & deploy"
for ROLE in roles/run.admin roles/cloudbuild.builds.editor roles/iam.serviceAccountUser roles/storage.admin roles/serviceusage.serviceUsageAdmin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${DEPLOY_SA_EMAIL}" \
    --role "$ROLE" \
    --condition None >/dev/null
done

echo "==> Allowing GitHub Actions (repo: ${GITHUB_REPO}) to impersonate the deploy service account"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" \
  --project "$PROJECT_ID" \
  --role "roles/iam.workloadIdentityUser" \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}"

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

echo ""
echo "==> Done. Add these as GitHub Actions secrets in ${GITHUB_REPO}:"
echo "    GCP_PROJECT_ID                 = ${PROJECT_ID}"
echo "    GCP_WORKLOAD_IDENTITY_PROVIDER  = ${WIF_PROVIDER}"
echo "    GCP_DEPLOY_SERVICE_ACCOUNT      = ${DEPLOY_SA_EMAIL}"
