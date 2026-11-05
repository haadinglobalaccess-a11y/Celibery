/**
 * DEMO PRODUCTS — NOT CELIBERY DATA.
 * Generic placeholder products used only to exercise the storefront, filters and checkout
 * during development and review. Names, prices and specifications are illustrative and are
 * flagged on the storefront as "Sample product". Replace with the client's product list (Q14)
 * using `npm run import:products`, then run `npm run seed:demo -- --remove`.
 */
const img = (cat: string) => [{ url: `/placeholders/${cat}.svg`, alt: { ar: 'صورة المنتج قيد التجهيز', en: 'Product photo coming soon' } }];
const L = (ar: string, en: string) => ({ ar, en });
const black = { key: 'black', name: L('أسود', 'Black'), hex: '#111111' };
const white = { key: 'white', name: L('أبيض', 'White'), hex: '#F5F5F5' };
const grey = { key: 'grey', name: L('رمادي', 'Grey'), hex: '#8A8F98' };

type Demo = {
  sku: string;
  slug: string;
  model: string;
  category: string;
  name: { ar: string; en: string };
  shortDescription: { ar: string; en: string };
  description: { ar: string; en: string };
  price: number;
  compareAtPrice?: number;
  stock: number;
  featured?: boolean;
  isBundle?: boolean;
  attributes: { capacityMah?: number; powerW?: number; connectors: string[]; color?: typeof black };
  specs: { label: { ar: string; en: string }; value: { ar: string; en: string } }[];
  images: ReturnType<typeof img>;
  tags?: string[];
};

const demoDesc = L(
  'منتج تجريبي لعرض تصميم المتجر فقط. سيتم استبداله ببيانات منتجات سيليبري الحقيقية.',
  'Sample product used only to preview the store design. It will be replaced with real CELIBERY product data.',
);

const d = (x: Omit<Demo, 'images' | 'description'> & { cat: string }): Demo => ({ ...x, images: img(x.cat), description: demoDesc });

export const DEMO_PRODUCTS: Demo[] = [
  d({ cat: 'headphones', category: 'headphones', sku: 'DEMO-HP-ANC', slug: 'demo-wireless-anc-headphones', model: 'DEMO-H1', name: L('سماعة لاسلكية بعزل ضوضاء (تجريبي)', 'Wireless ANC Headphones (Sample)'), shortDescription: L('سماعة رأس لاسلكية للعرض', 'Over-ear wireless sample'), price: 29900, compareAtPrice: 34900, stock: 25, featured: true, attributes: { connectors: ['bluetooth', 'usb-c'], color: black }, specs: [{ label: L('الاتصال', 'Connectivity'), value: L('بلوتوث', 'Bluetooth') }] }),
  d({ cat: 'headphones', category: 'headphones', sku: 'DEMO-HP-SPORT', slug: 'demo-sport-earbuds', model: 'DEMO-E2', name: L('سماعات أذن رياضية (تجريبي)', 'Sport Earbuds (Sample)'), shortDescription: L('سماعات أذن للعرض', 'In-ear sample'), price: 14900, stock: 40, attributes: { connectors: ['bluetooth', 'usb-c'], color: white }, specs: [{ label: L('الاتصال', 'Connectivity'), value: L('بلوتوث', 'Bluetooth') }] }),
  d({ cat: 'headphones', category: 'headphones', sku: 'DEMO-HP-WIRED', slug: 'demo-wired-earphones', model: 'DEMO-E3', name: L('سماعات سلكية USB-C (تجريبي)', 'USB-C Wired Earphones (Sample)'), shortDescription: L('سماعات سلكية للعرض', 'Wired sample'), price: 4900, stock: 0, attributes: { connectors: ['usb-c'], color: white }, specs: [] }),
  d({ cat: 'power-banks', category: 'power-banks', sku: 'DEMO-PB-10K', slug: 'demo-power-bank-10000', model: 'DEMO-P10', name: L('باور بانك 10000 مللي أمبير (تجريبي)', 'Power Bank 10,000mAh (Sample)'), shortDescription: L('شحن سريع 20 واط', '20W fast charging'), price: 9900, stock: 60, featured: true, attributes: { capacityMah: 10000, powerW: 20, connectors: ['usb-c', 'usb-a'], color: black }, specs: [{ label: L('السعة', 'Capacity'), value: L('10000 مللي أمبير', '10,000mAh') }, { label: L('القدرة', 'Output'), value: L('20 واط', '20W') }] }),
  d({ cat: 'power-banks', category: 'power-banks', sku: 'DEMO-PB-20K', slug: 'demo-power-bank-20000', model: 'DEMO-P20', name: L('باور بانك 20000 مللي أمبير (تجريبي)', 'Power Bank 20,000mAh (Sample)'), shortDescription: L('شحن سريع 65 واط', '65W fast charging'), price: 19900, compareAtPrice: 22900, stock: 4, featured: true, attributes: { capacityMah: 20000, powerW: 65, connectors: ['usb-c', 'usb-a'], color: grey }, specs: [{ label: L('السعة', 'Capacity'), value: L('20000 مللي أمبير', '20,000mAh') }, { label: L('القدرة', 'Output'), value: L('65 واط', '65W') }] }),
  d({ cat: 'power-banks', category: 'power-banks', sku: 'DEMO-PB-MAG', slug: 'demo-magnetic-power-bank', model: 'DEMO-PM5', name: L('باور بانك مغناطيسي 5000 (تجريبي)', 'Magnetic Power Bank 5,000mAh (Sample)'), shortDescription: L('شحن لاسلكي', 'Wireless charging'), price: 12900, stock: 18, attributes: { capacityMah: 5000, powerW: 15, connectors: ['magsafe', 'usb-c'], color: white }, specs: [] }),
  d({ cat: 'car-essentials', category: 'car-essentials', sku: 'DEMO-CAR-CHG', slug: 'demo-car-charger-45w', model: 'DEMO-C45', name: L('شاحن سيارة 45 واط (تجريبي)', 'Car Charger 45W (Sample)'), shortDescription: L('منفذان USB-C و USB-A', 'USB-C + USB-A ports'), price: 7900, stock: 30, attributes: { powerW: 45, connectors: ['car-12v', 'usb-c', 'usb-a'], color: black }, specs: [] }),
  d({ cat: 'car-essentials', category: 'car-essentials', sku: 'DEMO-CAR-MOUNT', slug: 'demo-magnetic-car-mount', model: 'DEMO-CM1', name: L('حامل جوال مغناطيسي للسيارة (تجريبي)', 'Magnetic Car Mount (Sample)'), shortDescription: L('حامل للعرض', 'Mount sample'), price: 5900, stock: 22, attributes: { connectors: [], color: black }, specs: [] }),
  d({ cat: 'cables', category: 'cables', sku: 'DEMO-CB-CC-1M', slug: 'demo-usb-c-cable-1m', model: 'DEMO-CC1', name: L('كابل USB-C إلى USB-C بطول 1 متر (تجريبي)', 'USB-C to USB-C Cable 1m (Sample)'), shortDescription: L('يدعم 60 واط', 'Supports 60W'), price: 3900, stock: 120, attributes: { powerW: 60, connectors: ['usb-c'], color: black }, specs: [{ label: L('الطول', 'Length'), value: L('1 متر', '1m') }] }),
  d({ cat: 'cables', category: 'cables', sku: 'DEMO-CB-CC-2M', slug: 'demo-usb-c-cable-2m-100w', model: 'DEMO-CC2', name: L('كابل USB-C بطول 2 متر 100 واط (تجريبي)', 'USB-C Cable 2m 100W (Sample)'), shortDescription: L('يدعم 100 واط', 'Supports 100W'), price: 5900, stock: 80, attributes: { powerW: 100, connectors: ['usb-c'], color: grey }, specs: [{ label: L('الطول', 'Length'), value: L('2 متر', '2m') }] }),
  d({ cat: 'cables', category: 'cables', sku: 'DEMO-CB-CL-1M', slug: 'demo-usb-c-lightning-cable', model: 'DEMO-CL1', name: L('كابل USB-C إلى لايتنينج (تجريبي)', 'USB-C to Lightning Cable (Sample)'), shortDescription: L('كابل للعرض', 'Cable sample'), price: 4900, stock: 70, attributes: { powerW: 20, connectors: ['usb-c', 'lightning'], color: white }, specs: [] }),
  d({ cat: 'charging-adapters', category: 'charging-adapters', sku: 'DEMO-AD-30W', slug: 'demo-wall-charger-30w', model: 'DEMO-A30', name: L('رأس شحن 30 واط (تجريبي)', 'Wall Charger 30W (Sample)'), shortDescription: L('منفذ USB-C', 'USB-C port'), price: 6900, stock: 50, attributes: { powerW: 30, connectors: ['usb-c'], color: white }, specs: [{ label: L('القدرة', 'Output'), value: L('30 واط', '30W') }] }),
  d({ cat: 'charging-adapters', category: 'charging-adapters', sku: 'DEMO-AD-65W', slug: 'demo-wall-charger-65w', model: 'DEMO-A65', name: L('رأس شحن 65 واط بثلاث منافذ (تجريبي)', 'Wall Charger 65W, 3 Ports (Sample)'), shortDescription: L('منفذان USB-C ومنفذ USB-A', '2× USB-C + 1× USB-A'), price: 14900, compareAtPrice: 17900, stock: 35, featured: true, attributes: { powerW: 65, connectors: ['usb-c', 'usb-a'], color: black }, specs: [{ label: L('القدرة', 'Output'), value: L('65 واط', '65W') }] }),
  d({ cat: 'tech-essentials', category: 'tech-essentials', sku: 'DEMO-TE-HUB', slug: 'demo-usb-c-hub', model: 'DEMO-HB6', name: L('موزع USB-C بستة منافذ (تجريبي)', 'USB-C 6-in-1 Hub (Sample)'), shortDescription: L('موزع للعرض', 'Hub sample'), price: 13900, stock: 15, attributes: { connectors: ['usb-c'], color: grey }, specs: [] }),
  d({ cat: 'tech-essentials', category: 'tech-essentials', sku: 'DEMO-TE-STAND', slug: 'demo-phone-stand', model: 'DEMO-ST1', name: L('حامل جوال مكتبي (تجريبي)', 'Desk Phone Stand (Sample)'), shortDescription: L('حامل للعرض', 'Stand sample'), price: 3900, stock: 45, attributes: { connectors: [], color: grey }, specs: [] }),
  d({ cat: 'tech-essentials', category: 'tech-essentials', sku: 'DEMO-KIT-TRAVEL', slug: 'demo-umrah-travel-kit', model: 'DEMO-KT1', name: L('طقم السفر والعمرة (تجريبي)', 'Umrah & Travel Kit (Sample)'), shortDescription: L('باور بانك + كابل + رأس شحن', 'Power bank + cable + charger'), price: 17900, compareAtPrice: 20700, stock: 12, isBundle: true, attributes: { connectors: ['usb-c', 'usb-a'], color: black }, specs: [], tags: ['umrah', 'travel', 'bundle'] }),
  d({ cat: 'tech-essentials', category: 'tech-essentials', sku: 'DEMO-KIT-GIFT', slug: 'demo-gift-box', model: 'DEMO-KG1', name: L('صندوق هدية تقني (تجريبي)', 'Tech Gift Box (Sample)'), shortDescription: L('هدية للعرض', 'Gift sample'), price: 24900, stock: 10, isBundle: true, attributes: { connectors: ['usb-c'], color: black }, specs: [], tags: ['gift', 'bundle', 'eid'] }),
];
