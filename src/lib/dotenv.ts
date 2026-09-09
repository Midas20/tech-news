// .env loading for local scripts ONLY.
//
// This lives outside config.ts deliberately. config.ts is imported by the Worker
// bundle, and a `node:fs` import -- even a dynamic one inside a runtime guard --
// is resolved by the bundler and dragged into the build. Keeping the file system
// on this side of the line keeps the Worker bundle free of Node built-ins.
//
// Workers get their values from wrangler vars and secrets instead.

/**
 * NEWSTRACK_ENV_FILE overrides the default, for a deployment whose
 * configuration is not beside its code. The desktop launcher keeps it in
 * %LOCALAPPDATA%, because the program folder is replaced on every upgrade and
 * may not be writable at all.
 */
export async function loadDotEnv(
  path = process.env.NEWSTRACK_ENV_FILE || '.env',
): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    // Real environment variables win over the file, so a one-off override works.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
