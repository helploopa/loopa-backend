import { Router, Request, Response } from 'express';
import { prisma } from '../context';
import { renderPage } from './claimLink';

const router = Router();

const REFERRAL_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * @swagger
 * /join:
 *   get:
 *     summary: Referral invite landing page
 *     description: >-
 *       Public https landing page linked from referral invite emails. Opens
 *       loopa://join?referralId={referralId} so the owner can sign up and add their business;
 *       once the referral has been used to add a business the link is disabled.
 *     parameters:
 *       - in: query
 *         name: referralId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: HTML page that hands off to the Loopa app
 *       404:
 *         description: Unknown or malformed referral id
 *       410:
 *         description: Business already added from this invite — link disabled
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  res.type('html').set('Cache-Control', 'no-store');

  const referralId = typeof req.query.referralId === 'string' ? req.query.referralId : '';
  const referral = REFERRAL_ID.test(referralId)
    ? await prisma.referbusiness
        .findUnique({ where: { id: referralId }, select: { status: true, businessId: true } })
        .catch((error) => {
          console.error('Error loading referral for join link:', error);
          return undefined;
        })
    : null;

  if (referral === undefined) {
    res.status(500).send(renderPage({
      title: 'Something went wrong',
      message: "We couldn't open this invite just now. Please try again in a few minutes.",
    }));
    return;
  }

  if (!referral || referral.status === 'rejected') {
    res.status(404).send(renderPage({
      title: "This invite isn't valid",
      message: "We couldn't find this invite. Check you've used the full link from your email.",
    }));
    return;
  }

  if (referral.status === 'onboarded' || referral.businessId) {
    res.status(410).send(renderPage({
      title: "You're already on Loopa",
      message: 'This invite has already been used to add a business. Open the Loopa app to manage your listing.',
    }));
    return;
  }

  res.status(200).send(renderPage({
    title: 'Your neighbours want you on Loopa',
    message: 'Opening the Loopa app so you can create your account and add your business.',
    appUrl: `loopa://join?referralId=${referralId}`,
  }));
});

export default router;
