import { useEffect, useState, type FormEvent } from 'react';
import { ErrorState, Spinner } from '../../components/ui';
import { del, get, patch, post, put } from '../../lib/api';
import { invalidateCache, useApi } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import { Card, dt, en, ErrorBox, F, LocInput, Modal, ProductPicker, Status, Tabs, AHead, usePerms } from '../kit';
import { MediaField } from '../media';

type TabKey = 'home' | 'banners' | 'collections' | 'campaigns' | 'pages' | 'reviews';
const emptyL = { ar: '', en: '' };
const dateIn = (s?: string | null) => (s ? new Date(s).toISOString().slice(0, 16) : '');
const dateOut = (s: string) => (s ? new Date(s).toISOString() : null);

export function Content({ canSettings, canReviews }: { canSettings: boolean; canReviews: boolean }) {
  const [tab, setTab] = useState<TabKey>(canSettings ? 'home' : 'banners');
  const tabs: [TabKey, string][] = [
    ...(canSettings ? ([['home', 'Homepage']] as [TabKey, string][]) : []),
    ['banners', 'Banners'],
    ['collections', 'Collections & bundles'],
    ['campaigns', 'Seasonal campaigns'],
    ['pages', 'Policy pages'],
    ...(canReviews ? ([['reviews', 'Reviews']] as [TabKey, string][]) : []),
  ];
  return (
    <>
      <AHead title="Website content" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'home' ? <HomepageSettings /> : null}
      {tab === 'banners' ? <Banners /> : null}
      {tab === 'collections' ? <Collections /> : null}
      {tab === 'campaigns' ? <Campaigns /> : null}
      {tab === 'pages' ? <Pages /> : null}
      {tab === 'reviews' ? <Reviews /> : null}
    </>
  );
}

type Homepage = {
  heroSortOrder: number;
  heroDurationSec: number;
  heroVideoDurationSec: number;
  heroVideoFallbackSec: number;
  heroDescription: Localized;
  heroEnabled: boolean;
  heroVideoUrl: string;
  heroPosterUrl: string;
  heroMobileVideoUrl: string;
  heroMobilePosterUrl: string;
  heroTitle: Localized;
  heroSubtitle: Localized;
  heroCtaLabel: Localized;
  heroCtaLink: string;
  brandStory: Localized;
  brandStoryImageUrl: string;
  newsletterEnabled: boolean;
};
const HOMEPAGE_DEFAULTS: Homepage = {
  heroSortOrder: -1,
  heroDurationSec: 5,
  heroVideoDurationSec: 0,
  heroVideoFallbackSec: 20,
  heroDescription: { ar: '', en: '' },
  heroEnabled: true,
  heroVideoUrl: '',
  heroPosterUrl: '',
  heroMobileVideoUrl: '',
  heroMobilePosterUrl: '',
  heroTitle: { ar: '', en: '' },
  heroSubtitle: { ar: '', en: '' },
  heroCtaLabel: { ar: '', en: '' },
  heroCtaLink: '',
  brandStory: { ar: '', en: '' },
  brandStoryImageUrl: '',
  newsletterEnabled: true,
};

function HomepageSettings() {
  const [h, setH] = useState<Homepage | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  useEffect(() => {
    get<{ settings: { homepage: Partial<Homepage> } }>('/api/admin/settings').then((r) => setH({ ...HOMEPAGE_DEFAULTS, ...r.settings.homepage }));
  }, []);
  if (!h) return <Spinner />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await put('/api/admin/settings', { homepage: h });
      invalidateCache();
      toast('Homepage saved');
    } catch (ex) {
      setErr(ex);
    }
  };
  return (
    <form onSubmit={save}>
      <ErrorBox error={err} />
      <Card title="Hero">
        <p className="muted" style={{ fontSize: 13 }}>
          This hero and active Hero banners rotate together in ascending sort order. Use the Banners tab to add images or videos. Video duration 0 plays to completion; a positive video duration sets an earlier endpoint; posters appear while loading or when motion/data saving is enabled.
        </p>
        <div className="form-grid form-grid--2">
          <label className="check span-2">
            <input type="checkbox" checked={h.heroEnabled} onChange={(e) => setH({ ...h, heroEnabled: e.target.checked })} /> Show the hero section
          </label>
          <MediaField label="Hero video — desktop" kind="video" value={h.heroVideoUrl} poster={h.heroPosterUrl} onChange={(url, a) => setH({ ...h, heroVideoUrl: url, heroPosterUrl: a?.posterUrl && !h.heroPosterUrl ? a.posterUrl : h.heroPosterUrl })} />
          <MediaField label="Poster image — desktop" kind="image" value={h.heroPosterUrl} onChange={(url) => setH({ ...h, heroPosterUrl: url })} />
          <MediaField
            label="Hero video — mobile (optional, vertical 9:16)"
            kind="video"
            value={h.heroMobileVideoUrl}
            poster={h.heroMobilePosterUrl}
            hint="Empty = the desktop video is used on phones."
            onChange={(url, a) => setH({ ...h, heroMobileVideoUrl: url, heroMobilePosterUrl: a?.posterUrl && !h.heroMobilePosterUrl ? a.posterUrl : h.heroMobilePosterUrl })}
          />
          <MediaField label="Poster image — mobile (optional)" kind="image" value={h.heroMobilePosterUrl} onChange={(url) => setH({ ...h, heroMobilePosterUrl: url })} />
          <LocInput label="Hero headline (empty = default)" value={h.heroTitle} onChange={(v) => setH({ ...h, heroTitle: v })} />
          <F label="Hero sort order" hint="Combined with Hero banner sort order; lower numbers play first."><input className="input" type="number" step="1" value={h.heroSortOrder} onChange={e => setH({ ...h, heroSortOrder: Number(e.target.value) })} /></F>
          <F label="Hero image duration (seconds)" hint="Display this image for the specified number of seconds. Use a positive number."><input className="input" type="number" min="0" step="any" required value={h.heroDurationSec} onChange={e => setH({ ...h, heroDurationSec: Number(e.target.value) })} /></F>
          <F label="Hero video duration (seconds)" hint="0 = complete original video. A positive value advances at that playback time, or sooner if the video ends."><input className="input" type="number" min="0" step="any" required value={h.heroVideoDurationSec} onChange={e => setH({ ...h, heroVideoDurationSec: Number(e.target.value) })} /></F>
          <F label="Hero video fallback (seconds)" hint="Recovery window for failed playback, stalled streams or unavailable provider tracking. Separate from video duration."><input className="input" type="number" min="2" max="300" step="0.5" value={h.heroVideoFallbackSec} onChange={e => setH({ ...h, heroVideoFallbackSec: Number(e.target.value) })} /></F>
          <LocInput label="Hero description" value={h.heroDescription} onChange={v => setH({ ...h, heroDescription: v })} textarea />
          <LocInput label="Hero sub-headline" value={h.heroSubtitle} onChange={(v) => setH({ ...h, heroSubtitle: v })} />
          <LocInput label="Button label (empty = “Shop now”)" value={h.heroCtaLabel} onChange={(v) => setH({ ...h, heroCtaLabel: v })} />
          <F label="Button destination" hint="Site path like /shop or /c/power-banks (language added automatically), or https://…">
            <input className="input ltr" value={h.heroCtaLink} placeholder="/shop" onChange={(e) => setH({ ...h, heroCtaLink: e.target.value })} />
          </F>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Preview after saving:{' '}
          <a href="/ar" target="_blank" rel="noreferrer">
            Arabic homepage ↗
          </a>{' '}
          ·{' '}
          <a href="/en" target="_blank" rel="noreferrer">
            English homepage ↗
          </a>
        </p>
      </Card>
      <Card title="Brand story">
        <div className="form-grid form-grid--2">
          <LocInput label="Story text (only facts confirmed by CELIBERY)" textarea value={h.brandStory} onChange={(v) => setH({ ...h, brandStory: v })} />
          <MediaField label="Story image" kind="image" value={h.brandStoryImageUrl} onChange={(url) => setH({ ...h, brandStoryImageUrl: url })} />
          <label className="check">
            <input type="checkbox" checked={h.newsletterEnabled} onChange={(e) => setH({ ...h, newsletterEnabled: e.target.checked })} /> Show newsletter section
          </label>
        </div>
      </Card>
      <button className="btn btn--primary">Save homepage</button>
    </form>
  );
}

type Banner = { description?: Localized; durationSec?: number; videoDurationSec?: number; videoFallbackSec?: number; _id?: string; placement: string; title: Localized; subtitle: Localized; ctaLabel: Localized; link: string; imageUrl: Localized; mobileImageUrl: Localized; videoUrl?: string; mobileVideoUrl?: string; posterUrl?: string; theme: string; active: boolean; startsAt?: string | null; endsAt?: string | null; sortOrder: number };
function Banners() {
  const { data, error, loading, reload } = useApi<Banner[]>('/api/admin/content/banners');
  const [edit, setEdit] = useState<Banner | null>(null);
  const [err, setErr] = useState<unknown>(null);
  if (error) return <ErrorState message={error.message} />;
  if (loading || !data) return <Spinner />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const { _id, ...b } = edit!;
    const body = { description: b.description ?? emptyL, durationSec: Number(b.durationSec ?? 5), videoDurationSec: Number(b.videoDurationSec ?? 0), videoFallbackSec: Number(b.videoFallbackSec ?? 20), placement: b.placement, title: b.title, subtitle: b.subtitle, ctaLabel: b.ctaLabel, link: b.link, imageUrl: b.imageUrl, mobileImageUrl: b.mobileImageUrl, videoUrl: b.videoUrl ?? '', mobileVideoUrl: b.mobileVideoUrl ?? '', posterUrl: b.posterUrl ?? '', theme: b.theme, active: b.active, startsAt: b.startsAt || null, endsAt: b.endsAt || null, sortOrder: Number(b.sortOrder) };
    try {
      if (_id) await put(`/api/admin/content/banners/${_id}`, body);
      else await post('/api/admin/content/banners', body);
      invalidateCache();
      setEdit(null);
      reload();
    } catch (ex) {
      setErr(ex);
    }
  };
  return (
    <>
      <Card
        title="Banners"
        actions={
          <button className="btn btn--primary btn--sm" onClick={() => setEdit({ placement: 'hero', title: emptyL, subtitle: emptyL, ctaLabel: emptyL, link: '/shop', imageUrl: emptyL, mobileImageUrl: emptyL, theme: 'dark', active: true, sortOrder: 0 })}>
            + New banner
          </button>
        }
      >
        <div className="table-wrap banners-table-card"><table className="table banners-table">
          <thead>
            <tr>
              <th>Placement</th>
              <th>Title</th>
              <th>Schedule</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((b) => (
              <tr key={b._id}>
                <td>{b.placement}</td>
                <td>{en(b.title) || '—'}</td>
                <td>
                  {b.startsAt ? dt(b.startsAt) : 'Always'} {b.endsAt ? `→ ${dt(b.endsAt)}` : ''}
                </td>
                <td>{b.active ? 'Yes' : 'No'}</td>
                <td className="actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => setEdit(b)}>
                    Edit
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={async () => {
                      if (window.confirm('Delete banner?')) {
                        await del(`/api/admin/content/banners/${b._id}`);
                        reload();
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!data.length ? <p className="muted">No banners yet. Hero banners replace the animated product slider; lifestyle banners appear mid-page.</p> : null}
      </Card>
      {edit ? (
        <Modal title={edit._id ? 'Edit banner' : 'New banner'} onClose={() => setEdit(null)} wide>
          <form className="form-grid form-grid--2 banners-form" onSubmit={save}>
            <div className="span-2">
              <ErrorBox error={err} />
            </div>
            <F label="Placement">
              <select className="select" value={edit.placement} onChange={(e) => setEdit({ ...edit, placement: e.target.value })}>
                <option value="hero">Homepage hero (dark)</option>
                <option value="lifestyle">Lifestyle banner</option>
                <option value="promo">Promo</option>
                <option value="campaign">Campaign</option>
              </select>
            </F>
            <F label="Theme">
              <select className="select" value={edit.theme} onChange={(e) => setEdit({ ...edit, theme: e.target.value })}>
                <option value="dark">Dark text overlay</option>
                <option value="light">Light</option>
              </select>
            </F>
            <LocInput label="Title" value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} />
            <F label="Image duration (seconds)" hint="Display this image for the specified number of seconds. Use a positive number."><input className="input" type="number" min="0" step="any" required value={edit.durationSec ?? 5} onChange={e => setEdit({ ...edit, durationSec: Number(e.target.value) })} /></F>
            <F label="Video duration (seconds)" hint="0 = complete original video. A positive value advances at that playback time, or sooner if the video ends."><input className="input" type="number" min="0" step="any" required value={edit.videoDurationSec ?? 0} onChange={e => setEdit({ ...edit, videoDurationSec: Number(e.target.value) })} /></F>
            <F label="Video fallback (seconds)" hint="Recovery window for failures or unavailable provider tracking; separate from normal video duration."><input className="input" type="number" min="2" max="300" step="0.5" value={edit.videoFallbackSec ?? 20} onChange={e => setEdit({ ...edit, videoFallbackSec: Number(e.target.value) })} /></F>
            <LocInput label="Description" value={edit.description} onChange={v => setEdit({ ...edit, description: v })} textarea />
            <LocInput label="Subtitle" value={edit.subtitle} onChange={(v) => setEdit({ ...edit, subtitle: v })} />
            <LocInput label="Button label" value={edit.ctaLabel} onChange={(v) => setEdit({ ...edit, ctaLabel: v })} />
            <F label="Link" hint="Site path like /c/power-banks (language is added automatically) or a full URL">
              <input className="input" value={edit.link} onChange={(e) => setEdit({ ...edit, link: e.target.value })} />
            </F>
            <F label="Sort order">
              <input className="input" type="number" value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} />
            </F>
            <MediaField label="Image — desktop, Arabic site" kind="image" value={edit.imageUrl.ar} onChange={(url) => setEdit({ ...edit, imageUrl: { ...edit.imageUrl, ar: url } })} />
            <MediaField label="Image — desktop, English site" kind="image" value={edit.imageUrl.en} onChange={(url) => setEdit({ ...edit, imageUrl: { ...edit.imageUrl, en: url } })} hint="Use the same image for both languages if it contains no text." />
            <MediaField label="Image — mobile, Arabic (optional)" kind="image" value={edit.mobileImageUrl.ar} onChange={(url) => setEdit({ ...edit, mobileImageUrl: { ...edit.mobileImageUrl, ar: url } })} />
            <MediaField label="Image — mobile, English (optional)" kind="image" value={edit.mobileImageUrl.en} onChange={(url) => setEdit({ ...edit, mobileImageUrl: { ...edit.mobileImageUrl, en: url } })} />
            <MediaField
              label="Video (optional — plays instead of the image)"
              kind="video"
              value={edit.videoUrl ?? ''}
              poster={edit.posterUrl}
              onChange={(url, a) => setEdit({ ...edit, videoUrl: url, posterUrl: a?.posterUrl && !edit.posterUrl ? a.posterUrl : edit.posterUrl })}
            />
            <MediaField label="Video — mobile (optional)" kind="video" value={edit.mobileVideoUrl ?? ''} onChange={(url) => setEdit({ ...edit, mobileVideoUrl: url })} />
            <MediaField label="Video poster image" kind="image" value={edit.posterUrl ?? ''} onChange={(url) => setEdit({ ...edit, posterUrl: url })} hint="Shown while the video loads and to visitors who prefer reduced motion. Defaults to the desktop image." />
            <F label="Starts">
              <input className="input" type="datetime-local" value={dateIn(edit.startsAt)} onChange={(e) => setEdit({ ...edit, startsAt: dateOut(e.target.value) })} />
            </F>
            <F label="Ends">
              <input className="input" type="datetime-local" value={dateIn(edit.endsAt)} onChange={(e) => setEdit({ ...edit, endsAt: dateOut(e.target.value) })} />
            </F>
            <label className="check">
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active
            </label>
            <button className="btn btn--primary span-2">Save banner</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

type Collection = { _id?: string; slug: string; kind: string; title: Localized; description: Localized; products: string[]; active: boolean; showOnHome: boolean; sortOrder: number };
function Collections() {
  const { data, error, loading, reload } = useApi<Collection[]>('/api/admin/content/collections');
  const [edit, setEdit] = useState<Collection | null>(null);
  const [err, setErr] = useState<unknown>(null);
  if (error) return <ErrorState message={error.message} />;
  if (loading || !data) return <Spinner />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const { _id, ...c } = edit!;
    const body = { slug: c.slug, kind: c.kind, title: c.title, description: c.description, products: c.products.map(String), active: c.active, showOnHome: c.showOnHome, sortOrder: Number(c.sortOrder) };
    try {
      if (_id) await put(`/api/admin/content/collections/${_id}`, body);
      else await post('/api/admin/content/collections', body);
      invalidateCache();
      setEdit(null);
      reload();
    } catch (ex) {
      setErr(ex);
    }
  };
  return (
    <>
      <Card title="Collections" actions={<button className="btn btn--primary btn--sm" onClick={() => setEdit({ slug: '', kind: 'custom', title: emptyL, description: emptyL, products: [], active: true, showOnHome: false, sortOrder: 0 })}>+ New collection</button>}>
        <p className="muted" style={{ fontSize: 13 }}>
          “bundles” is the Bundles &amp; Gift Kits menu item (Q17). “best-sellers” is only used until real sales data exists. “for-travel / work / fitness / home” feed the use-case section.
        </p>
        <div className="table-wrap collections-table-card"><table className="table collections-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Slug</th>
              <th>Kind</th>
              <th>Products</th>
              <th>Home</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c._id}>
                <td>{en(c.title)}</td>
                <td>{c.slug}</td>
                <td>{c.kind}</td>
                <td>{c.products.length}</td>
                <td>{c.showOnHome ? 'Yes' : 'No'}</td>
                <td>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEdit({ ...c, products: c.products.map(String) })}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      {edit ? (
        <Modal title={edit._id ? `Edit ${edit.slug}` : 'New collection'} onClose={() => setEdit(null)} wide>
          <form className="form-grid form-grid--2 collections-form" onSubmit={save}>
            <div className="span-2">
              <ErrorBox error={err} />
            </div>
            <LocInput label="Title" required value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} />
            <F label="Slug">
              <input className="input" required value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase() })} />
            </F>
            <F label="Kind">
              <select className="select" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                {['custom', 'featured', 'best_sellers', 'bundles', 'use_case', 'series', 'campaign'].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </F>
            <LocInput label="Description" value={edit.description} onChange={(v) => setEdit({ ...edit, description: v })} />
            <ProductPicker value={edit.products} onChange={(ids) => setEdit({ ...edit, products: ids })} />
            <label className="check">
              <input type="checkbox" checked={edit.showOnHome} onChange={(e) => setEdit({ ...edit, showOnHome: e.target.checked })} /> Show on homepage
            </label>
            <label className="check">
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active
            </label>
            <button className="btn btn--primary span-2">Save collection</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

type Campaign = { _id?: string; slug: string; kind: string; title: Localized; description: Localized; heroImageUrl: string; heroMobileImageUrl?: string; heroVideoUrl?: string; accentColor: string; collection?: string | null; discountCode: string; active: boolean; showOnHome: boolean; startsAt?: string | null; endsAt?: string | null };
function Campaigns() {
  const { data, error, loading, reload } = useApi<Campaign[]>('/api/admin/content/campaigns');
  const cols = useApi<Collection[]>('/api/admin/content/collections');
  const [edit, setEdit] = useState<Campaign | null>(null);
  const [err, setErr] = useState<unknown>(null);
  if (error) return <ErrorState message={error.message} />;
  if (loading || !data) return <Spinner />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const { _id, ...c } = edit!;
    const body = { slug: c.slug, kind: c.kind, title: c.title, description: c.description, heroImageUrl: c.heroImageUrl, heroMobileImageUrl: c.heroMobileImageUrl ?? '', heroVideoUrl: c.heroVideoUrl ?? '', accentColor: c.accentColor, collection: c.collection || null, discountCode: c.discountCode, active: c.active, showOnHome: c.showOnHome, startsAt: c.startsAt || null, endsAt: c.endsAt || null };
    try {
      if (_id) await put(`/api/admin/content/campaigns/${_id}`, body);
      else await post('/api/admin/content/campaigns', body);
      invalidateCache();
      setEdit(null);
      reload();
    } catch (ex) {
      setErr(ex);
    }
  };
  return (
    <>
      <Card title="Saudi seasonal campaigns" actions={<button className="btn btn--primary btn--sm" onClick={() => setEdit({ slug: '', kind: 'seasonal', title: emptyL, description: emptyL, heroImageUrl: '', accentColor: '', collection: null, discountCode: '', active: false, showOnHome: true })}>+ New campaign</button>}>
        <p className="muted" style={{ fontSize: 13 }}>
          Ramadan, Eid, National Day and Umrah &amp; travel templates are pre-created and inactive. Set dates, a collection and (optionally) a discount code from Discounts, then activate. Each campaign gets a landing page at /campaign/&lt;slug&gt;.
        </p>
        <div className="table-wrap campaigns-table-card"><table className="table campaigns-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Schedule</th>
              <th>Code</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c._id}>
                <td>
                  {en(c.title)} <span className="muted">/{c.slug}</span>
                </td>
                <td>
                  {c.startsAt ? dt(c.startsAt) : '—'} → {c.endsAt ? dt(c.endsAt) : '—'}
                </td>
                <td>{c.discountCode || '—'}</td>
                <td>{c.active ? <span className="badge badge--success">active</span> : <span className="badge">inactive</span>}</td>
                <td>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEdit({ ...c, collection: c.collection ? String(c.collection) : null })}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      {edit ? (
        <Modal title={edit._id ? `Edit ${edit.slug}` : 'New campaign'} onClose={() => setEdit(null)} wide>
          <form className="form-grid form-grid--2 campaigns-form" onSubmit={save}>
            <div className="span-2">
              <ErrorBox error={err} />
            </div>
            <LocInput label="Title" required value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} />
            <F label="Slug">
              <input className="input" required value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase() })} />
            </F>
            <F label="Kind">
              <select className="select" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                {['ramadan', 'eid', 'national_day', 'umrah_travel', 'gifting', 'seasonal'].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </F>
            <LocInput label="Description" textarea value={edit.description} onChange={(v) => setEdit({ ...edit, description: v })} />
            <MediaField label="Campaign hero image" kind="image" value={edit.heroImageUrl} onChange={(url) => setEdit({ ...edit, heroImageUrl: url })} />
            <MediaField label="Campaign hero image — mobile (optional)" kind="image" value={edit.heroMobileImageUrl ?? ''} onChange={(url) => setEdit({ ...edit, heroMobileImageUrl: url })} />
            <MediaField label="Campaign video (optional)" kind="video" value={edit.heroVideoUrl ?? ''} poster={edit.heroImageUrl} onChange={(url) => setEdit({ ...edit, heroVideoUrl: url })} />
            <F label="Accent colour (e.g. #006C35 for National Day)">
              <input className="input" value={edit.accentColor} onChange={(e) => setEdit({ ...edit, accentColor: e.target.value })} />
            </F>
            <F label="Product collection">
              <select className="select" value={edit.collection ?? ''} onChange={(e) => setEdit({ ...edit, collection: e.target.value || null })}>
                <option value="">None</option>
                {(cols.data ?? []).map((c) => (
                  <option key={c._id} value={c._id}>
                    {en(c.title)}
                  </option>
                ))}
              </select>
            </F>
            <F label="Discount code to display (create it in Discounts)">
              <input className="input" value={edit.discountCode} onChange={(e) => setEdit({ ...edit, discountCode: e.target.value.toUpperCase() })} />
            </F>
            <F label="Starts">
              <input className="input" type="datetime-local" value={dateIn(edit.startsAt)} onChange={(e) => setEdit({ ...edit, startsAt: dateOut(e.target.value) })} />
            </F>
            <F label="Ends">
              <input className="input" type="datetime-local" value={dateIn(edit.endsAt)} onChange={(e) => setEdit({ ...edit, endsAt: dateOut(e.target.value) })} />
            </F>
            <label className="check">
              <input type="checkbox" checked={edit.showOnHome} onChange={(e) => setEdit({ ...edit, showOnHome: e.target.checked })} /> Show on homepage
            </label>
            <label className="check">
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active
            </label>
            <button className="btn btn--primary span-2">Save campaign</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

type Page = { _id: string; slug: string; title: Localized; body: Localized; status: string; approvedBy: string; approvedAt?: string; version?: number; updatedAt?: string };
type PageRevision = { _id: string; title: Localized; status: string; approvedBy: string; savedByName: string; reason: string; createdAt: string };
function Pages() {
  const { data, error, loading, reload } = useApi<Page[]>('/api/admin/content/pages');
  const perms = usePerms();
  const canApprove = perms.has('business:write');
  const [edit, setEdit] = useState<(Page & { reason?: string }) | null>(null);
  const [history, setHistory] = useState<Page | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  if (error) return <ErrorState message={error.message} />;
  if (loading || !data) return <Spinner />;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const saved = await put<Page>(`/api/admin/content/pages/${edit!._id}`, { title: edit!.title, body: edit!.body, status: edit!.status, approvedBy: edit!.approvedBy, reason: edit!.reason ?? '' });
      setEdit(null);
      reload();
      toast(saved.status === 'approved' ? 'Saved and approved' : 'Saved as draft — the previous version is kept in the history');
    } catch (ex) {
      setErr(ex);
    }
  };
  return (
    <>
      <Card title="Policy pages">
        <p className="muted" style={{ fontSize: 13 }}>
          Privacy, Terms &amp; Conditions, Returns, Refunds, Shipping and Warranty — drafts prepared for review by CELIBERY’s legal advisor (Q31). Replace every [bracketed] placeholder and remove the draft note.
          Every save keeps the previous version. {canApprove ? 'You can mark a policy as approved.' : 'Only staff with the legal & business permission can mark a policy as approved; editing an approved policy returns it to draft.'}
        </p>
        <div className="table-wrap pages-table-card"><table className="table pages-table">
          <tbody>
            {data.map((p) => (
              <tr key={p._id}>
                <td>{en(p.title)}</td>
                <td>
                  <Status value={p.status === 'approved' ? 'active' : 'draft'} /> {p.approvedBy ? <span className="muted">by {p.approvedBy}</span> : null} {p.version ? <span className="muted">· v{p.version}</span> : null}
                </td>
                <td>
                  <div className="actions">
                    <button className="btn btn--ghost btn--sm" onClick={() => setEdit(p)}>
                      Edit
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => setHistory(p)}>
                      History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      {edit ? (
        <Modal title={en(edit.title)} onClose={() => setEdit(null)} wide>
          <form className="form-grid form-grid--2 pages-form" onSubmit={save}>
            <div className="span-2">
              <ErrorBox error={err} />
            </div>
            <LocInput label="Title" required value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} />
            <LocInput label="Body (supports ## headings, - lists, > notes)" textarea value={edit.body} onChange={(v) => setEdit({ ...edit, body: v })} />
            <F label="Status">
              <select className="select" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                <option value="draft">Draft</option>
                <option value="approved" disabled={!canApprove && edit.status !== 'approved'}>
                  Approved by legal advisor{!canApprove ? ' (requires legal & business permission)' : ''}
                </option>
              </select>
            </F>
            <F label="Approved by">
              <input className="input" disabled={!canApprove} value={edit.approvedBy} onChange={(e) => setEdit({ ...edit, approvedBy: e.target.value })} />
            </F>
            <F label="Change note (kept in the history)" span>
              <input className="input" maxLength={300} value={edit.reason ?? ''} placeholder="e.g. Legal advisor comments of 5 Nov applied" onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
            </F>
            <button className="btn btn--primary span-2">Save</button>
          </form>
        </Modal>
      ) : null}
      {history ? <PageHistory page={history} onClose={() => setHistory(null)} onRestored={() => (setHistory(null), reload())} /> : null}
    </>
  );
}
function PageHistory({ page, onClose, onRestored }: { page: Page; onClose: () => void; onRestored: () => void }) {
  const { data, error } = useApi<PageRevision[]>(`/api/admin/content/pages/${page._id}/revisions`);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  const restore = async (r: PageRevision) => {
    if (!window.confirm('Restore this version? It becomes the current text as a DRAFT; the current text is kept in the history.')) return;
    try {
      await post(`/api/admin/content/pages/${page._id}/revisions/${r._id}/restore`);
      toast('Version restored as draft');
      onRestored();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <Modal title={`History — ${en(page.title)}`} onClose={onClose} wide>
      <ErrorBox error={err || error} />
      {!data ? <Spinner /> : null}
      {data && !data.length ? <p className="muted">No earlier versions yet — a version is saved every time this policy changes.</p> : null}
      {data?.length ? (
        <div className="table-wrap page-history-table-card"><table className="table page-history-table">
          <thead>
            <tr>
              <th>Saved</th>
              <th>Status then</th>
              <th>By</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r._id}>
                <td>{dt(r.createdAt)}</td>
                <td>
                  <Status value={r.status === 'approved' ? 'active' : 'draft'} /> {r.approvedBy ? <span className="muted">by {r.approvedBy}</span> : null}
                </td>
                <td>{r.savedByName}</td>
                <td>{r.reason}</td>
                <td>
                  <button className="btn btn--ghost btn--sm" onClick={() => void restore(r)}>
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : null}
    </Modal>
  );
}

type Review = { _id: string; rating: number; title: string; body: string; status: string; createdAt: string; product?: { sku: string; name: Localized }; customer?: { name: string; email: string } };

function Reviews() {
  const { data, error, loading, reload } = useApi<Review[]>('/api/admin/content/reviews');
  if (error) return <ErrorState message={error.message} />;
  if (loading || !data) return <Spinner />;
  return (
    <Card title="Customer reviews">
      <p className="muted reviews-note" style={{ fontSize: 13 }}>
        Only customers with a delivered order can review a product. Reviews stay hidden on the store until “Show reviews” is enabled in Settings (Q19: no imported reviews).
      </p>
      {data.map((r) => (
        <div key={r._id} className="picker__row reviews-row" style={{ alignItems: 'flex-start' }}>
          <div>
            <strong>{'★'.repeat(r.rating)}</strong> {r.title} — <span className="muted">{r.product?.sku}</span>
            <div>{r.body}</div>
            <div className="muted">
              {r.customer?.name} · {dt(r.createdAt)}
            </div>
          </div>
          <div className="actions">
            <Status value={r.status} />
            {r.status !== 'approved' ? (
              <button
                className="btn btn--outline btn--sm"
                onClick={async () => {
                  await patch(`/api/admin/content/reviews/${r._id}`, { status: 'approved' });
                  reload();
                }}
              >
                Approve
              </button>
            ) : null}
            {r.status !== 'rejected' ? (
              <button
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  await patch(`/api/admin/content/reviews/${r._id}`, { status: 'rejected' });
                  reload();
                }}
              >
                Reject
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {!data.length ? <p className="muted">No reviews yet.</p> : null}
    </Card>
  );
}

