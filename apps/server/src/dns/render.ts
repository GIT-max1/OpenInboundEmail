import type { DNSRecordSpec } from '../types.js';

export function renderBindZone(domain: string, recs: DNSRecordSpec[]) {
  const serial = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 10);
  const zone = domain + '.';
  const ns = `ns1.${domain}.`;
  const hostmaster = `hostmaster.${domain}.`;
  const ttl = 300;
  const lines: string[] = [];
  lines.push(`$TTL ${ttl}`);
  lines.push(`$ORIGIN ${zone}`);
  lines.push(`${zone} IN SOA ${ns} ${hostmaster} (${serial} 3600 600 1209600 300)`);
  lines.push(`${zone} IN NS ${ns}`);
  for (const r of recs) {
    const name = r.name === '@' ? zone : `${r.name}.${zone}`;
    if (r.type === 'MX') lines.push(`${zone} ${r.ttl||ttl} IN MX ${r.priority||10} ${r.content}`);
    else if (r.type === 'TXT') lines.push(`${name} ${r.ttl||ttl} IN TXT "${r.content.replace(/"/g, '\\"')}"`);
    else lines.push(`${name} ${r.ttl||ttl} IN ${r.type} ${r.content}`);
  }
  return lines.join('\n') + '\n';
}

export function renderGeneric(domain: string, recs: DNSRecordSpec[]) {
  const rows = recs.map(r => {
    const name = r.name === '@' ? domain : `${r.name}.${domain}`;
    const prio = r.type === 'MX' ? `,${r.priority||10}` : '';
    const content = r.type === 'TXT' ? `"${r.content.replace(/"/g, '\\"')}"` : r.content;
    return `${name},${r.type},${r.ttl||300}${prio?','+ (r.priority||10):''},${content}`;
  });
  return ['name,type,ttl,priority,content', ...rows].join('\n') + '\n';
}

export function renderCloudflareCurl(domain: string, recs: DNSRecordSpec[]) {
  const lines: string[] = [];
  lines.push('# Replace $CF_API_TOKEN and $CF_ZONE_ID with your values');
  for (const r of recs) {
    const name = r.name === '@' ? domain : `${r.name}.${domain}`;
    const payload: any = { type: r.type, name, content: r.content, ttl: r.ttl||300 };
    if (r.type === 'MX' && r.priority != null) payload.priority = r.priority;
    lines.push(`curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \\\n  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \\\n  --data '${JSON.stringify(payload)}'`);
  }
  return lines.join('\n') + '\n';
}
