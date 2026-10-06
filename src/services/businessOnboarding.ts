const ONBOARDING_WEBHOOK_URL =
  process.env.N8N_BUSINESS_ONBOARDING_WEBHOOK_URL ?? 'https://n8n.srv996951.hstgr.cloud/webhook/business-onboarding';

// Website onboarding only responds after scraping the site and running its Claude checks, which
// takes far longer than a serverless request should wait; n8n keeps executing after the caller
// disconnects, so we only wait long enough to know the request was delivered. Invites respond
// once the email is sent, so we wait for that and log a failure.
const WEBSITE_HANDOFF_TIMEOUT_MS = 4000;
const INVITE_TIMEOUT_MS = 15000;

export interface OnboardingReferral {
  id: string;
  businessName: string | null;
  businessUrl: string | null;
  email: string;
  phone: string | null;
  zipcode: string | null;
  referredByUserId: string;
}

export async function startBusinessOnboarding(referral: OnboardingReferral): Promise<void> {
  const mode = referral.businessUrl ? 'website' : 'invite';
  try {
    const response = await fetch(ONBOARDING_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(mode === 'invite' ? { mode: 'invite' } : {}),
        referralId: referral.id,
        websiteUrl: referral.businessUrl,
        businessName: referral.businessName ?? '',
        email: referral.email,
        phone: referral.phone,
        zipCode: referral.zipcode,
        referredByUserId: referral.referredByUserId,
      }),
      signal: AbortSignal.timeout(mode === 'invite' ? INVITE_TIMEOUT_MS : WEBSITE_HANDOFF_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`Business ${mode} webhook failed for referral ${referral.id}: HTTP ${response.status}`, await response.text());
    }
  } catch (error) {
    if (mode === 'website' && error instanceof Error && error.name === 'TimeoutError') return;
    console.error(`Business ${mode} webhook unreachable for referral ${referral.id}:`, error);
  }
}
