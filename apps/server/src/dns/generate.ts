import type { DNSRecordSpec, Settings } from '../types.js';

export function generateRecords(s: Settings): DNSRecordSpec[] {
  const root = s.domain;
  const at = '@';
  const records: DNSRecordSpec[] = [];

  // MX -> mxHostname
  records.push({ type: 'MX', name: at, content: s.mxHostname + '.', priority: 10, ttl: 300 });

  // Host for mxHostname -> A/AAAA (only if mxHostname is within the domain)
  const underDomain = s.mxHostname === root || s.mxHostname.endsWith(`.${root}`);
  if (underDomain) {
    const host = s.mxHostname === root ? '@' : s.mxHostname.slice(0, -(root.length + 1));
    if (s.publicIPv4) records.push({ type: 'A', name: host, content: s.publicIPv4, ttl: 300 });
    if (s.publicIPv6) records.push({ type: 'AAAA', name: host, content: s.publicIPv6, ttl: 300 });
  }

  // MTA-STS: TXT at _mta-sts.<domain>
  const id = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  records.push({ type: 'TXT', name: `_mta-sts`, content: `v=STSv1; id=${id}`, ttl: 300 });

  // TLS-RPT: TXT at _smtp._tls
  records.push({ type: 'TXT', name: `_smtp._tls`, content: `v=TLSRPTv1; rua=mailto:${s.tlsrptEmail}` , ttl: 300});

  // MTA-STS policy host: A/AAAA for mta-sts.<domain> (served by our API)
  if (s.publicIPv4) records.push({ type: 'A', name: `mta-sts`, content: s.publicIPv4, ttl: 300 });
  if (s.publicIPv6) records.push({ type: 'AAAA', name: `mta-sts`, content: s.publicIPv6, ttl: 300 });

  return records;
}
