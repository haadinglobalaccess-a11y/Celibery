import { Router } from 'express';
import { z } from 'zod';
import { hasReplacementChar, repairMojibake } from '../../lib/text';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { MessageTemplate } from '../../models';
import {
  SAMPLE_VARS,
  TEMPLATES,
  buildEmail,
  fill,
  resolveContent,
  templateDef,
  validateOverride,
  type Lang,
  type TemplateOverride,
} from '../../integrations/notifications/templates';

/**
 * Admin → Settings → Notifications → Message templates. Wording of customer emails and the
 * WhatsApp status text, in Arabic and English, with {{placeholders}}, validation and preview.
 */
export const adminTemplateRoutes = Router();
adminTemplateRoutes.use(requirePermission('settings:write'));

// Not trimmed (line breaks are part of the message); damaged text is refused, reversible damage repaired.
const msg = (max: number) => z.string().max(max).refine((v) => !hasReplacementChar(v), 'Contains unreadable characters (\ufffd). Copy the text again from the original.').transform(repairMojibake);
const content = z.object({ subject: msg(200), body: msg(5000), whatsapp: msg(1024) }).partial();
const overrideInput = z.object({ ar: content.optional(), en: content.optional() });
const keyParam = z.object({ key: z.string().refine((k) => Boolean(templateDef(k)), 'Unknown template') });

function view(def: (typeof TEMPLATES)[number], o: TemplateOverride & { updatedAt?: Date } | null) {
  return {
    key: def.key,
    label: def.label,
    group: def.group,
    variables: def.variables,
    whatsapp: def.whatsapp,
    defaults: def.defaults,
    override: o ? { ar: o.ar ?? {}, en: o.en ?? {} } : null,
    effective: { ar: resolveContent(def, 'ar', o), en: resolveContent(def, 'en', o) },
    customized: Boolean(o && (['ar', 'en'] as const).some((l) => Object.values(o[l] ?? {}).some((v) => typeof v === 'string' && v.trim()))),
    updatedAt: o?.updatedAt ?? null,
  };
}

function assertValid(key: string, o: NonNullable<TemplateOverride>) {
  const errors = validateOverride(templateDef(key)!, o);
  if (Object.keys(errors).length) throw badRequest('VALIDATION_ERROR', 'Some template fields are invalid', { fieldErrors: errors });
}

adminTemplateRoutes.get(
  '/',
  ah(async (_req, res) => {
    const docs = await MessageTemplate.find().lean();
    return ok(res, TEMPLATES.map((d) => view(d, (docs.find((x) => x.key === d.key) as TemplateOverride & { updatedAt?: Date }) ?? null)));
  }),
);

adminTemplateRoutes.put(
  '/:key',
  validate(keyParam, 'params'),
  validate(overrideInput),
  ah(async (req, res) => {
    const key = req.params.key;
    const body = req.body as z.infer<typeof overrideInput>;
    assertValid(key, body);
    const set: Record<string, string> = {};
    for (const lang of ['ar', 'en'] as const) for (const [f, v] of Object.entries(body[lang] ?? {})) set[`${lang}.${f}`] = (v ?? '').trim() === '' ? '' : v!;
    const doc = await MessageTemplate.findOneAndUpdate({ key }, { $set: { ...set, updatedBy: req.user!.id } }, { upsert: true, new: true }).lean();
    await audit(req, 'template_update', 'template', key, Object.keys(set).join(', '));
    return ok(res, view(templateDef(key)!, doc as TemplateOverride & { updatedAt?: Date }));
  }),
);

adminTemplateRoutes.delete(
  '/:key',
  validate(keyParam, 'params'),
  ah(async (req, res) => {
    await MessageTemplate.deleteOne({ key: req.params.key });
    await audit(req, 'template_reset', 'template', req.params.key, 'restored defaults');
    return ok(res, view(templateDef(req.params.key)!, null));
  }),
);

/** Renders a message with sample data — the unsaved text from the editor when given. */
adminTemplateRoutes.post(
  '/:key/preview',
  validate(keyParam, 'params'),
  validate(z.object({ lang: z.enum(['ar', 'en']), content: content.optional() })),
  ah(async (req, res) => {
    const def = templateDef(req.params.key);
    if (!def) throw notFound('Template');
    const lang = req.body.lang as Lang;
    let o: TemplateOverride = (await MessageTemplate.findOne({ key: def.key }).lean()) as TemplateOverride;
    if (req.body.content) {
      o = { ...(o ?? {}), [lang]: { ...(o?.[lang] ?? {}), ...req.body.content } };
      assertValid(def.key, { [lang]: req.body.content });
    }
    const cta = def.key === 'auth.password_reset' ? (lang === 'ar' ? 'إعادة تعيين كلمة المرور' : 'Reset password') : def.key === 'staff.invite' ? (lang === 'ar' ? 'تعيين كلمة المرور' : 'Set password') : lang === 'ar' ? 'عرض الطلب' : 'View order';
    const lines: [string, string][] = def.group === 'order' ? [[lang === 'ar' ? 'الإجمالي' : 'Total', SAMPLE_VARS.total], [lang === 'ar' ? 'رقم التتبع' : 'Tracking number', SAMPLE_VARS.trackingNumber]] : [];
    const email = buildEmail(def, lang, SAMPLE_VARS, o, { lines, cta: { href: 'https://example.com/order', label: cta } });
    const whatsapp = def.whatsapp ? fill(resolveContent(def, lang, o).whatsapp, SAMPLE_VARS) : null;
    return ok(res, { email, whatsapp, sample: SAMPLE_VARS });
  }),
);
