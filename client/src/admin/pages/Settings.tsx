import { useCallback, useEffect, useState } from 'react';
import { Spinner } from '../../components/ui';
import { ApiError, get, post, put } from '../../lib/api';
import { invalidateCache } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import { AHead, Card, dt, ErrorBox, F, LocInput, Modal, Tabs, toSarInput, usePerms } from '../kit';
import { MediaField } from '../media';

/**
 * Admin → Settings. Every business configuration the client may need to change lives here, so
 * no developer or code change is needed. Sensitive areas are permission-gated on the server:
 *  - legal identity (CR, VAT, legal name, SBC)         → business:write
 *  - payment gateway credentials / test-live / enable  → payments:manage
 *  - everything else                                    → settings:write
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySettings = any;
type Diagnostics = { cardGateway: string; sandboxAllowed: boolean; emailConfigured: boolean; whatsappConfigured: boolean };
type Hosting = { appRegion: string; databaseRegion: string; mediaRegion: string; mediaStorage: { provider: string; uploadsEnabled: boolean; reason: string; maxImageMb: number; maxVideoMb: number; publicBaseUrl: string } };

type TabKey = 'store' | 'legal' | 'brand' | 'shipping' | 'cod' | 'orders' | 'payments' | 'notifications' | 'seo' | 'hosting';

const MONEY = ['deliveryFee', 'codFee', 'codMaxOrderTotal', 'codMinOrderTotal', 'freeDeliveryThreshold'];
const emptyL: Localized = { ar: '', en: '' };

export function SettingsPage() {
  const perms = usePerms();
  const canSettings = perms.has('settings:write');
  const canLegal = perms.has('business:write');
  const canPayments = perms.has('payments:manage');
  const tabs: [TabKey, string][] = [
    ...(canSettings ? ([['store', 'Store & contact']] as [TabKey, string][]) : []),
    ...(canLegal ? ([['legal', 'Legal & business']] as [TabKey, string][]) : []),
    ...(canSettings
      ? ([
          ['brand', 'Brand'],
          ['shipping', 'Shipping & I Mile'],
          ['cod', 'Cash on delivery'],
          ['orders', 'Warranty, VAT & stock'],
        ] as [TabKey, string][])
      : []),
    ...(canSettings || canPayments ? ([['payments', 'Payments']] as [TabKey, string][]) : []),
    ...(canSettings
      ? ([
          ['notifications', 'Notifications & reviews'],
          ['seo', 'SEO'],
        ] as [TabKey, string][])
      : []),
    ['hosting', 'Hosting & data'],
  ];
  const [tab, setTab] = useState<TabKey>(tabs[0][0]);
  const [s, setS] = useState<AnySettings | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [hosting, setHosting] = useState<Hosting | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    get<{ settings: AnySettings; integrations: Diagnostics; hosting: Hosting }>('/api/admin/settings')
      .then((r) => {
        const c = r.settings.commerce ?? {};
        const money = Object.fromEntries(MONEY.map((k) => [k, toSarInput(c[k])]));
        setS({
          ...r.settings,
          announcement: { enabled: true, text: emptyL, link: '', ...(r.settings.announcement ?? {}) },
          business: { description: emptyL, ...r.settings.business },
          commerce: { shippingAvailable: true, shippingUnavailableMessage: emptyL, fulfilmentMode: 'manual', codAllowedCities: [], ...c, ...money, codCitiesText: (c.codAllowedCities ?? []).join('\n') },
        });
        setDiag(r.integrations);
        setHosting(r.hosting);
      })
      .catch((e) => setErr(e));
  }, []);
  useEffect(load, [load]);

  if (!s) return err ? <ErrorBox error={err} /> : <Spinner />;
  const set = (section: string, key: string, value: unknown) => setS({ ...s, [section]: { ...s[section], [key]: value } });
  const num = (v: unknown) => (v === '' || v == null ? null : Number(v));

  const save = async (body: Record<string, unknown>, message = 'Settings saved') => {
    setErr(null);
    setSaving(true);
    try {
      await put('/api/admin/settings', body);
      invalidateCache();
      toast(message);
    } catch (ex) {
      setErr(ex);
    } finally {
      setSaving(false);
    }
  };
  const pick = (obj: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
  const b = s.business;
  const c = s.commerce;
  const saveBtn = (onClick: () => void, label = 'Save') => (
    <button className="btn btn--primary btn--sm" disabled={saving} onClick={onClick}>
      {saving ? 'Saving…' : label}
    </button>
  );

  return (
    <>
      <AHead title="Settings" />
      <div className="settings-tabs"><Tabs tabs={tabs} value={tab} onChange={(t) => (setErr(null), setTab(t))} /></div>
      <ErrorBox error={err} />

      {tab === 'store' ? (
        <>
          <Card title="Store information" actions={saveBtn(() => save({ business: pick(b, ['name', 'description', 'address', 'email', 'phone', 'whatsappNumber', 'supportHours', 'social']) }))}>
            <div className="form-grid form-grid--2 settings-form-grid">
              <LocInput label="Store name" value={b.name} onChange={(v) => set('business', 'name', v)} />
              <LocInput label="Store description (footer / search results)" textarea value={b.description} onChange={(v) => set('business', 'description', v)} />
              <F label="Support email">
                <input className="input ltr" type="email" value={b.email} onChange={(e) => set('business', 'email', e.target.value)} />
              </F>
              <F label="Support phone">
                <input className="input ltr" value={b.phone} onChange={(e) => set('business', 'phone', e.target.value)} />
              </F>
              <F label="WhatsApp number" hint="International format, e.g. 9665XXXXXXXX. The WhatsApp button stays hidden until this is set.">
                <input className="input ltr" value={b.whatsappNumber} onChange={(e) => set('business', 'whatsappNumber', e.target.value)} />
              </F>
              <span />
              <LocInput label="Support hours" value={b.supportHours} onChange={(v) => set('business', 'supportHours', v)} />
              <LocInput label="Business address" textarea value={b.address} onChange={(v) => set('business', 'address', v)} />
              {['instagram', 'tiktok', 'snapchat', 'x', 'youtube', 'facebook', 'linkedin'].map((k) => (
                <F key={k} label={`${k === 'x' ? 'X (Twitter)' : k[0].toUpperCase() + k.slice(1)} URL`}>
                  <input className="input ltr" value={b.social?.[k] ?? ''} placeholder="https://" onChange={(e) => set('business', 'social', { ...b.social, [k]: e.target.value })} />
                </F>
              ))}
            </div>
          </Card>
          <Card title="Announcement bar" actions={saveBtn(() => save({ announcement: s.announcement }))}>
            <div className="form-grid form-grid--2 settings-form-grid">
              <label className="check span-2">
                <input type="checkbox" checked={s.announcement.enabled} onChange={(e) => set('announcement', 'enabled', e.target.checked)} /> Show the announcement bar above the header
              </label>
              <LocInput label="Message (empty = the default free-delivery & warranty message)" value={s.announcement.text} onChange={(v) => set('announcement', 'text', v)} />
              <F label="Link (optional)" hint="Site path like /campaign/ramadan, or https://…">
                <input className="input ltr" value={s.announcement.link} onChange={(e) => set('announcement', 'link', e.target.value)} />
              </F>
            </div>
          </Card>
        </>
      ) : null}

      {tab === 'legal' ? (
        <>
          <Card
            title="Legal & business identity (Saudi e-commerce requirements)"
            actions={saveBtn(() => save({ business: pick(b, ['legalName', 'crNumber', 'vatNumber', 'sbcVerified', 'sbcVerificationUrl', 'sbcBadgeImageUrl']) }, 'Legal details saved'))}
          >
            <p className="muted" style={{ fontSize: 13 }}>
              Enter only official values supplied by CELIBERY (Q29/Q30). Empty fields are hidden on the store — nothing is ever invented. Changes are recorded in the activity log.
            </p>
            <div className="form-grid form-grid--2 settings-form-grid">
              <LocInput label="Legal (registered) name" value={b.legalName} onChange={(v) => set('business', 'legalName', v)} />
              <F label="Commercial Registration (CR) number">
                <input className="input ltr" value={b.crNumber} onChange={(e) => set('business', 'crNumber', e.target.value)} />
              </F>
              <F label="VAT registration number" hint="15 digits, starts and ends with 3">
                <input className="input ltr" inputMode="numeric" value={b.vatNumber} onChange={(e) => set('business', 'vatNumber', e.target.value.replace(/\s/g, ''))} />
              </F>
              <label className="check span-2">
                <input type="checkbox" checked={b.sbcVerified} onChange={(e) => set('business', 'sbcVerified', e.target.checked)} /> The store is verified on the Saudi Business Center platform (shows the trust badge) — tick only with official proof
              </label>
              <F label="Verification page URL" span>
                <input className="input ltr" value={b.sbcVerificationUrl} onChange={(e) => set('business', 'sbcVerificationUrl', e.target.value)} />
              </F>
              <MediaField label="Official verification badge" kind="image" value={b.sbcBadgeImageUrl} onChange={(url) => set('business', 'sbcBadgeImageUrl', url)} />
            </div>
          </Card>
          <Card title="Policies">
            <p style={{ margin: 0 }}>
              Privacy, Terms &amp; Conditions, Returns, Refunds, Shipping and Warranty texts are edited in <a href="/admin/content">Website content → Policy pages</a>. Every save keeps a version history; marking a policy “approved” requires this legal &amp; business permission.
            </p>
          </Card>
        </>
      ) : null}

      {tab === 'brand' ? (
        <Card title="Brand" actions={saveBtn(() => save({ brand: s.brand }))}>
          <div className="form-grid form-grid--2 settings-form-grid">
            <F label="Accent colour (buttons & offers)" hint="Q2: CELIBERY's brand accent — the current value is a placeholder until the client approves one.">
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="color" value={s.brand.accentColor} onChange={(e) => set('brand', 'accentColor', e.target.value)} style={{ width: 48, height: 44, border: 0 }} aria-label="Pick accent colour" />
                <input className="input ltr" value={s.brand.accentColor} onChange={(e) => set('brand', 'accentColor', e.target.value)} />
                <span className="swatch" style={{ background: /^#[0-9a-f]{6}$/i.test(s.brand.accentColor) ? s.brand.accentColor : 'transparent' }} aria-hidden="true" />
              </div>
            </F>
            <span />
            <MediaField label="Logo for light backgrounds" kind="image" value={s.brand.logoUrl} onChange={(url) => set('brand', 'logoUrl', url)} hint="PNG, WebP or an SVG URL. Uploads accept PNG/WebP (SVG only by URL)." />
            <MediaField label="Logo for dark backgrounds" kind="image" value={s.brand.logoDarkUrl} onChange={(url) => set('brand', 'logoDarkUrl', url)} />
          </div>
        </Card>
      ) : null}

      {tab === 'shipping' ? (
        <>
          <Card
            title="Delivery"
            actions={saveBtn(() =>
              save({
                commerce: {
                  ...pick(c, ['freeDelivery', 'shippingAvailable', 'shippingUnavailableMessage', 'courierName', 'courierTrackingUrlTemplate', 'estimatedDelivery', 'fulfilmentMode']),
                  deliveryFee: Number(c.deliveryFee || 0),
                  freeDeliveryThreshold: num(c.freeDeliveryThreshold),
                },
              }),
            )}
          >
            <div className="form-grid form-grid--2 settings-form-grid">
              <label className="check span-2">
                <input type="checkbox" checked={c.shippingAvailable} onChange={(e) => set('commerce', 'shippingAvailable', e.target.checked)} /> Accept orders for delivery (untick to pause checkout, e.g. during a courier outage)
              </label>
              {!c.shippingAvailable ? <LocInput label="Message shown at checkout while delivery is paused" value={c.shippingUnavailableMessage} onChange={(v) => set('commerce', 'shippingUnavailableMessage', v)} /> : null}
              <label className="check span-2">
                <input type="checkbox" checked={c.freeDelivery} onChange={(e) => set('commerce', 'freeDelivery', e.target.checked)} /> Free delivery across Saudi Arabia on every order (approved — Q25)
              </label>
              <F label="Delivery fee (SAR)" hint="Used only when free delivery is off">
                <input className="input" inputMode="decimal" disabled={c.freeDelivery} value={c.deliveryFee} onChange={(e) => set('commerce', 'deliveryFee', e.target.value)} />
              </F>
              <F label="Free delivery from (SAR, optional)" hint="When free delivery is off: orders at or above this amount ship free. Empty = no threshold.">
                <input className="input" inputMode="decimal" disabled={c.freeDelivery} value={c.freeDeliveryThreshold ?? ''} onChange={(e) => set('commerce', 'freeDeliveryThreshold', e.target.value)} />
              </F>
              <LocInput label="Estimated delivery text (e.g. 2–4 business days)" value={c.estimatedDelivery} onChange={(v) => set('commerce', 'estimatedDelivery', v)} />
            </div>
          </Card>
          <Card title="Courier & fulfilment (I Mile Logistics — Q24)">
            <div className="form-grid form-grid--2 settings-form-grid">
              <F label="Courier name shown to customers">
                <input className="input" value={c.courierName} onChange={(e) => set('commerce', 'courierName', e.target.value)} />
              </F>
              <F label="Tracking URL template" hint="Use {tracking} as placeholder, e.g. https://courier.example/track?no={tracking}">
                <input className="input ltr" value={c.courierTrackingUrlTemplate} onChange={(e) => set('commerce', 'courierTrackingUrlTemplate', e.target.value)} />
              </F>
              <F label="Fulfilment mode" span hint="Manual: staff book each shipment in the I Mile portal and enter the tracking number in Orders → Mark as shipped. Automatic booking needs I Mile API documentation and a tested integration, which is not built yet.">
                <select className="select" value={c.fulfilmentMode} onChange={(e) => set('commerce', 'fulfilmentMode', e.target.value)}>
                  <option value="manual">Manual — book in the I Mile portal (current)</option>
                  <option value="api" disabled>
                    Automatic via I Mile API — not available yet
                  </option>
                </select>
              </F>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>Save with the Delivery “Save” button above.</p>
          </Card>
          {canPayments ? <Integrations only={['imile']} /> : null}
        </>
      ) : null}

      {tab === 'cod' ? (
        <Card
          title="Cash on delivery (Q23)"
          actions={saveBtn(() =>
            save({
              commerce: {
                codEnabled: c.codEnabled,
                codFee: Number(c.codFee || 0),
                codMinOrderTotal: num(c.codMinOrderTotal),
                codMaxOrderTotal: num(c.codMaxOrderTotal),
                codAllowedCities: String(c.codCitiesText ?? '')
                  .split(/\n|,/)
                  .map((x: string) => x.trim())
                  .filter(Boolean),
              },
            }),
          )}
        >
          <div className="form-grid form-grid--2 settings-form-grid">
            <label className="check span-2">
              <input type="checkbox" checked={c.codEnabled} onChange={(e) => set('commerce', 'codEnabled', e.target.checked)} /> Offer cash on delivery at checkout (enable once CELIBERY confirms the COD rules)
            </label>
            <F label="COD fee (SAR)" hint="The client includes COD cost in the sales price → keep 0">
              <input className="input" inputMode="decimal" value={c.codFee} onChange={(e) => set('commerce', 'codFee', e.target.value)} />
            </F>
            <span />
            <F label="Minimum order for COD (SAR, empty = none)">
              <input className="input" inputMode="decimal" value={c.codMinOrderTotal ?? ''} onChange={(e) => set('commerce', 'codMinOrderTotal', e.target.value)} />
            </F>
            <F label="Maximum order for COD (SAR, empty = none)">
              <input className="input" inputMode="decimal" value={c.codMaxOrderTotal ?? ''} onChange={(e) => set('commerce', 'codMaxOrderTotal', e.target.value)} />
            </F>
            <F label="Only in these cities (one per line, empty = all of Saudi Arabia)" span hint="Matched against the city typed at checkout, ignoring upper/lower case. Add Arabic and English spellings, e.g. Riyadh and Ø§Ù„Ø±ÙŠاض.">
              <textarea className="textarea" rows={4} value={c.codCitiesText ?? ''} onChange={(e) => set('commerce', 'codCitiesText', e.target.value)} />
            </F>
          </div>
        </Card>
      ) : null}

      {tab === 'orders' ? (
        <Card
          title="Warranty, VAT and stock"
          actions={saveBtn(() =>
            save({
              commerce: {
                warrantyEnabled: c.warrantyEnabled,
                warrantyMonths: Number(c.warrantyMonths),
                vatRatePercent: Number(c.vatRatePercent),
                lowStockThreshold: Number(c.lowStockThreshold),
                reservationMinutes: Number(c.reservationMinutes),
                maxQuantityPerItem: Number(c.maxQuantityPerItem),
              },
            }),
          )}
        >
          <div className="form-grid form-grid--2 settings-form-grid">
            <label className="check">
              <input type="checkbox" checked={c.warrantyEnabled} onChange={(e) => set('commerce', 'warrantyEnabled', e.target.checked)} /> Show warranty
            </label>
            <F label="Default warranty (months)" hint="Q32: 2-year warranty confirmed">
              <input className="input" type="number" value={c.warrantyMonths} onChange={(e) => set('commerce', 'warrantyMonths', e.target.value)} />
            </F>
            <F label="VAT rate (%) — prices are VAT inclusive">
              <input className="input" type="number" value={c.vatRatePercent} onChange={(e) => set('commerce', 'vatRatePercent', e.target.value)} />
            </F>
            <F label="Default low-stock alert">
              <input className="input" type="number" value={c.lowStockThreshold} onChange={(e) => set('commerce', 'lowStockThreshold', e.target.value)} />
            </F>
            <F label="Unpaid order holds stock for (minutes)">
              <input className="input" type="number" value={c.reservationMinutes} onChange={(e) => set('commerce', 'reservationMinutes', e.target.value)} />
            </F>
            <F label="Max quantity per product per order">
              <input className="input" type="number" value={c.maxQuantityPerItem} onChange={(e) => set('commerce', 'maxQuantityPerItem', e.target.value)} />
            </F>
          </div>
        </Card>
      ) : null}

      {tab === 'payments' ? (
        <>
          {canSettings ? (
            <Card title="Payment methods offered at checkout" actions={saveBtn(() => save({ payments: s.payments }))}>
              {[
                ['card', 'mada / Visa / Mastercard'],
                ['applepay', 'Apple Pay'],
                ['stcpay', 'STC Pay'],
                ['tabby', 'Tabby (buy now, pay later)'],
              ].map(([k, label]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={s.payments[k] !== false} onChange={(e) => set('payments', k, e.target.checked)} /> {label}
                </label>
              ))}
              <p className="muted" style={{ fontSize: 13 }}>
                A method is shown to customers only when it is ticked here AND its gateway below is enabled. Cash on delivery is controlled in the “Cash on delivery” tab.
                {diag ? (
                  <>
                    {' '}
                    Card gateway right now: <strong>{diag.cardGateway}</strong>
                    {diag.cardGateway === 'sandbox' ? ' (test simulator — no real payments)' : ''}.
                  </>
                ) : null}
              </p>
            </Card>
          ) : null}
          {canPayments ? (
            <Integrations only={['moyasar', 'tabby']} />
          ) : (
            <Card title="Payment gateways">
              <p className="muted">Only Super Administrators (permission “payments:manage”) can view or change payment gateway credentials.</p>
            </Card>
          )}
        </>
      ) : null}

      {tab === 'notifications' ? (
        <>
          <Card title="Customer order updates (Q28: email and WhatsApp)" actions={saveBtn(() => save({ notifications: s.notifications }))}>
            <label className="check">
              <input type="checkbox" checked={s.notifications.emailOrderUpdates} onChange={(e) => set('notifications', 'emailOrderUpdates', e.target.checked)} /> Email updates {diag ? <Configured ok={diag.emailConfigured} /> : null}
            </label>
            <label className="check">
              <input type="checkbox" checked={s.notifications.whatsappOrderUpdates} onChange={(e) => set('notifications', 'whatsappOrderUpdates', e.target.checked)} /> WhatsApp updates {diag ? <Configured ok={diag.whatsappConfigured} /> : null}
            </label>
            <p className="muted" style={{ fontSize: 13 }}>A channel sends only when it is ticked here and its provider below is enabled.</p>
          </Card>
          {canPayments ? (
            <Integrations only={['smtp', 'whatsapp']} />
          ) : (
            <Card title="Email & WhatsApp providers">
              <p className="muted">Only Super Administrators (permission “payments:manage”) can view or change the email (SMTP) and WhatsApp credentials.</p>
            </Card>
          )}
          {perms.has('orders:read') ? <NotificationLog /> : null}
          <Card title="Product reviews" actions={saveBtn(() => save({ reviews: s.reviews }))}>
            <label className="check">
              <input type="checkbox" checked={s.reviews.enabled} onChange={(e) => set('reviews', 'enabled', e.target.checked)} /> Show reviews and allow verified buyers to write them
            </label>
          </Card>
        </>
      ) : null}

      {tab === 'seo' ? (
        <Card title="Search engines & AI assistants" actions={saveBtn(() => save({ seo: s.seo }))}>
          <div className="form-grid form-grid--2 settings-form-grid">
            <LocInput label="Default page title" value={s.seo.title} onChange={(v) => set('seo', 'title', v)} />
            <LocInput label="Default description" value={s.seo.description} onChange={(v) => set('seo', 'description', v)} />
            <label className="check span-2">
              <input type="checkbox" checked={s.seo.allowAiCrawlers} onChange={(e) => set('seo', 'allowAiCrawlers', e.target.checked)} /> Allow AI assistants to read the store (Q37 — robots.txt allows them)
            </label>
          </div>
        </Card>
      ) : null}

      {tab === 'hosting' && hosting ? (
        <Card title="Hosting & data residency (Q33)">
          <dl className="kv">
            <dt>Website & API</dt>
            <dd>{hosting.appRegion}</dd>
            <dt>Database (customer & order data)</dt>
            <dd>{hosting.databaseRegion}</dd>
            <dt>Media files</dt>
            <dd>
              {hosting.mediaRegion} · storage: {hosting.mediaStorage.provider} · uploads {hosting.mediaStorage.uploadsEnabled ? 'enabled' : 'disabled'}
            </dd>
          </dl>
          {hosting.mediaStorage.reason ? <p className="alert alert--warning">{hosting.mediaStorage.reason}</p> : null}
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            These values are read-only on purpose. Moving customer data to another country or provider is an infrastructure migration that needs the legal advisor’s approval (Q33) and a planned data transfer — it cannot be done with a dashboard switch. Ask the developer; see docs/DEPLOYMENT.md → “Data residency”.
          </p>
        </Card>
      ) : null}
    </>
  );
}

type NotificationEntry = { _id: string; channel: 'email' | 'whatsapp'; to: string; template: string; status: 'sent' | 'failed' | 'skipped'; detail?: string; createdAt: string };

/** Last 200 email / WhatsApp attempts, so staff can see whether customers actually received updates. */
function NotificationLog() {
  const [rows, setRows] = useState<NotificationEntry[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [filter, setFilter] = useState<'all' | 'failed' | 'skipped'>('all');
  const load = useCallback(() => {
    setErr(null);
    get<NotificationEntry[]>('/api/admin/notifications').then(setRows).catch(setErr);
  }, []);
  useEffect(load, [load]);
  const shown = (rows ?? []).filter((r) => filter === 'all' || r.status === filter);
  return (
    <Card
      title="Delivery log"
      actions={
        <>
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter delivery log">
            <option value="all">All</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
          <button className="btn btn--ghost btn--sm" onClick={load}>
            Refresh
          </button>
        </>
      }
    >
      <ErrorBox error={err} />
      {!rows ? (
        err ? null : <Spinner />
      ) : shown.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Channel</th>
                <th>To</th>
                <th>Message</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r._id}>
                  <td>{dt(r.createdAt)}</td>
                  <td>{r.channel === 'email' ? 'Email' : 'WhatsApp'}</td>
                  <td className="ltr">{r.to}</td>
                  <td>{r.template}</td>
                  <td>
                    <span className={`badge ${r.status === 'sent' ? 'badge--success' : r.status === 'failed' ? 'badge--danger' : 'badge--warning'}`}>{r.status}</span>
                    {r.detail ? <div className="muted" style={{ fontSize: 12 }}>{r.detail}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No {filter === 'all' ? '' : `${filter} `}messages yet.</p>
      )}
    </Card>
  );
}

const Configured = ({ ok }: { ok: boolean }) => (ok ? <span className="badge badge--success">configured</span> : <span className="badge badge--warning">provider not enabled</span>);

// ---------------------------------------------------------------------------------------------
// Gateway / integration credentials
// ---------------------------------------------------------------------------------------------

type FieldView = { key: string; secret: boolean; set: boolean; masked?: string; value?: string; updatedAt?: string | null };
type ModeView = { fields: FieldView[]; missing: string[]; verification: { status: string; message?: string; checkedAt?: string } };
type FieldDef = { key: string; label: string; secret: boolean; required: boolean; hint?: string };
type IntegrationView = {
  key: string;
  label: string;
  kind: string;
  /** One credential set (no test/live tabs) — email and WhatsApp. */
  singleMode?: boolean;
  inUse: boolean;
  verifiable: boolean;
  docsUrl: string;
  fieldDefs: FieldDef[];
  managed: boolean;
  enabled: boolean;
  activeMode: 'test' | 'live';
  liveConfirmedAt: string | null;
  updatedAt: string | null;
  modes: Record<'test' | 'live', ModeView>;
  effective: { source: 'admin' | 'env' | 'none'; enabled: boolean; mode: 'test' | 'live'; configured: boolean; error: string | null };
  env: Record<string, string> | null;
};
type IntegrationsResponse = { integrations: IntegrationView[]; encryptionKeyConfigured: boolean; encryptionAvailable: boolean; production: boolean };

function Integrations({ only }: { only: string[] }) {
  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => {
    get<IntegrationsResponse>('/api/admin/integrations')
      .then(setData)
      .catch(setErr);
  }, []);
  useEffect(load, [load]);
  if (err) return <ErrorBox error={err} />;
  if (!data) return <Spinner />;
  return (
    <>
      {!data.encryptionKeyConfigured ? (
        <p className={`alert ${data.production ? 'alert--error' : 'alert--warning'}`}>
          {data.production
            ? 'CREDENTIALS_ENCRYPTION_KEY is not set on the server, so credentials cannot be stored. Ask the developer to configure it (docs/PAYMENTS-GUIDE.md).'
            : 'Development mode: credentials are encrypted with a built-in development key. Production requires CREDENTIALS_ENCRYPTION_KEY.'}
        </p>
      ) : null}
      {data.integrations
        .filter((i) => only.includes(i.key))
        .map((i) => (
          <GatewayCard key={i.key} integration={i} canStore={data.encryptionAvailable} production={data.production} onChanged={(next) => setData({ ...data, integrations: data.integrations.map((x) => (x.key === next.key ? next : x)) })} />
        ))}
    </>
  );
}

function VerificationBadge({ v }: { v: ModeView['verification'] }) {
  const cls = v.status === 'ok' ? 'badge--success' : v.status === 'failed' ? 'badge--danger' : 'badge--warning';
  const label = v.status === 'ok' ? 'connection verified' : v.status === 'failed' ? 'verification failed' : v.status === 'unsupported' ? 'cannot be tested automatically' : 'not verified';
  return (
    <span>
      <span className={`badge ${cls}`}>{label}</span> {v.message ? <span className="muted">{v.message}</span> : null} {v.checkedAt ? <span className="muted">· {dt(v.checkedAt)}</span> : null}
    </span>
  );
}

function GatewayCard({ integration: i, canStore, production, onChanged }: { integration: IntegrationView; canStore: boolean; production: boolean; onChanged: (i: IntegrationView) => void }) {
  const [mode, setMode] = useState<'test' | 'live'>(i.activeMode);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [confirmLive, setConfirmLive] = useState<{ enabled: boolean; mode: 'test' | 'live' } | null>(null);
  const [typed, setTyped] = useState('');
  const toast = useToast();
  const m = i.modes[mode];
  const dirty = Object.keys(draft).length > 0;

  const run = async (label: string, fn: () => Promise<void>) => {
    setErr(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy('');
    }
  };
  const saveCreds = () =>
    run('save', async () => {
      const next = await put<IntegrationView>(`/api/admin/integrations/${i.key}/${mode}/credentials`, { values: draft });
      setDraft({});
      setReplacing({});
      onChanged(next);
      toast('Credentials saved and encrypted');
    });
  const verify = () =>
    run('verify', async () => {
      const r = await post<{ check: { ok: boolean; message: string }; integration: IntegrationView }>(`/api/admin/integrations/${i.key}/${mode}/verify`);
      onChanged(r.integration);
      toast(r.check.ok ? 'Connection verified' : r.check.message, r.check.ok ? 'success' : 'error');
    });
  const activate = (enabled: boolean, target: 'test' | 'live', confirm?: string) =>
    run('activate', async () => {
      const next = await post<IntegrationView>(`/api/admin/integrations/${i.key}/activate`, { enabled, mode: target, confirm });
      onChanged(next);
      setConfirmLive(null);
      setTyped('');
      toast(enabled ? (i.singleMode ? `${i.label} enabled` : `${i.label.split(' ')[0]} enabled in ${target} mode`) : 'Disabled');
    });
  const sendTest = () =>
    run('test', async () => {
      const r = await post<{ sent: boolean; to: string }>('/api/admin/integrations/smtp/test-message');
      toast(`Test email sent to ${r.to}`);
    });
  const requestActivate = (enabled: boolean, target: 'test' | 'live') => {
    if (enabled && i.kind === 'payment' && target === 'live' && !(i.enabled && i.activeMode === 'live')) setConfirmLive({ enabled, mode: target });
    else void activate(enabled, target);
  };

  const sourceLabel = i.effective.source === 'admin' ? 'Managed here' : i.effective.source === 'env' ? 'Using server environment variables (legacy)' : 'Not configured';
  return (
    <section className="a-card gateway">
      <div className="a-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{i.label}</h2>
        <div className="actions">
          {i.inUse ? (
            <>
              <span className={`badge ${i.effective.enabled ? 'badge--success' : ''}`}>{i.effective.enabled ? 'enabled' : 'disabled'}</span>
              {i.singleMode ? null : <span className={`badge ${i.effective.mode === 'live' ? 'badge--danger' : 'badge--warning'}`}>{i.effective.mode} mode</span>}
            </>
          ) : (
            <span className="badge">stored only — not connected yet</span>
          )}
          <span className="badge">{sourceLabel}</span>
        </div>
      </div>
      <ErrorBox error={err} />
      {i.effective.error ? <p className="alert alert--error">{i.effective.error} — re-enter the credentials.</p> : null}
      {i.effective.source === 'env' && i.env ? (
        <p className="alert alert--warning" style={{ fontSize: 13 }}>
          This {i.kind === 'payment' ? 'gateway' : 'integration'} currently runs on settings from the server environment ({Object.entries(i.env)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · ')}
          ). Saving here moves management to the dashboard; the environment values are then ignored.
        </p>
      ) : null}
      {!i.inUse ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Store the I Mile API credentials securely here when I Mile provides them. They are encrypted and not used yet: fulfilment stays manual until an I Mile API integration is built and tested.
        </p>
      ) : null}
      {production && i.effective.enabled && i.effective.mode === 'test' ? <p className="alert alert--warning">Test mode on the production site: customers cannot pay for real orders.</p> : null}

      {i.singleMode ? null : (
      <Tabs
        tabs={[
          ['test', `Test credentials${i.activeMode === 'test' && i.enabled ? ' (active)' : ''}`],
          ['live', `Live credentials${i.activeMode === 'live' && i.enabled ? ' (active)' : ''}`],
        ]}
        value={mode}
        onChange={(v) => (setMode(v), setDraft({}), setReplacing({}))}
      />
      )}
      <div className="form-grid form-grid--2 settings-form-grid">
        {i.fieldDefs.map((f) => {
          const view = m.fields.find((x) => x.key === f.key);
          const editing = !f.secret || replacing[f.key] || !view?.set;
          return (
            <F key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint}>
              {f.secret && view?.set && !replacing[f.key] ? (
                <div className="secret-row">
                  <code className="ltr">{draft[f.key] === null ? '(will be removed)' : view.masked}</code>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setReplacing({ ...replacing, [f.key]: true })}>
                    Replace
                  </button>
                  {!f.required ? (
                    <button type="button" className="btn btn--ghost btn--sm danger" onClick={() => setDraft({ ...draft, [f.key]: null })}>
                      Remove
                    </button>
                  ) : null}
                </div>
              ) : editing ? (
                <input
                  className="input ltr"
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={f.secret ? 'Paste the new secret' : ''}
                  value={(draft[f.key] as string | undefined) ?? (f.secret ? '' : (view?.value ?? ''))}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              ) : null}
            </F>
          );
        })}
      </div>
      <div className="gateway__row">
        {i.verifiable ? <VerificationBadge v={m.verification} /> : <span className="muted">Automatic connection test not available for this integration.</span>}
        <div className="actions">
          <button className="btn btn--primary btn--sm" disabled={!dirty || !canStore || Boolean(busy)} onClick={() => void saveCreds()}>
            {busy === 'save' ? 'Saving…' : i.singleMode ? 'Save settings' : `Save ${mode} credentials`}
          </button>
          {i.verifiable ? (
            <button className="btn btn--outline btn--sm" disabled={dirty || Boolean(busy) || m.missing.length > 0} onClick={() => void verify()} title={dirty ? 'Save first' : undefined}>
              {busy === 'verify' ? 'Testing…' : 'Test connection'}
            </button>
          ) : null}
          {i.key === 'smtp' ? (
            <button className="btn btn--outline btn--sm" disabled={dirty || Boolean(busy) || m.missing.length > 0} onClick={() => void sendTest()} title="Sends a real email to your own address">
              {busy === 'test' ? 'Sending…' : 'Send test email to me'}
            </button>
          ) : null}
        </div>
      </div>
      {m.missing.length ? <p className="muted" style={{ fontSize: 13 }}>Missing{i.singleMode ? '' : ` for ${mode} mode`}: {m.missing.join(', ')}</p> : null}

      {i.inUse && i.singleMode ? (
        <div className="gateway__activate">
          <strong>Use for sending</strong>
          <span className="muted" style={{ fontSize: 13 }}>Enabling requires saved settings that passed “Test connection”. While disabled, messages are not sent and are logged as skipped.</span>
          <div className="actions">
            {i.enabled ? (
              <button className="btn btn--ghost btn--sm danger" disabled={Boolean(busy)} onClick={() => window.confirm(`Disable ${i.label}? Customers will stop receiving these messages.`) && requestActivate(false, 'live')}>
                Disable
              </button>
            ) : (
              <button className="btn btn--primary btn--sm" disabled={Boolean(busy)} onClick={() => requestActivate(true, 'live')}>
                Enable
              </button>
            )}
          </div>
        </div>
      ) : i.inUse ? (
        <div className="gateway__activate">
          <strong>Use for payments</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            Enabling requires saved credentials that passed “Test connection”. Live mode processes real customer money.
          </span>
          <div className="actions">
            {i.enabled ? (
              <>
                <button className="btn btn--ghost btn--sm danger" disabled={Boolean(busy)} onClick={() => window.confirm(`Disable ${i.label}? Customers will no longer see these payment methods.`) && requestActivate(false, i.activeMode)}>
                  Disable
                </button>
                {i.activeMode === 'test' ? (
                  <button className="btn btn--outline btn--sm" disabled={Boolean(busy)} onClick={() => requestActivate(true, 'live')}>
                    Switch to live…
                  </button>
                ) : (
                  <button className="btn btn--outline btn--sm" disabled={Boolean(busy)} onClick={() => window.confirm('Switch back to test mode? Real payments will stop.') && requestActivate(true, 'test')}>
                    Switch to test
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="btn btn--outline btn--sm" disabled={Boolean(busy)} onClick={() => requestActivate(true, 'test')}>
                  Enable in test mode
                </button>
                <button className="btn btn--primary btn--sm" disabled={Boolean(busy)} onClick={() => requestActivate(true, 'live')}>
                  Enable in live mode…
                </button>
              </>
            )}
          </div>
          {i.liveConfirmedAt ? <span className="muted" style={{ fontSize: 12 }}>Live mode last confirmed {dt(i.liveConfirmedAt)}</span> : null}
        </div>
      ) : null}

      {confirmLive ? (
        <Modal title="Confirm live payments" onClose={() => (setConfirmLive(null), setTyped(''))}>
          <p>
            You are about to process <strong>real customer payments</strong> through {i.label}. Make sure the live credentials passed “Test connection”, the webhook is registered in the {i.label.split(' ')[0]} dashboard, and a small real payment + refund has been tested.
          </p>
          <F label='Type LIVE to confirm'>
            <input className="input ltr" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </F>
          <button className="btn btn--primary" disabled={typed !== 'LIVE' || Boolean(busy)} onClick={() => void activate(confirmLive.enabled, confirmLive.mode, 'LIVE')}>
            Switch to live
          </button>
        </Modal>
      ) : null}
    </section>
  );
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}


