/**
 * npm run seed:demo             — adds clearly-labelled SAMPLE products for development/review.
 * npm run seed:demo -- --remove — removes all sample products.
 * Refuses to run against production unless --force is given.
 */
import { isProd } from '../config/env';
import { removeDemo, seedDemo } from '../seed/seed';
import { arg, run } from './_run';

run(async () => {
  if (isProd && arg('force') === undefined && arg('remove') === undefined) {
    throw new Error('Refusing to add demo products in production. Use --force on a private staging database only.');
  }
  return arg('remove') !== undefined ? removeDemo() : seedDemo();
});
