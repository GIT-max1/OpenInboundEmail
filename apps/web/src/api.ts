export type Settings = {
  mode: 'dev'|'prod';
  domain: string;
  mxHostname: string;
  publicIPv4?: string | null;
  publicIPv6?: string | null;
  recipients: string[];
  rbl: { enabled: boolean; zones: string[] };
  greylist: { enabled: boolean; minDelaySec: number; ttlSec: number };
  policy: { requireDMARC: boolean };
  dns: { provider: 'manual'|'cloudflare'; autoMaintain: boolean; cloudflare: { apiToken?: string; accountId?: string } };
  tlsrptEmail: string;
  mtaStsMode: 'enforce'|'testing'|'none';
};

export type DNSRecord = { type: string; name: string; content: string; ttl?: number; priority?: number };

const API = (path: string) => `${location.origin.replace(/:\d+$/, ':4000')}${path}`; // dev proxy to 4000 if opened via vite
function buildHeaders(base?: Record<string,string>) {
  const h = new Headers(base || {});
  const t = localStorage.getItem('ADMIN_TOKEN');
  if (t) h.set('Authorization', `Bearer ${t}`);
  return h;
}

export async function getSettings(): Promise<Settings> { const r = await fetch(API('/api/settings')); return r.json(); }
export async function setSettings(s: Settings): Promise<void> {
  await fetch(API('/api/settings'), { method: 'POST', headers: buildHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(s) });
}
export async function dnsPreview(): Promise<DNSRecord[]> { const r = await fetch(API('/api/dns/preview')); return r.json(); }
export async function dnsStatus(): Promise<any> { const r = await fetch(API('/api/dns/status')); return r.json(); }
export async function dnsApply(): Promise<any> { const r = await fetch(API('/api/dns/apply'), { method: 'POST', headers: buildHeaders() }); return r.json(); }
export function dnsArtifactsUrl() { return API('/api/dns/artifacts.zip'); }
