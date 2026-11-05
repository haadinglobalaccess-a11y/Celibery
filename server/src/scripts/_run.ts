import { connectDb, disconnectDb } from '../db/connect';

/** Connects, runs a CLI task, prints errors clearly and always disconnects. */
export async function run(task: () => Promise<unknown>) {
  try {
    await connectDb();
    const result = await task();
    if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    await disconnectDb();
    process.exit(0);
  } catch (err) {
    console.error('✖', err instanceof Error ? err.message : err);
    await disconnectDb().catch(() => undefined);
    process.exit(1);
  }
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}
