import type { Settings } from './types.js';

const seen = new Map<string, number>();

export function greyDecision(s: Settings, ip: string, mailFrom: string | null, rcptTo: string) {
  if (!s.greylist.enabled) return { action: 'allow' as const };
  const key = `${ip}|${mailFrom||''}|${rcptTo}`;
  const now = Date.now() / 1000;
  const first = seen.get(key);
  if (!first) { seen.set(key, now); return { action: 'tempfail' as const, wait: s.greylist.minDelaySec }; }
  if (now - first < s.greylist.minDelaySec) return { action: 'tempfail' as const, wait: Math.ceil(s.greylist.minDelaySec - (now - first)) };
  // cleanup expired
  for (const [k, t] of Array.from(seen.entries())) if (now - t > s.greylist.ttlSec) seen.delete(k);
  return { action: 'allow' as const };
}
