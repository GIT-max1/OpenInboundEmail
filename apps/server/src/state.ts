import fs from 'node:fs';
import path from 'node:path';
import { Settings, SettingsSchema } from './types.js';

const DATA = path.resolve('./data');
const STATE_PATH = path.join(DATA, 'state.json');

const defaults: Settings = {
  mode: (process.env.MODE as 'dev'|'prod') || 'dev',
  domain: process.env.DOMAIN || 'example.com',
  mxHostname: process.env.SMTP_HOSTNAME || 'mx1.example.com',
  publicIPv4: process.env.PUBLIC_IPV4 || null,
  publicIPv6: process.env.PUBLIC_IPV6 || null,
  recipients: ['info@example.com'],
  rbl: { enabled: (process.env.ENABLE_RBL||'true')==='true', zones: (process.env.RBL_ZONES||'').split(',').filter(Boolean) },
  greylist: { enabled: (process.env.ENABLE_GREYLIST||'true')==='true', minDelaySec: parseInt(process.env.GREYLIST_MIN_DELAY||'60', 10), ttlSec: parseInt(process.env.GREYLIST_TTL||'86400', 10) },
  policy: { requireDMARC: (process.env.REQUIRE_DMARC||'false')==='true' },
  dns: {
    provider: (process.env.DNS_PROVIDER as 'manual'|'cloudflare') || 'manual',
    autoMaintain: (process.env.AUTO_MAINTAIN_DNS||'true')==='true',
    cloudflare: { apiToken: process.env.CF_API_TOKEN, accountId: process.env.CF_ACCOUNT_ID }
  },
  tlsrptEmail: process.env.TLSRPT_EMAIL || 'tlsrpt@example.com',
  mtaStsMode: (process.env.MTA_STS_MODE as any) || 'enforce'
};

export function ensureDataDir() {
  fs.mkdirSync(DATA, { recursive: true });
}

export function loadSettings(): Settings {
  ensureDataDir();
  if (!fs.existsSync(STATE_PATH)) {
    saveSettings(defaults);
    return defaults;
  }
  const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const res = SettingsSchema.safeParse(parsed);
  if (!res.success) throw new Error('Invalid state.json, fix or delete it.');
  return res.data;
}

export function saveSettings(s: Settings) {
  ensureDataDir();
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}
