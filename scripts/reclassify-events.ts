// Re-judge the event class of every held story under the current rules.
//
//   npm run events:reclass              dry run: print what would move
//   npm run events:reclass -- --apply   write it
//
// `event_kind` is decided once, at ingest, from the title. That is right --
// the verdict travels with the story and cannot be lost to a later rename --
// and it means a change to the grammar leaves the archive speaking the old
// language. When `market` was added, the funding rounds already held were
// still filed as whatever the old rules could make of them.
//
// Dry run by default, for the reason every rule change in this project is:
// the only way to know whether a rule is right is to read what it did.
//
// Re-runnable and idempotent. It reads titles and writes one column; it never
// deletes, never re-fetches, and a second run with no rule change is a no-op.

import { createDb, closePool } from '../src/db/client.ts';
import { configureFromEnv } from '../src/config.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { classifyEvent } from '../src/collect/eventful.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createDb(url);
const apply = process.argv.includes('--apply');

interface Row {
  id: string; title: string; event_kind: string | null;
  src: string; kind: string | null; roles: string[] | null;
}

const rows = await db.query<Row>(`
  SELECT st.id::text, coalesce(st.title_en, st.title_original) AS title,
         st.event_kind, s.name AS src, s.kind::text AS kind, s.roles
    FROM stories st LEFT JOIN sources s ON s.id = st.source_id
   WHERE st.superseded_by IS NULL`);

const moves = new Map<string, Row[]>();
for (const r of rows) {
  const v = classifyEvent(r.title ?? '', {
    sourceKind: r.kind ?? undefined,
    firstParty: (r.roles ?? []).includes('PRIMARY'),
  });
  if (v.kind === r.event_kind) continue;
  const key = `${r.event_kind ?? 'unclassified'} -> ${v.kind}`;
  if (!moves.has(key)) moves.set(key, []);
  moves.get(key)!.push({ ...r, event_kind: v.kind });
}

const total = [...moves.values()].reduce((n, v) => n + v.length, 0);
console.log(`${rows.length} stories examined, ${total} would change class\n`);
for (const [key, list] of [...moves].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(list.length).padStart(4)}  ${key}`);
  for (const r of list.slice(0, 4)) {
    console.log(`        ${r.src.slice(0, 20).padEnd(21)} ${r.title.slice(0, 70)}`);
  }
}

if (!apply) {
  console.log('\ndry run. --apply to write it.');
} else {
  let written = 0;
  for (const list of moves.values()) {
    // One statement per class, not per story: the classes are few and the
    // stories are many.
    const byKind = new Map<string, string[]>();
    for (const r of list) {
      if (!byKind.has(r.event_kind!)) byKind.set(r.event_kind!, []);
      byKind.get(r.event_kind!)!.push(r.id);
    }
    for (const [kind, ids] of byKind) {
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        await db.query(
          `UPDATE stories SET event_kind = $1 WHERE id = ANY($2::uuid[])`, [kind, chunk]);
        written += chunk.length;
      }
    }
  }
  console.log(`\n${written} stories reclassified.`);
}
await closePool();
