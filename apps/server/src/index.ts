import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import cron from 'node-cron';
import archiver from 'archiver';
import { loadSettings, saveSettings } from './state.js';
import { logger } from './logger.js';
import { InboundSMTP } from './smtp.js';
import { SettingsSchema } from './types.js';
import { generateRecords } from './dns/generate.js';
import { checkAll } from './dns/check.js';
import { buildMtaStsPolicy } from './mta-sts.js';
import { findZoneId, upsertRecords } from './dns/providers/cloudflare.js';
import { renderArtifacts } from './dns/artifacts.js';

const app = Fastify({ logger });

// Security headers
await app.register(helmet, { contentSecurityPolicy: false });

// Basic rate limiting (per IP)
await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });

// CORS: tighten to configured origin; allow localhost in dev by default
const frontendOrigin = process.env.FRONTEND_ORIGIN
  || (process.env.MODE === 'dev' ? 'http://localhost:5174' : undefined);
await app.register(cors, { origin: frontendOrigin ? [frontendOrigin] : false });

// Serve built panel when available (in dev, vite serves it separately)
const panelDir = path.resolve(process.env.PANEL_STATIC_DIR || '../web/dist');
if (fs.existsSync(panelDir)) {
  await app.register(fastifyStatic, { root: panelDir, prefix: '/' });
}

let settings = loadSettings();
const smtp = new InboundSMTP(settings);

function applyModeEnv() {
  if (settings.mode === 'dev') process.env.NODE_ENV = 'development';
  else process.env.NODE_ENV = 'production';
}

applyModeEnv();
smtp.listen();

// Redact Cloudflare token when reading settings
app.get('/api/settings', async () => {
  const redacted = JSON.parse(JSON.stringify(settings));
  if (redacted?.dns?.cloudflare?.apiToken) {
    redacted.dns.cloudflare.apiToken = '__REDACTED__';
  }
  return redacted;
});

// Optional Admin token protection for mutating endpoints
function requireAdmin(req: any, res: any, done: any) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return done(); // not enforced when unset
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token && token === expected) return done();
  res.code(401).send({ error: 'Unauthorized' });
}

app.post('/api/settings', { preHandler: requireAdmin }, async (req, res) => {
  const body = await req.body as unknown;
  const parsed = SettingsSchema.safeParse(body);
  if (!parsed.success) return res.status(400).send({ error: parsed.error.flatten() });

  // Preserve secret if client sent a redacted sentinel
  const next = parsed.data as any;
  if (next?.dns?.cloudflare?.apiToken === '__REDACTED__' && settings?.dns?.cloudflare?.apiToken) {
    next.dns.cloudflare.apiToken = settings.dns.cloudflare.apiToken;
  }
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
app.post('/api/dns/apply', { preHandler: requireAdmin }, async () => {
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
