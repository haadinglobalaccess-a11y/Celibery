/**
 * Base (non-demo) data: the six confirmed categories, default roles, collections, campaign
 * templates and DRAFT legal pages. Contains no invented business facts — anything the client
 * still has to supply is left empty or marked with [square brackets] for their review.
 *
 * Arabic names/copy are drafts written for native Saudi review (Q12), not final marketing copy.
 */
import type { FilterKey } from '../models/Category';

export const CATEGORIES: { slug: string; name: { ar: string; en: string }; filters: FilterKey[]; sortOrder: number; image: string }[] = [
  { slug: 'headphones', name: { ar: 'سماعات', en: 'Headphones' }, filters: ['price', 'connector', 'color', 'availability'], sortOrder: 1, image: '/placeholders/headphones.svg' },
  { slug: 'power-banks', name: { ar: 'باور بانك', en: 'Power Banks' }, filters: ['price', 'capacityMah', 'powerW', 'connector', 'color', 'availability'], sortOrder: 2, image: '/placeholders/power-banks.svg' },
  { slug: 'car-essentials', name: { ar: 'مستلزمات السيارة', en: 'Car Essentials' }, filters: ['price', 'powerW', 'connector', 'color', 'availability'], sortOrder: 3, image: '/placeholders/car-essentials.svg' },
  { slug: 'cables', name: { ar: 'كابلات', en: 'Cables' }, filters: ['price', 'connector', 'powerW', 'color', 'availability'], sortOrder: 4, image: '/placeholders/cables.svg' },
  { slug: 'charging-adapters', name: { ar: 'رؤوس الشحن', en: 'Charging Adapters' }, filters: ['price', 'powerW', 'connector', 'color', 'availability'], sortOrder: 5, image: '/placeholders/charging-adapters.svg' },
  { slug: 'tech-essentials', name: { ar: 'أساسيات تقنية', en: 'Tech Essentials' }, filters: ['price', 'color', 'availability'], sortOrder: 6, image: '/placeholders/tech-essentials.svg' },
];

export const COLLECTIONS = [
  { slug: 'bundles', kind: 'bundles', title: { ar: 'الباقات وأطقم الهدايا', en: 'Bundles & Gift Kits' }, showOnHome: true, sortOrder: 1 },
  { slug: 'best-sellers', kind: 'best_sellers', title: { ar: 'الأكثر مبيعاً', en: 'Best Sellers' }, showOnHome: false, sortOrder: 2 },
  { slug: 'for-travel', kind: 'use_case', title: { ar: 'للسفر', en: 'For Travel' }, showOnHome: false, sortOrder: 3 },
  { slug: 'for-work', kind: 'use_case', title: { ar: 'للعمل', en: 'For Work' }, showOnHome: false, sortOrder: 4 },
  { slug: 'for-fitness', kind: 'use_case', title: { ar: 'للرياضة', en: 'For Fitness' }, showOnHome: false, sortOrder: 5 },
  { slug: 'for-home', kind: 'use_case', title: { ar: 'للمنزل', en: 'For Home' }, showOnHome: false, sortOrder: 6 },
] as const;

/** Inactive campaign templates — staff set dates, products and discounts before activating. */
export const CAMPAIGNS = [
  { slug: 'ramadan', kind: 'ramadan', title: { ar: 'عروض رمضان', en: 'Ramadan Offers' } },
  { slug: 'eid', kind: 'eid', title: { ar: 'هدايا العيد', en: 'Eid Gifts' } },
  { slug: 'national-day', kind: 'national_day', title: { ar: 'اليوم الوطني السعودي', en: 'Saudi National Day' }, accentColor: '#006C35' },
  { slug: 'umrah-travel', kind: 'umrah_travel', title: { ar: 'أطقم العمرة والسفر', en: 'Umrah & Travel Kits' } },
] as const;

const draftNoteAr = '> مسودة — بانتظار مراجعة واعتماد المستشار القانوني لسيليبري. النصوص بين [أقواس] معلومات مطلوبة من العميل.';
const draftNoteEn = "> DRAFT — pending review and approval by CELIBERY's legal advisor. Text in [brackets] is information the client must supply.";

export const PAGES = [
  {
    slug: 'shipping',
    title: { ar: 'سياسة الشحن والتوصيل', en: 'Shipping & Delivery Policy' },
    body: {
      ar: `${draftNoteAr}\n\n## التوصيل\n- التوصيل مجاني لجميع مناطق المملكة العربية السعودية.\n- شركة الشحن الحالية: I Mile Logistics.\n- مدة التوصيل المتوقعة: [عدد الأيام] أيام عمل.\n\n## تتبع الطلب\nيمكنك متابعة حالة طلبك من صفحة "تتبع الطلب" أو من حسابك، وسنرسل لك التحديثات عبر البريد الإلكتروني وواتساب.`,
      en: `${draftNoteEn}\n\n## Delivery\n- Delivery is free to all regions of Saudi Arabia.\n- Current courier: I Mile Logistics.\n- Estimated delivery time: [number of] business days.\n\n## Order tracking\nYou can follow your order from the "Track order" page or your account. We send updates by email and WhatsApp.`,
    },
  },
  {
    slug: 'returns',
    title: { ar: 'سياسة الاستبدال والاسترجاع', en: 'Returns & Exchanges Policy' },
    body: {
      ar: `${draftNoteAr}\n\n## مدة الإرجاع\nيمكن طلب الإرجاع خلال [عدد الأيام] يوماً من تاريخ الاستلام وفق نظام التجارة الإلكترونية في المملكة.\n\n## الشروط\n- [شروط حالة المنتج والتغليف]\n- [من يتحمل تكلفة شحن الإرجاع]\n\n## طريقة الاسترداد\nيُعاد المبلغ بنفس وسيلة الدفع خلال [المدة].`,
      en: `${draftNoteEn}\n\n## Return window\nReturns can be requested within [number of] days of delivery, in line with the Saudi E-Commerce Law.\n\n## Conditions\n- [Product and packaging condition requirements]\n- [Who pays return shipping]\n\n## Refunds\nRefunds are issued to the original payment method within [timeframe].`,
    },
  },
  {
    slug: 'refunds',
    title: { ar: 'سياسة استرداد المبالغ', en: 'Refund Policy' },
    body: {
      ar: `${draftNoteAr}\n\n## متى يُسترد المبلغ\n[الحالات التي يحق فيها الاسترداد: إرجاع مقبول، إلغاء قبل الشحن، منتج معيب…]\n\n## طريقة الاسترداد\n- المدفوعات الإلكترونية (مدى، فيزا، ماستركارد، Apple Pay، STC Pay): إلى وسيلة الدفع نفسها.\n- تابي: وفق جدول الأقساط لدى تابي.\n- الدفع عند الاستلام: [طريقة إعادة المبلغ].\n\n## المدة\nخلال [المدة] من اعتماد الاسترداد.`,
      en: `${draftNoteEn}\n\n## When a refund is due\n[Cases that qualify: accepted return, cancellation before dispatch, defective product…]\n\n## How refunds are paid\n- Online payments (mada, Visa, Mastercard, Apple Pay, STC Pay): to the same payment method.\n- Tabby: according to Tabby's instalment schedule.\n- Cash on delivery: [refund method].\n\n## Timing\nWithin [timeframe] of the refund being approved.`,
    },
  },
  {
    slug: 'warranty',
    title: { ar: 'سياسة الضمان', en: 'Warranty Policy' },
    body: {
      ar: `${draftNoteAr}\n\n## مدة الضمان\nضمان لمدة سنتين على المنتجات (حسب تأكيد سيليبري).\n\n## ما يشمله الضمان\n[عيوب التصنيع المشمولة]\n\n## ما لا يشمله الضمان\n[الاستثناءات]\n\n## طريقة المطالبة\nتواصل معنا عبر واتساب أو البريد الإلكتروني مع رقم الطلب.`,
      en: `${draftNoteEn}\n\n## Warranty period\nTwo-year warranty on products (as confirmed by CELIBERY).\n\n## What is covered\n[Covered manufacturing defects]\n\n## What is not covered\n[Exclusions]\n\n## How to claim\nContact us on WhatsApp or by email with your order number.`,
    },
  },
  {
    slug: 'privacy',
    title: { ar: 'سياسة الخصوصية', en: 'Privacy Policy' },
    body: {
      ar: `${draftNoteAr}\n\n## البيانات التي نجمعها\nالاسم، البريد الإلكتروني، رقم الجوال، عنوان التوصيل، وسجل الطلبات.\n\n## استخدام البيانات\nلتنفيذ الطلبات والتوصيل وخدمة العملاء وإرسال تحديثات الطلب.\n\n## الدفع\nلا نخزن بيانات البطاقات؛ تتم معالجة المدفوعات عبر مزود دفع معتمد.\n\n## مكان تخزين البيانات\n[يتطلب تأكيد المستشار القانوني بشأن التخزين لدى مزودين خارج المملكة — السؤال 33]\n\n## حقوقك\n[وفق نظام حماية البيانات الشخصية]`,
      en: `${draftNoteEn}\n\n## Data we collect\nName, email, mobile number, delivery address and order history.\n\n## How we use it\nTo fulfil orders, deliver, provide customer service and send order updates.\n\n## Payments\nWe do not store card details; payments are processed by a licensed payment provider.\n\n## Where data is stored\n[Requires legal advisor confirmation regarding providers outside Saudi Arabia — Q33]\n\n## Your rights\n[Per the Personal Data Protection Law (PDPL)]`,
    },
  },
  {
    slug: 'terms',
    title: { ar: 'الشروط والأحكام', en: 'Terms & Conditions' },
    body: {
      ar: `${draftNoteAr}\n\n## البائع\n[الاسم التجاري]، سجل تجاري رقم [رقم السجل]، الرقم الضريبي [الرقم الضريبي]، العنوان [العنوان].\n\n## الأسعار\nجميع الأسعار بالريال السعودي وشاملة ضريبة القيمة المضافة.\n\n## الطلبات والدفع\n[شروط قبول الطلب والإلغاء]`,
      en: `${draftNoteEn}\n\n## Seller\n[Trade name], Commercial Registration No. [CR number], VAT No. [VAT number], address [address].\n\n## Prices\nAll prices are in Saudi Riyals and include VAT.\n\n## Orders and payment\n[Order acceptance and cancellation terms]`,
    },
  },
];
