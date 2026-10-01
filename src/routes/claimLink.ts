import { Router, Request, Response } from 'express';

const router = Router();

const BUSINESS_ID = /^[A-Za-z0-9-]{1,64}$/;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * @swagger
 * /claim/{businessId}:
 *   get:
 *     summary: Claim-business link landing page
 *     description: >-
 *       Public https landing page used in claim emails (mail apps like Gmail don't linkify
 *       custom schemes). Opens loopa://claim/{businessId} in the app, with a tap fallback.
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
 *         description: Malformed business id
 */
router.get('/:businessId', (req: Request, res: Response) => {
  const businessId = String(req.params.businessId);
  if (!BUSINESS_ID.test(businessId)) {
    res.status(404).send('Not found');
    return;
  }

  const name = typeof req.query.name === 'string' ? req.query.name.slice(0, 120) : '';
  const appUrl = `loopa://claim/${businessId}${name ? `?name=${encodeURIComponent(name)}` : ''}`;
  const heading = name ? `Claim ${escapeHtml(name)} on Loopa` : 'Claim your business on Loopa';

  res
    .status(200)
    .type('html')
    .set('Cache-Control', 'no-store')
    .send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
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
  <h1>${heading}</h1>
  <p>Opening the Loopa app so you can verify your email and phone and take over your listing.</p>
  <a class="button" href="${escapeHtml(appUrl)}">Open in Loopa</a>
  <small>Nothing happening? Make sure the Loopa app is installed on this phone, then tap the button.</small>
</main>
<script>window.location.href = ${JSON.stringify(appUrl)};</script>
</body>
</html>`);
});

export default router;
