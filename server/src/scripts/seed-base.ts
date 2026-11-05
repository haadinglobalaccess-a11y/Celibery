/** npm run seed:base — creates categories, roles, collections, campaign templates and draft legal pages. Safe to re-run. */
import { seedBase } from '../seed/seed';
import { run } from './_run';

run(seedBase);
