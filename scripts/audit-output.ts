// What each source actually produces, judged on its output rather than its name.
//
//   npm run audit:output
//
// A source is a promise: this publisher writes about technology changing. The
// only way to check is to read what it has actually put in the archive. Three
// hundred repository feeds looked reasonable in a seed file and turned out to
// be a build log; kernel.org's release feed looked like a release feed and
// turned out to be nine copies of the same front page with different fragments.
//
// Every number here is measured, not declared.

import { createDb, closePool } from '../src/db/client.ts';
import { loadDotEnv } from '../src/lib/dotenv.ts';
import { configureFromEnv } from '../src/config.ts';

await loadDotEnv();
configureFromEnv(process.env as Record<string, string | undefined>);
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const db = createDb(url);

interface Row {
  name: string; kind: string; health: string; company: string | null;
  stories: string; urls: string; hosts: string; med_words: string;
  same_title: string; titles: string[];
}

const rows = await db.query<Row>(`
  SELECT src.name, src.kind::text, src.health::text, src.company_slug AS company,
         count(*)::text AS stories,
         count(DISTINCT st.canonical_url)::text AS urls,
         count(DISTINCT split_part(split_part(st.canonical_url, '//', 2), '/', 1))::text AS hosts,
         coalesce(percentile_disc(0.5) WITHIN GROUP (
           ORDER BY coalesce(array_length(
             regexp_split_to_array(trim(coalesce(st.summary_en, '')), '\s+'), 1), 0)), 0)::text
           AS med_words,
         (count(*) - count(DISTINCT coalesce(st.title_en, st.title_original)))::text AS same_title,
         (array_agg(coalesce(st.title_en, st.title_original)
            ORDER BY st.published_at DESC))[1:3] AS titles
    FROM stories st
    JOIN sources src ON src.id = st.source_id
   WHERE st.superseded_by IS NULL AND st.dismissed_at IS NULL
   GROUP BY 1,2,3,4
   ORDER BY count(*) DESC`);

console.log(`${rows.length} sources have produced a visible story\n`);
console.log('  n  urls host  med  dup  source');
console.log('  -- ---- ----  ---  ---  ------');
for (const r of rows) {
  const n = Number(r.stories);
  const urls = Number(r.urls);
  const med = Number(r.med_words);
  const dupTitles = Number(r.same_title);
  // The three shapes worth flagging, each measured.
  const flags = [
    urls < n ? 'ONE-PAGE' : '',
    med < 12 ? 'THIN' : '',
    dupTitles > 0 ? `SAMETITLE:${dupTitles}` : '',
  ].filter(Boolean).join(' ');
  console.log(`  ${String(n).padStart(2)} ${String(urls).padStart(4)} ${
    String(r.hosts).padStart(4)}  ${String(med).padStart(3)}  ${
    String(dupTitles).padStart(3)}  ${r.name}${flags ? '   << ' + flags : ''}`);
  for (const t of r.titles) console.log(`         ${(t ?? '').slice(0, 88)}`);
}

await closePool();
process.exit(0);
