import { Router, Request, Response } from 'express';
import { prisma } from '../context';
import { renderPage } from './claimLink';
import { firstNameOf, normaliseLoopCode } from '../services/loopService';

const router = Router();

/**
 * @swagger
 * /loop/{code}:
 *   get:
 *     summary: Loop invite landing page
 *     description: >-
 *       Public https landing page for loop invite links sent by text, email or WhatsApp (those
 *       apps don't linkify custom schemes). Opens loopa://loop/{code} so the neighbour can join
 *       the loop in the app; full drops and used invites show a notice instead.
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: HTML page that hands off to the Loopa app
 *       404:
 *         description: Unknown or malformed code
 *       410:
 *         description: Drop full or invite already used
 */
router.get('/:code', async (req: Request, res: Response): Promise<void> => {
  res.type('html').set('Cache-Control', 'no-store');

  const code = normaliseLoopCode(req.params.code as string);
  const invite = code
    ? await prisma.loopInviteCode
        .findUnique({
          where: { code },
          select: { kind: true, status: true, uses: true, maxUses: true, owner: { select: { firstName: true, name: true } } },
        })
        .catch((error) => {
          console.error('Error loading loop invite for landing page:', error);
          return undefined;
        })
    : null;

  if (invite === undefined) {
    res.status(500).send(renderPage({
      title: 'Something went wrong',
      message: "We couldn't open this invite just now. Please try again in a few minutes.",
    }));
    return;
  }

  if (!invite || invite.status === 'cancelled') {
    res.status(404).send(renderPage({
      title: "This invite isn't valid",
      message: "We couldn't find this invite. Check you've used the full link your neighbour sent.",
    }));
    return;
  }

  if (invite.uses >= invite.maxUses) {
    res.status(410).send(renderPage(
      invite.kind === 'seed'
        ? {
            title: 'This drop is full',
            message: `All ${invite.maxUses} spots have been claimed. Ask a neighbour who's already on Loopa to bring you into their loop.`,
          }
        : {
            title: "This invite's already been used",
            message: 'Each invite works once. Ask your neighbour to send you a fresh one.',
          }
    ));
    return;
  }

  res.status(200).send(renderPage({
    title: `${firstNameOf(invite.owner)} saved you a spot in their loop`,
    message: 'Opening the Loopa app so you can join your neighbours.',
    appUrl: `loopa://loop/${code}`,
  }));
});

export default router;
