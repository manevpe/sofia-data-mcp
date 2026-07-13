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

## 2. Set up the budget kill-switch

```bash
export GCP_PROJECT_ID=my-project
export GCP_BILLING_ACCOUNT_ID=XXXXXX-XXXXXX-XXXXXX   # gcloud billing accounts list
./deploy/gcp/setup-budget-guard.sh
```

This wires together:

1. A Pub/Sub topic that receives budget notifications.
2. IAM grant so the billing account's service agent can publish to it.
3. A 2nd-gen Cloud Function (`deploy/gcp/budget-guard`) subscribed to that
   topic — see [`budget-guard/index.js`](budget-guard/index.js). When it
   receives a notification where `costAmount >= budgetAmount`, it calls the
   Cloud Run Admin API to set `maxInstanceCount` to `0` on the service,
   immediately stopping it from serving any traffic.
4. A Billing Budget of `$2` (override with `BUDGET_AMOUNT`/`BUDGET_CURRENCY`)
   with alert thresholds at 50%, 90%, and 100% of spend, notifying the
   Pub/Sub topic.

## 3. Restoring service after a shutdown

Once the budget-guard has tripped, the Cloud Run service remains deployed
but serves no traffic (`maxInstanceCount=0`). After investigating the cause
of the spend and confirming it's safe to resume:

```bash
export GCP_PROJECT_ID=my-project
./deploy/gcp/restore-service.sh
```

## Files

| File | Purpose |
|---|---|
| `deploy-cloud-run.sh` | Builds and deploys the service to Cloud Run with cost-safety flags. |
| `setup-budget-guard.sh` | One-time setup of the Pub/Sub topic, IAM bindings, Cloud Function, and billing budget. |
| `budget-guard/index.js` | The Cloud Function source: reads budget notifications, scales Cloud Run to zero on overage. |
| `restore-service.sh` | Re-enables the service (sets `max-instances` back to 1) after a shutdown. |
