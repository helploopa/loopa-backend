import { Router, Request, Response } from 'express';
import { prisma } from '../context';

const router = Router();

const BUSINESS_ID = /^[A-Za-z0-9-]{1,64}$/;
const SUPPORT_EMAIL = 'help.loopa@gmail.com';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface PageOptions {
  title: string;
  message: string;
  appUrl?: string;
}

function renderPage({ title, message, appUrl }: PageOptions) {
  const action = appUrl
    ? `<a class="button" href="${escapeHtml(appUrl)}">Open in Loopa</a>
  <small>Nothing happening? Make sure the Loopa app is installed on this phone, then tap the button.</small>`
    : `<small>Questions? Email ${SUPPORT_EMAIL}</small>`;
  const redirect = appUrl ? `<script>window.location.href = ${JSON.stringify(appUrl)};</script>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; font-family: 'DM Sans', Helvetica, Arial, sans-serif; background: #FAF3EE; color: #2A1F14; }
  main { max-width: 480px; margin: 0 auto; padding: 48px 24px; text-align: center; line-height: 1.7; }
  h1 { font-family: 'Playfair Display', Georgia, serif; font-size: 28px; margin: 0 0 12px; }
  p { color: #5A3C1C; margin: 0 0 24px; }
  a.button { display: inline-block; background: #C2652A; color: #FFFFFF; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; }
  small { display: block; margin-top: 32px; color: #A08060; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>${message}</p>
  ${action}
</main>
${redirect}
</body>
</html>`;
}

/**
 * @swagger
 * /claim/{businessId}:
 *   get:
 *     summary: Claim-business link landing page
 *     description: >-
 *       Public https landing page used in claim emails (mail apps like Gmail don't linkify
 *       custom schemes). Opens loopa://claim/{businessId} in the app while the business is
 *       unclaimed; once it has been claimed the link is disabled and shows a notice instead.
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: name
 *         required: false
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: HTML page that hands off to the Loopa app
 *       404:
 *         description: Unknown or malformed business id
 *       410:
 *         description: Business already claimed — link disabled
 */
router.get('/:businessId', async (req: Request, res: Response): Promise<void> => {
  res.type('html').set('Cache-Control', 'no-store');

  const businessId = String(req.params.businessId);
  const business = BUSINESS_ID.test(businessId)
    ? await prisma.seller
        .findUnique({ where: { id: businessId }, select: { name: true, status: true, userId: true } })
        .catch((error) => {
          console.error('Error loading business for claim link:', error);
          return undefined;
        })
    : null;

  if (business === undefined) {
    res.status(500).send(renderPage({
      title: 'Something went wrong',
      message: "We couldn't open this claim link just now. Please try again in a few minutes.",
    }));
    return;
  }

  if (!business) {
    res.status(404).send(renderPage({
      title: "This link isn't valid",
      message: "We couldn't find the business this link points to. Check you've used the full link from your email.",
    }));
    return;
  }

  const queryName = typeof req.query.name === 'string' ? req.query.name.slice(0, 120) : '';
  const name = business.name || queryName;
  const safeName = escapeHtml(name);

  // Same rule POST /api/businesses/:id/claim uses to refuse a second claim.
  if (business.status !== 'unclaimed' || business.userId !== null) {
    res.status(410).send(renderPage({
      title: name ? `${safeName} has already been claimed` : 'This business has already been claimed',
      message: 'This claim link is no longer active because the business is already linked to an owner on Loopa. If you run this business and didn’t claim it, get in touch and we’ll help sort it out.',
    }));
    return;
  }

  const appUrl = `loopa://claim/${businessId}${name ? `?name=${encodeURIComponent(name)}` : ''}`;
  res.status(200).send(renderPage({
    title: name ? `Claim ${safeName} on Loopa` : 'Claim your business on Loopa',
    message: 'Opening the Loopa app so you can verify your email and phone and take over your listing.',
    appUrl,
  }));
});

export default router;
