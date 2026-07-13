'use strict';

const { GoogleAuth } = require('google-auth-library');

// Populated at deploy time via `gcloud functions deploy --set-env-vars`.
const PROJECT_ID = process.env.GCP_PROJECT_ID;
const REGION = process.env.GCP_REGION || 'europe-west1';
const SERVICE_NAME = process.env.SERVICE_NAME || 'sofia-data-mcp';

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

/**
 * Sets the Cloud Run service's max instance count via the Admin API v2.
 * Setting it to 0 stops the service from serving any traffic (a "soft
 * shutdown" that keeps the service and its config intact for later restore),
 * without deleting anything or touching billing account state.
 */
async function setMaxInstances(maxInstanceCount) {
  const client = await auth.getClient();
  const url =
    `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}` +
    `/services/${SERVICE_NAME}?updateMask=template.scaling.maxInstanceCount`;

  await client.request({
    url,
    method: 'PATCH',
    data: { template: { scaling: { maxInstanceCount } } },
  });
}

/**
 * Pub/Sub-triggered (CloudEvent) budget guard.
 *
 * GCP billing budget alerts publish a message to a Pub/Sub topic on every
 * threshold crossing. The payload includes `costAmount` (spend so far in the
 * current period) and `budgetAmount` (the configured budget). We only act
 * once actual spend has reached/exceeded the budget — lower thresholds
 * (e.g. 50%, 90%) are informational and are ignored here.
 */
exports.budgetGuard = async (cloudEvent) => {
  if (!PROJECT_ID) {
    throw new Error('GCP_PROJECT_ID env var is required');
  }

  const base64Data = cloudEvent?.data?.message?.data;
  if (!base64Data) {
    console.error('No Pub/Sub message data found on event; ignoring.');
    return;
  }

  const payload = JSON.parse(Buffer.from(base64Data, 'base64').toString('utf8'));
  const { costAmount, budgetAmount, budgetDisplayName } = payload;

  console.log(
    `Budget alert for "${budgetDisplayName}": spend=${costAmount} budget=${budgetAmount}`
  );

  if (typeof costAmount !== 'number' || typeof budgetAmount !== 'number') {
    console.error('Unexpected budget notification payload; ignoring.', payload);
    return;
  }

  if (costAmount < budgetAmount) {
    console.log('Spend is still under budget; no action taken.');
    return;
  }

  console.warn(
    `Spend (${costAmount}) has reached/exceeded budget (${budgetAmount}). ` +
      `Scaling "${SERVICE_NAME}" to zero instances.`
  );
  await setMaxInstances(0);
  console.warn(`"${SERVICE_NAME}" scaled to zero. Restore it with restore-service.sh once resolved.`);
};
