// (Optional helper library kept for reference — not used by the panel any more)
// You can still use this module manually if you later want programmatic changes.
import type { DNSRecordSpec } from '../../types.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';

type CfZone = { id: string; name: string };

type CfRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority?: number | null;
  proxied?: boolean;
};

async function cfFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Cloudflare API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function findZoneId(token: string, domain: string): Promise<string> {
  const data = await cfFetch(token, `/zones?name=${encodeURIComponent(domain)}`);
  const z: CfZone | undefined = data.result?.[0];
  if (!z) throw new Error(`Zone not found in Cloudflare: ${domain}`);
  return z.id;
}

export async function upsertRecords(token: string, zoneId: string, domain: string, specs: DNSRecordSpec[]) {
  // Get all existing records for names we care about
  const names = Array.from(new Set(specs.map(s => (s.name === '@' ? domain : `${s.name}.${domain}`))));
  const existing: CfRecord[] = [];
  for (const n of names) {
    const data = await cfFetch(token, `/zones/${zoneId}/dns_records?name=${encodeURIComponent(n)}`);
    existing.push(...(data.result as CfRecord[]));
  }

  const results: { spec: DNSRecordSpec; action: 'created'|'updated'|'unchanged'; id?: string }[] = [];

  for (const spec of specs) {
    const nameFqdn = spec.name === '@' ? domain : `${spec.name}.${domain}`;
    const match = existing.find(r => r.type === spec.type && r.name === nameFqdn);
    const payload: any = {
      type: spec.type,
      name: nameFqdn,
      content: spec.type === 'MX' || spec.type === 'CNAME' ? spec.content.replace(/\.$/, '') : spec.content,
      ttl: spec.ttl ?? 300,
    };
    if (spec.type === 'MX' && spec.priority != null) payload.priority = spec.priority;
    if (spec.proxied !== undefined) payload.proxied = spec.proxied;

    if (!match) {
      const data = await cfFetch(token, `/zones/${zoneId}/dns_records`, { method: 'POST', body: JSON.stringify(payload) });
      results.push({ spec, action: 'created', id: data.result.id });
      continue;
    }

    // Compare content
    const desiredContent = payload.content;
    const currentContent = (match.content || '').replace(/\.$/, '');
    const same = currentContent === desiredContent && (spec.priority ?? null) === (match.priority ?? null) && (spec.ttl ?? 300) === match.ttl;
    if (same) { results.push({ spec, action: 'unchanged', id: match.id }); continue; }

    const data = await cfFetch(token, `/zones/${zoneId}/dns_records/${match.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    results.push({ spec, action: 'updated', id: data.result.id });
  }
  return results;
}
