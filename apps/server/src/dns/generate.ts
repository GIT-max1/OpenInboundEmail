import { createHash } from 'node:crypto';
import type { DNSRecordSpec, Settings } from '../types.js';

export function generateRecords(s: Settings): DNSRecordSpec[] {
  const root = s.domain.replace(/\.$/, '').toLowerCase();
  const at = '@';
  const records: DNSRecordSpec[] = [];

  // MX -> mxHostname
  const mxHost = s.mxHostname.replace(/\.$/, '').toLowerCase();
  records.push({ type: 'MX', name: at, content: mxHost + '.', priority: 10, ttl: 300 });

  // Host for mxHostname -> A/AAAA (only if mxHostname is within the domain)
  const underDomain = mxHost === root || mxHost.endsWith(`.${root}`);
  if (underDomain) {
    const host = mxHost === root ? '@' : mxHost.slice(0, -(root.length + 1));
    if (s.publicIPv4) records.push({ type: 'A', name: host, content: s.publicIPv4, ttl: 300 });
    if (s.publicIPv6) records.push({ type: 'AAAA', name: host, content: s.publicIPv6, ttl: 300 });
  }

  // MTA-STS: TXT at _mta-sts.<domain>
  const idSource = `${root}|${mxHost}|${s.mtaStsMode}`;
  const id = createHash('sha256').update(idSource).digest('hex').slice(0, 12);
  records.push({ type: 'TXT', name: `_mta-sts`, content: `v=STSv1; id=${id}`, ttl: 300 });

  // TLS-RPT: TXT at _smtp._tls
  records.push({ type: 'TXT', name: `_smtp._tls`, content: `v=TLSRPTv1; rua=mailto:${s.tlsrptEmail}` , ttl: 300});

  // MTA-STS policy host: A/AAAA for mta-sts.<domain> (served by our API)
  if (s.publicIPv4) records.push({ type: 'A', name: `mta-sts`, content: s.publicIPv4, ttl: 300 });
  if (s.publicIPv6) records.push({ type: 'AAAA', name: `mta-sts`, content: s.publicIPv6, ttl: 300 });

  return records;
}
