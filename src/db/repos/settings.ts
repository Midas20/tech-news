// Reading and writing the settings overlay.
//
// One query loads the whole table -- there are a few dozen rows and every caller
// wants all of them -- so a process pays a single round trip to learn everything
// an operator has changed, and then never asks again for the life of the run.

import type { Db } from '../client.ts';
import { coerce, settingDef, applyOverrides, type SettingValue } from '../../settings.ts';
import { getConfig, setConfig, type Config } from '../../config.ts';

/** Every stored override, validated against the current definitions. */
export async function loadOverrides(db: Db): Promise<Map<string, SettingValue>> {
  const rows = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM app_settings`);
  const out = new Map<string, SettingValue>();
  for (const row of rows) {
    const def = settingDef(row.key);
    if (!def) continue;                       // a key the code no longer knows
    const value = coerce(def, row.value);
    if (value === null) continue;             // a value that no longer fits
    out.set(row.key, value);
  }
  return out;
}

/**
 * Load the overlay and install the merged config process-wide.
 *
 * Called once at start-up by every entry point that acts on configuration --
 * the collector, the processing pass, the Worker. It is deliberately best
 * effort: a database that cannot be reached must not stop a cycle that only
 * needed the environment values anyway.
 */
export async function applyStoredSettings(db: Db): Promise<Config> {
  try {
    const overrides = await loadOverrides(db);
    const merged = applyOverrides(getConfig(), overrides);
    setConfig(merged);
    return merged;
  } catch (err) {
    console.warn(`settings: using environment only (${err instanceof Error ? err.message : err})`);
    return getConfig();
  }
}
