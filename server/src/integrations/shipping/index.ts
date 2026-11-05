/**
 * Courier integration interface. CELIBERY currently ships with I Mile Logistics (Q24).
 * No courier API credentials were supplied, so the operational workflow is manual:
 * staff create the shipment in the courier's portal, then enter the tracking number in
 * Admin → Orders → "Mark as shipped". Customers see the tracking number (and a tracking
 * link if a URL template is configured in Settings).
 *
 * To automate later, implement CourierProvider for the courier's API and call
 * createShipment() from the order service when an order moves to "processing".
 */
export interface CourierProvider {
  readonly name: string;
  createShipment?(input: {
    orderNumber: string;
    recipient: { name: string; phone: string; city: string; district: string; street: string; postalCode?: string };
    codAmount?: number;
    pieces: number;
  }): Promise<{ trackingNumber: string; labelUrl?: string }>;
  trackingUrl(trackingNumber: string, template: string): string;
}

export const manualCourier: CourierProvider = {
  name: 'manual',
  trackingUrl(trackingNumber, template) {
    if (!template || !trackingNumber) return '';
    return template.replace('{tracking}', encodeURIComponent(trackingNumber));
  },
};
