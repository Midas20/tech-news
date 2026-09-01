// The small registry: sources that report changes to technology, and nothing else.
//
// WHAT MADE THIS NECESSARY
//
//   "ATF confirms major incident after recent Qilin breach claims"
//
// BleepingComputer, filed as a `change` because it is one -- to a US federal
// agency. It is not a change to a stack, a tool or a platform, and no amount of
// filtering fixes it, because the source's beat IS incidents at organisations.
// A registry of 367 sources contained perhaps sixteen that answer the brief.
//
// THE TEST EVERY ROW HERE PASSES
//
// Does this source report that a technology CHANGED -- launched, released,
// deprecated, repriced, relicensed, retired -- rather than that something
// happened to somebody who uses one? A breach, an outage at a company, a funding
// round, an industry survey and a conference keynote all fail it.
//
// Chosen against the fields this reader follows -- AI & ML, Security,
// Infrastructure, Cloud, DevOps -- because "best" has no meaning without them:
// the V8 blog is excellent and irrelevant to somebody who does not follow
// browsers.
//
// WHAT IS DELIBERATELY ABSENT
//
//   Incident press          BleepingComputer, The Hacker News. A breach at an
//                           agency is not a change to a stack. Security is kept
//                           through advisories instead -- Ubuntu's USNs say
//                           which package changed and to what version.
//   Industry press          The Register, SD Times. Funding, lawsuits, earnings.
//   Vendor marketing        SAP news, most of it awards and customer stories.
//   Hobby hardware          Arduino, Raspberry Pi. Real, and not this archive.
//   Fields not followed     Android, Unity, Unreal, Windows Insider, V8,
//                           Inside Java, Django, WordPress, Haskell, Lua.
//   319 repo release feeds  Not deleted from the world -- derived on demand by
//                           `npm run sync:releases`, which now takes --tracked
//                           and adds a feed only for a technology named in
//                           Settings -> Releases you track. Collection follows
//                           the reader's choice rather than preceding it.
//
// Everything dropped is one command from coming back: `npm run seed`,
// `npm run seed:primary`, `npm run sync:releases`. The seed files still hold all
// of it, with the reasoning for each row.

import type { SourceSeed } from './sources.ts';
import type { PrimarySeed } from './primary.ts';
import { PRIMARY_SOURCES } from './primary.ts';
import { NEWS_SOURCES } from './news.ts';
import { ANNOUNCE_SOURCES } from './announce.ts';

/**
 * Kept by name, with the reason. The rows themselves live in the seed files
 * that already describe them; duplicating a feed URL here would be a second
 * place for it to be wrong.
 */
export const CORE_NAMES: { name: string; why: string }[] = [
  // Every verdict below was reached by reading what the source actually put in
  // the archive -- `npm run audit:output` -- rather than from what it is called.
  // The counts are what it produced over the window that was measured.
  //
  // Three hundred repository feeds looked reasonable in a seed file and turned
  // out to be a build log. kernel.org's release feed looked like a release feed
  // and turned out to be nine copies of one front page. A source is a promise
  // and the only way to check it is to read the output.

  // --- the platforms you build on: launches, retirements, prices ------------
  { name: 'AWS What’s New', why: '22 items, every one a dated AWS change. Retirements and price cuts land here first.' },
  { name: 'Azure updates', why: '25 items, each tagged [Launched] or [In preview], with the end-of-life notices.' },
  { name: 'Google Cloud release notes', why: '296 items and the archive’s largest source: one entry per service change, read through an adapter.' },
  { name: 'Cloudflare changelog', why: '91 items across Workers, Durable Objects and Access. Second only to Google Cloud by volume.' },
  { name: 'GitHub changelog', why: '13 items on Actions, retention and the API — where most of this archive is hosted.' },
  { name: 'Vercel changelog', why: '11 items on Next.js and the deploy platform under it.' },
  { name: 'Discord developer changelog', why: '4 items, each a named API or SDK change.' },
  { name: 'Notion releases', why: '3 items, all product changes rather than announcements about the company.' },
  { name: 'Auth0 changelog', why: 'Identity platform changes, first-party.' },
  { name: 'Docker changelog', why: 'Engine and Desktop changes at their source.' },

  // --- security, kept as ADVISORIES rather than as breach reporting ---------
  { name: 'Ubuntu security notices', why: '22 USNs. Each says which package changed and to what version — the form security news should take.' },
  { name: 'Microsoft Security Blog', why: 'Microsoft patching its own stack, component by component.' },
  { name: 'AWS Security Bulletins', why: 'Which AWS component was patched, and to what.' },

  // --- languages and runtimes, first-party -----------------------------------
  { name: 'PostgreSQL news', why: '9 items: releases, tooling and packaging, written by the project.' },
  { name: 'Go blog', why: 'Language and toolchain changes from the team that makes them.' },
  { name: 'Rust blog', why: 'The same for Rust.' },
  { name: 'Kotlin blog', why: 'Language and multiplatform releases, first-party.' },
  { name: 'Node.js blog', why: 'Release announcements. Thin bodies, but each one is a real version of a thing this archive tracks.' },
  { name: 'WebKit blog', why: 'Safari Technology Preview release notes — the web platform as implemented.' },
  { name: 'Mozilla Firefox releases', why: 'The other implementer, first-party.' },

  // --- infrastructure and the things that run on it -------------------------
  { name: 'Kubernetes blog', why: '2 items, both v1.37 release notes. Low volume because it releases rarely, not because it is quiet.' },
  { name: 'HashiCorp blog', why: '4 items: Vault, Packer and HCP, each a named capability change.' },
  { name: 'Grafana blog', why: '5 items on Grafana, the AI SDK and Synthetic Monitoring. Technical throughout.' },
  { name: 'Redis blog', why: '13 items, median 25 words, and the most consistently technical vendor blog measured.' },
  { name: 'Databricks Blog', why: '4 items on the runtime and the lakehouse layer.' },
  { name: 'ClickHouse Blog', why: 'Engine releases and the format work under them.' },
  { name: 'Supabase Blog', why: 'Postgres as a platform: what shipped, and what it costs.' },
  { name: 'Tailscale blog', why: '2 items on connectivity and privileged access. Clear writing about protocol change.' },
  { name: 'Sentry Blog', why: 'SDK and instrumentation changes across every language it supports.' },
  { name: 'Debian news', why: 'Distribution releases and project decisions.' },
  { name: 'Arch Linux news', why: 'Manual-intervention notices: the rare case where a distribution change breaks your machine.' },

  // --- AI, where the model is the technology --------------------------------
  { name: 'OpenAI changelog', why: '19 items, one per API change, with pricing among them.' },
  { name: 'Google DeepMind blog', why: '3 items, all model releases.' },
  { name: 'Hugging Face blog', why: 'The hub itself changing: formats, licences, serving.' },
  { name: 'NVIDIA developer blog', why: '2 items on NVLink and the accelerator stack under all of it.' },
  { name: 'Mistral AI news', why: 'Open-weight model releases, announced directly.' },
  { name: 'OpenAI blog', why: 'The company channel beside the API changelog.' },

  // --- tooling vendors -------------------------------------------------------
  { name: 'JetBrains Blog', why: '6 items including a security incident affecting their own product and Loom support in IntelliJ.' },
  { name: 'GitHub Blog', why: '2 items on Copilot and supply-chain security.' },
  { name: 'GitLab Blog', why: 'The other vendor on the same ground.' },
  { name: 'Docker Blog', why: 'Engine, Hub and build tooling, first-party.' },
  { name: 'Fly.io blog', why: 'Runtime and networking changes, written unusually plainly.' },
  { name: 'Red Hat Blog', why: 'RHEL, OpenShift and the enterprise Linux stack.' },
  { name: 'Microsoft Azure Blog', why: '2 items, both engineering rather than marketing.' },
  { name: 'Google Cloud Blog', why: 'Kept on probation: 16 items and some are customer stories. Watch it.' },

  // --- engineering blogs whose output other people end up running -----------
  { name: 'Meta Engineering', why: 'Infrastructure at a scale that produces tools other people adopt.' },
  { name: 'Netflix Tech Blog', why: 'The origin of a great deal of what the industry now runs.' },
  { name: 'Stripe Engineering', why: 'API design and payments infrastructure at scale.' },
  { name: 'Spotify Engineering', why: 'Backstage and the developer-platform work around it.' },

  // --- the two press outlets that report changes rather than incidents ------
  { name: 'LWN.net', why: 'Measured at 93% events — the highest of any source here. Kernel and toolchain changes as changes.' },
  { name: 'The New Stack', why: 'Cloud native and platform engineering, practitioner-facing.' },
  { name: 'InfoQ', why: 'Practitioners writing for practitioners.' },
];

/**
 * Read, and not kept. The evidence, so the next person does not re-add them.
 *
 * Every line is a real headline this source put in the archive. Most of these
 * were already named in the "deliberately absent" list at the top of this file
 * and had drifted back in -- which is the argument for keeping the list and the
 * registry in one place, and for `npm run sources:core` being run rather than
 * feared.
 */
export const REJECTED: { name: string; why: string }[] = [
  { name: 'SAP news', why: '18 items. "SAP CX Wins TrustRadius Top Rated 2026", "AI-Powered Memory Games Bring Personal Stories into Dementia Care". Marketing, not change.' },
  { name: 'Elastic blog', why: '15 items. "Forging India\'s Digital Future: Elastic{ON} Comes to Mumbai", "The search multiplier: Driving revenue". Events and positioning.' },
  { name: 'Linux kernel releases', why: '10 items, median 4 words, every one the kernel.org front page under a different fragment. "7.2.2: stable" is a table row, not an announcement.' },
  { name: 'Raspberry Pi news', why: '9 items. "LesionIQ skin cancer diagnostic", "Create your own cyberdeck". Hobby projects — real, and not this archive.' },
  { name: 'Arduino blog', why: '8 items. "four 17-year-olds are building AI-powered livestock monitoring". As above.' },
  { name: 'WordPress news', why: '6 items. "WordPress Signs the Open Weights and American AI Leadership Letter", "AI Creates Opportunity While Artists Ship at WordCamp US". Advocacy and events.' },
  { name: 'Django weblog', why: '6 items. "PyCharm & Django Fall Fundraiser", "DSF Membership Open Space at DjangoCon". Community administration.' },
  { name: 'Haskell announcements', why: '12 items of mailing-list traffic: "[ANN] vulkan-3.27 + lots of new stuff", "2026-08-18 Infrastructure Update".' },
  { name: 'Inside Java', why: '6 items, genuinely technical, and Java is not a field this reader follows.' },
  { name: 'Unity blog', why: '4 items. "Keeping a VR giant fresh: Gorilla Tag\'s two-week live ops cadence". Game development.' },
  { name: 'Windows Insider blog', why: '4 items, half of them "Announcing new builds for 21 August 2026" — a build number with a date.' },
  { name: 'Apple Newsroom', why: '1 item: "Exciting updates for Sneaky Sasquatch come to Apple Arcade". Consumer.' },
  { name: 'Lua news', why: '2 items, median 5 words, version numbers only.' },
  { name: 'Fedora Magazine', why: '5 items. "Fedora Badges Revamp Project", "Test Days for Fedora 45". Community programme, not distribution change.' },
  { name: 'PHP releases', why: 'Half of what it produced was "LonghornPHP 2026", a conference. The releases arrive through php.net anyway.' },
  { name: 'Ubuntu Blog', why: '1 item: "AI harnesses for telco autonomous networks". Canonical\'s marketing channel; the security notices are the useful half and are kept.' },
  { name: 'Android Developers Blog', why: '10 items, competent, and mobile is not a field this reader follows.' },
];


/**
 * A company's own announcement channel.
 *
 * THIS REVISED THE RULE ABOVE, on instruction. The test every other row passes
 * is "does this source report that a technology CHANGED, rather than that
 * something happened to somebody who uses one" -- and it was read as excluding
 * companies, which put "vendor marketing" on the absent list.
 *
 * That reading was too broad. A company announcing its own work IS the
 * technology changing, and it is the primary record of it. The rule was meant
 * to exclude a breach at an agency and a funding round, not the release note.
 *
 * The channels are no longer listed separately: they were audited on their
 * output alongside everything else and the survivors are in CORE_NAMES above,
 * beside the changelogs they sit next to in the reader. Splitting them out made
 * a second list to keep in step, which is the mistake this file exists to
 * avoid. Status pages are still excluded before either list sees them -- an
 * incident is a bad afternoon, not a change -- and so are the channels that
 * publish no feed at all. Both are recorded in seeds/announce.ts.
 */


const ALL: (SourceSeed | PrimarySeed)[] = [
  ...PRIMARY_SOURCES, ...NEWS_SOURCES, ...ANNOUNCE_SOURCES];

export const CORE_SOURCES: (SourceSeed | PrimarySeed)[] = CORE_NAMES.map((k) => {
  const found = ALL.find((s) => s.name === k.name);
  if (!found) throw new Error(`core source not found in any seed: ${k.name}`);
  return found;
});

export function reasonFor(name: string): string {
  return CORE_NAMES.find((k) => k.name === name)?.why ?? '';
}
