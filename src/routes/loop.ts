import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../context';
import { authenticateApiKey, authenticateToken } from '../middleware/auth';
import {
  LOOP_INVITE_CHANNELS,
  LOOP_INVITES_PER_USER,
  LOOP_RADIUS_MILES,
  LOOP_SEED_CODE_MAX_USES,
  countInvitesUsed,
  countReach,
  displayName,
  firstNameOf,
  generateLoopCode,
  initialsFor,
  loadLoopNetwork,
  loopInviteLink,
  milesBetween,
  normaliseLoopCode,
  snapToGrid,
  upsertMemberArea,
} from '../services/loopService';

const router = Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => (req.user?.userId as string) ?? 'anonymous',
  message: { error: 'TOO_MANY_INVITES', message: 'Too many invites. Try again in a little while.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Codes are short, so cap public lookups to stop anyone guessing their way through them.
const codeLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Too many invite lookups. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Zod schemas ───────────────────────────────────────────────────────────────

const areaFields = {
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  areaName: z.string().trim().min(1).max(100),
};

const areaSchema = z.object(areaFields);
const optionalAreaQuerySchema = z.object(areaFields).partial();

const createInviteSchema = z.object({ channel: z.enum(LOOP_INVITE_CHANNELS) }).strict();

const createDropSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    hostUserId: z.string().uuid(),
    maxUses: z.number().int().min(1).max(10_000).default(LOOP_SEED_CODE_MAX_USES),
    code: z.string().trim().min(4).max(32).optional(),
    ...areaFields,
  })
  .strict();

function getUserId(req: Request): string | null {
  return (req.user?.userId as string) ?? null;
}

function validationError(res: Response, error: z.ZodError): void {
  const first = error.issues[0];
  res.status(400).json({ error: 'VALIDATION_ERROR', message: first.message });
}

const round1 = (value: number) => Math.round(value * 10) / 10;

// ════════════════════════════════════════════════════════════════════════════
// GET /api/loop/me — the caller's loop
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/loop/me:
 *   get:
 *     summary: Get my neighbour loop
 *     description: >
 *       Returns the caller's loop: invites used (20 for life), neighbours who joined and the
 *       neighbours they brought in, pending invites, and the drop the loop traces back to.
 *       `network` lists everyone further down the invite tree (depth 2 and deeper) with their
 *       inviter's id, first name only, and neighbourhood, so the app can draw the whole loop.
 *       Pass the caller's neighbourhood to set or refresh their loop's centre; it is snapped
 *       to a ~0.7 mile grid and never stored precisely. Pending invites carry no name — the
 *       app keeps who an invite went to on the device.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: latitude
 *         schema: { type: number }
 *       - in: query
 *         name: longitude
 *         schema: { type: number }
 *       - in: query
 *         name: areaName
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The caller's loop
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: AREA_REQUIRED — no neighbourhood set yet
 */
router.get('/me', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = optionalAreaQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    validationError(res, parsed.error);
    return;
  }

  try {
    const { latitude, longitude, areaName } = parsed.data;
    const member =
      latitude !== undefined && longitude !== undefined && areaName
        ? await upsertMemberArea(userId, { latitude, longitude, areaName })
        : await prisma.loopMember.findUnique({ where: { userId } });

    if (!member || member.latitude === null || member.longitude === null) {
      res.status(409).json({ error: 'AREA_REQUIRED', message: 'Set your neighbourhood to see your loop.' });
      return;
    }

    const [joinedMembers, pendingCodes, invitesUsed, reach] = await Promise.all([
      prisma.loopMember.findMany({
        where: { inviterId: userId },
        include: { user: { select: { firstName: true, lastName: true, name: true } } },
        orderBy: { joinedLoopAt: 'desc' },
      }),
      prisma.loopInviteCode.findMany({
        where: { ownerId: userId, kind: 'personal', status: 'sent' },
        orderBy: { createdAt: 'desc' },
      }),
      countInvitesUsed(userId),
      countReach(userId),
    ]);

    const networkMembers = await loadLoopNetwork(joinedMembers.map((m) => m.userId));
    const network = networkMembers.map((m) => {
      const name = firstNameOf(m.user);
      return {
        id: m.userId,
        inviterId: m.inviterId as string,
        depth: m.depth,
        name,
        initials: initialsFor(name),
        joinedAt: m.joinedLoopAt ?? m.createdAt,
        area: m.latitude !== null && m.longitude !== null ? { latitude: m.latitude, longitude: m.longitude } : null,
      };
    });

    const drop = member.rootDropId
      ? await prisma.loopDrop.findUnique({
          where: { id: member.rootDropId },
          include: { codes: { where: { kind: 'seed' }, select: { uses: true } } },
        })
      : null;
    const [dropReach, dropHost] = drop
      ? await Promise.all([
          prisma.loopMember.count({ where: { rootDropId: drop.id } }),
          prisma.user.findUnique({ where: { id: drop.hostUserId }, select: { firstName: true, name: true } }),
        ])
      : [0, null];

    const joined = joinedMembers.map((m) => {
      const name = displayName(m.user);
      const area = m.latitude !== null && m.longitude !== null ? { latitude: m.latitude, longitude: m.longitude } : null;
      return {
        id: m.userId,
        name,
        initials: initialsFor(name),
        status: 'joined' as const,
        channel: null,
        invitedAt: m.joinedLoopAt ?? m.createdAt,
        joinedAt: m.joinedLoopAt ?? m.createdAt,
        area,
        distanceMiles: m.distanceMiles,
        withinRadius: m.withinRadius,
        branches: network.flatMap((n) => (n.inviterId === m.userId && n.area ? [n.area] : [])),
      };
    });

    const pending = pendingCodes.map((c) => ({
      id: c.code,
      name: null,
      initials: null,
      status: 'pending' as const,
      channel: c.channel,
      invitedAt: c.createdAt,
      joinedAt: null,
      area: null,
      distanceMiles: null,
      withinRadius: null,
      branches: [],
    }));

    res.status(200).json({
      userId,
      areaName: member.areaName,
      origin: { latitude: member.latitude, longitude: member.longitude },
      radiusMiles: LOOP_RADIUS_MILES,
      invitesLimit: LOOP_INVITES_PER_USER,
      invitesUsed,
      loopSize: joinedMembers.filter((m) => m.withinRadius).length,
      reach,
      rewardsEligible: member.rewardsEligible,
      rewardsId: member.rewardsId,
      drop: drop
        ? {
            id: drop.id,
            name: drop.name,
            hostName: dropHost ? firstNameOf(dropHost) : 'A neighbour',
            isHost: drop.hostUserId === userId,
            areaName: drop.areaName,
            maxUses: drop.maxUses,
            uses: drop.codes.reduce((sum, c) => sum + c.uses, 0),
            reach: dropReach,
          }
        : null,
      neighbours: [...joined, ...pending],
      network,
    });
  } catch (error) {
    console.error('Error loading loop:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/loop/invites — reserve one of the caller's 20 invites
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/loop/invites:
 *   post:
 *     summary: Create a personal loop invite
 *     description: >
 *       Uses one of the caller's 20 lifetime invites and returns a single-use code and link.
 *       The app sends the link from the user's own phone (SMS, email, WhatsApp or share
 *       sheet), so no recipient details are sent to or stored by Loopa. If the user cancels
 *       before sending, the app calls DELETE /api/loop/invites/{code} to hand the invite back.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [channel]
 *             properties:
 *               channel:
 *                 type: string
 *                 enum: [sms, email, whatsapp, share]
 *     responses:
 *       201:
 *         description: "{ code, link, channel }"
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: NO_INVITES_LEFT — all 20 invites used
 *       409:
 *         description: AREA_REQUIRED, or TRY_AGAIN when two invites raced for the last slot
 *       429:
 *         description: Too many invites in the last hour
 */
router.post('/invites', authenticateToken, inviteLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    validationError(res, parsed.error);
    return;
  }

  try {
    const member = await prisma.loopMember.findUnique({ where: { userId }, select: { latitude: true } });
    if (!member || member.latitude === null) {
      res.status(409).json({ error: 'AREA_REQUIRED', message: 'Set your neighbourhood before inviting neighbours.' });
      return;
    }

    // Serializable so two taps at 19/20 can't both pass the count and land on 21.
    const invite = await prisma.$transaction(
      async (tx) => {
        const used = await tx.loopInviteCode.count({
          where: { ownerId: userId, kind: 'personal', status: { in: ['sent', 'redeemed'] } },
        });
        if (used >= LOOP_INVITES_PER_USER) return null;
        return tx.loopInviteCode.create({
          data: { code: generateLoopCode(), kind: 'personal', ownerId: userId, channel: parsed.data.channel },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (!invite) {
      res.status(403).json({
        error: 'NO_INVITES_LEFT',
        message: `You've used all ${LOOP_INVITES_PER_USER} of your invites.`,
      });
      return;
    }

    res.status(201).json({ code: invite.code, link: loopInviteLink(invite.code), channel: invite.channel });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      res.status(409).json({ error: 'TRY_AGAIN', message: 'That invite clashed with another. Please try again.' });
      return;
    }
    console.error('Error creating loop invite:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/loop/invites/:code — hand back an unsent invite
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/loop/invites/{code}:
 *   delete:
 *     summary: Cancel an unused loop invite
 *     description: Returns the invite to the caller's allowance. Redeemed invites can't be cancelled.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Invite cancelled
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Invite not found or already redeemed
 */
router.delete('/invites/:code', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const code = normaliseLoopCode(req.params.code as string);
  if (!code) {
    res.status(404).json({ error: 'INVITE_NOT_FOUND', message: 'Invite not found' });
    return;
  }

  try {
    const result = await prisma.loopInviteCode.updateMany({
      where: { code, ownerId: userId, kind: 'personal', status: 'sent' },
      data: { status: 'cancelled' },
    });
    if (result.count === 0) {
      res.status(404).json({ error: 'INVITE_NOT_FOUND', message: 'Invite not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error cancelling loop invite:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/loop/codes/:code — public invite preview
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/loop/codes/{code}:
 *   get:
 *     summary: Preview a loop invite code
 *     description: >
 *       Public. Tells the invite landing screen whether a code is open, full (a seed drop with
 *       all spots claimed), used, or invalid. Only the inviter's first name is returned.
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "{ code, kind, status, inviterName, areaName, dropName, maxUses, uses }"
 *       429:
 *         description: Too many lookups
 */
router.get('/codes/:code', codeLookupLimiter, async (req: Request, res: Response): Promise<void> => {
  const code = normaliseLoopCode(req.params.code as string) ?? '';
  const invalid = {
    code,
    kind: 'personal',
    status: 'invalid',
    inviterName: null,
    areaName: null,
    dropName: null,
    maxUses: 1,
    uses: 0,
  };

  if (!code) {
    res.status(200).json(invalid);
    return;
  }

  try {
    const invite = await prisma.loopInviteCode.findUnique({
      where: { code },
      include: {
        owner: { select: { firstName: true, name: true, loopMember: { select: { areaName: true } } } },
        drop: { select: { name: true, areaName: true } },
      },
    });

    if (!invite || invite.status === 'cancelled') {
      res.status(200).json(invalid);
      return;
    }

    const spent = invite.uses >= invite.maxUses;
    res.status(200).json({
      code,
      kind: invite.kind,
      status: !spent ? 'open' : invite.kind === 'seed' ? 'full' : 'used',
      inviterName: firstNameOf(invite.owner),
      areaName: invite.drop?.areaName ?? invite.owner.loopMember?.areaName ?? null,
      dropName: invite.drop?.name ?? null,
      maxUses: invite.maxUses,
      uses: invite.uses,
    });
  } catch (error) {
    console.error('Error loading loop code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/loop/codes/:code/redeem — join a loop
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/loop/codes/{code}/redeem:
 *   post:
 *     summary: Join a loop with an invite code
 *     description: >
 *       Claims a spot on the code (atomically — a 100-spot drop never admits a 101st) and adds
 *       the caller to the inviter's loop. The caller's neighbourhood is compared with the
 *       inviter's (or the drop's area for seed codes); joiners more than 15 miles away still
 *       join Loopa but don't grow the loop. A user can only join one loop.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude, areaName]
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               areaName: { type: string }
 *     responses:
 *       200:
 *         description: "{ inviterId, withinRadius, distanceMiles, depth }"
 *       400:
 *         description: Validation error, or OWN_INVITE
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: INVITE_NOT_FOUND
 *       409:
 *         description: ALREADY_IN_LOOP, DROP_FULL or INVITE_USED
 */
router.post('/codes/:code/redeem', authenticateToken, codeLookupLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const code = normaliseLoopCode(req.params.code as string);
  if (!code) {
    res.status(404).json({ error: 'INVITE_NOT_FOUND', message: "We couldn't find that invite." });
    return;
  }

  const parsed = areaSchema.safeParse(req.body);
  if (!parsed.success) {
    validationError(res, parsed.error);
    return;
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.loopMember.findUnique({ where: { userId } });
      if (existing?.invitedByCode || existing?.rootDropId) return { error: 'ALREADY_IN_LOOP' as const };

      const invite = await tx.loopInviteCode.findUnique({ where: { code }, include: { drop: true } });
      if (!invite || invite.status === 'cancelled') return { error: 'INVITE_NOT_FOUND' as const };
      if (invite.ownerId === userId) return { error: 'OWN_INVITE' as const };

      const now = new Date();
      const claimed = await tx.loopInviteCode.updateMany({
        where: { code, status: { not: 'cancelled' }, uses: { lt: prisma.loopInviteCode.fields.maxUses } },
        data: {
          uses: { increment: 1 },
          ...(invite.kind === 'personal' ? { status: 'redeemed', redeemedByUserId: userId, redeemedAt: now } : {}),
        },
      });
      if (claimed.count === 0) return { error: invite.kind === 'seed' ? ('DROP_FULL' as const) : ('INVITE_USED' as const) };

      const inviter = await tx.loopMember.findUnique({ where: { userId: invite.ownerId } });
      const anchor =
        invite.drop ??
        (inviter?.latitude != null && inviter.longitude != null
          ? { latitude: inviter.latitude, longitude: inviter.longitude }
          : null);
      const area = snapToGrid(parsed.data);
      const distanceMiles = anchor ? round1(milesBetween(anchor, area)) : null;
      const withinRadius = distanceMiles === null ? null : distanceMiles <= LOOP_RADIUS_MILES;
      const depth = (inviter?.depth ?? 0) + 1;

      const loopFields = {
        areaName: parsed.data.areaName,
        ...area,
        inviterId: invite.ownerId,
        invitedByCode: code,
        rootDropId: invite.dropId ?? inviter?.rootDropId ?? null,
        depth,
        distanceMiles,
        withinRadius,
        joinedLoopAt: now,
      };
      await tx.loopMember.upsert({
        where: { userId },
        create: { userId, ...loopFields },
        update: loopFields,
      });

      return { inviterId: invite.ownerId, withinRadius, distanceMiles, depth };
    });

    if (outcome.error) {
      const responses = {
        ALREADY_IN_LOOP: [409, "You're already part of a loop."],
        INVITE_NOT_FOUND: [404, "We couldn't find that invite."],
        OWN_INVITE: [400, "That's your own invite — send it to a neighbour."],
        DROP_FULL: [409, 'This drop is full. Ask a neighbour on Loopa for an invite.'],
        INVITE_USED: [409, "This invite's already been used. Ask your neighbour for a fresh one."],
      } as const;
      const [status, message] = responses[outcome.error];
      res.status(status).json({ error: outcome.error, message });
      return;
    }

    res.status(200).json(outcome);
  } catch (error) {
    console.error('Error redeeming loop code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/loop/drops — create an influencer drop (service only)
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/loop/drops:
 *   post:
 *     summary: Create a loop drop with a seed code (service only)
 *     description: >
 *       Creates a drop hosted by an existing user (e.g. a local influencer) and a public seed
 *       code with `maxUses` spots (default 100). The host becomes the root of the drop's loop.
 *       Requires the x-api-key service token.
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, hostUserId, latitude, longitude, areaName]
 *             properties:
 *               name: { type: string, example: Rocklin drop }
 *               hostUserId: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               areaName: { type: string }
 *               maxUses: { type: integer, default: 100 }
 *               code: { type: string, description: Optional custom seed code, e.g. MAYAMAKES }
 *     responses:
 *       201:
 *         description: "{ drop, code, link }"
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid or missing API key
 *       404:
 *         description: Host user not found
 *       409:
 *         description: CODE_TAKEN, or the host already belongs to a loop
 */
router.post('/drops', authenticateApiKey, async (req: Request, res: Response): Promise<void> => {
  const parsed = createDropSchema.safeParse(req.body);
  if (!parsed.success) {
    validationError(res, parsed.error);
    return;
  }

  const { name, hostUserId, maxUses, latitude, longitude, areaName } = parsed.data;
  const code = parsed.data.code ? normaliseLoopCode(parsed.data.code) : generateLoopCode();
  if (!code) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Codes use letters and numbers only' });
    return;
  }

  try {
    const host = await prisma.user.findUnique({ where: { id: hostUserId }, select: { id: true } });
    if (!host) {
      res.status(404).json({ error: 'NOT_FOUND', message: `User ${hostUserId} not found` });
      return;
    }

    const area = snapToGrid({ latitude, longitude });
    const created = await prisma.$transaction(async (tx) => {
      const hostMember = await tx.loopMember.findUnique({ where: { userId: hostUserId } });
      if (hostMember?.invitedByCode || hostMember?.rootDropId) return null;

      const drop = await tx.loopDrop.create({ data: { name, hostUserId, areaName, ...area, maxUses } });
      await tx.loopInviteCode.create({ data: { code, kind: 'seed', ownerId: hostUserId, dropId: drop.id, maxUses } });
      await tx.loopMember.upsert({
        where: { userId: hostUserId },
        create: { userId: hostUserId, areaName, ...area, rootDropId: drop.id, depth: 0, joinedLoopAt: new Date() },
        update: { areaName, ...area, rootDropId: drop.id, depth: 0, joinedLoopAt: new Date() },
      });
      return drop;
    });

    if (!created) {
      res.status(409).json({ error: 'HOST_IN_LOOP', message: 'This host already belongs to a loop.' });
      return;
    }

    res.status(201).json({ drop: created, code, link: loopInviteLink(code) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: 'CODE_TAKEN', message: `The code ${code} is already in use.` });
      return;
    }
    console.error('Error creating loop drop:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
