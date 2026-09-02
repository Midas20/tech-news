// Migration runner. Applies migrations/*.sql in filename order, once each,
// inside a transaction, tracked in schema_migrations.
//
//   node --experimental-strip-types scripts/migrate.ts
//   node --experimental-strip-types scripts/migrate.ts --status
//   node --experimental-strip-types scripts/migrate.ts --dry-run

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';
import { loadDotEnv } from '../src/lib/dotenv.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');

async function main(): Promise<void> {
  await loadDotEnv();
  const args = new Set(process.argv.slice(2));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  if (args.has('--dry-run')) {
    console.log(`${files.length} migrations found:`);
    for (const f of files) console.log(`  ${f}`);
    return;
  }

  // Migrations need session state (SET, CREATE ROLE, advisory ordering), which a
  // transaction pooler does not preserve -- always the direct URL when there is one.
  const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_DIRECT_URL / DATABASE_URL is not set. Nothing was executed.');
    console.error('Run with --dry-run to list migrations without a database.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now(),
        checksum    text NOT NULL
      )`);

    const applied = new Map<string, string>(
      (await client.query('SELECT filename, checksum FROM schema_migrations')).rows.map(
        (r: any) => [r.filename, r.checksum],
      ),
    );

    if (args.has('--status')) {
      for (const f of files) {
        const state = applied.has(f) ? 'applied' : 'pending';
        console.log(`${state.padEnd(8)} ${f}`);
      }
      return;
    }

    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');

      // HASH THE SQL, NOT THE CHECKOUT.
      //
      // git is configured with core.autocrlf on Windows, so the same committed
      // migration is CRLF in this working tree and LF in a Linux one. Hashing
      // the raw bytes made the checksum a property of the machine: 0071 was
      // applied as a1d5efb7 and read back as 943b2530 after nothing but a line
      // ending changed, and every migration would have failed the same way on a
      // fresh clone from another platform.
      //
      // Normalising here is safe because the thing being guarded is the SQL
      // that ran. A line ending cannot change what a statement does, so two
      // checkouts of one commit must not be able to disagree about whether the
      // history matches. An actual edit still changes the hash, which is the
      // property this check exists for.
      const checksum = await sha256Hex(sql.replace(/\r\n/g, '\n'));

      const previous = applied.get(file);
      if (previous) {
        // A changed migration is an error, not something to re-run. Schema
        // history has to match what actually happened to the database.
        if (previous !== checksum) {
          // Unless the only thing that changed is the line ending. Rows written
          // before the normalisation above hold the hash of whatever bytes that
          // checkout happened to have, so this table currently holds a mix: some
          // migrations were applied from a CRLF working tree and some from LF.
          // Re-hashing the raw file tells the two cases apart -- a match means
          // the SQL is byte-identical and only the endings moved, which cannot
          // change what ran, so the row is corrected in place. Anything that
          // matches neither form is a genuine edit and still stops the run.
          if (previous === await sha256Hex(sql)) {
            await client.query(
              'UPDATE schema_migrations SET checksum = $2 WHERE filename = $1',
              [file, checksum],
            );
            console.log(`${file} checksum normalised (line endings only)`);
            continue;
          }
          throw new Error(
            `${file} has changed since it was applied (${previous.slice(0, 8)} -> ${checksum.slice(0, 8)}). ` +
            'Write a new migration instead of editing an applied one.',
          );
        }
        continue;
      }

      process.stdout.write(`applying ${file} ... `);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
        await client.query('COMMIT');
        console.log('ok');
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('failed');
        throw err;
      }
    }
    console.log('migrations up to date');
  } finally {
    client.release();
    await pool.end();
  }
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
