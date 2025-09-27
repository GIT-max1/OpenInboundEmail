import React, { useEffect, useMemo, useState } from 'react';
import { Card, Button, Input, Label } from './components/ui';
import { Settings, getSettings, setSettings, dnsPreview, dnsStatus, dnsApply, dnsArtifactsUrl, adminLogin } from './api';
import { Loader2, RefreshCw, Server, Shield, Cloud, Activity, TestTube, Download } from 'lucide-react';
import { motion } from 'framer-motion';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setState] = useState<Settings | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [status, setStatus] = useState<any[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [jwtStatus, setJwtStatus] = useState<string | null>(null);

  useEffect(() => { (async () => { setLoading(true); const s = await getSettings(); setState(s); setLoading(false); })(); }, []);

  useEffect(() => { (async () => { if (!settings) return; const recs = await dnsPreview(); setRecords(recs); })(); }, [settings?.domain, settings?.mxHostname, settings?.publicIPv4, settings?.publicIPv6, settings?.tlsrptEmail, settings?.mtaStsMode]);

  const modeBadge = useMemo(() => settings?.mode === 'dev' ? 'bg-yellow-100 text-yellow-900' : 'bg-emerald-100 text-emerald-900', [settings?.mode]);

  if (loading || !settings) return <div className="p-6 text-slate-600 flex items-center gap-2"><Loader2 className="animate-spin"/> Loading…</div>;

  const update = (patch: Partial<Settings>) => setState({ ...settings, ...patch });

  async function save() {
    setSaving(true);
    await setSettings(settings!);
    const fresh = await getSettings();
    setState(fresh);
    setSaving(false);
  }
  async function refreshStatus() { setStatus(null); const s = await dnsStatus(); setStatus(s); }
  async function applyDNS() { setApplying(true); const r = await dnsApply(); setApplying(false); alert(r.ok ? 'Applied' : `Error: ${r.error}`); refreshStatus(); }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Server size={22}/> Inbound Mail — Settings</h1>
        <span className={`px-3 py-1 rounded-xl text-sm ${modeBadge}`}>{settings.mode === 'dev' ? 'Localhost Testing Mode' : 'Production'}</span>
      </header>

      <div className="text-xs text-slate-500 space-y-1">
        <div>Tip: set a browser-only admin token via <code>localStorage.setItem('ADMIN_TOKEN','your-token')</code>. It is sent as a Bearer token only for protected actions and never stored server-side.</div>
        <div>If JWT is configured server-side, you can exchange it: <button className="underline" onClick={async()=>{ const tok = localStorage.getItem('ADMIN_TOKEN')||''; const r = await adminLogin(tok); if (r){ localStorage.setItem('ADMIN_JWT', r.token); setJwtStatus('JWT acquired'); setTimeout(()=>setJwtStatus(null), 3000);} else { setJwtStatus('Login failed'); setTimeout(()=>setJwtStatus(null), 3000);} }}>Get JWT</button> {jwtStatus && <span className="text-slate-600">— {jwtStatus}</span>}</div>
      </div>

      <Card>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Mode</Label>
            <div className="flex gap-2 mt-2">
              <Button onClick={() => update({ mode: 'dev' })} className={settings.mode==='dev' ? '' : 'opacity-70'}>Dev (localhost)</Button>
              <Button onClick={() => update({ mode: 'prod' })} className={settings.mode==='prod' ? '' : 'opacity-70'}>Production</Button>
            </div>
            <p className="text-xs text-slate-500 mt-2">Dev binds SMTP to 2525 and skips DNS writes; Production expects port 25. Use the Artifact Pack to make DNS changes.</p>
          </div>
          <div>
            <Label>Recipients (comma-separated)</Label>
            <Input value={settings.recipients.join(',')} onChange={e=>update({ recipients: e.target.value.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean) })} />
            <p className="text-xs text-slate-500 mt-2">Leave empty to accept any user @ {settings.domain}.</p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Domain</Label>
            <Input value={settings.domain} onChange={e=>update({ domain: e.target.value })} />
            <Label className="mt-3 block">SMTP Hostname (MX target)</Label>
            <Input value={settings.mxHostname} onChange={e=>update({ mxHostname: e.target.value })} />
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div>
                <Label>Public IPv4</Label>
                <Input value={settings.publicIPv4||''} onChange={e=>update({ publicIPv4: e.target.value })} placeholder="203.0.113.10" />
              </div>
              <div>
                <Label>Public IPv6</Label>
                <Input value={settings.publicIPv6||''} onChange={e=>update({ publicIPv6: e.target.value })} placeholder="2001:db8::1" />
              </div>
            </div>
          </div>
          <div>
            <Label>MTA-STS Mode</Label>
            <div className="flex gap-2 mt-2">
              {(['enforce','testing','none'] as const).map(m => (
                <Button key={m} onClick={()=>update({ mtaStsMode: m })} className={settings.mtaStsMode===m? '' : 'opacity-70'}>{m}</Button>
              ))}
            </div>
            <Label className="mt-3 block">TLS-RPT aggregate email</Label>
            <Input value={settings.tlsrptEmail} onChange={e=>update({ tlsrptEmail: e.target.value })} />
          </div>
        </div>
      </Card>

      <Card>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <Label className="block">DNS Provider</Label>
            <div className="flex gap-2 mt-2">
              <Button onClick={()=>update({ dns: { ...settings.dns, provider: 'manual' } })} className={settings.dns.provider==='manual'? '' : 'opacity-70'}>Manual</Button>
              <Button onClick={()=>update({ dns: { ...settings.dns, provider: 'cloudflare' } })} className={settings.dns.provider==='cloudflare'? '' : 'opacity-70'}><Cloud size={16}/> Cloudflare (optional)</Button>
            </div>
            <div className="mt-3 text-sm text-slate-600">Prefer <b>Manual</b> and download the Artifact Pack to apply on any DNS host.</div>
          </div>
          {settings.dns.provider==='cloudflare' && (
            <div className="md:col-span-2 grid gap-2">
              <Label>API Token</Label>
              <Input value={settings.dns.cloudflare.apiToken||''} onChange={e=>update({ dns: { ...settings.dns, cloudflare: { ...settings.dns.cloudflare, apiToken: e.target.value } } })} />
              <p className="text-xs text-slate-500">Token needs DNS:Edit on your zone.</p>
              <div className="flex gap-2 mt-2">
                <Button onClick={applyDNS} disabled={applying}>{applying? 'Applying…' : 'Apply via Cloudflare'}</Button>
              </div>
            </div>
          )}
          {settings.dns.provider==='manual' && (
            <div className="md:col-span-2 flex items-end gap-2">
              <a className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-2" href={dnsArtifactsUrl()}>
                <Download size={16}/> Download Artifact Pack (.zip)
              </a>
              <Button onClick={refreshStatus}><RefreshCw size={16}/>&nbsp;Refresh Status</Button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center gap-2 mb-3"><Shield size={18}/> Governing Policies</div>
          <div className="flex items-center gap-2">
            <input id="grey" type="checkbox" checked={settings.greylist.enabled} onChange={e=>update({ greylist: { ...settings.greylist, enabled: e.target.checked } })} />
            <Label>Greylisting</Label>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <input id="dmarc" type="checkbox" checked={settings.policy.requireDMARC} onChange={e=>update({ policy: { requireDMARC: e.target.checked } })} />
            <Label>Require DMARC=pass</Label>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-3"><Activity size={18}/> DNS Records</div>
          <div className="text-xs text-slate-600 space-y-1 max-h-48 overflow-auto">
            {records.map((r,i)=> (
              <div key={i}><code>{r.type}</code> <b>{r.name==='@'? settings.domain : `${r.name}.${settings.domain}`}</b> → <span className="break-all">{r.type==='MX'? `${r.priority} ${r.content}` : r.content}</span></div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <Button onClick={refreshStatus}><RefreshCw size={16}/>&nbsp;Refresh Status</Button>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-3"><TestTube size={18}/> Dev Testing</div>
          <div className="text-xs text-slate-600">
            <p>Send a test (localhost):</p>
            <pre className="bg-slate-100 p-2 rounded text-xs whitespace-pre-wrap break-all">swaks --server 127.0.0.1:2525 --from a@test.net --to {settings.recipients[0]||`info@${settings.domain}`} --data "Subject: hi\n\nhello"</pre>
            <p className="mt-2">Maildir path: <code>apps/server/spool/&lt;domain&gt;/&lt;user&gt;/Maildir/new/</code></p>
          </div>
        </Card>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Card>
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>{saving? 'Saving…' : 'Save & Restart SMTP'}</Button>
          </div>
          {status && (
            <div className="mt-4 text-sm">
              <div className="font-medium mb-1">DNS Status</div>
              <ul className="space-y-1">
                {status.map((s:any, i:number)=> (
                  <li key={i} className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${s.present? 'bg-emerald-500':'bg-rose-500'}`}></span>
                    <code>{s.record.type}</code> {s.record.name==='@'? settings.domain : `${s.record.name}.${settings.domain}`} → {s.record.type==='MX'? `${s.record.priority} ${s.record.content}` : s.record.content}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}