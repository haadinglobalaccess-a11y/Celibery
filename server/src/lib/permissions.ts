/** Every permission the admin API enforces. Roles are sets of these. */
export const PERMISSIONS = [
  'overview:read',
  'orders:read',
  'orders:write',
  'orders:refund',
  'products:read',
  'products:write',
  'categories:write',
  'inventory:read',
  'inventory:write',
  'customers:read',
  'discounts:read',
  'discounts:write',
  'content:write',
  'media:write',
  'reviews:moderate',
  'reports:read',
  'staff:manage',
  'settings:write',
  /** Legal identity (CR, VAT, legal name, SBC verification) and approving legal policies. */
  'business:write',
  /** Payment gateway / courier credentials, test ↔ live mode, enabling gateways. */
  'payments:manage',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Highly sensitive permissions — only the Super Administrator role holds them by default. */
export const SENSITIVE_PERMISSIONS: Permission[] = ['payments:manage', 'staff:manage'];

/**
 * Default roles created by `npm run seed:base` (and added to existing databases by
 * `npm run migrate`). Staff named in the client document (Q27/Q39): Usama M. Usman (BDM,
 * approver) → Super Administrator; Shuja Mubeen (Online Sales Executive) → Online Sales
 * Executive. Accounts are created separately with `npm run create-staff` — no passwords are
 * ever generated or stored in code.
 *
 * Suggested roles from the upgrade brief: Super Admin, Admin, Content Manager, Product Manager,
 * Order Manager. The role key "admin" is kept for the Super Administrator so existing staff
 * accounts keep their access after the upgrade.
 */
const ALL_BUT_SENSITIVE = PERMISSIONS.filter((p) => !SENSITIVE_PERMISSIONS.includes(p));

export const DEFAULT_ROLES: { key: string; name: { ar: string; en: string }; permissions: Permission[]; system: boolean }[] = [
  { key: 'admin', name: { ar: 'المدير العام', en: 'Super Administrator' }, permissions: [...PERMISSIONS], system: true },
  {
    key: 'administrator',
    name: { ar: 'مدير', en: 'Administrator' },
    // Everything except payment credentials and staff management.
    permissions: [...ALL_BUT_SENSITIVE],
    system: false,
  },
  {
    key: 'content_editor',
    name: { ar: 'مدير المحتوى', en: 'Content Manager' },
    permissions: ['overview:read', 'products:read', 'content:write', 'media:write', 'categories:write', 'reviews:moderate'],
    system: false,
  },
  {
    key: 'product_manager',
    name: { ar: 'مدير المنتجات', en: 'Product Manager' },
    permissions: ['overview:read', 'products:read', 'products:write', 'categories:write', 'inventory:read', 'inventory:write', 'media:write', 'discounts:read', 'reports:read'],
    system: false,
  },
  {
    key: 'order_manager',
    name: { ar: 'مدير الطلبات', en: 'Order Manager' },
    permissions: ['overview:read', 'orders:read', 'orders:write', 'inventory:read', 'customers:read', 'products:read'],
    system: false,
  },
  {
    key: 'sales_executive',
    name: { ar: 'مسؤول المبيعات الإلكترونية', en: 'Online Sales Executive' },
    permissions: [
      'overview:read',
      'orders:read',
      'orders:write',
      'products:read',
      'products:write',
      'inventory:read',
      'inventory:write',
      'customers:read',
      'discounts:read',
      'discounts:write',
      'reports:read',
    ],
    system: false,
  },
];
