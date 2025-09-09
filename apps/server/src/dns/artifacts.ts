import type { Settings, DNSRecordSpec } from '../types.js';
import { generateRecords } from './generate.js';
import { buildMtaStsPolicy } from '../mta-sts.js';

function renderBindZone(s: Settings, recs: DNSRecordSpec[]) {
  const zone = s.domain + '.';
  const ns = `ns1.${s.domain}.`;
  const hostmaster = `hostmaster.${s.domain}.`;
  const serial = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 10);
  const ttl = 300;
  const lines: string[] = [];
  lines.push(`$TTL ${ttl}`);
  lines.push(`$ORIGIN ${zone}`);
  lines.push(`${zone} IN SOA ${ns} ${hostmaster} (${serial} 3600 600 1209600 300)`);
  lines.push(`${zone} IN NS ${ns}`);

  for (const r of recs) {
    const name = r.name === '@' ? s.domain + '.' : `${r.name}.${s.domain}.`;
    if (r.type === 'MX') lines.push(`${s.domain}. ${r.ttl||ttl} IN MX ${r.priority||10} ${r.content}`);
    else if (r.type === 'TXT') lines.push(`${name} ${r.ttl||ttl} IN TXT "${r.content.replace(/"/g, '\\"')}"`);
    else lines.push(`${name} ${r.ttl||ttl} IN ${r.type} ${r.content}`);
  }
  return lines.join('\n') + '\n';
}

function renderRoute53ChangeBatch(s: Settings, recs: DNSRecordSpec[]) {
  const changes = recs.map(r => {
    const Name = r.name === '@' ? `${s.domain}.` : `${r.name}.${s.domain}.`;
    const base: any = { Name, Type: r.type, TTL: r.ttl || 300 };
    if (r.type === 'MX') base.ResourceRecords = [{ Value: `${r.priority||10} ${r.content}` }];
    else if (r.type === 'TXT') base.ResourceRecords = [{ Value: `"${r.content}"` }];
    else base.ResourceRecords = [{ Value: r.content }];
    return { Action: 'UPSERT', ResourceRecordSet: base };
  });
  return JSON.stringify({ Comment: 'Inbound Mail DNS Records', Changes: changes }, null, 2);
}

function renderCSV(s: Settings, recs: DNSRecordSpec[]) {
  const rows = [ ['name','type','ttl','priority','content'].join(',') ];
  for (const r of recs) {
    const name = r.name === '@' ? s.domain : `${r.name}.${s.domain}`;
    const priority = r.type === 'MX' ? String(r.priority ?? 10) : '';
    const content = r.type === 'TXT' ? `"${r.content.replace(/"/g,'\\"')}"` : r.content;
    rows.push([name, r.type, String(r.ttl||300), priority, content].join(','));
  }
  return rows.join('\n') + '\n';
}

function renderPowerDNSSQL(s: Settings, recs: DNSRecordSpec[]) {
  const rows: string[] = [];
  rows.push('-- Replace <domain_id> with your zone id in PowerDNS');
  rows.push('BEGIN;');
  for (const r of recs) {
    const name = r.name === '@' ? `${s.domain}.` : `${r.name}.${s.domain}.`;
    const prio = r.type === 'MX' ? (r.priority ?? 10) : 'NULL';
    const content = r.type === 'TXT' ? `"${r.content.replace(/"/g,'\\"')}"` : r.content;
    rows.push(`INSERT INTO records (domain_id, name, type, content, ttl, prio) VALUES (<domain_id>, '${name}', '${r.type}', '${content}', ${r.ttl||300}, ${prio});`);
  }
  rows.push('COMMIT;');
  return rows.join('\n') + '\n';
}

function renderReadme(s: Settings) {
  return `# DNS Artifact Pack

Domain: ${s.domain}
MX Hostname: ${s.mxHostname}

## What to create
- MX at @ → ${s.mxHostname}. (prio 10, TTL 300)
- A/AAAA for ${s.mxHostname}. to your public IPs
- TXT at _mta-sts.${s.domain} with: v=STSv1; id=...
- TXT at _smtp._tls.${s.domain} with: v=TLSRPTv1; rua=mailto:${s.tlsrptEmail}
- A/AAAA for mta-sts.${s.domain} pointing to this API host

## Apply examples
**Route53**
aws route53 change-resource-record-sets --hosted-zone-id ZONEID --change-batch file://dns/route53-change-batch.json

**BIND**
# Put dns/bind/${s.domain}.zone on your nameserver and update named.conf

**Check**
- dig +short MX ${s.domain}
- dig +short A ${s.mxHostname}
- dig +short TXT _mta-sts.${s.domain}
- curl https://mta-sts.${s.domain}/.well-known/mta-sts.txt

Notes:
- BIND SOA/NS are placeholders; adjust to your NS.
- If some subdomains should never receive mail, consider RFC 7505 (Null MX) separately.
`;
}

export function renderArtifacts(s: Settings) {
  const recs = generateRecords(s);
  const files: Record<string, string> = {};
  files[`dns/bind/${s.domain}.zone`] = renderBindZone(s, recs);
  files['dns/route53-change-batch.json'] = renderRoute53ChangeBatch(s, recs);
  files['dns/records.csv'] = renderCSV(s, recs);
  files['dns/powerdns.sql'] = renderPowerDNSSQL(s, recs);
  files['mta-sts/.well-known/mta-sts.txt'] = buildMtaStsPolicy(s);
  files['dns/README-DNS.md'] = renderReadme(s);
  return files;
}
