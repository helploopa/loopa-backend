import { randomInt } from 'crypto';
import { prisma } from '../context';

export const LOOP_INVITES_PER_USER = 20;
export const LOOP_RADIUS_MILES = 15;
export const LOOP_SEED_CODE_MAX_USES = 100;
export const LOOP_INVITE_CHANNELS = ['sms', 'email', 'whatsapp', 'share'] as const;

// Reach walks the invite tree level by level; these caps keep one request bounded even if a
// drop goes viral.
const MAX_REACH_DEPTH = 12;
const MAX_REACH_NODES = 50_000;
// The network is drawn node by node on the map, so it's capped far lower than reach.
const MAX_NETWORK_NODES = 500;

const APP_URL = (process.env.APP_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const EARTH_RADIUS_MILES = 3958.8;

export interface LoopPoint {
  latitude: number;
  longitude: number;
}

export interface LoopArea extends LoopPoint {
  areaName: string;
}

// Two decimal places is a ~0.7 mile grid: precise enough to draw a neighbourhood, too coarse
// to locate a home.
export function snapToGrid(point: LoopPoint): LoopPoint {
  return {
    latitude: Math.round(point.latitude * 100) / 100,
    longitude: Math.round(point.longitude * 100) / 100,
  };
}

export function milesBetween(a: LoopPoint, b: LoopPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

export function generateLoopCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function normaliseLoopCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,32}$/.test(code) ? code : null;
}

export function loopInviteLink(code: string): string {
  return `${APP_URL}/loop/${code}`;
}

export function displayName(user: { firstName: string | null; lastName: string | null; name: string | null }): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || 'Neighbour';
  return full.trim();
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Only the first name leaves the server on public endpoints, so an invite link never
// exposes the inviter's full name.
export function firstNameOf(user: { firstName: string | null; name: string | null }): string {
  return (user.firstName ?? user.name ?? 'A neighbour').trim().split(/\s+/)[0];
}

export async function upsertMemberArea(userId: string, area: LoopArea) {
  const snapped = snapToGrid(area);
  return prisma.loopMember.upsert({
    where: { userId },
    create: { userId, areaName: area.areaName, ...snapped },
    update: { areaName: area.areaName, ...snapped },
  });
}

export async function countInvitesUsed(userId: string): Promise<number> {
  return prisma.loopInviteCode.count({
    where: { ownerId: userId, kind: 'personal', status: { in: ['sent', 'redeemed'] } },
  });
}

// Everyone below the caller's direct invites, level by level (depth 2 = invited by a
// neighbour the caller invited). Only first names are loaded — the caller never invited
// these people themselves.
export async function loadLoopNetwork(directInviteeIds: string[]) {
  const loadLevel = (inviterIds: string[], take: number) =>
    prisma.loopMember.findMany({
      where: { inviterId: { in: inviterIds }, withinRadius: true },
      include: { user: { select: { firstName: true, name: true } } },
      orderBy: { joinedLoopAt: 'asc' },
      take,
    });

  const network: (Awaited<ReturnType<typeof loadLevel>>[number] & { depth: number })[] = [];
  let frontier = directInviteeIds;
  for (let depth = 2; depth <= MAX_REACH_DEPTH && frontier.length > 0 && network.length < MAX_NETWORK_NODES; depth++) {
    const children = await loadLevel(frontier, MAX_NETWORK_NODES - network.length);
    network.push(...children.map((member) => ({ ...member, depth })));
    frontier = children.map((c) => c.userId);
  }
  return network;
}

export async function countReach(userId: string): Promise<number> {
  let frontier = [userId];
  let reach = 0;
  for (let depth = 0; depth < MAX_REACH_DEPTH && frontier.length > 0 && reach < MAX_REACH_NODES; depth++) {
    const children = await prisma.loopMember.findMany({
      where: { inviterId: { in: frontier }, withinRadius: true },
      select: { userId: true },
    });
    reach += children.length;
    frontier = children.map((c) => c.userId);
  }
  return Math.min(reach, MAX_REACH_NODES);
}
