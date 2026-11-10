import { useState } from 'react';
import { post } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useToast } from '../../state/toast';
import { useAT } from '../i18n';
import { ErrorBox } from '../kit';

/**
 * Admin → Orders → order → "Order confirmation": delivery state of the confirmation email and the
 * prepared WhatsApp message, with the actions staff need. Shows "sent" only when it was actually
 * confirmed (mail server accepted the email / a staff member confirmed the WhatsApp send).
 */
type HistoryEntry = { at: string; action: string; status: string; detail: string; by?: { name: string } | null };
type View = {
  orderConfirmed: boolean;
  config: { emailEnabled: boolean; smtpConfigured: boolean; whatsappEnabled: boolean; businessNumber: string; whatsappApi: boolean };
  email: { status: string; to: string; subject: string; attempts: number; maxAttempts: number; lastError: string; sentAt: string | null; nextAttemptAt: string | null; history: HistoryEntry[] } | null;
  whatsapp: { status: string; to: string; message: string; link: string | null; preparedAt: string | null; openedAt: string | null; confirmedAt: string | null; confirmedBy: { name: string } | null; lastError: string; history: HistoryEntry[] } | null;
};

const TXT = {
  en: {
    title: 'Order confirmation',
    email: 'Email',
    whatsapp: 'WhatsApp',
    status: {
      none: 'Not created',
      pending: 'Queued',
      sending: 'Sending…',
      sent: 'Sent (accepted by mail server)',
      failed: 'Failed',
      skipped: 'Skipped',
      prepared: 'Prepared — not sent',
      opened: 'Opened in WhatsApp — not confirmed',
      sent_manual: 'Sent (confirmed by staff)',
    } as Record<string, string>,
    to: 'To',
    attempts: (a: number, m: number) => `Attempt ${a} of ${m}`,
    nextRetry: 'Next automatic retry',
    sentAt: 'Sent',
    sendNow: 'Send now',
    sendCopy: 'Send another copy',
    confirmCopy: 'The confirmation email was already sent. Send another copy to the customer?',
    prepare: 'Prepare message',
    prepareAgain: 'Prepare again',
    confirmPrepareAgain: 'This WhatsApp message was already confirmed as sent. Prepare a new one to send again?',
    open: 'Open WhatsApp & Send',
    markSent: 'I sent it',
    confirmMarkSent: 'Confirm that you pressed Send in WhatsApp and the message went to the customer?',
    message: 'Prepared message',
    history: 'Notification history',
    notConfirmed: 'The order is not confirmed yet (online payment not confirmed), so no confirmation is sent.',
    emailOff: 'Order confirmation emails are switched off in Settings → Notifications.',
    noSmtp: 'The email account (SMTP) is not configured or switched off.',
    waOff: 'WhatsApp preparation is switched off in Settings → Notifications.',
    waNote: (n: string) =>
      `No WhatsApp API is connected: the message is sent manually${n ? ` from +${n}` : ''}. Opening WhatsApp does not mean the customer received it — press “I sent it” only after you pressed Send.`,
    noNumber: 'Set the official business number in Settings → Notifications → Order confirmation.',
    by: 'by',
    done: 'Done',
  },
  ar: {
    title: 'تأكيد الطلب',
    email: 'البريد الإلكتروني',
    whatsapp: 'واتساب',
    status: {
      none: 'لم يُنشأ',
      pending: 'في قائمة الانتظار',
      sending: 'جارٍ الإرسال…',
      sent: 'أُرسل (قبله خادم البريد)',
      failed: 'فشل',
      skipped: 'تم التخطي',
      prepared: 'جاهز — لم يُرسل',
      opened: 'فُتح في واتساب — غير مؤكد',
      sent_manual: 'أُرسل (بتأكيد الموظف)',
    } as Record<string, string>,
    to: 'إلى',
    attempts: (a: number, m: number) => `المحاولة ${a} من ${m}`,
    nextRetry: 'إعادة المحاولة التلقائية التالية',
    sentAt: 'أُرسل',
    sendNow: 'أرسل الآن',
    sendCopy: 'أرسل نسخة أخرى',
    confirmCopy: 'تم إرسال بريد التأكيد مسبقاً. هل تريد إرسال نسخة أخرى للعميل؟',
    prepare: 'تجهيز الرسالة',
    prepareAgain: 'تجهيز مرة أخرى',
    confirmPrepareAgain: 'تم تأكيد إرسال رسالة واتساب هذه مسبقاً. هل تريد تجهيز رسالة جديدة لإرسالها مرة أخرى؟',
    open: 'افتح واتساب وأرسل',
    markSent: 'تم الإرسال',
    confirmMarkSent: 'هل تؤكد أنك ضغطت إرسال في واتساب ووصلت الرسالة إلى العميل؟',
    message: 'الرسالة الجاهزة',
    history: 'سجل الإشعارات',
    notConfirmed: 'الطلب غير مؤكد بعد (لم يتم تأكيد الدفع الإلكتروني)، لذلك لا يُرسل التأكيد.',
    emailOff: 'رسائل تأكيد الطلب بالبريد متوقفة من الإعدادات ← الإشعارات.',
    noSmtp: 'حساب البريد (SMTP) غير مُعد أو غير مفعّل.',
    waOff: 'تجهيز رسائل واتساب متوقف من الإعدادات ← الإشعارات.',
    waNote: (n: string) => `لا يوجد ربط بواجهة واتساب: تُرسل الرسالة يدوياً${n ? ` من الرقم +${n}` : ''}. فتح واتساب لا يعني أن العميل استلمها — اضغط «تم الإرسال» فقط بعد الضغط على إرسال.`,
    noNumber: 'أضف رقم واتساب الرسمي للأعمال من الإعدادات ← الإشعارات ← تأكيد الطلب.',
    by: 'بواسطة',
    done: 'تم',
  },
};

const TONE: Record<string, string> = { sent: 'positive', sent_manual: 'positive', failed: 'negative', skipped: 'warning', pending: 'pending', sending: 'processing', prepared: 'neutral', opened: 'processing', none: 'neutral' };

function Badge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`st st--${TONE[status] ?? 'neutral'}`} data-testid="oc-status" data-status={status}>
      <span className="st__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function OrderConfirmationPanel({ orderId, canWrite }: { orderId: string; canWrite: boolean }) {
  const { lang, dt } = useAT();
  const x = TXT[lang];
  const toast = useToast();
  const { data, error, reload } = useApi<View>(`/api/admin/order-notifications/orders/${orderId}`);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const v = view ?? data;

  const act = async (label: string, path: string, body: Record<string, unknown> = {}) => {
    setErr(null);
    setBusy(label);
    try {
      setView(await post<View>(`/api/admin/order-notifications/orders/${orderId}/${path}`, body));
      toast(x.done);
    } catch (e) {
      setErr(e);
      reload();
      setView(null);
    } finally {
      setBusy('');
    }
  };

  if (error) return <section className="a-card"><ErrorBox error={error} /></section>;
  if (!v) return null;
  const e = v.email;
  const w = v.whatsapp;
  const history = [...(e?.history ?? []).map((h) => ({ ...h, ch: x.email })), ...(w?.history ?? []).map((h) => ({ ...h, ch: x.whatsapp }))].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="a-card" aria-labelledby="od-confirmation" data-testid="order-confirmation">
      <div className="a-card__head">
        <h2 id="od-confirmation">{x.title}</h2>
      </div>
      <ErrorBox error={err} />
      {!v.orderConfirmed ? <p className="a-muted">{x.notConfirmed}</p> : null}

      <div data-testid="oc-email" style={{ marginBottom: 16 }}>
        <p style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 6px' }}>
          <strong>{x.email}</strong> <Badge status={e?.status ?? 'none'} label={x.status[e?.status ?? 'none'] ?? e?.status ?? ''} />
        </p>
        {e ? (
          <p className="a-sub" style={{ margin: 0 }}>
            {x.to}: <span className="ltr">{e.to || '—'}</span>
            {e.sentAt ? <> · {x.sentAt}: {dt(e.sentAt)}</> : null}
            {e.status === 'failed' ? <> · {x.attempts(e.attempts, e.maxAttempts)}</> : null}
            {e.nextAttemptAt && e.status === 'failed' ? <> · {x.nextRetry}: {dt(e.nextAttemptAt)}</> : null}
          </p>
        ) : null}
        {e?.lastError && e.status !== 'sent' ? <p className="a-footnote" data-testid="oc-email-error">{e.lastError}</p> : null}
        {!v.config.emailEnabled ? <p className="a-footnote">{x.emailOff}</p> : !v.config.smtpConfigured ? <p className="a-footnote">{x.noSmtp}</p> : null}
        {canWrite && v.orderConfirmed ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {e?.status === 'sent' ? (
              <button type="button" className="a-btn a-btn--ghost a-btn--sm" disabled={Boolean(busy)} data-testid="oc-email-resend" onClick={() => window.confirm(x.confirmCopy) && void act('email', 'email', { resend: true })}>
                {x.sendCopy}
              </button>
            ) : e?.status !== 'sending' ? (
              <button type="button" className="a-btn a-btn--ghost a-btn--sm" disabled={Boolean(busy)} data-testid="oc-email-send" onClick={() => void act('email', 'email')}>
                {busy === 'email' ? '…' : x.sendNow}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div data-testid="oc-whatsapp">
        <p style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 6px' }}>
          <strong>{x.whatsapp}</strong> <Badge status={w?.status ?? 'none'} label={x.status[w?.status ?? 'none'] ?? w?.status ?? ''} />
        </p>
        {w?.to ? (
          <p className="a-sub" style={{ margin: 0 }}>
            {x.to}: <span className="ltr">+{w.to}</span>
            {w.confirmedAt ? <> · {x.sentAt}: {dt(w.confirmedAt)}{w.confirmedBy ? ` ${x.by} ${w.confirmedBy.name}` : ''}</> : null}
          </p>
        ) : null}
        {w?.lastError ? <p className="a-footnote">{w.lastError}</p> : null}
        {w?.message ? (
          <details style={{ margin: '6px 0' }}>
            <summary>{x.message}</summary>
            <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }} dir="auto" data-testid="oc-wa-message">
              {w.message}
            </p>
          </details>
        ) : null}
        {!v.config.whatsappEnabled && !w ? <p className="a-footnote">{x.waOff}</p> : null}
        {canWrite && v.orderConfirmed ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {w?.link && (w.status === 'prepared' || w.status === 'opened') ? (
              <a
                className="a-btn a-btn--primary a-btn--sm"
                href={w.link}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="oc-wa-open"
                onClick={() => void post<View>(`/api/admin/order-notifications/orders/${orderId}/whatsapp/opened`).then(setView).catch(setErr)}
              >
                {x.open}
              </a>
            ) : null}
            {w && (w.status === 'prepared' || w.status === 'opened') ? (
              <button type="button" className="a-btn a-btn--ghost a-btn--sm" disabled={Boolean(busy)} data-testid="oc-wa-mark-sent" onClick={() => window.confirm(x.confirmMarkSent) && void act('wa', 'whatsapp/confirm-sent')}>
                {x.markSent}
              </button>
            ) : null}
            {!w || w.status === 'skipped' ? (
              <button type="button" className="a-btn a-btn--ghost a-btn--sm" disabled={Boolean(busy)} data-testid="oc-wa-prepare" onClick={() => void act('wa', 'whatsapp/prepare', { again: true })}>
                {x.prepare}
              </button>
            ) : w.status === 'sent_manual' ? (
              <button type="button" className="a-btn a-btn--ghost a-btn--sm" disabled={Boolean(busy)} data-testid="oc-wa-prepare-again" onClick={() => window.confirm(x.confirmPrepareAgain) && void act('wa', 'whatsapp/prepare', { again: true })}>
                {x.prepareAgain}
              </button>
            ) : null}
          </div>
        ) : null}
        <p className="a-footnote" data-testid="oc-wa-note">
          {x.waNote(v.config.businessNumber)} {!v.config.businessNumber ? x.noNumber : null}
        </p>
      </div>

      {history.length ? (
        <details style={{ marginTop: 12 }}>
          <summary>{x.history}</summary>
          <ul className="a-list" data-testid="oc-history">
            {history.map((h, i) => (
              <li key={i}>
                <span>
                  <span>
                    {h.ch} · {h.action.replace(/_/g, ' ')}
                    {h.by?.name ? ` · ${x.by} ${h.by.name}` : ''}
                  </span>
                  {h.detail ? <span className="a-sub">{h.detail}</span> : null}
                </span>
                <span className="a-sub">{dt(h.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
