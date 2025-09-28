import 'dotenv/config';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import cron from 'node-cron';
import archiver from 'archiver';
import readline from 'node:readline';
import { loadSettings, saveSettings } from './state.js';
import { logger } from './logger.js';
import { InboundSMTP } from './smtp.js';
import { SettingsSchema, type Settings } from './types.js';
import { generateRecords } from './dns/generate.js';
import { checkAll } from './dns/check.js';
import { buildMtaStsPolicy } from './mta-sts.js';
import { findZoneId, upsertRecords } from './dns/providers/cloudflare.js';
import { renderArtifacts } from './dns/artifacts.js';
import { PrismaClient } from './generated/prisma/index.js';
import { accountExists, createAccount, verifyAccount, regenToken, verifyToken } from './auth.js';

const prisma = new PrismaClient();

// Prompt for inbox password if not set
if (!process.env.INBOX_PASSWORD) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>(resolve => {
    rl.question('Enter inbox password: ', (password) => {
      process.env.INBOX_PASSWORD = password.trim();
      rl.close();
      resolve();
    });
  });
}

const app = Fastify({ logger, bodyLimit: 256 * 1024 });

// Security headers: keep CSP off to avoid breaking dev/Vite, but enable other protections
await app.register(helmet, {
  contentSecurityPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
  xssFilter: true,
  noSniff: true,
  hsts: process.env.MODE === 'prod' ? { maxAge: 15552000 } : false // 180 days in prod only
});

// Basic rate limiting (per IP)
await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });

// CORS: restrict to configured origin; allow localhost in dev
const frontendOrigin = process.env.FRONTEND_ORIGIN
  || (process.env.MODE === 'dev' ? 'http://localhost:5174' : undefined);
await app.register(cors, {
  origin: frontendOrigin ? [frontendOrigin] : false,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
  credentials: false
});

// Serve built panel when available (in dev, vite serves it separately)
const panelDir = path.resolve(process.env.PANEL_STATIC_DIR || '../web/dist');
if (fs.existsSync(panelDir)) {
  await app.register(fastifyStatic, { root: panelDir, prefix: '/', decorateReply: false });
}

let settings = loadSettings();
const smtp = new InboundSMTP(settings);

function applyModeEnv() {
  if (settings.mode === 'dev') process.env.NODE_ENV = 'development';
  else process.env.NODE_ENV = 'production';
}

applyModeEnv();
smtp.listen();

// Optional UI IP allowlist (comma-separated IPv4/IPv6 exact matches)
const allowIps = (process.env.ADMIN_UI_ALLOW_IPS || '').split(',').map(s=>s.trim()).filter(Boolean);
if (allowIps.length) {
  app.addHook('onRequest', (req, res, done) => {
    try {
      // Only gate non-API paths (UI assets)
      if (req.url.startsWith('/api')) return done();
      const ip = (req.ip || '').trim();
      if (allowIps.includes(ip)) return done();
      return res.code(403).send({ error: 'Forbidden' });
    } catch { return res.code(403).send({ error: 'Forbidden' }); }
  });
}

// Redact Cloudflare token when reading settings
app.get('/api/settings', async () => {
  const redacted = JSON.parse(JSON.stringify(settings));
  if (redacted?.dns?.cloudflare?.apiToken) {
    redacted.dns.cloudflare.apiToken = '__REDACTED__';
  }
  return redacted;
});

// Simple health endpoint
app.get('/health', async (_req, res) => {
  res.send({ ok: true, mode: settings.mode });
});

// Account management and inbox endpoints
// If no account exists, clients must call /api/account/create to make one.
app.get('/api/account/status', async () => ({ exists: accountExists() }));

app.post('/api/account/create', async (req, res) => {
  if (accountExists()) return res.code(409).send({ error: 'Account exists' });
  const body = (req.body || {}) as any;
  if (!body.username || !body.password) return res.code(400).send({ error: 'username+password required' });
  const created = createAccount(body.username, body.password);
  return { ok: true, token: created.token };
});

app.post('/api/account/login', async (req, res) => {
  const body = (req.body || {}) as any;
  if (!body.username || !body.password) return res.code(400).send({ error: 'username+password required' });
  if (!verifyAccount(body.username, body.password)) return res.code(401).send({ error: 'Unauthorized' });
  // return a token existing in store by regenerating
  const t = regenToken();
  return { ok: true, token: t?.token };
});

// Inbox endpoints: accept either INBOX_PASSWORD env or master account token
const inboxPassword = process.env.INBOX_PASSWORD;
function inboxAuth(req: any) {
  const h = (req.headers.authorization as string) || '';
  if (h.startsWith('Bearer ')) {
    const token = h.slice(7);
    if (inboxPassword && token === inboxPassword) return true;
    if (verifyToken(token)) return true;
  }
  return false;
}

app.get('/api/inbox', async (req, res) => {
  if (!inboxAuth(req)) return res.code(401).send({ error: 'Unauthorized' });
  const emails = await prisma.email.findMany({ orderBy: { receivedAt: 'desc' }, take: 50 });
  res.send(emails.map(e => ({ ...e, to: JSON.parse(e.to) })));
});

app.get('/api/inbox/:id', async (req, res) => {
  if (!inboxAuth(req)) return res.code(401).send({ error: 'Unauthorized' });
  const id = parseInt((req as any).params.id);
  const email = await prisma.email.findUnique({ where: { id } });
  if (!email) return res.code(404).send({ error: 'Not found' });
  res.send({ ...email, to: JSON.parse(email.to) });
});

// Admin auth: prefer JWT if ADMIN_JWT_SECRET is set, else fall back to ADMIN_TOKEN
async function requireAdmin(req: any, res: any) {
  const expected = process.env.ADMIN_TOKEN;
  const jwtSecret = process.env.ADMIN_JWT_SECRET;
  // In production, some admin credential MUST be configured
  if (settings.mode === 'prod' && !expected && !jwtSecret) {
    return res.code(503).send({ error: 'ADMIN_TOKEN not configured (required in prod)' });
  }
  const h = (req.headers['authorization'] as string) || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (jwtSecret && token && token.split('.').length === 3) {
    try {
      const payload: any = jwt.verify(token, jwtSecret);
      if (payload?.sub === 'admin') return;
    } catch {}
  }
  if (expected && token && token === expected) return;
  return res.code(401).send({ error: 'Unauthorized' });
}

// Optional JWT login: exchange ADMIN_TOKEN for a short-lived JWT
app.post('/api/admin/login', async (req, res) => {
  try {
    const jwtSecret = process.env.ADMIN_JWT_SECRET;
    const expected = process.env.ADMIN_TOKEN;
    if (!jwtSecret || !expected) return res.code(400).send({ error: 'JWT not configured' });
    const body = (req.body || {}) as any;
    const supplied = (body?.token || '').toString();
    if (supplied !== expected) return res.code(401).send({ error: 'Unauthorized' });
    const ttl = parseInt(process.env.ADMIN_JWT_TTL_SECONDS || '900', 10);
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign({ sub: 'admin', iat: now }, jwtSecret, { algorithm: 'HS256', expiresIn: ttl });
    return res.send({ token, exp: now + ttl });
  } catch (e) { return res.code(500).send({ error: 'login failed' }); }
});

app.post('/api/settings', {
  preHandler: requireAdmin,
  config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
}, async (req, res) => {
  const body = await req.body as unknown;
  const parsed = SettingsSchema.safeParse(body);
  if (!parsed.success) return res.status(400).send({ error: parsed.error.flatten() });

  const input = parsed.data;
  const rawToken = input.dns.cloudflare.apiToken?.trim();
  const existingToken = settings?.dns?.cloudflare?.apiToken;
  const keepExistingToken = rawToken === '__REDACTED__' && !!existingToken;
  const ipv4 = input.publicIPv4?.trim();
  const ipv6 = input.publicIPv6?.trim();
  const normalizedRecipients = Array.from(new Set(input.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean)));
  const normalizedZones = Array.from(new Set(input.rbl.zones.map((z) => z.trim().toLowerCase()).filter(Boolean)));
  const normalizeHost = (h: string) => h.trim().replace(/ /g, '').replace(/\.$/, '').toLowerCase();
  const normalizedDomain = normalizeHost(input.domain);
  const normalizedMx = normalizeHost(input.mxHostname);
  // Basic validations beyond zod
  const hostRe = /^(?=.{1,253}$)(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*$/;
  if (!hostRe.test(normalizedDomain) || !hostRe.test(normalizedMx)) {
    return res.status(400).send({ error: 'Invalid domain or mxHostname' });
  }
  const ip4Re = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)(\.(25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/;
  const ip6Re = /^[0-9a-f:]+$/i;
  if (ipv4 && !ip4Re.test(ipv4)) return res.status(400).send({ error: 'Invalid IPv4' });
  if (ipv6 && !ip6Re.test(ipv6)) return res.status(400).send({ error: 'Invalid IPv6' });
  // Ensure recipients belong to domain when provided
  for (const r of normalizedRecipients) if (!r.endsWith(`@${normalizedDomain}`)) {
    return res.status(400).send({ error: 'Recipients must be within domain' });
  }
  const candidate: Settings = {
    ...input,
    domain: normalizedDomain,
    mxHostname: normalizedMx,
    publicIPv4: ipv4 || null,
    publicIPv6: ipv6 || null,
    recipients: normalizedRecipients,
    tlsrptEmail: input.tlsrptEmail.trim().toLowerCase(),
    rbl: {
      enabled: input.rbl.enabled,
      zones: normalizedZones
    },
    greylist: { ...input.greylist },
    policy: { ...input.policy },
    dns: {
      provider: input.dns.provider,
      autoMaintain: input.dns.autoMaintain,
      cloudflare: {
        apiToken: keepExistingToken ? existingToken : (rawToken && rawToken !== '__REDACTED__' ? rawToken : undefined),
        accountId: input.dns.cloudflare.accountId?.trim() || undefined
      }
    }
  };
  const validation = SettingsSchema.safeParse(candidate);
  if (!validation.success) return res.status(400).send({ error: validation.error.flatten() });
  const next = validation.data;
  settings = next;
  saveSettings(settings);
  applyModeEnv();
  await smtp.close();
  smtp.setSettings(settings);
  smtp.listen();
  return { ok: true };
});

app.get('/api/dns/preview', async () => {
  return generateRecords(settings);
});

app.get('/api/dns/status', async () => {
  const recs = generateRecords(settings);
  const status = await checkAll(settings.domain, recs);
  return status;
});

// NEW: Downloadable DNS Artifact Pack (.zip)
app.get('/api/dns/artifacts.zip', async (req, reply) => {
  const files = renderArtifacts(settings);
  reply
    .header('Content-Type', 'application/zip')
    .header('Content-Disposition', 'attachment; filename="dns-artifacts.zip"');
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.pipe(reply.raw);
  for (const [name, content] of Object.entries(files)) {
    zip.append(content as any, { name });
  }
  await zip.finalize();
  // Tell Fastify we're streaming manually
  reply.hijack();
});

// Optional: apply via Cloudflare (still available, but manual is default)
app.post('/api/dns/apply', {
  preHandler: requireAdmin,
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
}, async () => {
  if (settings.dns.provider !== 'cloudflare') return { ok: false, error: 'Manual mode: use artifact pack.' };
  const token = settings.dns.cloudflare.apiToken;
  if (!token) return { ok: false, error: 'Cloudflare token missing.' };
  const zoneId = await findZoneId(token, settings.domain);
  const recs = generateRecords(settings);
  const results = await upsertRecords(token, zoneId, settings.domain, recs);
  return { ok: true, results };
});

// MTA-STS policy served here; ensure DNS points mta-sts.<domain> to this host
app.get('/.well-known/mta-sts.txt', async (req, res) => {
  const txt = buildMtaStsPolicy(settings);
  res.header('Cache-Control', 'max-age=86400, public');
  res.type('text/plain').send(txt);
});

// background DNS maintainer (every 10 minutes)
cron.schedule('*/10 * * * *', async () => {
  try {
    if (!settings.dns.autoMaintain) return;
    if (settings.dns.provider !== 'cloudflare') return;
    const token = settings.dns.cloudflare.apiToken; if (!token) return;
    const zoneId = await findZoneId(token, settings.domain);
    const recs = generateRecords(settings);
    await upsertRecords(token, zoneId, settings.domain, recs);
    logger.info('DNS auto-maintain pass complete');
  } catch (e) { logger.warn({ e }, 'auto-maintain failed'); }
});

const apiPort = parseInt(process.env.API_PORT || '4000', 10);
const apiHost = (settings.mode === 'dev') ? (process.env.API_HOST_DEV || '127.0.0.1') : (process.env.API_HOST_PROD || '0.0.0.0');
app.listen({ port: apiPort, host: apiHost }).then(() => logger.info({ apiPort, apiHost }, 'API listening'));

// global not found
app.setNotFoundHandler((_req, res) => res.code(404).send({ error: 'Not Found' }));

// Informational root for convenience: point devs to the frontend URL
app.get('/', async (_req, res) => {
  const frontend = process.env.FRONTEND_ORIGIN || (process.env.MODE === 'dev' ? 'http://localhost:5174' : undefined);
  if (frontend) {
    return res.type('text/html').send(`<html><body><h3>InboundMail API</h3><p>Frontend: <a href="${frontend}">${frontend}</a></p></body></html>`);
  }
  return res.type('text/html').send('<html><body><h3>InboundMail API</h3><p>Frontend not configured; build and set PANEL_STATIC_DIR to serve static files from this API.</p></body></html>');
});
