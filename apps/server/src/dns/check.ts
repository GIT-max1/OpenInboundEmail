import dns from 'node:dns/promises';
import type { DNSRecordSpec, DNSStatus } from '../types.js';

export async function checkRecord(domain: string, rec: DNSRecordSpec): Promise<DNSStatus> {
  const fqdn = rec.name === '@' ? domain : `${rec.name}.${domain}`;
  try {
    let observed: string[] = [];
    if (rec.type === 'MX') {
      const mx = await dns.resolveMx(domain);
      observed = mx.map(m => `${m.exchange}.`);
      return { record: rec, present: observed.includes(rec.content), observed };
    }
    if (rec.type === 'A') {
      observed = await dns.resolve4(fqdn);
      return { record: rec, present: observed.includes(rec.content), observed };
    }
    if (rec.type === 'AAAA') {
      observed = await dns.resolve6(fqdn);
      return { record: rec, present: observed.includes(rec.content), observed };
    }
    if (rec.type === 'TXT') {
      const txt = await dns.resolveTxt(fqdn);
      observed = txt.map(rr => rr.join(''));
      const present = observed.some(v => v.includes(rec.content));
      return { record: rec, present, observed };
    }
    if (rec.type === 'CNAME') {
      const c = await dns.resolveCname(fqdn);
      observed = c;
      return { record: rec, present: observed.includes(rec.content), observed };
    }
    return { record: rec, present: false };
  } catch {
    return { record: rec, present: false };
  }
}

export async function checkAll(domain: string, records: DNSRecordSpec[]) {
  const out: DNSStatus[] = [];
  for (const r of records) out.push(await checkRecord(domain, r));
  return out;
}
