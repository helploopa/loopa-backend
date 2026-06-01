import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../context';
import { authenticateToken } from '../middleware/auth';
import { geocodeAddress } from '../services/geocodingService';

const router = Router();

const MAX_PICKUP_ADDRESSES = 3;

// ── Zod schema ────────────────────────────────────────────────────────────────

const baseAddressFields = z.object({
  type: z.enum(['business', 'pickup']),
  label: z.string().max(100).optional(),
  street: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zipcode: z.string().max(20).optional(),
  country: z.string().max(100).default('US'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// No lat/lng refinement here — the route handler auto-geocodes when they are absent,
// and returns GEOCODE_FAILED if the address cannot be resolved.
const addressSchema = baseAddressFields;

const patchSchema = baseAddressFields.partial().omit({ type: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUserId(req: Request): string | null {
  return (req.user as any)?.userId ?? null;
}

async function assertOwner(
  sellerId: string,
  userId: string,
): Promise<{ ok: true; sellerId: string } | { ok: false; status: number; error: string; message: string }> {
  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller) return { ok: false, status: 404, error: 'NOT_FOUND', message: `Seller ${sellerId} not found` };
  if (seller.userId !== userId) return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Access denied' };
  return { ok: true, sellerId: seller.id };
}

// When a pickup address is set as default, clear the flag on all others first.
async function clearOtherDefaults(sellerId: string, excludeId?: string) {
  await prisma.sellerAddress.updateMany({
    where: {
      sellerId,
      type: 'pickup',
      isDefault: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    data: { isDefault: false },
  });
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/addresses/geocode
// Resolve an address string to lat/lng without saving anything
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/addresses/geocode:
 *   post:
 *     summary: Geocode an address to lat/lng (does not save)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               street: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               zipcode: { type: string }
 *               country: { type: string }
 *     responses:
 *       200:
 *         description: Resolved coordinates and formatted address
 */
router.post('/geocode', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { street, city, state, zipcode, country } = req.body as Record<string, string | undefined>;
  try {
    const result = await geocodeAddress({ street, city, state, zipcode, country });
    res.status(200).json(result);
  } catch {
    res.status(422).json({ error: 'INVALID_ADDRESS', message: 'The address could not be verified. Please check the street, city, state, and zip code and try again.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/addresses/sellers/:sellerId
// List all addresses for a seller (optionally filter by ?type=pickup|business)
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/addresses/sellers/{sellerId}:
 *   get:
 *     summary: List all addresses for a seller
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [business, pickup] }
 *     responses:
 *       200:
 *         description: Array of addresses
 */
router.get('/sellers/:sellerId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const check = await assertOwner(req.params.sellerId as string, userId);
  if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

  const { type } = req.query as { type?: string };

  const addresses = await prisma.sellerAddress.findMany({
    where: {
      sellerId: check.sellerId,
      ...(type ? { type } : {}),
    },
    orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
  });

  res.status(200).json(addresses);
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/addresses/sellers/:sellerId
// Create a new address (max 3 pickup addresses enforced)
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/addresses/sellers/{sellerId}:
 *   post:
 *     summary: Add an address (max 3 pickup addresses per seller)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, latitude, longitude]
 *             properties:
 *               type: { type: string, enum: [business, pickup] }
 *               label: { type: string }
 *               street: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               zipcode: { type: string }
 *               country: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               isDefault: { type: boolean }
 *     responses:
 *       201:
 *         description: Created address
 */
router.post('/sellers/:sellerId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const check = await assertOwner(req.params.sellerId as string, userId);
  if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

  const parsed = addressSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({ error: 'VALIDATION_ERROR', message: first.message });
    return;
  }

  const data = parsed.data;

  if (data.type === 'pickup') {
    const pickupCount = await prisma.sellerAddress.count({
      where: { sellerId: check.sellerId, type: 'pickup' },
    });
    if (pickupCount >= MAX_PICKUP_ADDRESSES) {
      res.status(422).json({
        error: 'LIMIT_EXCEEDED',
        message: `Maximum ${MAX_PICKUP_ADDRESSES} pickup addresses allowed. Remove one before adding another.`,
      });
      return;
    }
  }

  // Resolve lat/lng — geocode when not supplied, reject if address cannot be found
  let latitude = data.latitude;
  let longitude = data.longitude;

  if (latitude === undefined || longitude === undefined) {
    try {
      const geo = await geocodeAddress({
        street: data.street, city: data.city,
        state: data.state, zipcode: data.zipcode, country: data.country,
      });
      latitude = geo.lat;
      longitude = geo.lng;
    } catch {
      res.status(422).json({
        error: 'INVALID_ADDRESS',
        message: 'The address could not be verified. Please check the street, city, state, and zip code and try again.',
      });
      return;
    }
  }

  // Auto-set as default if it's the first pickup address or explicitly requested
  const isFirstPickup =
    data.type === 'pickup' &&
    (await prisma.sellerAddress.count({ where: { sellerId: check.sellerId, type: 'pickup' } })) === 0;

  const shouldBeDefault = data.type === 'pickup' && (data.isDefault === true || isFirstPickup);

  if (shouldBeDefault) {
    await clearOtherDefaults(check.sellerId);
  }

  const address = await prisma.sellerAddress.create({
    data: {
      sellerId: check.sellerId,
      type: data.type,
      label: data.label ?? null,
      street: data.street ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      zipcode: data.zipcode ?? null,
      country: data.country,
      latitude,
      longitude,
      isDefault: shouldBeDefault,
      isActive: data.isActive ?? true,
    },
  });

  res.status(201).json(address);
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/addresses/:id
// Get a single address
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/addresses/{id}:
 *   get:
 *     summary: Get a single address
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Address record
 */
router.get('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const address = await prisma.sellerAddress.findUnique({ where: { id: req.params.id as string } });
  if (!address) { res.status(404).json({ error: 'NOT_FOUND', message: 'Address not found' }); return; }

  const check = await assertOwner(address.sellerId, userId);
  if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

  res.status(200).json(address);
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/addresses/:id
// Update an address
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/addresses/{id}:
 *   patch:
 *     summary: Update an address
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated address
 */
router.patch('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const address = await prisma.sellerAddress.findUnique({ where: { id: req.params.id as string } });
  if (!address) { res.status(404).json({ error: 'NOT_FOUND', message: 'Address not found' }); return; }

  const check = await assertOwner(address.sellerId, userId);
  if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({ error: 'VALIDATION_ERROR', message: first.message });
    return;
  }

  const data = parsed.data;

  if (address.type === 'pickup' && data.isDefault === true) {
    await clearOtherDefaults(address.sellerId, address.id);
  }

  const updated = await prisma.sellerAddress.update({
    where: { id: address.id },
    data: {
      ...(data.label !== undefined && { label: data.label }),
      ...(data.street !== undefined && { street: data.street }),
      ...(data.city !== undefined && { city: data.city }),
      ...(data.state !== undefined && { state: data.state }),
      ...(data.zipcode !== undefined && { zipcode: data.zipcode }),
      ...(data.country !== undefined && { country: data.country }),
      ...(data.latitude !== undefined && { latitude: data.latitude }),
      ...(data.longitude !== undefined && { longitude: data.longitude }),
      ...(data.isDefault !== undefined && address.type === 'pickup' && { isDefault: data.isDefault }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });

  res.status(200).json(updated);
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/addresses/:id/set-default
// Set a pickup address as the default
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/addresses/{id}/set-default:
 *   patch:
 *     summary: Set a pickup address as the default
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated address
 */
router.patch('/:id/set-default', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const address = await prisma.sellerAddress.findUnique({ where: { id: req.params.id as string } });
  if (!address) { res.status(404).json({ error: 'NOT_FOUND', message: 'Address not found' }); return; }

  if (address.type !== 'pickup') {
    res.status(422).json({ error: 'INVALID_TYPE', message: 'Only pickup addresses can be set as default' });
    return;
  }

  const check = await assertOwner(address.sellerId, userId);
  if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

  await clearOtherDefaults(address.sellerId, address.id);
  const updated = await prisma.sellerAddress.update({ where: { id: address.id }, data: { isDefault: true } });

  res.status(200).json(updated);
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/addresses/:id/toggle-active
// Toggle isActive flag
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/addresses/{id}/toggle-active:
 *   patch:
 *     summary: Toggle address active status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated address
 */
router.patch('/:id/toggle-active', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const address = await prisma.sellerAddress.findUnique({ where: { id: req.params.id as string } });
  if (!address) { res.status(404).json({ error: 'NOT_FOUND', message: 'Address not found' }); return; }

  const check = await assertOwner(address.sellerId, userId);
  if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

  const updated = await prisma.sellerAddress.update({
    where: { id: address.id },
    data: { isActive: !address.isActive },
  });

  res.status(200).json(updated);
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/addresses/:id
// Delete an address. If it was the default pickup address, promote the next one.
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/addresses/{id}:
 *   delete:
 *     summary: Delete an address
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted successfully
 */
router.delete('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const address = await prisma.sellerAddress.findUnique({ where: { id: req.params.id as string } });
  if (!address) { res.status(404).json({ error: 'NOT_FOUND', message: 'Address not found' }); return; }

  const check = await assertOwner(address.sellerId, userId);
  if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

  await prisma.sellerAddress.delete({ where: { id: address.id } });

  // Auto-promote the next pickup address to default if the deleted one was default
  if (address.type === 'pickup' && address.isDefault) {
    const next = await prisma.sellerAddress.findFirst({
      where: { sellerId: address.sellerId, type: 'pickup', isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (next) {
      await prisma.sellerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }

  res.status(200).json({ message: 'Address deleted successfully' });
});

export default router;
