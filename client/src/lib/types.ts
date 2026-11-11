export type Lang = 'ar' | 'en';
export type Localized = { ar: string; en: string };
export type ImageVariant = { width: number; url: string };
/** Plain URL images (older records) have only url/alt; uploaded images add responsive variants. */
export type Image = { url: string; alt?: Localized; mediaId?: string | null; variants?: ImageVariant[]; width?: number | null; height?: number | null };

export type Category = {
  _id: string;
  slug: string;
  name: Localized;
  description?: Localized;
  image?: Image;
  filters: string[];
  productCount?: number;
};

export type ProductCardData = {
  _id: string;
  slug: string;
  sku: string;
  model?: string;
  /** Product series (Q16) — CELIBERY's own series names, entered in Admin → Products */
  series?: string;
  name: Localized;
  shortDescription?: Localized;
  images: Image[];
  price: number;
  compareAtPrice: number | null;
  discountPercent: number;
  available: boolean;
  lowStock: boolean;
  featured?: boolean;
  isBundle?: boolean;
  dataSource?: 'client' | 'demo';
  category?: string | { _id: string; slug: string; name: Localized };
  attributes?: { capacityMah?: number; powerW?: number; connectors?: string[]; color?: { key: string; name: Localized; hex?: string } };
};

export type ProductDetail = ProductCardData & {
  description: Localized;
  specs: { label: Localized; value: Localized }[];
  warrantyMonths: number;
  related: ProductCardData[];
  bundles: ProductCardData[];
  bundleContents: { quantity: number; product: { _id: string; slug: string; name: Localized; images: Image[]; model?: string } | null }[];
  reviews: { average: number; count: number } | null;
  delivery: { free: boolean; fee: number; courier: string; estimate: Localized };
  seo?: { title?: Localized; description?: Localized };
};

export type Facets = {
  price?: { min: number; max: number } | null;
  capacity?: { value: number; count: number }[];
  power?: { value: number; count: number }[];
  connector?: { value: string; count: number }[];
  color?: { value: string; name: Localized; hex?: string; count: number }[];
  availability?: boolean;
};

export type Banner = {
  description?: Localized;
  durationSec?: number;
  videoDurationSec?: number;
  videoFallbackSec?: number;
  sortOrder?: number;
  _id: string;
  placement: string;
  title: Localized;
  subtitle: Localized;
  ctaLabel: Localized;
  link: string;
  imageUrl: Localized;
  mobileImageUrl?: Localized;
  /** Optional video (uploaded file, .mp4/.webm link, YouTube or Vimeo) shown instead of the image. */
  videoUrl?: string;
  mobileVideoUrl?: string;
  posterUrl?: string;
  theme: 'dark' | 'light';
};

export type Collection = { _id: string; slug: string; kind: string; title: Localized; description?: Localized; image?: Image; products: ProductCardData[] };

export type Campaign = {
  _id: string;
  slug: string;
  kind: string;
  title: Localized;
  description: Localized;
  heroImageUrl: string;
  heroMobileImageUrl?: string;
  heroVideoUrl?: string;
  accentColor?: string;
  discountCode?: string;
  products?: ProductCardData[];
};

export type HomeData = {
  hero: {
    sortOrder?: number;
    durationSec?: number;
    videoDurationSec?: number;
    videoFallbackSec?: number;
    description?: Localized;
    enabled?: boolean;
    videoUrl: string;
    posterUrl: string;
    mobileVideoUrl?: string;
    mobilePosterUrl?: string;
    title: Localized;
    subtitle: Localized;
    ctaLabel?: Localized;
    ctaLink?: string;
    banners: Banner[];
  };
  lifestyleBanners: Banner[];
  promoBanners: Banner[];
  categories: Category[];
  categoryProducts: { categoryId: string; items: ProductCardData[] }[];
  featured: ProductCardData[];
  /** Products the Admin selected for the Flagship section (in Admin order). Never Featured/Best Sellers by default. */
  flagship?: ProductCardData[];
  bestSellers: { source: 'orders' | 'curated' | 'none'; items: ProductCardData[] };
  collections: Collection[];
  campaigns: Campaign[];
  brandStory: { text: Localized; imageUrl: string };
  newsletterEnabled: boolean;
};

export type PublicSettings = {
  business: {
    name: Localized;
    legalName: Localized;
    address: Localized;
    crNumber: string;
    vatNumber: string;
    sbcVerified: boolean;
    sbcVerificationUrl: string;
    sbcBadgeImageUrl: string;
    email: string;
    phone: string;
    whatsappNumber: string;
    supportHours: Localized;
    social: Record<string, string>;
  };
  brand: { accentColor: string; logoUrl: string; logoDarkUrl: string };
  commerce: {
    currency: string;
    vatRatePercent: number;
    freeDelivery: boolean;
    deliveryFee: number;
    freeDeliveryThreshold?: number | null;
    shippingAvailable?: boolean;
    courierName: string;
    estimatedDelivery: Localized;
    warrantyEnabled: boolean;
    warrantyMonths: number;
    maxQuantityPerItem: number;
  };
  payments: { card: boolean; applepay: boolean; stcpay: boolean; tabby: boolean; cod: boolean; gateway: string; sandbox: boolean };
  reviewsEnabled: boolean;
  checkoutRecovery?: { enabled: boolean };
  seo?: { title?: Localized; description?: Localized };
  announcement?: { enabled: boolean; text: Localized; link: string };
};

export type QuoteLine = {
  productId: string;
  slug: string;
  sku: string;
  model: string;
  name: Localized;
  image: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  discount: number;
  available: boolean;
  maxQuantity: number;
  warrantyMonths: number;
};

export type Quote = {
  lines: QuoteLine[];
  issues: { productId?: string; code: string; message: string }[];
  subtotal: number;
  discountTotal: number;
  discount: { code: string; id: string } | null;
  discountError: string | null;
  deliveryFee: number;
  codFee: number;
  codAvailable: boolean;
  /** '' | disabled | below_min | above_max | city */
  codUnavailableReason?: string;
  /** 'paused' = delivery paused store-wide; 'city' = the city is outside every delivery zone. */
  shippingUnavailableReason?: '' | 'paused' | 'city';
  /** Delivery zone that priced the quote (once the delivery city is known). */
  zone?: { key: string; name: Localized; estimatedDelivery: Localized } | null;
  shippingAvailable?: boolean;
  total: number;
  vatRate: number;
  vatAmount: number;
  currency: string;
};

export type OrderView = {
  id?: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  paymentStatus: string;
  paymentMethod?: string;
  contact?: { name: string; email: string; phone: string };
  shippingAddress?: Record<string, string>;
  items: { name: Localized; quantity: number; image: string; unitPrice?: number; lineTotal?: number; sku?: string; slug?: string; warrantyMonths?: number }[];
  subtotal?: number;
  discountTotal?: number;
  discountCode?: string | null;
  deliveryFee?: number;
  codFee?: number;
  total: number;
  vatAmount?: number;
  vatRate?: number;
  delivery?: { courier?: string; trackingNumber?: string; trackingUrl?: string; shippedAt?: string; deliveredAt?: string; estimatedDelivery?: Localized };
  reservationExpiresAt?: string;
  history: { status: string; note: string; at: string }[];
};

export type Me = {
  _id: string;
  type: 'customer' | 'staff';
  name: string;
  email: string;
  phone?: string;
  preferredLang?: Lang;
  title?: string;
  role?: { key: string; name: Localized; permissions: string[] } | null;
  /** Staff only: two-factor authentication state. */
  mfa?: { enabled: boolean; required: boolean };
};

export type Address = {
  _id?: string;
  label?: string;
  fullName: string;
  phone: string;
  city: string;
  district: string;
  street: string;
  buildingNumber: string;
  postalCode: string;
  shortAddress: string;
  notes: string;
  isDefault?: boolean;
};
