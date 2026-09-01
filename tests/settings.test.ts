import { describe, it, expect } from 'vitest';
import {
  SETTINGS, coerce, applyOverrides, readingPrefs, configValue, settingDef,
  READING_DEFAULTS, type SettingValue, type SettingDef,
} from '../src/settings.ts';
import { loadConfig } from '../src/config.ts';

const def = (key: string) => {
  const d = settingDef(key);
  if (!d) throw new Error(`no such setting: ${key}`);
  return d;
};

describe('setting definitions', () => {
  it('every config-scoped key resolves to a real path in Config', () => {
    // The guard against the whole point of the page: a knob that looks
    // configurable but is ignored is worse than a hardcoded constant.
    const config = loadConfig({});
    const missing = SETTINGS
      .filter((d) => d.scope === 'config')
      .filter((d) => configValue(config, d.key) === undefined)
      .map((d) => d.key);
    expect(missing).toEqual([]);
  });

  it('every reading-scoped key exists in the reading defaults', () => {
    const missing = SETTINGS
      .filter((d) => d.scope === 'reading')
      .map((d) => d.key.slice('reading.'.length))
      .filter((k) => !(k in READING_DEFAULTS));
    expect(missing).toEqual([]);
  });

  it('has no duplicate keys', () => {
    const keys = SETTINGS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('coercion', () => {
  it('clamps numbers into their declared range rather than rejecting them', () => {
    const d = def('fetch.maxConcurrency');   // 1..64
    expect(coerce(d, '9')).toBe(9);
    expect(coerce(d, '900')).toBe(64);
    expect(coerce(d, '-4')).toBe(1);
    expect(coerce(d, 'not a number')).toBeNull();
  });

  it('rounds to an integer where the setting is an integer', () => {
    expect(coerce(def('batch.classify'), '12.7')).toBe(13);
  });

  it('reads the several spellings of true a form can produce', () => {
    const d = def('gates.classificationEnabled');
    expect(coerce(d, 'on')).toBe(true);
    expect(coerce(d, true)).toBe(true);
    expect(coerce(d, 'false')).toBe(false);
    expect(coerce(d, '')).toBe(false);
  });

  it('drops enum values that are not offered', () => {
    expect(coerce(def('reading.sort'), 'velocity')).toBe('velocity');
    expect(coerce(def('reading.sort'), 'whatever')).toBeNull();
  });

  it('keeps only allowed values in a multi-select, de-duplicated', () => {
    // No shipped setting is a multi-select any more -- the last one was
    // "languages collected", removed once collection became English-only -- but
    // the kind is still supported, so it is still tested.
    const multi: SettingDef = {
      key: 'test.multi', scope: 'config', group: 'quality', kind: 'multi',
      label: 'Test', help: 'Test.',
      options: [{ value: 'en', label: 'English' }, { value: 'ja', label: '日本語' }],
    };
    expect(coerce(multi, ['en', 'ja', 'en', 'klingon'])).toEqual(['en', 'ja']);
  });

  it('splits a free list on newlines or commas and lowercases it', () => {
    expect(coerce(def('filters.blockedHosts'), 'Example.com\n spam.net ,example.com'))
      .toEqual(['example.com', 'spam.net']);
  });

  it('treats empty text as no value, not as an empty value', () => {
    expect(coerce(def('fetch.userAgent'), '   ')).toBeNull();
  });
});

describe('the overlay', () => {
  it('overrides the environment and leaves everything else alone', () => {
    const env = loadConfig({ FETCH_MAX_CONCURRENCY: '20', POLITENESS_INTERVAL_MS: '2000' });
    const merged = applyOverrides(env, new Map<string, SettingValue>([
      ['fetch.maxConcurrency', 8],
    ]));
    expect(merged.fetch.maxConcurrency).toBe(8);
    expect(merged.fetch.politenessMs).toBe(2000);
  });

  it('does not mutate the config it was given', () => {
    // "What would this be without the overlay" has to stay answerable: it is
    // what the settings page prints under every field.
    const env = loadConfig({ FETCH_MAX_CONCURRENCY: '20' });
    applyOverrides(env, new Map<string, SettingValue>([['fetch.maxConcurrency', 3]]));
    expect(env.fetch.maxConcurrency).toBe(20);
  });

  it('ignores a stored value that no longer fits its definition', () => {
    const env = loadConfig({});
    const merged = applyOverrides(env, new Map<string, SettingValue>([
      ['fetch.maxConcurrency', 'banana' as unknown as number],
    ]));
    expect(merged.fetch.maxConcurrency).toBe(env.fetch.maxConcurrency);
  });

  it('clamps a stored value that is now out of range', () => {
    const merged = applyOverrides(loadConfig({}), new Map<string, SettingValue>([
      ['fetch.maxConcurrency', 5000],
    ]));
    expect(merged.fetch.maxConcurrency).toBe(64);
  });

  it('applies arrays as arrays', () => {
    const merged = applyOverrides(loadConfig({}), new Map<string, SettingValue>([
      ['filters.blockedHosts', ['example.com', 'spam.net']],
    ]));
    expect(merged.filters.blockedHosts).toEqual(['example.com', 'spam.net']);
  });

  it('applies booleans, including switching a gate off', () => {
    const env = loadConfig({ CLASSIFICATION_ENABLED: 'true' });
    expect(env.gates.classificationEnabled).toBe(true);
    const merged = applyOverrides(env, new Map<string, SettingValue>([
      ['gates.classificationEnabled', false],
    ]));
    expect(merged.gates.classificationEnabled).toBe(false);
  });
});

describe('reading preferences', () => {
  it('falls back to the shipped defaults when nothing is stored', () => {
    expect(readingPrefs(new Map())).toEqual(READING_DEFAULTS);
  });

  it('takes stored values and ignores nonsense', () => {
    const prefs = readingPrefs(new Map<string, SettingValue>([
      ['reading.density', 'compact'],
      ['reading.pageSize', 25],
      ['reading.theme', 'sideways'],
    ]));
    expect(prefs.density).toBe('compact');
    expect(prefs.pageSize).toBe(25);
    expect(prefs.theme).toBe('dark');          // rejected, so the default stands
  });

  it('defaults to dark rather than to the operating system', () => {
    // "Match the system" is still offered, but as a choice. It was the default
    // once, which meant a light desktop served a white page to someone who had
    // never asked for one.
    expect(READING_DEFAULTS.theme).toBe('dark');
    expect(readingPrefs(new Map()).theme).toBe('dark');
    expect(readingPrefs(new Map<string, SettingValue>([['reading.theme', 'auto']])).theme)
      .toBe('auto');
  });
});
