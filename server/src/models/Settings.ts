import { Schema, model, models, type Model, type Types } from 'mongoose';
import { LocalizedSchema } from './common';

/**
 * Single settings document (key = "store"). Every business value that the client still
 * has to confirm (CR/VAT numbers, contact details, accent colour, COD rules, …) lives here
 * so it can be changed from the admin dashboard without code changes.
 * Empty values are never replaced with invented data: the storefront hides or marks them.
 */
/** One delivery zone (amounts in halalas). */
const ShippingZoneSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
    name: { type: LocalizedSchema, default: () => ({}) },
    active: { type: Boolean, default: true },
    cities: { type: [String], default: [] },
    freeDelivery: { type: Boolean, default: false },
    deliveryFee: { type: Number, default: 0, min: 0 },
    freeDeliveryThreshold: { type: Number, min: 0 },
    codEnabled: { type: Boolean, default: true },
    /** Unset = the store-wide COD fee. */
    codFee: { type: Number, min: 0 },
    estimatedDelivery: { type: LocalizedSchema, default: () => ({}) },
  },
  { _id: false },
);

const SettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'store' },
    business: {
      name: { type: LocalizedSchema, default: () => ({ ar: 'سيليبري إنترناشونال', en: 'CELIBERY International' }) },
      /** Short store description (footer, search-result default description). */
      description: { type: LocalizedSchema, default: () => ({}) },
      legalName: { type: LocalizedSchema, default: () => ({}) },
      address: { type: LocalizedSchema, default: () => ({}) },
      crNumber: { type: String, default: '' },
      vatNumber: { type: String, default: '' },
      sbcVerified: { type: Boolean, default: false },
      sbcVerificationUrl: { type: String, default: '' },
      sbcBadgeImageUrl: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      whatsappNumber: { type: String, default: '' },
      supportHours: { type: LocalizedSchema, default: () => ({}) },
      social: {
        instagram: { type: String, default: '' },
        tiktok: { type: String, default: '' },
        snapchat: { type: String, default: '' },
        x: { type: String, default: '' },
        youtube: { type: String, default: '' },
        facebook: { type: String, default: '' },
      },
    },
    brand: {
      /** Q2: one accent colour from CELIBERY's brand — pending client value. */
      accentColor: { type: String, default: '#2563EB' },
      logoUrl: { type: String, default: '' },
      logoDarkUrl: { type: String, default: '' },
    },
    commerce: {
      currency: { type: String, default: 'SAR' },
      /** Prices are VAT-inclusive; this rate is used to show the VAT portion on invoices. */
      vatRatePercent: { type: Number, default: 15, min: 0, max: 100 },
      /** Q25: free delivery across Saudi Arabia, cost covered in the sales price. */
      freeDelivery: { type: Boolean, default: true },
      deliveryFee: { type: Number, default: 0, min: 0 },
      /** When free delivery is off: orders at or above this total (halalas) ship free. Unset = no threshold. */
      freeDeliveryThreshold: { type: Number, min: 0 },
      /** Untick to pause checkout (e.g. courier outage). */
      shippingAvailable: { type: Boolean, default: true },
      shippingUnavailableMessage: { type: LocalizedSchema, default: () => ({}) },
      /** manual = staff book in the I Mile portal (current). 'api' is reserved for a future, tested I Mile integration. */
      fulfilmentMode: { type: String, enum: ['manual', 'api'], default: 'manual' },
      courierName: { type: String, default: 'I Mile Logistics' },
      courierTrackingUrlTemplate: { type: String, default: '' },
      estimatedDelivery: { type: LocalizedSchema, default: () => ({}) },
      /** Q32: 2-year warranty confirmed by the client. */
      warrantyEnabled: { type: Boolean, default: true },
      warrantyMonths: { type: Number, default: 24, min: 0 },
      /** Q23: COD is being worked on by the client — disabled until they approve the rules. */
      codEnabled: { type: Boolean, default: false },
      codFee: { type: Number, default: 0, min: 0 },
      codMaxOrderTotal: { type: Number, min: 0 },
      codMinOrderTotal: { type: Number, min: 0 },
      /** Empty = COD everywhere in KSA. Matched case-insensitively against the checkout city. */
      codAllowedCities: { type: [String], default: [] },
      /**
       * Delivery zones: a group of cities with its own delivery fee / free-delivery rule and COD
       * availability. Cities outside every zone use the store-wide rules above, or are refused when
       * deliverToUnlistedCities is false. Empty = store-wide rules everywhere (previous behaviour).
       */
      shippingZones: { type: [ShippingZoneSchema], default: [] },
      deliverToUnlistedCities: { type: Boolean, default: true },
      /** Customers can request returns from their order page (Admin → Returns handles them). */
      returnsEnabled: { type: Boolean, default: true },
      /**
       * Days after delivery during which a return can be requested. 7 = the consumer withdrawal
       * period of the Saudi E-Commerce Law regulations; the returns policy states the final number.
       */
      returnWindowDays: { type: Number, default: 7, min: 0, max: 365 },
      lowStockThreshold: { type: Number, default: 5, min: 0 },
      /** Minutes an unpaid online order holds its stock before it is released. */
      reservationMinutes: { type: Number, default: 30, min: 5, max: 1440 },
      maxQuantityPerItem: { type: Number, default: 10, min: 1 },
    },
    payments: {
      card: { type: Boolean, default: true }, // mada, Visa, Mastercard
      applepay: { type: Boolean, default: true },
      stcpay: { type: Boolean, default: true },
      tabby: { type: Boolean, default: true },
    },
    notifications: {
      emailOrderUpdates: { type: Boolean, default: true },
      whatsappOrderUpdates: { type: Boolean, default: true },
    },
    /** Announcement bar above the header (empty text = default free-delivery & warranty message). */
    announcement: {
      enabled: { type: Boolean, default: true },
      text: { type: LocalizedSchema, default: () => ({}) },
      link: { type: String, default: '' },
    },
    homepage: {
      heroEnabled: { type: Boolean, default: true },
      heroSortOrder: { type: Number, default: -1 },
      heroDurationSec: { type: Number, min: Number.MIN_VALUE, default: 5 },
      heroVideoDurationSec: { type: Number, min: 0, default: 0 },
      heroVideoFallbackSec: { type: Number, min: 2, max: 300, default: 20 },
      heroDescription: { type: LocalizedSchema, default: () => ({}) },
      /** Hero media: uploaded file or URL (direct .mp4/.webm, YouTube, Vimeo). Desktop + optional mobile versions. */
      heroVideoUrl: { type: String, default: '' },
      heroPosterUrl: { type: String, default: '' },
      heroMobileVideoUrl: { type: String, default: '' },
      heroMobilePosterUrl: { type: String, default: '' },
      heroTitle: { type: LocalizedSchema, default: () => ({}) },
      heroSubtitle: { type: LocalizedSchema, default: () => ({}) },
      heroCtaLabel: { type: LocalizedSchema, default: () => ({}) },
      heroCtaLink: { type: String, default: '' },
      brandStory: { type: LocalizedSchema, default: () => ({}) },
      brandStoryImageUrl: { type: String, default: '' },
      newsletterEnabled: { type: Boolean, default: true },
    },
    /** FAQ display (Admin → Website → FAQ management → Display settings). Questions live in the Faq collection. */
    faq: {
      homepageEnabled: { type: Boolean, default: true },
      /** How many homepage-selected questions the homepage preview shows. */
      homepageLimit: { type: Number, default: 6, min: 1, max: 12 },
      showCategoryFilters: { type: Boolean, default: false },
      /** Optional heading / subtitle; empty = the storefront's default wording. */
      title: { type: LocalizedSchema, default: () => ({}) },
      subtitle: { type: LocalizedSchema, default: () => ({}) },
      /** Missing translation: 'hide' the question in that language, or 'fallback' to the other language (shown with its own direction). */
      missingTranslation: { type: String, enum: ['hide', 'fallback'], default: 'hide' },
      /** Accordion: allow several answers open at once (false = opening one closes the others). */
      allowMultipleOpen: { type: Boolean, default: false },
    },
    reviews: {
      /** Q19: no real reviews yet — reviews stay hidden until enabled and genuinely collected. */
      enabled: { type: Boolean, default: false },
    },
    /** Abandoned / incomplete checkout tracking (Admin → Abandoned checkouts). */
    /** Order confirmation (Admin → Settings → Notifications & reviews → Order confirmation). */
    orderNotifications: {
      /** Email the customer a full order confirmation once the order is confirmed (COD placed / payment confirmed). */
      confirmationEmail: { type: Boolean, default: true },
      /** Prepare a WhatsApp click-to-chat confirmation for staff to send manually (no WhatsApp API). */
      whatsappPrepare: { type: Boolean, default: true },
      /** CELIBERY's official WhatsApp Business number (digits, international format) staff send from. */
      whatsappBusinessNumber: { type: String, default: '' },
    },
    checkoutRecovery: {
      /** Save checkout progress so customers can resume and staff can see incomplete checkouts. */
      enabled: { type: Boolean, default: true },
      /** Minutes without activity after which an unfinished checkout counts as abandoned. */
      abandonAfterMinutes: { type: Number, default: 60, min: 5, max: 10080 },
      /** Days a saved checkout is kept after its last activity (then deleted automatically). */
      retentionDays: { type: Number, default: 30, min: 1, max: 365 },
    },
    seo: {
      title: { type: LocalizedSchema, default: () => ({}) },
      description: { type: LocalizedSchema, default: () => ({}) },
      allowAiCrawlers: { type: Boolean, default: true },
    },
  },
  { timestamps: true, minimize: false },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SettingsDoc = { _id: Types.ObjectId; key: string; [field: string]: any };
export const Settings: Model<SettingsDoc> = (models.Settings as Model<SettingsDoc>) || model<SettingsDoc>('Settings', SettingsSchema);

export async function getSettings() {
  const existing = await Settings.findOne({ key: 'store' }).lean();
  if (existing) return existing;
  try {
    return (await Settings.create({ key: 'store' })).toObject();
  } catch (error) {
    // Only a concurrent singleton insert is recoverable. Do not hide database failures.
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  return Settings.findOne({ key: 'store' }).lean().orFail();
}
