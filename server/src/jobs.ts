import { logger } from './lib/logger';
import { cleanupAbandonedUploads } from './modules/admin/media.service';
import { releaseExpiredReservations } from './modules/orders/order.service';
import { reconcileOpenRefunds } from './modules/payments/refund.service';
import { markAbandonedDrafts } from './modules/checkout-drafts/draft.service';

/**
 * Scheduled maintenance. On Vercel these run through Vercel Cron (vercel.json → /api/cron/*).
 * A long-running server (Railway, a VPS, a container) has no Vercel Cron, so server.ts runs them
 * in-process with startScheduler(). Every job uses conditional updates, so overlapping runs
 * (cron + scheduler, or several instances) are safe.
 */

/** Cancels unpaid online orders whose stock reservation expired and returns the stock; records abandoned checkouts. */
export async function runReservationJob() {
  const reservations = await releaseExpiredReservations(200);
  const checkouts = await markAbandonedDrafts();
  return { ...reservations, checkouts };
}

/** Refunds whose gateway outcome was uncertain, and abandoned media uploads. */
export async function runMaintenanceJob() {
  const refunds = await reconcileOpenRefunds(50);
  const media = await cleanupAbandonedUploads(24, 100);
  return { refunds, media };
}

const RESERVATION_EVERY_MS = 5 * 60_000;
const MAINTENANCE_EVERY_MS = 30 * 60_000;

function every(name: string, ms: number, job: () => Promise<unknown>) {
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap with a slow previous run
    running = true;
    try {
      const result = await job();
      logger.info(`Scheduled job ${name} finished`, { result: result as Record<string, unknown> });
    } catch (err) {
      logger.error(`Scheduled job ${name} failed`, { err: String(err) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), ms);
  timer.unref(); // does not keep the process alive on shutdown
  setTimeout(() => void tick(), 15_000).unref(); // first run shortly after start-up
  return timer;
}

/** Starts the in-process scheduler (long-running servers only; set DISABLE_INTERNAL_SCHEDULER=true to rely on external cron). */
export function startScheduler() {
  const timers = [every('release-reservations', RESERVATION_EVERY_MS, runReservationJob), every('maintenance', MAINTENANCE_EVERY_MS, runMaintenanceJob)];
  logger.info('In-process scheduler started', { reservationsEveryMin: RESERVATION_EVERY_MS / 60_000, maintenanceEveryMin: MAINTENANCE_EVERY_MS / 60_000 });
  return () => timers.forEach(clearInterval);
}
