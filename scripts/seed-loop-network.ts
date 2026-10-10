/**
 * Seeds a "Your loop" invite tree through the real HTTP API, the same way the app does it:
 *
 *   inviter: POST /api/loop/invites            → single-use code
 *   invitee: POST /auth/register, /auth/login  → new neighbour
 *   invitee: POST /api/loop/codes/:code/redeem → joins the inviter's loop
 *
 * Every neighbour then invites 2-3 more, down to --depth levels. All of them sit in the same
 * zipcode, so every join is within the loop radius and counts towards loop size and reach.
 *
 * Usage (server must be running; start it with SKIP_EMAIL_VERIFICATION=true, or let this
 * script mark the test accounts verified through DATABASE_URL):
 *
 *   npx ts-node --transpile-only scripts/seed-loop-network.ts --zip 95677
 *   npx ts-node --transpile-only scripts/seed-loop-network.ts --zip 95677 --depth 2 \
 *       --root-email me@example.com --root-password 'secret123'
 *   npx ts-node --transpile-only scripts/seed-loop-network.ts --cleanup [--run <runId>]
 *
 * Options:
 *   --api <url>            API base URL (default http://localhost:4000)
 *   --zip <zipcode>        US zipcode every neighbour lives in (default 95677)
 *   --lat/--lng/--area     Skip the zipcode lookup and use this centre + area name instead
 *   --depth <n>            Levels of invites below the root (default 3)
 *   --min <n> --max <n>    Invites each neighbour sends (default 2 and 3)
 *   --root-email/--root-password   Use an existing account as the root instead of a new one
 *   --password <pw>        Password for the created accounts (default LoopaTest123!)
 *   --cleanup              Delete accounts created by this script (all runs, or just --run)
 */
import 'dotenv/config';

const EMAIL_PREFIX = 'loop-test+';
const EMAIL_DOMAIN = 'example.com';
const CHANNELS = ['sms', 'email', 'whatsapp', 'share'] as const;
// ~0.8 miles either way: spreads neighbours over a few grid cells without leaving the zipcode.
const JITTER_DEGREES = 0.012;

const FIRST_NAMES = [
  'Maya', 'Arjun', 'Priya', 'Diego', 'Hannah', 'Omar', 'Lucy', 'Kenji', 'Sofia', 'Noah',
  'Aisha', 'Ethan', 'Chloe', 'Ravi', 'Emma', 'Mateo', 'Zoe', 'Liam', 'Nora', 'Samir',
  'Ivy', 'Caleb', 'Leila', 'Owen', 'Tara', 'Felix', 'Anika', 'Jonah', 'Mina', 'Theo',
];
const LAST_NAMES = [
  'Patel', 'Garcia', 'Nguyen', 'Brooks', 'Khan', 'Rivera', 'Kim', 'Walker', 'Shah', 'Lopez',
  'Bennett', 'Iyer', 'Foster', 'Tanaka', 'Reyes', 'Hughes', 'Menon', 'Carter', 'Silva', 'Ward',
];

interface Area {
  latitude: number;
  longitude: number;
  areaName: string;
}

interface Neighbour {
  id: string;
  name: string;
  email: string;
  token: string;
  depth: number;
  children: Neighbour[];
}

interface ApiResult {
  status: number;
  body: any;
  headers: Headers;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const API_URL = (args.api ?? process.env.LOOP_SEED_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const PASSWORD = args.password ?? 'LoopaTest123!';
const DEPTH = Number(args.depth ?? 3);
const MIN_INVITES = Number(args.min ?? 2);
const MAX_INVITES = Number(args.max ?? 3);
const RUN_ID = args.run ?? Date.now().toString(36);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

function getPrisma() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — needed to verify test accounts or clean them up.');
  }
  // Loaded lazily so a server running with SKIP_EMAIL_VERIFICATION=true needs no database access.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../src/context').prisma as typeof import('../src/context').prisma;
}

async function request(method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<ApiResult> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }).catch(() => {
      throw new Error(`Couldn't reach ${API_URL} — is the server running? (npm run dev, or pass --api <url>)`);
    });

    if (response.status === 429 && attempt === 0) {
      const waitSeconds = Number(response.headers.get('ratelimit-reset') ?? response.headers.get('retry-after') ?? 60);
      console.log(`  … rate limited on ${method} ${path}; waiting ${waitSeconds}s for the window to reset`);
      await sleep((waitSeconds + 1) * 1000);
      continue;
    }

    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    return { status: response.status, body, headers: response.headers };
  }
}

async function call(method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<any> {
  const result = await request(method, path, options);
  if (result.status >= 400) {
    const detail = result.body?.message ?? result.body?.error ?? JSON.stringify(result.body);
    throw new Error(`${method} ${path} → ${result.status}: ${detail}`);
  }
  return result.body;
}

async function resolveArea(): Promise<Area> {
  if (args.lat && args.lng) {
    return { latitude: Number(args.lat), longitude: Number(args.lng), areaName: args.area ?? args.zip ?? 'Test neighbourhood' };
  }

  const zip = args.zip ?? '95677';
  const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&country=US&format=json&limit=1&addressdetails=1`;
  const response = await fetch(url, { headers: { 'User-Agent': 'loopa-backend/1.0' } });
  const results = (await response.json().catch(() => [])) as any[];
  if (!results.length) {
    throw new Error(`Couldn't find zipcode ${zip}. Pass --lat, --lng and --area instead.`);
  }
  const address = results[0].address ?? {};
  return {
    latitude: parseFloat(results[0].lat),
    longitude: parseFloat(results[0].lon),
    areaName: args.area ?? address.city ?? address.town ?? address.village ?? address.county ?? zip,
  };
}

function nearby(centre: Area): Area {
  const jitter = () => (Math.random() * 2 - 1) * JITTER_DEGREES;
  return { ...centre, latitude: centre.latitude + jitter(), longitude: centre.longitude + jitter() };
}

async function login(email: string, password: string): Promise<{ token: string; id: string }> {
  const body = await call('POST', '/auth/login', { body: { email, password } });
  return { token: body.token, id: body.user.id };
}

async function registerNeighbour(index: number, depth: number): Promise<Neighbour> {
  const firstName = FIRST_NAMES[index % FIRST_NAMES.length];
  const lastName = LAST_NAMES[(index * 7 + Math.floor(index / FIRST_NAMES.length)) % LAST_NAMES.length];
  const email = `${EMAIL_PREFIX}${RUN_ID}-${String(index).padStart(3, '0')}@${EMAIL_DOMAIN}`;

  const registered = await call('POST', '/auth/register', { body: { firstName, lastName, email, password: PASSWORD } });
  if (!registered.user.emailVerified) {
    const updated = await getPrisma().user.updateMany({
      where: { id: registered.user.id },
      data: { emailVerified: true, emailVerificationToken: null, emailVerificationTokenExpiry: null },
    });
    if (updated.count === 0) {
      throw new Error(
        `${email} was created on ${API_URL} but isn't in the DATABASE_URL database, so it can't be verified. ` +
          'Start the server with SKIP_EMAIL_VERIFICATION=true or point DATABASE_URL at the same database.',
      );
    }
  }

  const session = await login(email, PASSWORD);
  return { id: session.id, name: `${firstName} ${lastName}`, email, token: session.token, depth, children: [] };
}

async function resolveRoot(centre: Area): Promise<Neighbour> {
  if (!args['root-email']) {
    const root = await registerNeighbour(0, 0);
    await call('GET', `/api/loop/me?${new URLSearchParams({
      latitude: String(centre.latitude),
      longitude: String(centre.longitude),
      areaName: centre.areaName,
    })}`, { token: root.token });
    return root;
  }

  if (!args['root-password']) throw new Error('--root-email needs --root-password');
  const session = await login(args['root-email'], args['root-password']);
  const root: Neighbour = { id: session.id, name: args['root-email'], email: args['root-email'], token: session.token, depth: 0, children: [] };

  // Keep an existing account's neighbourhood; only set one when it has none yet.
  const existing = await request('GET', '/api/loop/me', { token: root.token });
  if (existing.status === 409) {
    await call('GET', `/api/loop/me?${new URLSearchParams({
      latitude: String(centre.latitude),
      longitude: String(centre.longitude),
      areaName: centre.areaName,
    })}`, { token: root.token });
  } else if (existing.status >= 400) {
    throw new Error(`GET /api/loop/me → ${existing.status}: ${JSON.stringify(existing.body)}`);
  } else {
    console.log(`  root already has a loop around ${existing.body.areaName} (${existing.body.invitesUsed}/${existing.body.invitesLimit} invites used)`);
  }
  return root;
}

async function inviteNeighbour(inviter: Neighbour, index: number, centre: Area): Promise<Neighbour> {
  const channel = CHANNELS[index % CHANNELS.length];
  const invite = await call('POST', '/api/loop/invites', { token: inviter.token, body: { channel } });

  const neighbour = await registerNeighbour(index, inviter.depth + 1);
  const joined = await call('POST', `/api/loop/codes/${invite.code}/redeem`, { token: neighbour.token, body: nearby(centre) });
  if (joined.inviterId !== inviter.id || joined.withinRadius !== true) {
    throw new Error(`${neighbour.email} joined with unexpected result: ${JSON.stringify(joined)}`);
  }

  inviter.children.push(neighbour);
  console.log(`  ${'  '.repeat(inviter.depth)}${inviter.name} → ${neighbour.name} (${channel}, code ${invite.code}, ${joined.distanceMiles} mi)`);
  return neighbour;
}

const countDescendants = (n: Neighbour): number => n.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);

function printTree(node: Neighbour, prefix = '', isLast = true, isRoot = true): void {
  console.log(`${isRoot ? '' : prefix + (isLast ? '└─ ' : '├─ ')}${node.name}  <${node.email}>`);
  const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
  node.children.forEach((child, i) => printTree(child, childPrefix, i === node.children.length - 1, false));
}

// For a root that already had a loop, only the neighbours added by this run are compared.
async function verify(all: Neighbour[], rootBaseline: { joined: number; reach: number }): Promise<number> {
  let failures = 0;
  for (const neighbour of all) {
    const loop = await call('GET', '/api/loop/me', { token: neighbour.token });
    const baseline = neighbour.depth === 0 ? rootBaseline : { joined: 0, reach: 0 };
    const joined = loop.neighbours.filter((n: any) => n.status === 'joined').length - baseline.joined;
    const reach = loop.reach - baseline.reach;
    const expectedReach = countDescendants(neighbour);
    if (joined !== neighbour.children.length || reach !== expectedReach) {
      failures++;
      console.log(
        `  ✗ ${neighbour.name}: joined ${joined} (expected ${neighbour.children.length}), reach ${reach} (expected ${expectedReach})`,
      );
    }
  }
  return failures;
}

async function seed(): Promise<void> {
  if (!(MIN_INVITES >= 1 && MAX_INVITES >= MIN_INVITES && MAX_INVITES <= 20 && DEPTH >= 1)) {
    throw new Error('Need --depth >= 1 and 1 <= --min <= --max <= 20');
  }

  const centre = await resolveArea();
  console.log(`API:  ${API_URL}`);
  console.log(`Area: ${centre.areaName} ${args.zip ?? ''} (${centre.latitude.toFixed(4)}, ${centre.longitude.toFixed(4)})`);
  console.log(`Run:  ${RUN_ID} — depth ${DEPTH}, ${MIN_INVITES}-${MAX_INVITES} invites each\n`);

  const root = await resolveRoot(centre);
  const before = await call('GET', '/api/loop/me', { token: root.token });
  const rootBaseline = {
    joined: before.neighbours.filter((n: any) => n.status === 'joined').length,
    reach: before.reach,
  };

  console.log('Inviting neighbours:');
  const all: Neighbour[] = [root];
  let frontier = [root];
  let index = 1;
  for (let level = 0; level < DEPTH; level++) {
    const next: Neighbour[] = [];
    for (const inviter of frontier) {
      const invites = randomInt(MIN_INVITES, MAX_INVITES);
      for (let i = 0; i < invites; i++) {
        next.push(await inviteNeighbour(inviter, index++, centre));
      }
    }
    all.push(...next);
    frontier = next;
  }

  console.log('\nLoop tree:');
  printTree(root);

  console.log('\nChecking every loop against the tree…');
  const failures = await verify(all, rootBaseline);

  console.log(`\n${all.length - 1} neighbours joined across ${DEPTH} levels in ${centre.areaName}.`);
  console.log(`Log in as any of them with password: ${PASSWORD}`);
  console.log(`Root: ${root.email}`);
  console.log(`Remove this run:  npx ts-node --transpile-only scripts/seed-loop-network.ts --cleanup --run ${RUN_ID}`);

  if (failures > 0) {
    throw new Error(`${failures} loop(s) didn't match the invite tree`);
  }
  console.log('✓ Every loop matches the invite tree.');
}

async function cleanup(): Promise<void> {
  const prisma = getPrisma();
  const prefix = args.run ? `${EMAIL_PREFIX}${args.run}-` : EMAIL_PREFIX;
  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix, endsWith: `@${EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) {
    console.log(`No test accounts matching ${prefix}*@${EMAIL_DOMAIN}`);
    return;
  }

  // Codes redeemed by test accounts go too, which hands those invites back to a real root account.
  const [codes, members, deleted] = await prisma.$transaction([
    prisma.loopInviteCode.deleteMany({ where: { OR: [{ ownerId: { in: ids } }, { redeemedByUserId: { in: ids } }] } }),
    prisma.loopMember.deleteMany({ where: { userId: { in: ids } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`Removed ${deleted.count} test accounts, ${members.count} loop members and ${codes.count} invite codes.`);
}

(args.cleanup ? cleanup() : seed())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n✗ ${error.message}`);
    process.exit(1);
  });
