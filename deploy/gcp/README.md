# Deploying to Google Cloud Run (free tier) with a budget kill-switch

This deploys the `http-server` package to Cloud Run, capped at a single
instance, plus an automated safeguard that scales the service to **zero
instances** the moment GCP reports your spend has reached a configured
budget (default: **$2**).

> **Important caveat:** GCP has no true "hard billing cap" API. This setup
> is the closest reliable equivalent — it reacts to a budget alert (which
> GCP evaluates roughly hourly, using their cost data which itself can lag
> up to ~24h) by disabling the service. It bounds your exposure but is not
> an instantaneous, guaranteed-zero-overage cutoff. Combine it with the
> Cloud Run `--max-instances 1` limit (which bounds worst-case burn rate
> regardless of the budget check's latency).

## Prerequisites

- `gcloud` CLI installed and authenticated: `gcloud auth login`
- A GCP project with billing enabled
- Billing Account Administrator role (needed to create budgets) and
  Project Owner/Editor role (needed to deploy Cloud Run + Cloud Functions)

## 1. Deploy the service

```bash
export GCP_PROJECT_ID=my-project
./deploy/gcp/deploy-cloud-run.sh
```

This builds the repo's `Dockerfile` via Cloud Build and deploys it with:

- `--max-instances 1` — hard cap on concurrent instances
- `--cpu 1 --memory 256Mi` — minimal footprint
- `--timeout 30` — matches `REQUEST_TIMEOUT_MS`
- `--min-instances 0` — scales to zero when idle (no cost at rest)

Override any of `GCP_REGION`, `SERVICE_NAME`, `MAX_INSTANCES`, `CPU`,
`MEMORY` as environment variables before running.

The script also reads back Cloud Run's actual assigned hostname (its exact
`status.url`, whatever form Cloud Run gives it — this can be a hashed alias
like `<service>-<hash>-<region-code>.a.run.app` rather than a
`<service>-<project-number>.<region>.run.app` form) and passes it as
`ALLOWED_HOSTS`/`ALLOWED_ORIGINS`, since the server's own DNS-rebinding
and CORS protection otherwise rejects requests to its own public URL. On
the very first deploy the hostname isn't known until after the initial
`gcloud run deploy` call, so the script follows up with a `services update`
to patch it in once the URL is confirmed. If you map a custom domain to the
service, add it via `EXTRA_ALLOWED_HOSTS` and `EXTRA_ALLOWED_ORIGINS`
(comma-separated) before running.

## 2. Set up the budget kill-switch

```bash
export GCP_PROJECT_ID=my-project
export GCP_BILLING_ACCOUNT_ID=XXXXXX-XXXXXX-XXXXXX   # gcloud billing accounts list
./deploy/gcp/setup-budget-guard.sh
```

This wires together:

1. A Pub/Sub topic that receives budget notifications.
2. A 2nd-gen Cloud Function (`deploy/gcp/budget-guard`) subscribed to that
   topic — see [`budget-guard/index.js`](budget-guard/index.js). When it
   receives a notification where `costAmount >= budgetAmount`, it calls the
   Cloud Run Admin API to set `maxInstanceCount` to `0` on the service,
   immediately stopping it from serving any traffic.
3. A Billing Budget of `$2` (override with `BUDGET_AMOUNT`/`BUDGET_CURRENCY`)
   with alert thresholds at 50%, 90%, and 100% of spend, notifying the
   Pub/Sub topic.

### Required manual step: connect the topic in the Console

Cloud Billing Budgets publishes notifications using an internal Google
identity (you'll see it referenced online as
`billing-budget-alert@system.gserviceaccount.com`, among other inconsistent
names) that is **not** a normal, directly-bindable IAM principal. Running
`gcloud pubsub topics add-iam-policy-binding` against it always fails with
`Service account ... does not exist`, regardless of which name you try — this
was confirmed against real production deployments, so the script does not
attempt it. The publish permission is only ever granted automatically, behind
the scenes, when you connect the Pub/Sub topic to the budget through the
**Cloud Console UI**:

1. Open `Billing > Budgets & alerts` for the billing account, and select the
   budget the script created (`<service>-budget`).
2. Go to **Manage notifications** > **Connect a Pub/Sub topic**.
3. Select this project and the `sofia-data-mcp-budget-alerts` topic (even if
   it already looks selected from the `--notifications-rule-pubsub-topic`
   flag used at creation), then **Save**.

Skipping this step means the budget's alerts will silently never reach the
topic or the Cloud Function, so the kill-switch will not fire.

## 3. Restoring service after a shutdown

Once the budget-guard has tripped, the Cloud Run service remains deployed
but serves no traffic (`maxInstanceCount=0`). After investigating the cause
of the spend and confirming it's safe to resume:

```bash
export GCP_PROJECT_ID=my-project
./deploy/gcp/restore-service.sh
```

## 4. Automatic rollback on a failed post-deploy smoke test

`deploy-cloud-run.sh` records the revision serving traffic *before* each
deploy and exposes it as a `previous_revision` output. In
`.github/workflows/deploy.yml`, if the post-deploy e2e smoke test
(`pnpm test:e2e`, from `packages/e2e`, run against the just-deployed URL)
fails, a subsequent step automatically shifts 100% of traffic back to that
previous revision using `deploy/gcp/rollback-service.sh`:

```bash
export GCP_PROJECT_ID=my-project
export PREVIOUS_REVISION=sofia-data-mcp-00042-abc
./deploy/gcp/rollback-service.sh
```

The bad revision is **not** deleted — it stays deployed (just not receiving
traffic) so it can be inspected via `gcloud run revisions describe` or the
Cloud Console. On the very first deploy of a service there is no previous
revision to roll back to; in that case the workflow fails loudly instead
and requires manual investigation.

## 5. Automated deploys via GitHub Actions

Deploys run from `.github/workflows/deploy.yml`, triggered automatically once
the `CI` workflow succeeds on `main` (build/typecheck/test must pass first),
or manually via "Run workflow" in the Actions tab. It authenticates to GCP
using **Workload Identity Federation** — no service account JSON key is ever
stored in GitHub.

One-time setup:

```bash
export GCP_PROJECT_ID=my-project
./deploy/gcp/setup-workload-identity.sh
```

This creates a Workload Identity Pool + OIDC provider trusting GitHub's
token issuer (restricted to the `manevpe/sofia-data-mcp` repo only), a
dedicated deploy service account with the minimum roles (`run.admin`,
`cloudbuild.builds.editor`, `iam.serviceAccountUser`, `storage.admin`,
`serviceusage.serviceUsageAdmin`, `artifactregistry.admin`, `browser`), and
an IAM binding letting that repo's workflows impersonate the service
account — but only via short-lived tokens minted per workflow run.

Then add the three values it prints as **GitHub Actions secrets**
(Settings → Secrets and variables → Actions → New repository secret):

- `GCP_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT`

Optionally set repo **variables** `GCP_REGION` / `SERVICE_NAME` if you want
values other than the defaults (`europe-west1` / `sofia-data-mcp`).

The budget-guard setup (`setup-budget-guard.sh`) is separate and only needs
to be run once manually — it isn't part of the CI/CD pipeline since it
provisions billing-account-level resources.

## Files

| File | Purpose |
|---|---|
| `deploy-cloud-run.sh` | Builds and deploys the service to Cloud Run with cost-safety flags. Used both locally and by the GitHub Actions deploy workflow. |
| `setup-workload-identity.sh` | One-time setup of Workload Identity Federation so GitHub Actions can deploy without any long-lived key. |
| `setup-budget-guard.sh` | One-time setup of the Pub/Sub topic, IAM bindings, Cloud Function, and billing budget. |
| `budget-guard/index.js` | The Cloud Function source: reads budget notifications, scales Cloud Run to zero on overage. |
| `restore-service.sh` | Re-enables the service (sets `max-instances` back to 1) after a shutdown. |
| `../../.github/workflows/deploy.yml` | GitHub Actions workflow: deploys to Cloud Run after CI passes on `main`, or on manual dispatch. |
