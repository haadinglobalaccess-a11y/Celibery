/**
 * How a WhatsApp order confirmation reaches the customer.
 *
 * Today only the no-API "click-to-chat" channel is used: the system PREPARES the message and a
 * https://wa.me link; a staff member opens it in WhatsApp (signed in with CELIBERY's official
 * business number) and presses Send. WhatsApp gives the website no delivery result in this mode,
 * so the system never records such a message as delivered — at most "opened", or "sent_manual"
 * when the staff member confirms it.
 *
 * Future: an official WhatsApp Business Platform (Cloud API) channel can implement `deliver()` and
 * return a real provider result ("sent" / "failed" with the provider's message id). The order
 * confirmation code stores provider + status per record, so no redesign is needed. No unofficial
 * automation (WhatsApp Web bots, reverse-engineered endpoints) is or should be used.
 */
export type WhatsAppChannel = {
  id: 'click_to_chat' | 'whatsapp_cloud';
  /** True when the channel itself delivers the message and reports the result. */
  delivers: boolean;
};

export const clickToChat = {
  id: 'click_to_chat',
  delivers: false,
  /** wa.me link that opens a chat with `to` (international digits) with `message` pre-filled. */
  link: (to: string, message: string) => `https://wa.me/${to.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`,
} satisfies WhatsAppChannel & { link: (to: string, message: string) => string };

/**
 * A customer's mobile number as WhatsApp expects it (international digits without "+"), or null
 * when it cannot be a WhatsApp number. Saudi numbers may be entered as 05XXXXXXXX, 5XXXXXXXX,
 * +966 5X XXX XXXX or 009665XXXXXXXX; other countries need the full international number.
 */
export function whatsappNumber(phone: string): string | null {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('05') && d.length === 10) d = '966' + d.slice(1);
  else if (d.startsWith('5') && d.length === 9) d = '966' + d;
  if (d.startsWith('966')) return /^9665\d{8}$/.test(d) ? d : null;
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}
