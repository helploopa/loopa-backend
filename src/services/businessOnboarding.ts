const ONBOARDING_WEBHOOK_URL =
  process.env.N8N_BUSINESS_ONBOARDING_WEBHOOK_URL ?? 'https://n8n.srv996951.hstgr.cloud/webhook/business-onboarding';

// The workflow only responds after scraping the site and running its Claude checks, which can
// take far longer than a serverless request should wait. n8n keeps executing after the caller
// disconnects, so we only wait long enough to know the request was delivered.
const HANDOFF_TIMEOUT_MS = 4000;

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
  try {
    const response = await fetch(ONBOARDING_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referralId: referral.id,
        websiteUrl: referral.businessUrl,
        businessName: referral.businessName ?? '',
        email: referral.email,
        phone: referral.phone,
        zipcode: referral.zipcode,
        referredByUserId: referral.referredByUserId,
      }),
      signal: AbortSignal.timeout(HANDOFF_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`Business onboarding webhook failed for referral ${referral.id}: HTTP ${response.status}`, await response.text());
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return;
    console.error(`Business onboarding webhook unreachable for referral ${referral.id}:`, error);
  }
}
