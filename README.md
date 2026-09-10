# NewsTrack — Tech Intelligence System

Continuously collects **what happens to stacks, tools and platforms** — launches,
releases, deprecations, licence changes, shutdowns and advisories — from the open
web; classifies and deduplicates it; and exposes a searchable archive with
per-technology trends going back years.

The target is deliberately narrow, and the narrowness is the product. An article
about Kubernetes is not an event in Kubernetes' history; a 2.0 release is. Feeds
publish overwhelmingly the first kind — 86% of everything collected, measured
over 40 days — so an archive that does not separate them is mostly commentary
with a few facts buried in it. See **Two gates** below.

Built through **Phase 2** of the build plan, plus a web UI. All TypeScript, running
on Cloudflare Workers cron with Postgres (Neon) as the only durable state.

```
npm install
npm run migrate                       # schema
npm run create:app-role               # app_user   (UI/agent, NOBYPASSRLS)
npm run create:app-role -- --worker   # worker_user (collector, NOBYPASSRLS)
npm run seed                          # taxonomy + source registry
npm run live                          # continuous collection
npm run ui                            # http://127.0.0.1:3000
```

Or, on a PC with none of that installed: `npm run build:app -- --with-postgres`
produces `dist\NewsTrack\NewsTrack.exe`, which sets itself up on the first run and
opens the reader when it is ready. See **Running it on a PC**.

Runs on **162.246.23.43:3000** — the durable scheduler in `job_runs` does the
collecting, fourteen jobs, read-only to anyone off the host.

The reader is also on the edge: **https://newstrack-site.market-research.workers.dev**
— the same routes through the same handler, reading the same database as
`app_user`.

Both require an account. Sign in at `/login`, or create one at `/signup` with a
username and password; email is optional. The seeded administrator is `admin`
with the password `Password@026`, which should be changed. A reader sees the
whole archive and can set two things — their focus fields and their theme, both
on `/me`. Everything that changes what everybody sees is an administrator's.

And **https://newstrack-poller.market-research.workers.dev** — the pipeline as a
Worker, holding the current revision and **armed with no cron triggers**. A warm
spare, not a second collector; triggered while the scheduler is live it stands
down rather than working the queue. See *Two schedulers of different vintages*.

Collection itself runs only on the host.

---

## What is here

| Phase | State |
|---|---|
| 0 · Foundation | **Done.** 27 migrations, RLS + FORCE on 11 tenant tables, monthly partitioning, 2,323 stacks (705 curated, 1,615 imported from four public lists, growing by discovery), 76 companies, 470+ seeded sources. |
| 1 · Collection | **Done, in both directions.** Forward (live) and backward (backfill). Conditional GET, feed autodiscovery, RSS/Atom/RDF/JSON Feed, charset handling, article extraction, language gate, length gate, layer-1 dedup, per-source failure isolation, fetch logging. |
| 2 · Processing | **Done.** SimHash + title-hash + model dedup, batched classification against a closed vocabulary, two-stage importance scoring, the five score axes, snapshot scheduling and capture. |
| 3 · UI | **Done.** Overview, four streams, fields, technologies, the stack registry, companies, search, trends, sources, settings and admin — navigation and filtering kept strictly apart. Multi-select filters, all state in the URL. Ranked full text search. In-place reading without storing bodies. |
| Retention | **Done.** Two months of whole stories, monthly analysis forever, favourites exempt. Enforced by row-level database rules (0037), not by convention. |
| Content gates | **Done.** Topic filter and event classifier, both lexical, both auditable — see **Two gates**. |
| Operation | **Done.** One scheduler runs collection, tagging, processing, rollup and retention on its own timers, with the schedule in `job_runs` so it survives restarts and two runners cannot double-collect. See **Nothing here ran unless somebody typed**. |
| Deploy | **Ready, not deployed.** `npm start` runs the web server and the scheduler in one process; `Dockerfile` builds it. The Cloudflare Worker remains as a fallback collector — it cannot host the site, which is a Node HTTP server. |
| 4–8 | Not built. Slack, multi-tenant install, agent, registries, backfill. Their tables exist and the schema is coherent. |

### Verified against the real database

- 52 migrations applied to Neon.
- **2,312 stories held** (May–August 2026) across 52 curated sources, growing continuously. Every one reads as one outlet, which is the truth — see **Nine stories in ten claimed a corroboration that did not exist**. The registry was cut from 367 sources to those that report changes to technology rather than incidents at companies — see **The general tech press, measured rather than argued about** — and has since been cut again on measured output to the 52 that actually report changes — see **This is unnecessary news**. Retention holds two months, and as of 0060 the collector agrees with it about which two.
- Earlier, against the 174-source registry, one run collected **1,127 stories in 15 minutes** — the throughput figures below are from that period and still hold.
- Classified against the taxonomy. Duplicate merging is layer 1-4; the same-source merges an out-of-date deployed Worker kept recreating were undone — see **The other copy of this application**.
- 396 coverage snapshots captured on schedule, each now recording the outlets actually seen by that moment.
- Tenant isolation proven as the application role — see below.
- **539 unit tests** in 36 files, clean typecheck.

### Collection throughput

Measured on the same benchmark (`npm run bench`), never-fetched sources, real feeds:

| | before | after |
|---|---|---|
| Database round trips per item | 6.30 | **1.35** |
| Items per second | 0.75 | **16.02** |
| Wall clock, 6 sources | 66 s | 3.4 s |

Two changes produced it, in that order, because the first measurement said which
to make: database time was only 12% of wall clock, so the work was network-bound.

1. **Batch the database.** One feed now costs a fixed handful of queries instead
   of six per item: one lookup for all its URLs, one for all its bodies, then
   multi-row inserts of stories, keys, snapshot schedule and jobs.
2. **Fan out the network.** Sources are polled concurrently and article pages
   fetched concurrently within a source, with politeness still enforced *per
   domain* — so concurrency means many hosts at once, never one host harder.

---

## Two gates

Everything collected passes two lexical judgements, in this order. Both are
plain code — no model call, no budget, no gate to switch off — and both write
their evidence to `story_rejects`, because a filter you cannot audit is one that
quietly eats a beat you cared about.

### 1 · Is this about technology at all — `src/collect/topical.ts`

Refuses shopping listicles, television, sport, politics, ordinary crime, funding
rounds and vendor surveys. Two ideas do the work:

- **Reject markers say what a piece of writing is FOR.** "38% off", "season 3",
  "how to watch", "raises $75M", "new survey finds". They are reliable because
  they describe the form of the piece rather than its nouns.
- **A technology signal rescues the arguable ones.** Three strengths: shopping,
  television and sport are refused outright; politics, crime and business are
  refused unless the *title itself* sounds technical; consumer coverage is
  refused unless anything names a technology.

The middle strength is where the first draft was wrong. With a plain technology
signal, "OpenAI bans Russian accounts posing as a fake Israeli think tank" and
"report finds 40% of firms use Kubernetes" both walked straight back in. Naming
a technology is not enough.

Two structural exemptions, both from measurement rather than taste. Release,
status and research feeds skip the gate entirely — a release feed publishes
releases, and running a shopping filter over it can only produce mistakes.
First-party sources skip the shopping and consumer rules, because "DeepSeek V4
Flash is 90% off through Novita on AI Gateway" is a pricing announcement on
Vercel's own blog, and the difference from a listicle is not in the words, it is
that the publisher is the subject.

Measured over three days: **3.4% refused**, 19 of them from quality sources and
every one defensible. TechRadar Computing loses 56%, ZDNET 35%, Hacker News 3%.

### 2 · Is it an EVENT or an article about one — `src/collect/eventful.ts`

The narrower question, and the one that decides what this archive is.

| kind | meaning | example |
|---|---|---|
| `launch` | a thing that did not exist before now does | Introducing Agent Plugins 1.0.0 |
| `release` | a new version of something that already existed | Next.js 16.3 support on Vercel |
| `change` | the same thing, materially different | Python 3.9 has reached end of life |
| `article` | writing about a technology rather than a report of an event | How Factory scaled its cloud backend |

The distinction is in the GRAMMAR, which is what makes it decidable without a
model. An announcement is a transitive claim about a named thing: X ships, X
adds Y, X is now available, introducing X. An article is a question, a
first-person report, or an editorial verb: how we, why you should, what I
learned. The two sets barely overlap.

Deliberately **independent of the vocabulary**. A genuinely new tool is by
definition not in a closed vocabulary yet, so requiring a known name would
filter out exactly the launches this exists for.

Three rules earned their place by being wrong first:

- **First-party posts are events unless they say otherwise.** A vendor's blog IS
  a changelog. "Share Container Registry repositories across teams" and "Set
  your own project avatars" carry no announcement verb and are each a feature
  that did not exist last week. Read as anonymous headlines they are how-tos;
  read as what they are, they are events. An interrogative opening or an
  "Article:" prefix still wins.
- **Retrospectives borrow every verb an announcement uses.** "Windows XP was
  released to manufacturing a quarter of a century ago" matches RELEASE on its
  strongest pattern. The tense lives in the date, not the verb.
- **Digests are not releases.** "Java News Roundup: JDK 27-RC1, OpenJDK JEPs,
  Jakarta EE…" is six announcements in a trench coat, and filing it as a release
  attaches all six to whichever one matched first.

Measured over 40 days of the archive: **14.3% are events** — 2.9% launches, 5.8%
releases, 5.6% changes. The reader shows events by default; Articles is one
click away in the rail, counted with the filter removed so the number is a real
offer rather than a zero next to a link.

### Build artefacts are not releases

A GitHub releases feed carries whatever the project tags, and for many projects
that is continuous integration output. In one hour of collection Kotlin
published twelve `build-2.5.0-dev-5797` tags, llama.cpp published `b10635`,
PyTorch published `viable/strict/1787738484`, YugabyteDB published
`2025.2.7.0-b28`.

Nobody upgrades to `b10635` and no history of a technology contains it. These
now set `is_prerelease`, which every read path already honours — the flag
already meant "not a stable release anyone should read as news", and a CI tag is
the purest case of it. The word-based test (`alpha`, `beta`, `rc`) could never
have caught them, because a build number contains none of those words.

### Sources: three kinds, and nothing else

A source earns its place by being one of three things:

1. **A project announcing its own releases** — the 325 release feeds.
2. **A company announcing changes to its own products** — vendor and project
   blogs, marked `PRIMARY`.
3. **Developers writing about the work** — IT trade press, corporate
   engineering blogs, and practitioner sites.

Everything else is paused. `npm run audit` classifies and does it.

`npm run audit` scores every source on its own output — what fraction the topic
filter refuses, and what fraction of the rest names a technology or reads like
an announcement. Two classes are then paused, both decided by **host**, because
a host is a fact about who chooses what appears in the feed.

**Consumer and general technology press.** A real trade and a good one, simply
addressed to somebody choosing a laptop rather than somebody choosing a
dependency. Over 40 days:

| source | items | off-topic | events |
|---|---|---|---|
| TechRadar Computing | 126 | 67 | 5 |
| ZDNET | 65 | 25 | 1 |
| Tom's Hardware | 60 | 17 | 3 |
| TechCrunch | 44 | 14 | 4 |
| Ars Technica | 32 | 6 | 3 |
| **The New Stack** | 36 | **0** | 92% technical |
| **InfoQ** | 20 | **0** | 90% technical |
| **Publickey** | 16 | **0** | 100% technical |

The item filters can clean up after the first group and were doing so. What
they cannot do is make the remainder worth polling: five events in forty days
from the noisiest source in the list is a rounding error with a bandwidth cost.
Hackaday and LowEndBox are paused for a different reason and it is worth saying
plainly — neither publishes noise. One is hobbyist electronics and the other is
hosting offers; both are good at what they do and neither is professional IT
news.

Beyond the named hosts, any non-first-party source whose off-topic rate reaches
15% over a decent sample is paused too, for the outlets nobody thought to list.
First-party sources are exempt at any rate: a vendor publishing about its own
product is the purest source this system has.

**Not a tech-news site at all.** A software review marketplace (G2), a consumer
review site (Trustpilot), a hosting forum (Web Hosting Talk), a digital-politics
campaign (netzpolitik.org), the German and Chinese consumer-tech magazines
(t3n, Golem.de, 少数派), a general emoji-headline digest (TLDR), and Apple's
press room — whose recent output was a baseball schedule, an Apple Arcade
release and a factory opening. None was going to become one of the three.

Two of those could not be decided by host, which is worth recording because the
host rule works everywhere else. **heise.de publishes `heise Security` and `iX`
— both professional IT press and both wanted — from the same host as
`heise online`, which is a general news portal.** `itmedia.co.jp` is the same
story: `@IT` is written for IT professionals, `ITmedia NEWS` for everyone. Those
are named individually, and `developer.apple.com` is explicitly exempted so a
future entry is not swept up by the `apple.com` rule.

**What remains: 420 active sources.**

| class | active | paused |
|---|---|---|
| release feeds | 325 | 0 |
| first-party vendor and project blogs | 47 | 17 |
| IT press and developer blogs | 41 | 21 |
| developer newsletters | 7 | 15 |

The third row is The Register, The New Stack, InfoQ (three editions), heise
Security, iX, Publickey, SD Times, Phoronix, gihyo.jp, @IT, 机器之心; the
engineering blogs of GitHub, Meta, Netflix, Stripe, Uber, Mercari, DeNA,
Cybozu, CyberAgent, LY, Tencent and Alibaba; and Martin Fowler, Brendan Gregg,
Julia Evans, Dan Luu, Rachel by the Bay, Simon Willison, Xe Iaso and Jepsen.

### Who the feed is written for

**What is left is 68 news sources** — 36 first-party vendor and project blogs,
and 32 editorial: The Register, The New Stack, InfoQ, heise Security, Publickey,
SD Times, iX, Phoronix, Golem.de, LWN, the corporate engineering blogs, and a
handful of practitioner writers. Plus 325 release feeds and six curated
developer newsletters.

### Social is a structural judgement too

The second class: link aggregators and community boards, paused by host
regardless of score.

By host, and not by `kind = 'community'`, which is the obvious shortcut and is
wrong: that column holds Hacker News and Reddit alongside This Week in Rust,
JavaScript Weekly, Postgres Weekly and Console.dev — hand-curated newsletters
and the most concentrated reading in the list. `roles` does not separate them
either; Golang Weekly and Fosstodon are both `DISCOVERY`. A host is a fact about
who decides what appears in the feed, which is the actual distinction.

Hacker News measured 57% technical, which sounds respectable until you notice it
means 8,700 items of general-interest reading in one month. Paused rather than
deleted: a source row is referenced by every story it ever carried, and
`npm run audit -- --restore` puts them all back.

---

## Two collection directions

Forward answers *what is happening*; backward answers *what happened*, which is
what any trend claim actually rests on — twelve weeks of live collection is not a
trend, it is a start-up transient.

| | forward (`npm run live`) | backward (`npm run backfill`) |
|---|---|---|
| Runs | continuously | when you start it, never on a schedule |
| Marks rows | `collection_mode='live'` | `collection_mode='backfill'` |
| Priority | normal | 9 — cannot compete for model quota |
| Article pages | fetched | never (a 200-page walk would become 20,000 requests) |
| Resumable | n/a | yes — an opaque cursor per provider, saved every page |

Only sources that genuinely expose history are walked. **RSS has no past tense**:
a feed returns its last 20–50 items, so press and blog history begins on day one
of live collection, and `sources.backfill_depth` records that as `feed_window`
rather than retrying forever.

| Provider | Reach | Cursor |
|---|---|---|
| `hn` — Hacker News via Algolia | full, 2006 → | `created_at` timestamp |
| `github_releases` — REST API | every release a repo ever cut | page number |
| `arxiv` — query API | full, 3s spacing enforced | result offset |

```
npm run backfill -- --provider hn --until 2024-01-01
npm run backfill -- --provider github_releases --all --pages 3
npm run backfill -- --status
```

Measured: 400 Hacker News items in 3.9s (0.1 queries per item), 291 Kubernetes
releases in one run. The archive now spans **2017 → today across 59 months**.

**Trends bucket on event time**, `coalesce(published_at, collected_at)` — not on
when a row was collected. Backfilled rows are collected today and published years
ago; bucketing them by collection time stacks a decade of releases into the
current week and reports it as a spike.

---

## Companies: what they say vs what is said about them

A vendor's own blog is authoritative on fact and useless on judgement; an outlet
is the reverse. Merging them into one list destroys the only thing a reader needs
before believing a claim, so the two are kept apart structurally:

- **`sources.company_slug`** marks a feed as belonging to a company. A story from
  it is an **announcement** — a fact about provenance, not a guess about tone.
- **`stories.companies[]`** records which companies a story is *about*, whoever
  published it, from alias matching against a closed 76-company vocabulary.

Matching is deliberately conservative. Short and ordinary-word aliases (`Meta`,
`Arm`, `Apple`, `Go`) must appear capitalised as whole words, and URLs are
stripped before matching — release notes are full of `github.com` links, which
otherwise tagged 431 unrelated releases as stories "about GitHub". With URL
stripping that fell to 101 real mentions.

`/companies` ranks every company by activity with announcements counted
separately; `/company/nvidia` segments its stream into **Everything ·
Announcements · Coverage**. Currently 337 first-party announcements across 39
official channels.

## Fields: one page per domain

A single river is the wrong shape for sixteen domains. `/fields` is a card per
domain with a 16-week sparkline; `/field/security` gives that domain's volume
history, the technologies beneath it, the companies active in it, who covers it,
and its latest stories. A field is simply a **root of the taxonomy**, so this is
not a parallel hierarchy — it is the same tree entered at the top, and everything
beneath a root counts toward it.

## News is not Explore, and the rail is where you see it

The two pages share a renderer, and for a while they shared a menu too — which
made them read as one page with a filter applied. They are not.

| | question | rail |
|---|---|---|
| **News** | what happened in the fields I follow, and what is NEW | What happened · My fields · New technologies · Related stacks · Kept |
| **Explore** | interrogate the whole archive along any axis | Type · Field (all fourteen) · Related stacks · What happened |

**New technologies** is the group that only News has, and it is the point of the
page: `stack_totals.first_month` reaches back through the rolled-up years, so
"first seen in August" means first seen *ever* — not "first seen in the month of
whole stories we currently hold", which would describe every technology equally
and mean nothing. Restricted to things that ship (`stacks.kind IN ('stack',
'tool')`), because a list of new technologies opening with `algorithm` and
`education` is a list nobody reads twice, and narrowed to the reader's own
fields through `stack_closure`.

### News stopped being a source kind

It used to read `src.kind IN ('news','research','status')` — which excluded
release feeds, so the page whose job is "what is new in the fields I follow" was
structurally unable to show a release. Measured at the moment it changed: **371
events visible out of 2,073**, with 819 release announcements filtered out by
where they arrived from rather than by what they were.

A Rust 1.90 release is news to somebody following Languages whether it came from
a release feed, The Register or a vendor blog. News is now defined by what an
item IS — an event, not a prerelease — and the other streams are slices of it.
The count went from 371 to **1,499**.

### Every entry in the rail is a menu entry, and a menu entry has to keep its word

Three separate things in this rail were drawn one way and behaved another. They
were reported together, as "the left sidebar works strangely, some fields can't
be selected at the same time", and they are the same mistake three times: an
entry that promises something its link does not do.

**Fields were single-valued.** Sitting in a group headed MY FIELDS, next to two
groups that multi-select, `field` held one slug and clicking Security after AI &
ML silently discarded AI & ML. The argument for it — "a field is a question with
one answer" — is not what a reader sees in a list of the five fields they follow.
Fields are multi-valued and unioned now, like `stack`: `?field=ai&field=security`
is 1,220 stories, against 1,013 and 315 apart, so it is the union and not a sum,
and not a replacement.

**The event classes toggled from a phantom.** Empty `kind2` means the default,
which is everything except `article`, so the rail lit Launches, Releases and
Changes — while `toggled()` read the empty array underneath. Every first click on
that group therefore did something other than what it showed: clicking *Articles*
darkened three lit entries, because `[] + article` is a selection of exactly one;
clicking *Changes* left it lit and darkened the other two. `toggledKind()` starts
from the effective set instead, so what you see selected is what the next click
adds to or removes from. Emptying it returns to the default rather than to a page
that can hold nothing, and a set that *is* the default is written as no parameter,
so one view keeps one URL.

**Two numbers for one technology.** NEW TECHNOLOGIES counted from
`stack_totals` — a lifetime total over the whole archive — while every other
number in the rail meant "how many stories you get if you click this". They
disagreed in public: `adversarial-attacks` said **3** in one group and **1** in
another, same slug, same rail; `kyverno 2` led to an empty page, its two stories
being articles the stream does not show. It is counted under the page's own
WHERE now, less `stack` — the key those links set, whose inclusion would collapse
the group onto whatever is already chosen, which is what RELATED STACKS is for.
`kyverno` is simply not offered any more.

Field counts moved the same way, and for the reason the event counts already
had: they are taken with the field filter lifted. Under the current selection
"Security 315" beside a chosen AI & ML would mean *in both*, while the link
beside it means *in either*.

### A menu must not lose entries, and every group has to say what it is

Selecting a technology made the other groups collapse, and entries at zero were
dropped outright — so AI & ML simply vanished from MY FIELDS once OpenTofu was
picked, and there was no way to combine them or to see why not. That is what
"we can't multi-select across categories" was: cross-group selection worked, but
the option to make it had been removed from the page.

Groups whose membership is FIXED — the four event classes, the fields you follow
— now keep every entry. One at zero is shown greyed and inert, so the menu keeps
its shape and the zero explains itself rather than a destination going missing.
Explore's Field group is all fourteen fields and still drops its zeros: that is
an open list, not a menu.

Values inside a group union; groups intersect. The page now says so, because a
subtitle reading *"0 stories in opentofu or oracle-cloud"* while the field that
actually emptied it goes unmentioned is a page hiding its own state. It reads
**"0 stories in AI & ML, about opentofu or oracle-cloud and everything beneath"**.

Each group carries one line saying what it is for. **New technologies** was the
worst offender — a list of bare slugs under a heading nobody could check: new
according to what, measured from when? It is **First seen recently** now, each
row stamped with the month it first appeared anywhere in the archive
(`opentofu · Jun`), under the line *"Technologies with no mention anywhere in the
archive until the month shown."* `first_seen` was already being selected by the
query and thrown away before it reached the page.

RELATED STACKS is deliberately left as a facet, but renamed to what it is:
**Also in these stories**. It describes what the stories on screen are tagged
with and narrows as you narrow, which is what a facet list is for; the groups
above it are menus, and a menu is a different promise.

---

## "First seen" named the bookkeeping, not the thing

The tab, the rail group, the control and the sort all said **First seen** — which
describes the RECORD: the month a row in `stack_totals` first got a value. It
asks the reader to care about the archive's filing.

The page is a list of **things**, so it is called what the things are:

| | |
|---|---|
| tab · rail group · sort | **Newcomers** — "Newcomers first" |
| the control inside the tab | **Arrived** — any in this quarter · this month |
| the registry sort | **Newest to the archive**, against *Recently added to the registry* |
| the registry column | the month, under **came** |

Two alternatives were rejected for reasons worth writing down. **Emerging** and
**Rising** both claim momentum this measures nothing about — a newcomer with one
story is a newcomer, not a trend. **Debuts** collides with `debuts?`, which
`eventful.ts` already reads as a launch verb, and one word meaning two things
inside one system is how a vocabulary stops being one.

## Click a stack, get the stack — then the news

Every registry entry has a detail page: `/trend/:slug` for stacks, tools and
concepts, `/platform/:slug` for platforms. Neither offered a way to the news
about the thing except a text link at the very bottom of `/trend`, under a chart,
five cards and four sections — and `/platform` had no way at all, only an
external link to the vendor.

Both now lead with the question a reader asks second:

```
Python          [ News about it ] [ In my fields ]
Patreon         [ News about it ] [ Open Patreon ]
```

*News about it* goes to `/all`, not `/news`, deliberately: `/news` is narrowed to
the fields you follow, so a technology outside them would answer an explicit
request with an empty page.

In the registry list the row's own buttons were *In the reader · Trend · Search*
— "Trend" being the name of the detail page, which says what the URL is rather
than what the page is. They read **Full detail · News about it · Search**, with
the detail page first.

---

## The two News tabs are about two different recencies

They shared a control row, which made them look like one page with a filter
applied — the same mistake News and Explore made before the split. What actually
separates them is which kind of *recent* they mean:

| | the question | the control it gets |
|---|---|---|
| **News** | when did the STORY appear | **Window** — 24 hours · 7 days · 30 days |
| **First seen** | when did the TECHNOLOGY appear | **First seen** — any in this quarter · this month |

Each tab now offers only the one it is about. Offering both on both invited
reading *"last 24 hours"* as a statement about how new a technology is, which is
the single confusion this page cannot afford.

It also removed a control that could not do what it said. `/new` **is** the last
quarter, so a First seen option of "this year" was ANDed against the stream and
changed nothing — the same class of defect as a menu entry leading to an empty
page. On `/new` the options narrow inside the quarter and stop there.

Both tabs keep Field, About, Source, Sort and Importance, because those change
the answer on either.

## One word per thing

An audit of every heading, label, option and caption the site renders. The same
idea was being called different things depending on which page you were on:

| was | is | why |
|---|---|---|
| *A technology* (the About filter, for `kind = 'stack'`) | **A stack** | the registry's umbrella word used for one of the three things under it, so the same filter read "Stacks" in the rail and "A technology" in the dropdown |
| *An earning platform* | **A platform** | the tab is called Platforms |
| *Type* (Explore's rail group) | **About** | same filter as News's About group |
| *First seen* — tab, rail group, control, sort | **Newcomers** | see below |
| *Niche (≤2)* | **≤2 outlets** | its two siblings were already "≤5 outlets" and "≤15 outlets" |
| *Rising technologies* (overview) | **Gaining ground** | the same measure as the section on /trends |
| *healthy · degraded · failing · dead* | **Healthy · Struggling · Failing · Given up on** | raw enum values printed as labels made the filter row read like log output |

"Technology" is kept where it genuinely means the umbrella — *Tagged with a
technology* counts stories carrying any registry slug, stack, tool or concept
alike — and "stack" is used only for the thing that ships.

---

## Releases and Community were the old definition, still standing

Both were streams defined by `src.kind` — **where an item arrived from**. That is
the definition News itself stopped using, and for the reason spelled out above:
News read `src.kind IN ('news','research','status')` and was structurally unable
to show a release, hiding 819 of them.

**Releases.** `src.kind = 'releases'` — items from a release feed. But a release
is now a property of the item, `event_kind`, and the rail's **What happened ·
Releases** filters exactly that and filters it better: a Rust 1.90 release
reported by LWN *is* a release, and the source-kind form cannot see it because
LWN is not a release feed. A tab duplicating a rail entry, with the narrower of
the two definitions.

**Community.** `src.kind = 'community'` — link aggregators and boards: Hacker
News, Lobsters, Reddit, Hatena, Zenn. That is the one honest use of source kind,
because who decides what appears in a feed is a real question about the feed.
It has **no sources**: the registry is nine professional outlets and not one of
them is a board.

Both are gone, and both redirect:

```
/releases  301 -> /news?kind2=release
/community 301 -> /news
```

The tab row is **News · First seen** — the two questions the page answers.

While there: `backLink()` in the reading page still named `/today`, `/critical`,
`/niche`, `/releases` and `/community`, so "back to Niche" was offered for a page
that had been deleted. It names the streams that exist, and there is a test
asserting the deleted ones fall through to the reader.

---

## First seen is a tab, and the rail says which kind of thing

News handles new **stacks, tools and platforms**. Two things were missing for
that: a way to reach "what is new" in one click, and a way to say which of the
three you meant.

**`/new` — the First seen tab, second in the row.** It is a stream rather than a
saved preset, and the difference matters: the other three streams are defined by
what the items ARE — an event, from a release feed, from a community board — and
this one is *an event about a technology this archive had never seen before this
quarter*. That is the same kind of test, so it earns a tab where Today and
Critical did not.

It uses the **same three-month window** as the rail's *First seen recently*
group, so the tab and the group cannot disagree about what new means, and every
other control still applies inside it: `/new?about=tool&field=ai&sort=firstseen`.

**The About group in the rail — Stacks · Tools · Platforms.** The distinction
existed only in Explore, as a Type facet reading *"A technology"* and *"An
earning platform"*. It is the same filter, named after the tabs it corresponds
to, with one line saying what separates them:

> Stacks ship. Tools are operated and never ship. Platforms are where a thing
> runs or is sold.

Counted with the About dimension lifted, for the reason fields and event classes
already were: *Tools 12* beside a chosen *Stacks* would mean "in both", while the
link beside it means "either". Companies are left out of this group — they are a
real facet and they are not one of the three things this page is for.

The News rail reads **What happened · About · My fields · First seen recently ·
Also in these stories · Favourites**.

---

## Two meanings of "new", and the registry only had the weaker one

`/stacks` could sort by **Recently added** — `discovered_at`, when the ROW was
created. That is a fact about this project's curation and says nothing about the
technology: a stack seeded by hand in March and first written about last week
sorts as old.

The useful sense is **First seen in the archive** — `stack_totals.first_month`,
computed across the rolled-up years. It was already selected by the registry
query and shown only inside an expanded row, where it can be neither scanned nor
sorted. It is now a sort and a column:

```
/stacks?sort=firstseen
  Adversarial attacks   first 2026-08    3 stories
  Agent Lightning       first 2026-08    2 stories
  Kyverno               first 2026-08    2 stories
```

The old sort is relabelled **Recently added to the registry**, so the two are
told apart by their names rather than by reading the SQL.

This is where "review the new stacks" is answered as a list of technologies. On
News the same question is asked about STORIES, three ways: the **First seen
recently** rail group, the **First seen** control, and the **Newest technology
first** sort.

## One word for the shelf

The favourites shelf was called three things: the rail said *Kept*, the button
said *Keep* / *Kept*, the page had a *Kept* heading and a subtitle reading
*"N kept"*. It is **Favourites** everywhere now — rail group, button label,
button tooltip, the browser-side label the star swaps in, page heading and
subtitle. The retention note that read "everything else is kept for a month" now
says *held*, because that sentence is about retention and reusing the word made
it sound like the shelf.

---

## Views were the filter bar, saved under a name

A rail group on every reader page — Today, Critical, Rising fastest, Niche
technologies — with four routes, a tab row, and three sub-selects in the rail
count query. Set against the controls sitting directly above the list:

| view | preset | the control that already did it |
|---|---|---|
| Today | `days=1` | **Window** · 24 hours |
| Critical | `min=8` | **Importance** · Critical 8+ |
| Rising fastest | `sort=velocity, days=7` | **Sort** · Rising fastest + **Window** · 7 days |
| Niche technologies | `rare=3, sort=rarest` | **Sort** · Rarest technology first — `rare` had no control |

Three of the four were a second way to set controls that were never hidden.
*A menu is not a filter bar* already removed one copy of that mistake from this
rail; this was the other copy.

**Critical had a second problem.** It filters on `importance >= 8`, a classifier
score that is NULL whenever `CLASSIFICATION_ENABLED` is off — and historically
only 1,933 of 14,417 stack-months carried any score at all. A menu entry that
usually leads to an empty page is not a shortcut.

**The fourth was the only one worth anything, and it has a better answer now.**
`rare=3` — "a technology with three stories or fewer anywhere" — is a proxy for
*new* that drifts as the archive grows. **First seen** asks the question
directly, deterministically, and is a control rather than a saved page.

Every one of them redirects to the settings it stood for, which is both the
kindest thing to do to a saved link and the clearest possible statement of why
they were unnecessary:

```
/today     301 -> /news?days=1
/critical  301 -> /news?min=8
/rising    301 -> /news?sort=velocity&days=7
/niche     301 -> /news?sort=rarest&rare=3
```

Gone with them: `ViewDef`, `viewFor()`, `withPreset()`, the view branches
threaded through both reader entry points, and the `today`, `critical` and
`niche` sub-selects that ran on every rail render to put numbers beside them.
The News rail is now **What happened · My fields · First seen recently · Also in
these stories · Kept**.

---

## The News filters now ask the questions the page is for

News answers two things: *what happened in the fields I follow*, and *what is
NEW*. Every control on it answered the first. The second was visible only in the
rail — you could read that `kyverno` first appeared in August, and you could not
apply that to the list.

**`First seen` — a filter on how old the technology is.** Any age · this month ·
in 3 months · this year. Built on `stack_totals.first_month`, which is computed
across the whole archive including the rolled-up years, so *this month* means
first seen **ever** this month rather than "first seen in the stories we happen
to hold" — a distinction that describes every technology equally and means
nothing if you get it wrong. Verified against the real matview:

```
fresh=0   python=false  opentofu=false  kyverno=true
fresh=2   python=false  opentofu=true   kyverno=true
```

**`Newest technology first` — the same idea as an ordering.** It ranks by the
*most recent* first-appearance among the technologies a story names, so a story
about Python and OpenTofu sorts by OpenTofu:

```
python            -> 2015-08
kyverno           -> 2026-08
python+opentofu   -> 2026-06
not-a-slug        -> (unknown, sorts last)
```

**`About` moved onto News.** Anything · a stack · a tool · a company · an earning
platform. It existed as the Type group in Explore's rail and News had no way to
say "only things that ship" — which is the archive's entire subject.

**Both go through `unnest`, never `t.slug = ANY(s.stacks)`.** The second form
cannot use `stack_totals_slug_idx` and re-scans 2,330 rows per candidate story:
the same shape that made `field=languages` take 90 seconds. An array holds eight
slugs at most, so this is eight index lookups, and the plan confirms it:

```
Index Scan using stack_totals_slug_idx on stack_totals t
  Index Cond: (slug = st.st)
```

**`Least covered first` was dropped.** It sorted on `s.niche`, a classifier
score that is NULL whenever classification is off, and it ranked by inverse
coverage — which `Most covered` already orders by and `Rarest technology first`
answers deterministically from `stack_frequency`. Nothing linked to it. A saved
link carrying `sort=niche` falls back to newest, and there is a test for that.

**One caveat, stated plainly:** the ordering cannot be demonstrated on real
stories yet, because News is empty — the event gate refuses press voice, which
is the open question above. The SQL is verified against the live `stack_totals`
with fabricated story arrays, the plan is verified, and six tests cover parsing,
the clause, the round trip and the fallback. What is not verified is how the
ranking feels on a full page.

---

## Importance was a number with no units

The control offered *Any · Critical 8+ · Notable 6+ · Moderate 4+*, and the rows
carried a bare number in the margin. Nothing on any page said what the number
counts, so it read as a rating — of quality, of relevance, of popularity, take
your pick. It is none of those. It is **consequence**: how much a story changes
what a working engineer has to do, scored 0–10, and it is the same scale the
scorer is given and `assignTier()` splits on.

The bands are now written where they are used, in the scorer's own words:

| | |
|---|---|
| **8–10** critical | a breaking change, an exploited vulnerability, a shutdown, a forced migration, a licence change |
| **6–7** notable | a release, a deprecation with a runway, a tool with real adoption |
| **4–5** moderate | above commentary, below anything you must act on |
| **0–3** background | commentary, a tutorial, a funding round, a benchmark, an opinion |

Consequence is not popularity, which is the reason this axis exists separately
from `coverage_count`: a widely covered story can be a 2, and an obscure one a 9.

**Each option is a floor, not a band.** *Notable 6+* includes the 8s. The labels
now read `Critical 8+ — act on it`, `Notable 6+ — worth knowing`,
`Moderate 4+ — above commentary`, and the same sentence is one hover away on the
control, on every score badge in the river, and on every badge in Favourites —
`importanceTitle()` in [filters.ts](src/ui/filters.ts) is the single source, so
the badge, the filter and the delivery tier cannot drift apart.

**The trap this control had, and now admits to.** Every other filter tests
something stored with the story. This one tests a *judgement*, and `importance`
is NULL until the story has been classified and then scored — two model steps,
either of which can be off or behind. `NULL >= 6` is not true, so choosing any
floor silently drops every unscored story, and after the registry reset that is
all of them. Selecting a floor while unscored stories exist now says so above the
list, with the count and one click back:

```
Importance is a 0–10 judgement of how much a story changes what you do —
1,842 stories have not been scored yet, and a floor of 6+ hides them all.
Show any importance
```

The count is the one the rail already computes, so the notice costs no query.

`null` is rendered as **not scored yet**, never as 0. A story is unjudged for at
least one cycle after it arrives, and reading that as "unimportant" is the one
answer that is certainly wrong. There is a test for it.

---

## Navigation that named a structure the app no longer had

The Stacks page offered **Tools** — a tab of its own since the registry split.
Every registry page carried the same row: *By category · Stacks 1,361 · Tools 153
· Concepts 816*, which is the top bar repeated inside the page, listing two other
top-level sections. Explore did the same thing in the other direction, offering
*News · Releases · Community* — three pages the News section owns.

Both are gone. The rail already carries each section's own pages, correctly and
per-section; a second copy in the body could only ever disagree with it.

**Breadcrumbs were hand-written on every page and had drifted from the top bar:**

| page | said | should say |
|---|---|---|
| `/stacks` | Explore / Stacks | Stacks has been its own tab since the split |
| `/tools` | Explore / Tools | so has Tools |
| `/platforms` | **Stacks & tools** / Platforms | a section that no longer exists |
| `/favourites`, `/search` ×3 | **Read** / … | a section renamed to News |
| `/technologies` | Explore / Technologies | it belongs to Stacks |

They come from `crumbsFor()` now, which reads `sectionFor()` — the same function
the top bar uses — so a breadcrumb cannot name a section the top bar does not
have. It returns nothing at all when the page IS its section's home, because
"STACKS" over an `<h1>` reading *Stacks* is the title twice. Four tests pin it.

---

## What was removed because it could never work

An audit of every page against what is actually behind it. The method was to ask
one question of each table: **does anything in this codebase ever write to it?**
Where the answer was no and a page still read from it, the page was announcing a
feature rather than showing one.

**The Phase 7 fact collector.** `platform_facts` has no writer anywhere — not in
`src/`, not in `scripts/`, only in the generic admin table browser. The
platforms registry was rendering:

| shown | actual value | why |
|---|---|---|
| Facts collected | always **0** | nothing writes `platform_facts` |
| Pages to watch | 2 of 56 | nothing watches or diffs them; `page_watches` and `page_diffs` have no writer either |
| Answering | always **56** | one distinct `status` across every row — the platform count again |
| Time to first dollar | always **—** | 0 of 56 rows carry a value |
| Country limits | always **—** | 0 of 56 rows carry a value |
| Stated terms | a paragraph explaining Phase 7 is not built | |
| Pages that state the terms | each row labelled *"not yet watched"* | |

Of five KPI cards on a platform page, four were structurally constant. Gone,
along with the per-row `facts` column and the *"N pages to watch"* line. The
schema is untouched: if a fact collector is ever built, the UI is a smaller
thing to write than the collector.

**The `tools` table.** A registry from an earlier design that has never held a
row. A tool is a `stacks` row with `kind = 'tool'` — that is what `/tools`
renders and what the search already queries. Searching also asked the empty
table, costing one round trip per search for a result that could not exist.

**A promise where a link belonged.** Searching a platform returned *"Story-level
indexing for platforms arrives with Phase 7"* — and the entity hit linked back to
`/search`, a loop. Platforms got their own page later and the search never
learned about it. `patreon` now returns an **Open Patreon** button to
`/platform/patreon`, the same shape sources already had.

---

## The registry was emptied and rebuilt

`npm run reset:sources -- --apply`. 473 sources and 24,022 stories removed; nine
professional outlets put back. The list, why each one, and the two candidates
that failed their fetch check are in [`seeds/news.ts`](seeds/news.ts).

| | |
|---|---|
| LWN.net | kernel, toolchains, distributions. 93% events measured here — the highest of any source, press or otherwise |
| The Register | enterprise IT, and the only newsroom here covering the industry as an industry |
| The New Stack | cloud native and platform engineering. 0 off-topic items in 36, measured |
| InfoQ | practitioners writing for practitioners. 90% technical, measured |
| Phoronix | Linux, graphics, compilers and the hardware under them |
| DevClass | developer tools and platforms |
| SD Times | the software development industry as a beat |
| BleepingComputer · The Hacker News | security, because a CVE in a dependency is a material change to a stack |

Every feed was fetched and parsed before it was written down. **InfoWorld (404)**
and **ACM TechNews (403)** failed and are recorded in the seed file rather than
silently dropped. **heise Security** was dropped for a reason that is not the
site's fault: it is professional IT press publishing in German, and
`ALLOWED_LANGUAGES` is `['en']`, so every item would be refused at the language
gate. A source whose every item is rejected is not a source.

### What the database refused to let happen

Three guards fired, in order, and each one was right.

**`story_members` before `stories` — refused.** `forbid_orphan_only_delete()`
permits deleting a child row only once its parent is gone. Retention deletes
parents first, which is the opposite of the usual order: the usual order
protects referential integrity, this one protects evidence. Obeyed rather than
suspended.

**Deleting August — refused.** `forbid_unanalysed_delete()` blocks any story
whose month is not in `rollup_log`, because *stories are the only copy of
themselves*. And `archive_history` is a VIEW: rolled-up months come from
`month_totals`, and everything else is computed live from stories. So deleting
August's 24,000 stories without rolling August up first would have made August
**vanish from the history** — the exact thing this reset was told to preserve.
`npm run rollup -- --month 2026-08` first: 24,000 stories reduced to 1,138
stack-months and 1,366 pair-months, now durable. The script re-checks the
aggregate INSIDE the transaction and rolls back if it moved.

**`fetch_log` — refused.** An `information_schema.constraint_column_usage` query
fans out and had omitted three tables. `pg_constraint` gave the real list.

The script also does not use `createDb()`. That is the Neon HTTP driver, one
request per query — `BEGIN` and `COMMIT` over it are not a transaction, each
statement autocommits, and the rollback would have been decoration. The one
script that needs all-or-nothing holds a pooled connection.

### Nine sources, 290 items, nothing kept

The first poll: all nine healthy, 290 items seen, **0 stored, 234 refused —
218 of them as `article`.**

That is not a fault in the sources and it is not a bug. It is what press *is*,
and it was predicted: outlets run 5–8% events here. But the refusals show
something sharper — the event classifier is tuned to changelog voice and does not
read press voice:

```
Linux 7.3 FUSE Delivering Nice Performance Improvements          -> article
Lots Of New Audio Hardware Support In Linux 7.3                  -> article
14 Trojanized npm Packages Drop RedC2 4.0 Linux Backdoor         -> article
Security researcher exploits GitHub gotcha, gets admin on Istio  -> article
```

Every one of those is an event. A vendor writes *"Linux 7.3 adds FUSE
improvements"* — a transitive claim, which `eventful.ts` reads. A journalist
writes the gerund, and it does not.

So with press as the only source and `EVENTS_ONLY` on, the archive collects
nothing. Three ways forward, none of them mine to choose:

- **`npm run seed`** puts the release feeds and vendor channels back alongside
  the press. Announcements then come from where announcements are made, and the
  press supplies the discussion half of the brief.
- **`filters.eventsOnly` off** in /settings keeps articles. That is the archive's
  editorial position, so it should be turned off on purpose or not at all.
- **Teach `eventful.ts` press voice.** The right engineering answer, and it needs
  a corpus to measure against — which this reset just deleted. A few days of
  collection first, then the same dry-run-and-read-the-output method every other
  classifier here went through.

---

## The aggregator was a door around the source policy

Sources were audited and 53 were paused — consumer press, social, not-tech-news.
That cleaned the front door and left the side door wide open: **pausing
TechCrunch's feed does nothing about the TechCrunch article Hacker News submits
an hour later.**

Measured over thirty days: **3,236 of 23,477 collected items — 13.8% — pointed at
a host this project had already decided it did not want.** Every one had its page
fetched, extracted, hashed and inserted. Where they pointed:

| | items | survived into News |
|---|---|---|
| nytimes.com | 224 | 4 |
| theguardian.com | 200 | 5 |
| wsj.com | 170 | 3 |
| reuters.com | 166 | 5 |
| bloomberg.com | 125 | 3 |
| ft.com | 124 | 4 |
| bbc.com | 120 | 1 |
| technologyreview.com | 52 | 0 |
| theatlantic.com | 67 | 0 |

The content gates were catching almost all of it, which is why this was invisible.
What got through is the tell:

```
reuters.com     Jellyfish-hit French nuclear plant shuts down three reactors
apnews.com      Trump orders Navy to return to old system launching jets
economist.com   China is now the world's greatest oil power
nytimes.com     Violet Hensley Dies at 109; Ozarks Fiddler Made Opry Debut at 99
axios.com       Tucker Carlson unveils 10-point manifesto
```

A plant *shuts down* and a manifesto is *unveiled*, so the event classifier reads
them as a change and a launch — correctly, because the grammar really is the
grammar of an announcement. **No lexical gate can fix this. Only the outlet gives
it away.**

So the judgement moved out of `scripts/audit-sources.ts` and into
[`src/vocab/offtopic.ts`](src/vocab/offtopic.ts), where it is applied twice: to a
source before it is polled, and to a **link** before its page is fetched. One
list, two enforcement points, no drift. 92 hosts — general news, consumer tech
press, microblogs.

The refusal sits at the top of ingest step 1, next to the topic and event gates,
so it costs one host comparison rather than a page load; and it is recorded in
`story_rejects` with the host as the evidence, so it can be read back.

**What it is NOT allowed to refuse.** Aggregators and community publishing
platforms stay: `news.ycombinator.com` is an active source, and dev.to, Zenn,
Qiita and Medium are where a great deal of real developer writing lives.
Refusing a source's own links would empty the source. Only the microblogging
subset of `SOCIAL_HOSTS` is refused, because a link to a post has no article
behind it.

**Matching is exact or subdomain, never substring** — `ft.com` is a substring of
`microsoft.com` and `x.com` is a substring of `phoronix.com`. An audit query
written with `ILIKE` claimed both of those as matches, and both are active
sources. There is a test for each.

**The cost, stated plainly.** 141 stories in thirty days — 4.4% of the News
stream — are given up. Reading them: nuclear-plant shutdowns, an obituary, a
manifesto. The handful that were genuinely relevant (`Meta debuts first AI coding
agent`, `OpenAI launches GPT-5.6-Cyber`) are second-hand reports of announcements
whose first-party channels this archive already polls. Switchable at
`filters.offTopicHosts` in /settings, so the change stays measurable.

---

## The thing itself is the best source about the thing

The press reports a change; the project announces it. For an archive whose
subject is "new stacks, tools and platforms, and major changes to them", those
are not the same input, and only one of them is complete. Measured over this
archive, English outlets run **5–8% events** — The Register 3 of 58, InfoQ 5 of
20 — because a newspaper prints what an editor judged newsworthy, days later. A
changelog prints everything that happened, dated, on the day.

So the registry now has three tiers, and they answer different questions.

**1. First-party channels — 39, hand-resolved, in [seeds/primary.ts](seeds/primary.ts).**
Every one was fetched and parsed before it was written down. They came from a
measurement rather than a brainstorm: of 1,005 registry entries with a GitHub
repository, **261 point at an organisation rather than a repository** —
`github.com/aws`, `/cloudflare`, `/android`, `/vercel`. There is no
`releases.atom` for an org. Those 42 curated entries named exactly which vendors
matter, and this file is that list resolved into changelogs:

```
AWS What's New · Azure updates · Google Cloud release notes · Cloudflare changelog
GitHub changelog · Vercel · Netlify · Slack · Auth0 · Discord · Notion · OpenAI
Arch · Debian · Ubuntu USNs · kernel.org · Windows Insider · Android · Raspberry Pi
Python Insider · Go · PostgreSQL · Inside Java · V8 · Django · Lua · GHC · WordPress
```

Four candidates did not survive the check and are recorded in the file rather
than quietly dropped: **Espressif** (two addresses, both 404), **Figma** (release
notes are a page with no feed), **Fortran-lang** (404), **Obsidian** (no public
feed). Four more needed a second address, and the working one is what is written
down — Cloudflare's `/changelog/index.xml` is a 404 and `/changelog/rss.xml` is
not; Oracle's MySQL blog answers 403 to any non-browser, so MySQL arrives by
GitHub tags instead.

**2. Per-project release feeds — derived, never hand-listed, by
[`npm run sync:releases`](scripts/sync-release-feeds.ts).** It probes every
repository in the registry through the GitHub API and promotes only what
actually publishes. Hand-listing these would be a thousand lines that rot:
projects get renamed, archived and moved, and a hand-written feed URL keeps its
confident shape long after it stops resolving. What the probe found:

| | |
|---|---|
| publish GitHub releases | **656** — 562 of them within 12 months |
| tag, but never publish a release | **57** — Linux, Python, PostgreSQL, Go, Java, Git, Kafka, MongoDB |
| neither | 30 |
| an organisation, not a repository | 261 → tier 1 above |

That second row is why tier 1 exists in the shape it does. The biggest things in
the archive ship by tagging, so a strategy of "derive `releases.atom` from every
repo" would have covered everything **except** what matters most. They are in
tier 1 by their real announcement channels, and the three with no channel at all
(Kafka, MySQL, Git) are in by `tags.atom`.

**3. The press — 9 outlets, unchanged.** Still the right source for a technology
that has no feed yet, for the judgement of whether something matters, and for
everything a changelog will never say.

### Four things that only break when you turn it on

Adding the sources made four silent failures visible, each of which had the same
signature: **a source that fetches successfully, keeps nothing, and reports
itself healthy.**

**The rollup closed the current month to collection.** Emptying the registry
required deleting August's stories; the delete guard refuses a month that is not
rolled up; so August 2026 was rolled up by hand. `npm run rollup` says in its
own header that it never rolls the month still filling up — and `--month` took
the caller's word for it. A month in `rollup_log` is closed to ingest, so the
first poll after the new sources went in read like this:

```
Azure updates       200 seen   200 already_archived
Auth0 changelog     799 seen   799 already_archived
Vercel changelog  1,524 seen 1,523 already_archived
```

Two changes: `isArchived()` never treats the current month as settled whatever
the log says, and `rollup --month` refuses the current month by name unless
`--force`. The guard exists to protect analysis that is *finished*, and the
month you are standing in is not that.

**And it was the wrong fix, which cost the archive July.** "The current month"
is only the same thing as "still open" when `RETENTION_KEEP_MONTHS` is 1. It is
2. The same hand-rolling on 2026-08-26 settled July as well, August was saved by
the exemption above and July was not — so for two days the collector refused
half of its own window while retention faithfully kept the other half, and
every source went on reporting itself healthy. Measured on 2026-08-28 by
fetching all 50 live feeds and bucketing their items:

```
557  July items on offer across the live feeds, refused on every poll
  1  July stories held
668  August stories held
```

The rule that removes the class of bug, rather than this instance of it, is a
sentence: **a month inside the retention window is open.** It may be collected
into, it may not be rolled up, and it may not be pruned. The current-month
exemption falls out of it, because the window ends at the month you are standing
in. It lives in `src/lib/retention.ts` and is read by the three files that used
to each carry their own copy of the arithmetic:

| | asks | now reads |
|---|---|---|
| `collect/ingest.ts` | what it will accept | `isOpenMonth`, `isTooOld` |
| `maintain/rollup.ts` | what it will settle | `isOpen`, and the same interval in SQL |
| `maintain/retain.ts` | what it will delete | the cutoff it always computed |

They never disagreed about the arithmetic. They disagreed about the boundary,
which is the harder kind of bug to see, because every one of them was correct on
its own terms. Migration 0060 removes the settled-month record for any month
still inside the window; `pendingMonths()` refuses to create another.

After the fix, one sweep of the registry: **July 1 → 204 stories, the archive
669 → 1,231, and the count of live sources that had never produced anything 14 →
4.**

**July's own 27,873 stories are not coming back.** They were pruned on
2026-08-26 under the old one-month window, before the setting changed, and the
prune is the one operation in this system with no undo. What returns is whatever
the feeds still list — the 557 above. `rollup_log` still records July as pruned,
so `--force` cannot re-roll it and overwrite 27,873 stories' worth of analysis
with the survivors.

**A release with no notes was thrown away.** `RELEASE_MIN_LENGTH` was 60
characters, which sounds generous until the feeds are measured: Vercel (1,524
entries), Notion (149) and every `tags.atom` carry **no body text at all**. The
pages behind them are client-rendered, so the article fetch that rescues a short
press item returns nothing here either. "Muse Image now available on AI Gateway",
published by Vercel, dated and linked, is the whole event. The floor is now zero
for release feeds, on the format's contract rather than on generosity — and
enrichment is untouched, because the article fetch is driven by the ordinary
400-character bar and still runs.

**A 7.3 MB changelog was rejected by 55 entity expansions.** Cloudflare publishes
its entire history in one document: 1,174 entries, 200,055 expansions, against a
cap of 200,000. The fetch logged `unparseable feed` and the source produced
nothing. The cap was calibrated against a week of posts; a changelog is not a
week of posts. It is now 2,000,000, and the two limits that actually stop an
expansion bomb — depth 10, expanded length 20 MB, the same as `MAX_FEED_BYTES` —
did not move.

**The event verdict was keyed by a URL that changes.** `classifyEvent` runs at
arrival and its answer went into a `Map` keyed by canonical URL — but step 3
rewrites that URL whenever a page declares its own `rel=canonical`. Azure's feed
does it on every item, so 49 releases from a source whose every entry is a
release *by construction* were stored as unjudged. The verdict now travels on
the candidate, where a rename cannot lose it.

### A tag is not a headline

A monorepo publishes `pkg/machinery/v1.13.9`, and a river of those names no
project at all. The rule that supplied the missing subject only recognised a bare
`v4.2.0`, so every path-prefixed tag went through unqualified. It now reads: a
release title with **no whitespace** is a tag and gets its project name; a title
that is a sentence is left alone; and a tag that already contains the project
name is not told twice.

### What it produces

Before, News was empty: nine press outlets, an event gate, and 0 stories kept
out of 290 seen. After the 39 channels, one polling cycle:

```
367 stories   352 events (96%)   264 releases   30 sources reporting
```

The press ran 5–8% events. First-party channels run 96%, because that is what
they are for.

With the curated release feeds added on top — 279 projects plus 41 tag feeds,
chosen over the wider 605 because every one of them is a technology a person put
in the vocabulary — the registry is **367 sources, all healthy**, and three
minutes of collection produced 723 stories, 708 of them events. 126 arrived
marked `is_prerelease`: release candidates and canaries are collected, kept out
of News, and available in Explore, which is what that flag is for.

---

## A release is only news if you depend on the thing releasing

The moment 320 release feeds went in, News stopped being readable: **195
releases against 1 launch and 27 changes.** Every class is still collected, and
one of them buried the other two.

That ratio is not a bug to tune away. It is what release feeds are: a version
most days, per repository, forever. A launch is a thing that did not exist. A
change is a deprecation, a licence, a shutdown, an advisory. Both are rare
enough to read every one, and both were invisible under the third.

**So News shows releases for the technologies you track, and no others.** In
Settings → Reading, *Releases you track* takes one slug per line, with a picker
of every technology the registry can actually deliver a release for — read from
`sources`, so it cannot offer something that will never arrive. Nothing is lost:
the stories are collected, tagged, searchable, counted in the archive and shown
in full on Explore. What changes is the river you read.

```
tracked: (nothing)                    News = launches + changes          31 stories
tracked: postgresql linux k8s node    News = launches + changes + those  51 stories
```

Three consequences worth stating:

- **Empty means none, and that is the opposite of `fields`.** An unchosen field
  is a subject you have not ruled out; an unrequested release is 320
  repositories publishing a patch version. The two emptinesses mean opposite
  things and the code says so where it reads them.
- **Newcomers is exempt.** Its subject is technologies the archive has just met,
  which by definition nobody is tracking yet — filtering it by the things you
  already depend on empties the one tab whose job is showing you what you don't
  know.
- **The page says it out loud.** A river that silently drops the most numerous
  thing it collects is indistinguishable from a broken one, so News carries a
  line naming what you track, with a link to change it and a link to every
  release in Explore. The rail entry reads `Releases · none tracked` rather than
  a bare zero.

## The release feeds were registered, never polled, and pruned for it

Measured on 2026-09-01: **331 sources, 150 healthy, 181 paused.** Every paused
row carried one note — `not polled; kept only because a story that survives
cites it` — written in exactly one place, `scripts/prune-sources.ts`, which
reduces `sources` to a hardcoded core list. What it took out was **179 GitHub
`*/releases.atom` feeds**: .NET, Angular, Ansible, Arrow, Beam, Alpine, Actix,
AT Protocol, Ant Design and 170 more. All 179 had a `feed_url`, none had a
single `consecutive_failure`, and `fetch_log` held no row for any of them.

They were registered, pruned, and never polled once.

### Three independent reasons, each sufficient on its own

**1. The resume looked for a note nothing writes.** `syncTrackedReleases` is the
only thing that un-pauses a release feed, and it matched `notes LIKE 'paused: no
longer tracked%'`. Zero of the 181 rows carry that note.

**2. The resume sat below a gate that can never open.** It ran after `if
(tracked.length === 0) return report`, and `tracked` comes from the
`app_settings` key `reading.tracked` — which has never been written. The key is
declared in `src/settings.ts` and `app_settings` holds two rows: `reading.fields`
and `gates.backfillEnabled`. So a job on a six-hour timer had been running since
deploy and was structurally incapable of reaching its own resume path.

That gate was also the wrong idea. *Releases you track* is a **display** filter —
it decides what News shows. Using it to decide what is **fetched** means a
technology you stopped reading about stops being collected, and the archive has
no record of it when you look again. Collection is now governed by the
vocabulary: a feed derived from `stacks.repo_url` is polled for exactly as long
as that stack exists. The tracked list still governs the reader, and only the
reader.

**3. And when they did run, every item was refused.** This is the one that
matters. `isBuildNoise` refused any `github.com/<owner>/<repo>/releases/tag/<v>`
URL on sight, before reading title or body — and that is the canonical address of
**every entry in every releases.atom feed**. The rule refused the channel.

Measured over 100 entries from ten repositories:

| | |
|---|---|
| refused by the tag-page rule | 100 of 100 |
| the finer rules refuse anyway | 22 |
| **refused only by the tag-page rule** | **78** |

The 22 are the case the rule was reaching for — `v8.2.2` with 41 characters of
notes, a machine writing to tags. The 78 carry between 123 and 1,430 characters
of release notes and are the signal this archive exists to hold.

**The rule now asks who is linking, not what is linked.** A bot posting a tag
page to an aggregator is still refused on sight. A release feed's own entries are
read, and the prerelease, bare-version, templated and machine-title rules still
refuse the noise among them — verified in `tests/release-feed-noise.test.ts`.

### Two smaller things found on the way back in

**The conditional-GET state was lying.** The 179 rows held an `etag` from the one
fetch they did get, whose every item was then refused. The etag claims we already
hold what the address served; we held nothing. GitHub answered `304` forever and
the feeds produced nothing while reporting perfect health. The resume clears
`last_etag` and `last_modified` once, on the way back in.

**179 feeds coming back due at `now()` is one host taking a burst.** Every one is
github.com, and the politeness gate is per host, so they would serialise into a
six-minute march against a single origin on every resume. `next_fetch_at` is
offset by `hashtext(url) % poll_interval_seconds` — deterministic, so a second
run does not reshuffle a feed already scheduled.

### Verified, not reasoned about

One bounded cycle over six resumed feeds: **220 items seen, 18 stored**, every
one classified `release` — Angular 22.1.2 through 22.2.0-next.4, four LangChain
packages. Before the change the same cycle stored zero and logged
`build_noise: 10`.

`sources` now reads **204 healthy release feeds and 125 healthy news**, against
25 and 125 before.

One row needed fixing by hand: *Terraform releases* stored its `url` as
`.../terraform/releases` where every other row stores the bare repository URL, so
it matched no stack and would have stayed paused alone.

### What this does not fix

**Market moves are still 0.9% of the archive** — 126 rows, 74 of them from a
single source. That is the other half of what this system is for, and it is a
source-list problem rather than a code one.

**The archive is six days old.** First collection 2026-08-26, 14,788 live rows.
The month-by-month series that outlives the stories has nothing in it yet, and
the only cure is running.

**89% of fetch work is re-processing what is already stored.** Over seven days:
2,449,573 items seen, 29,198 kept — 1.2%. Of what was dropped, 1,482,376 were
`duplicate` and 704,078 `already_archived`. Only 40.6% of fetches return 304, and
86 of 150 healthy sources had an etag at all. That is a real cost and it is
untouched here.

## Turning it back on, and what that was worth

The repair above is inert until the process running the scheduler is restarted:
Node loads a module once, and both the noise rule and the resume live in
modules. For a while after the fix the live scheduler was still the old
revision, and it was working through the resumed feeds at ten items each and
storing none of them — Remix, Trivy, Prisma, OpenTofu, Vue.js, uv, Storybook,
Ollama, every one `seen=10 kept=0 build_noise=10`. Deployed code that is not
running is a habit; running code that is not deployed from is how the same
mistake gets made twice.

After the restart, one cycle: **34 sources due, 258 stored.** In the first
seventy minutes: **4,146 stories from 73 sources** — 2,254 changes, 1,213
releases, 423 launches, 11 market. Thirty-eight of the 179 resumed feeds had
produced by then; the rest were still spread across their six-hour offsets.

The old scheduler had also re-stamped `last_etag` on the feeds it polled while
discarding their contents, so they would have answered `304` forever with
nothing stored. Cleared on the 177 that had produced nothing.

### One bad row stopped sixty-two good ones

`npm run seed:primary -- --apply` ended `rolled back, nothing changed`. Sixty-one
of its sixty-three channels were fine.

`sources` has **two** unique indexes — `url`, and `feed_url` where it is not null
— and the upsert only knows about the first. Two seeds carried a `feedHint`
already held by a row at a slightly different address:

```
Elastic blog        seed url  https://www.elastic.co/blog/
                    held by   https://www.elastic.co/blog      (no trailing slash)
Terraform releases  seed url  https://github.com/hashicorp/terraform/releases
                    held by   https://github.com/hashicorp/terraform
```

Both raise on the second index, and one `BEGIN … COMMIT` around the whole loop
turned two address mismatches into sixty-three lost sources. It is now a
savepoint per row: what collides is named and skipped, the rest go in. **61
written, 2 skipped.**

The second collision was self-inflicted, and worth recording as such: the
Terraform row had been normalised to the bare repository URL an hour earlier so
the vocabulary-backed resume would match it, which is the convention every other
derived feed follows and the opposite of the one `seeds/primary.ts` uses for that
entry. Two conventions for the same address in one table is the actual defect;
the savepoint only stops it being fatal.

### Where the registry stands

| | before | after |
|---|---|---|
| news | 127 | 132 |
| releases | 204 | 220 |
| paused | 181 | **0** |
| **healthy** | **150** | **352** |

The last paused row, *Vercel Blog*, was a first-party vendor blog whose feed
resolves; it had been pruned for the same reason as the release feeds.

`seed:money`, `seed:ai` and `seed:breadth` were run and added nothing — their
candidates are already seeded or failed the audition. Those are dry-run by
default and print a measured projection before they will write anything.

## Filling in January 2024 onwards

A releases.atom feed carries the last ten entries. The API pages a hundred at a
time through the whole history, and `npm run backfill -- --provider
github_releases` already knew how to walk it — it had simply never been pointed
at the registry. `backfill_provider` was NULL on all 353 sources, so `--all`
selected nothing.

**182 repositories, 13,945 releases stored**, bounded to 2024-01-01.

| month | before | after |
|---|---|---|
| 2024-01 | ~130 | 432 |
| 2024-06 | 152 | 455 |
| 2024-12 | 228 | 547 |
| 2025-06 | 382 | 754 |
| 2026-01 | 555 | 982 |

Every month from January 2024 now carries between 410 and 3,911 stories against
130 to 230 before. The live archive went from 22,471 to **35,505**, of which
30,476 are 2024 or later.

### `--until` stopped the walk without bounding what it stored

The flag is documented at the top of `scripts/backfill.ts` and was only ever
passed to the Hacker News provider; the release branch took `maxPages` alone. So
asking for history back to a date got a page count instead, and with
`per_page=100` one page reaches years back for a busy repository and a fortnight
for a quiet one — the same command produced a different horizon per repository.

Passing it through was half the fix. The other half: the stop test runs *after*
the page has been ingested, so the final page went in whole. A bounded run over
eight repositories asking for 2024-01-01 stored 168 rows from 2020 to 2023 — not
harmful in an archive that wants depth, but not what the flag says, and the
overshoot is a different size every time because it depends where the cutoff
falls inside the page. `until` now filters the page before it is ingested. An
item with no date is kept: undated is not out of range.

## A source pointed at a whole site, and 800 documentation pages became news

`Qdrant blog` had `url = qdrant.tech/blog/` and
`feed_url = qdrant.tech/index.xml` — the site-wide feed. It carried
`/documentation/` and `/course/` pages, which have no publication date, so they
were stamped **2001-01-01**: 320 rows of "Quickstart", "Installing
Dependencies", "Configure Clusters" sitting in a 2001 bucket in a technology
trend series.

`qdrant.tech/blog/index.xml` exists, returns 200, and carries 165 entries all
under `/blog/`. The source now points at it. 785 non-blog rows are dismissed,
and **no live story is dated before 2010 any more**.

### Dismissal did not reach the analysis

This is the part worth keeping. `stories` carries a `forbid_delete` trigger, so
dismissal is the operator's only lever for taking a bad row out — and
`rollup.ts` filtered on `superseded_by` alone. All six of its selections ignored
`dismissed_at`.

So dismissing those 785 rows would have removed them from the reader and left
every one of them counted in `stack_month`, `month_totals` and the pair counts.
Those outlive the stories by design, which means the correction could never have
caught up with them: the analysis is not re-derivable once the rows are gone.

All six selections now exclude dismissed rows. A story somebody took out is out
of the series too.

## Search had one order and no way to change it

`/news` and `/all` carry a Sort control with six orderings. `/search` hardcoded
`ORDER BY rank DESC` in both its query paths and rendered no control at all, so
a phrase matching 5,212 stories offered exactly one view of them. `?sort=` in
the address was read by nothing — worse than refusing it, because the URL looks
like it worked.

The orderings are the reader's, imported rather than redefined: `SORTS` and
`SORT_LABELS` from `filters.ts`, plus `relevance` on the front as the default.
Six names meaning six different things depending on which page you are on is the
failure this avoids, and a test asserts the shared ones are worded identically.

**Relevance is dropped from the ORDER BY when another ordering is chosen**,
rather than kept as a tiebreak. `rank` is a float distinct for almost every row,
so a tiebreak would have made "newest first" mean "newest first, unless two
stories share a second" — which is to say, rank order with a different label.

The value reaches an `ORDER BY` by interpolation, so `searchSort()` is an
allowlist and the tests treat it as the security boundary it is.

Verified against the running server on one query:

| ordering | first result |
|---|---|
| Best match | Cloudflare changelog — AI Gateway, Workers AI |
| Newest first | Tech.eu — Cambridge spinout launches AI model |
| Importance | Anyscale — CVE-2025-62593 and the CISA KEV listing |
| Most covered | Pinecone — One Year In (6 outlets) |

### Dismissed stories were still in the results

The three search queries filtered on `superseded_by` alone. The reader excludes
dismissed rows, `rollup` now does too — search did not, so the 785 Qdrant
documentation pages taken out an hour earlier were still returnable, and the
result count disagreed with the list it was counting. All three now exclude them.

## Counting our own stories was the fake measurement

Said on 2026-09-01, and it retired an entire feature:

> *"I don't want to analysis news' count. I want to analysis news's content and
> summarize and then build report based on it by fields. In analysis feature,
> don't count news, it is fake value because we can't collect all news. If you
> want to use this value, collect public value of it in net."*

The movement report compared how many stories each technology attracted over 90
days against the 90 before, normalised both to a **share** of their window, and
called the ratio a finding. The share normalisation was the sophisticated part —
it existed so that the archive doubling in size would not read as every
technology doubling — and it does not survive the objection, because it does not
touch it.

**The denominator is the problem, and normalising cannot fix a denominator you
do not have.** This archive sees what 352 feeds carry. Everything technology
publishes anywhere is the population, nobody has that number, and no arithmetic
over a sample of unknown coverage produces a statement about the population.
"Rust grew its share of coverage 1.4×" reads as a fact about Rust and is a fact
about the feed list — and about the feed list *on the day*, which is why
repairing 179 dead release feeds moved every verdict in the table at once.

So the count is demoted to the only honest job it has: **deciding what to read**.
Choosing to open a story is not a claim about the world. The claims now come from
the text.

### Read forty, write five, cite everything

`src/analysis/corpus.ts` selects. `src/analysis/briefing.ts` writes. The
selection is ranked by event kind then importance then recency, over-pulls 400
rows, and is then cut to 40 by caps that are the difference between *what
happened in cloud* and *what the loudest publisher in cloud did*:

| cap | value | what it prevents |
|---|---|---|
| `perSource` | 4 | one vendor's changelog filling a field |
| `perSubject` | 3 | one project out-producing an industry |
| hard subject ceiling | 6 | the same project talking past its cap on co-tags |
| `maxReleases` | 8 | routine version traffic crowding out events |
| `total` | 40 | more than a model reads carefully, or a person checks |

`summary_en` is **required**, not preferred. A story with no text cannot be read,
and admitting one would let a headline stand in for evidence — which is how a
briefing ends up asserting what a title merely implied.

Two of those caps have subtleties worth stating. The **field root is not a
subject**: ask for cloud and nearly everything comes back tagged `cloud`, so
charging the root against `perSubject` would end the corpus at three stories. And
the **soft cap is evadable by design** — a story about Rust *and* WebAssembly is
admitted when Rust is full, because it is the only WebAssembly evidence there is.
That rule is right and it is also a hole: a project with a generous tag cloud
(`solana, web3, defi, blockchain`) always has one subject with room, so it never
actually caps. The hard ceiling at 2× is the backstop. A subject may exceed its
soft cap by bringing genuinely new ones, and never past twice.

The effect on the real archive, measured over a 14-day window before the daily
window replaced it: 40 stories from **26 distinct sources** in infrastructure and
web platform, 17 in AI. Before the caps, one changelog could supply half a field.
On the one-day windows the report now uses the caps bind less often, because a
day rarely offers a publisher four chances to dominate — they still bind on the
release feeds, which ship whether or not there is news.

### Three things keep a written report honest

**1. The writer sees only the corpus.** Forty numbered stories — title, summary,
source, event kind, date, and whether the source speaks for its own subject.
Every theme returns the story numbers it came from, and `validate()` drops any
theme citing nothing, or citing a story that does not exist. Dropped, not
flagged: a briefing containing one unsupported paragraph is worse than a shorter
briefing, because the reader cannot tell which paragraph it was.

This guards the real failure mode. A model asked about technology trends will
fluently supply the industry consensus from its training data, and a plausible
paragraph about last year is indistinguishable from a finding to the person
reading it. Citation is the only thing that separates them.

**2. No quantity comes from this archive.** The prompt bans the vocabulary
outright — *"seven stories"*, *"most coverage"*, *"the majority of reports"*,
*"dominate"*, *"increasingly"*, *"a wave of"*, *"widespread"*. That list is not
hypothetical. v1 forbade counting, the model obeyed the letter of it, and then
opened the AI briefing with *"AI infrastructure and agent platforms **dominate**
updates"* — a claim about how many, made without a number. v2 bans the words and
`tests/briefing.test.ts` asserts each one is still banned.

**3. The only numbers are public.** `src/analysis/public.ts` supplies GitHub's
topic census and star counts from `stack_adoption`, refreshed by the existing
`adoption` job — 2,338 technologies carry a public project figure, 746 a star
count. Every figure is quoted with the date it was measured, because an adoption
number without a date is a claim about the present made from an unknown past. If
nothing was measured, the prompt says *state no size figure at all*, and an
unmeasured technology is never rendered as zero: "nobody asked" and "nothing
exists" look identical in a column that defaults to 0, and only one is a fact.

### What the pages look like now

`/trends/report` is the whole archive, field by field. `/field/<slug>/report` is
one field, fully expanded. `/reports` lists every report ever written, and its
rows lead with what each briefing **found** rather than how many stories a field
produced — which was the old card's headline number and is not an answer to any
question a reader has. The full set of addresses is in **Every report is kept**
below.

There is **no window picker**, and there was one first. It offered 7, 14, 30 and
90 days, and three of those four led to an empty page, because the job writes one
briefing a day over one window — a control whose options mostly produce *nothing
has been written yet* teaches a reader that the page is broken. The deeper reason
is that the window is a property *of the report*: this is not a query that can be
re-run at any range, it is a piece of writing made once, from a period the report
itself records. So the window is stated on the page, and the thing a reader picks
is a **day**. `reportDay` guards it, because a hand-typed parameter must not
reach a query either way.

Under every finding sit the stories it was drawn from, open by default when there
are three or fewer. A citation the reader has to go looking for is a citation they
will not check, and the entire design here is that checking is easy. First-party
sources are marked in the citation list, because a reader cannot tell from a
domain name that a source is the subject describing itself.

There are no verdict badges any more, and no colour except one. The old page
painted a technology green for "surging" on a ratio of story counts; a colour is a
very confident way to say a thing, and that one was confident about the wrong
quantity. The single remaining accent marks `first-party`.

### The daily report was not daily

The first version of this read a rolling **fourteen days** every morning. The
window length was chosen carefully and the whole thing was still wrong, as the
next day's reader said plainly: *"The report don't change."*

The arithmetic is not close. Measured 2026-09-01: a fourteen-day window holds
**2,237** readable stories and about **171** arrive in a day. Consecutive reports
therefore shared roughly **92%** of their evidence — same evidence, same
briefing. Calling it daily made it look like a fresh reading of the news when it
was yesterday's reading with one day stirred in.

So a report now covers **the period since the last one**. `nextWindow` starts
where the previous report's `covered_to` stopped, so no story is read into two
briefings and none is skipped between them. Both ends are stored on the row
rather than derived, because "the last fourteen days" is a different set of
stories depending on when you ask, and a report has to be able to say exactly
what it read — including a week later, when the job has run six more times.

Two guards on that:

- **First run reads a week.** There is no previous report to follow, and a
  single day would make the very first report thin for no reason.
- **A catch-up is capped at seven days.** Without the cap, a fortnight's outage
  produces a fortnight-wide report — the rolling window this version exists to
  remove, arriving through the back door. The gap is stated on the page rather
  than hidden, so a reader can see the days nobody wrote about.

`first_seen_at` would be the obvious column for *new to us*, and it is unusable
here: the backfill campaign re-inserted the archive, so **22,167** stories claim
to have been first seen within a day. `published_at` is what actually happened
when, so the window is a window on the news rather than on our own write traffic.

Four consecutive days, generated to check the fix:

| day | fields | findings | stories read | leading subjects |
|---|---|---|---|---|
| 29 Aug | 11 | 47 | 196 | Tencent, Open Source, Hugging Face |
| 30 Aug | 3 | 10 | 16 | Debian, Documentation, Generator |
| 31 Aug | 9 | 35 | 88 | Vercel, SDK, API |
| 1 Sep | 14 | 53 | 322 | AWS, Model Context Protocol, HashiCorp |

**Zero cited stories are shared between any consecutive pair.** 30 August was a
Sunday: sixteen stories, three fields, and the other eleven fields reported as
having too little to write from. That is the correct answer to a quiet Sunday and
the old rolling window could not have given it.

### The briefing read like a filing system

v2 was accurate, cited, forbidden to count — and unreadable as news. Asked on
2026-09-01: *"the report have to be new news that generated by recent news."*
Its own output is the argument:

| what it wrote | what was underneath it |
|---|---|
| AI Agent Governance and Enterprise Infrastructure Updates | AWS opening Agent Registry; Meta shipping Muse Code |
| New Cloud Hardware and Database Regions | Graviton5 EC2 instances; BigQuery Graph reaching GA |
| Security Updates, Vulnerability Fixes and Agent Releases | Canonical patching OpenSSL and OpenZFS |
| Framework and Tooling Updates | a $74m Tectonic exploit and a network restart |

Every title a noun phrase: no actor, no verb, nothing that happened. The model
was abstracting real events *up* into categories, which is the opposite of the
job — and a category tells a reader nothing they did not already know from the
section heading they clicked to get there.

v3 demands **a subject and a verb in every title**, bans the endings that made
them interchangeable (Updates, Releases, Enhancements, Fixes, Roundup…), refuses
titles that join two subjects with "and" — if two things happened they are two
items — and requires the body to open with who did what and when. The four
examples of what *not* to write are v2's own titles, because an abstract rule
about noun phrases did not stop it and four concrete lines did.

The same days, rewritten:

> **Meta launches Muse Code and AWS releases Agent Registry**
> — AWS makes Agent Registry generally available for organization governance
> — HashiCorp integrates native AI agent support into Vault Enterprise 2.1
> — Cronos network restarts following a $74 million Tectonic exploit

**No validator enforces this, and that is a finding rather than an omission.**
The obvious guard drops any title ending in Updates, Releases, Fixes and so on.
Run against 155 real titles it flagged 12, and all 12 were correct news
sentences: *"LanceDB releases version 0.38.0 with breaking changes"*, *"Canonical
patches OpenZFS and OpenSSL vulnerabilities in Ubuntu releases"*. Those words are
verbs and objects at least as often as they are labels, so the check rejects good
writing to catch a fault the prompt already fixed — none of the 155 lacked a
verb. The rule lives in the prompt; the evidence lives in
`tests/briefing.test.ts` so nobody adds the validator later.

### A rate limit was being reported as a quiet industry

Found generating a fortnight of back reports on 2026-09-01. 15 to 18 August
wrote, then `gemini-flash-lite` hit its rate limit, and the next ten days came
back as **fourteen quiet fields each**. The page would have told a reader that
technology went silent for ten days while the archive held some 1,800 readable
stories from them.

The cause was one return type. `briefField` returned `null` for both *too little
arrived to write from* and *no model would answer*, and `briefArchive` filed both
under `quiet` — so the page said "produced too little to write from", which is a
statement about coverage and was simply false. The part of the code that reports
the limits was making exactly the kind of unfounded claim the rest of this
rewrite exists to prevent.

`briefField` now returns a `FieldOutcome`:

| outcome | meaning | what the page says |
|---|---|---|
| `written` | a briefing | the briefing |
| `quiet` | too little evidence | "too little to write from" — a fact about coverage |
| `unwritten` | evidence, no briefing | "had stories and no briefing", named, with how much went unread |

An `unwritten` field is never called quiet. The page states which fields they
were and how many stories went unread, because a gap in the archive's account of
a period is the reader's business and its size is part of it.

The damage was real and not hypothetical: regenerating 18 August under the fixed
code took it from **2 briefed fields to 12**. Ten fields had been recorded as a
quiet industry when the truth was a provider cooldown. 15, 16 and 17 August came
back identical, so those were honest.

A rate limit is a wait and not a verdict, so the backfill retries refused fields
once after a pause; 20, 24 and 27 August each needed it and each came back
complete.

### Reports could not be found by clicking anything

Asked on 2026-09-01: *"where can I look these report lists"*. They were one rail
entry under Explore, and that entry was invisible from the page the Explore tab
lands on.

`/all` is Explore's home. `/all` is also a **reader stream**, so it renders the
faceted query panel instead of the section menu that `renderRail()` builds for
`/fields`, `/categories` and `/companies`. Clicking **Explore** therefore landed
on the one page in the section where the section's own menu did not exist — and
Reports was only reachable from that menu. Everything worked; nothing was
findable.

The Explore group is now the first block of the faceted rail too. Facets narrow
the list; those links leave it, so they are a separate group rather than mixed in
among the checkboxes.

### Reports is a section again

Asked immediately after: *"hey add tab for this"*. It is the third answer this
question has had, and the first two were both right at the time:

| | |
|---|---|
| 29 Aug | reachable from one button, most of the way down the river it replaces |
| 30 Aug | given a tab, then demoted the same day — *"this page isn't enough to be individual menu"* |
| 1 Sep | a tab again |

The demotion was correct. A section earns its place by having a rail worth
opening, and that rail was fourteen links to fourteen field reports — the index
it duplicates, wearing a menu.

**What changed is that there is now something to navigate.** A report is written
every morning and kept, so the section has two axes: eighteen days down one,
fourteen fields across the other, and neither reachable from the other without a
rail. The Recent group is built from `daily_reports` rather than from a constant,
because a rail offering a day nobody wrote is a menu that lies about what exists.

`/trends/report` moves with it. The composed whole-archive briefing was in
Analyse because that is where the movement report lived, and it is a report;
reports in two tabs is how a reader learns to check both. It stays
administrators-only, filtered from the rail and refused at the route.

**A section cannot be a prefix here.** Every field report lives at
`/field/<slug>/report`, underneath the prefix that owns the field rivers, so no
ordering of `owns` separates them — Reports would have to claim `/field/` and
take the rivers with it. `NavSection` gained `claims`, a list of patterns tested
before the prefixes, and Reports claims `/^\/field\/[^/]+\/report(\/|$)/`. The
matching guard on the Fields entry became a segment test for the same reason:
`endsWith('/report')` walks straight past `/field/ai/report/2026-08-26`.

One thing the move broke and the tests did not catch, because it is a rendering
detail rather than a routing one: every report page called
`crumbsFor('/reports', 'Reports')`, and `crumbsFor` returns an empty trail when
the path IS its section's home. `/reports` had just become one, so the
breadcrumbs collapsed from *"Explore / Reports / AI & ML"* to *"AI & ML"* — no
way back. Each page now passes its own path, and reads **Reports / AI & ML**,
**Reports / 20 August 2026**, and nothing at all on `/reports` itself, where the
tab already says it.

### Every report is kept, and both ways in are listed

Asked for in the same breath: the report must *"list that compose each report for
each day and each fields"*. Two axes onto one grid.

| page | what it is |
|---|---|
| `/reports` | every day, each with its fields under it |
| `/reports/<day>` | one day, listed |
| `/field/<slug>/report` | one field, latest, with its own history under it |
| `/field/<slug>/report/<day>` | one field, one day |
| `/trends/report` | the composed whole-archive briefing (administrators) |

Migration 0073 adds `field_briefings`, keyed `(day, field)` — the grain a reader
actually navigates, down the days for one field and across the fields for one
day. Before it, the briefings lived inside one jsonb blob per day, so "every AI
briefing this month" meant parsing every day's payload and a single field's
report had no address of its own. `daily_reports` keeps its row per day for the
composed title and the totals, and carries no findings of its own — two copies of
a finding is two things that can disagree.

**A day appears once.** `daily_reports` is keyed `(day, window_days)`, which was
right when the window was a reader's choice and is not any more. `forbid_delete`
keeps the old rows, so 1 September held both a `content-v1` row over fourteen
rolling days and a `content-v2` row over one, and the index listed the day twice
with two sets of totals and identical fields beneath them. `DISTINCT ON (day)
… ORDER BY day DESC, generated_at DESC` — by *when it was written*, not by a
filter on the generator string, because the same thing happens at v3 and a filter
would have to be remembered.

**`/reports/<day>` lists; it does not compose.** That distinction is a
permission. The composed whole-archive view is administrators only, and rendering
the same content under a second address would have been a gate with a door beside
it. A reader gets the day's title, what it covered, and a way into each field's
briefing — which has always been theirs. Verified: reader gets `403` on
`/trends/report` and `/trends/report?day=…`, `200` and zero finding-prose on
`/reports/<day>`.

A day that was never written returns a page saying so, and a day-shaped string
that is not a date returns **404**. `reportDay` rejects `2026-02-30` rather than
letting `Date` roll it over to 2 March, because accepting it would put one day's
report at another day's address.

### The report is a record, not a page

Generated once a day at 07:00 by the `report` job, after rollup, retain and tag,
and read back on view. Generating on view would cost a model call per refresh and,
worse, would give two people looking at the same archive two different reports — a
report that changes when you reload is not a report.

The fourteen model calls are **sequential on purpose**. Fourteen at once is how a
provider's rate limit turns one slow report into fourteen failed ones, and the job
holds an hour's lease to do it in.

Citations are stored **resolved into real stories** (id, title, source, date)
rather than as indexes into a corpus, because retention deletes stories after four
months and these tables outlive them — an unresolved index becomes a pointer to
nothing exactly when the report becomes historically interesting. `forbid_delete`
applies to both tables for the same reason.

Migration 0072 made the old verdict columns nullable rather than dropping them.
Rows written under `movement-v1` are still true as what they were — a record of
what the archive was prepared to say on those mornings, under an analysis it no
longer performs — and dropping the columns would silently rewrite that history
into something it never said.

### The title names a subject, not a filename

Asked for on 2026-08-31: the title must name a market, technology, platform or
company, and the day. The subjects come from the stories each briefing **led
with**, so the title is made of the same judgement the briefing was rather than a
second one computed from tallies. Field roots are excluded — every story in the
cloud briefing is tagged `cloud`, and a title built from roots reads "Ai, Cloud,
Data", which is fourteen words for *we have fourteen sections*. Slugs are resolved
to real names through `stacks`, `companies` and `platforms`, because `ai-agents`
title-cases to "Ai Agents" and a title is the one string nobody reads charitably.
"Market moves:" leads when the leading evidence is money rather than shipping.

The first report written this way:

> **AWS, Model Context Protocol, HashiCorp — 14 fields briefed, 1 September 2026**

14 fields, 53 findings, **0 uncited**, written from 322 stories read across every
source that carried them.

### Administrators only

`/trends/report` is refused to readers by the same rule `/admin` uses: a signed-in
admin *is* the authorisation, and the token stays for headless access. The refusal
lives in the route, not only in the rail — a rail that hides a link is a menu, not
a permission.

### What it still cannot tell you, said on the page

Four limits, stated rather than buried: this is an unmeasured sample; every
finding is capped and cited; **absence is not evidence** (a quiet field is a
statement about coverage, not about the field); and the prose was written by a
model, which is named on its own briefing. Disclosure is what makes a fallback
chain honest for text somebody may quote — the chain runs Claude first and falls
through to `gemini-flash-lite` on this installation, and the page says so.


## The market is the second thing this is for

The project's purpose, stated 2026-08-28: **"finding new stacks and market via
news."** Two targets. The rules implemented one of them.

`eventful.ts` asked whether something happened to a codebase — launch, release,
change — and had no way to say that somebody with money had looked at a
technology and bet on it. Worse, `topical.ts` refused that question outright:
funding and valuation lived in the `business` category, next to the analyst
report and the vendor survey, at `rescue: 'strong'` — meaning only a version
number in the title could save them, and a funding round never has one.

What that threw away, verbatim from `story_rejects`:

```
ClickHouse raises $400M Series D led by Dragoneer
ClickHouse raises $350 million Series C to power analytics for the AI era
ClickHouse raises a $250M Series B at a $2B valuation
Mistral AI raises 1.7B€ to accelerate technological progress with AI
We Raised $100 Million for Open & Collaborative Machine Learning
Supabase Series F   /   Series B   /   $30m Series A
Towards the AI Cloud: Our Series F
```

Nine rounds from six of the most-watched infrastructure companies in the
registry, **each announced by the company itself**, every one filed as though it
were a survey. Which stack is being bet on is not a fact about a codebase, and
it is exactly what a reader deciding where to spend a year needs.

### Three changes, and one question that decides all of them

**`market` is now an event class.** Capital, ownership, position — who is being
funded, who now owns what, and which way adoption is moving. Acquisition moved
here off `change`, where it had been matching all along: "MotherDuck bought the
startup" changes nothing about what MotherDuck *is* this week and everything
about what it will be.

**`business` split on whose money it is.** Not on the vocabulary — the same
words appear on both sides — but on whether a technology is named:

| | rescue | reads |
|---|---|---|
| capital, valuation, market share | `signal` | name a technology and this is market news |
| surveys, earnings, analyst houses | `strong` | a survey is a survey however good its subject |

That keeps "report finds 40% of firms use Kubernetes" out, which was the
sentence that made the original `strong` threshold necessary, while letting
"ClickHouse raises $400M" in. Gartner, Forrester, IDC, McKinsey and the rest are
now named, because "McKinsey says enterprise AI is on the road to ROI" was
walking through every pattern above it.

**"What's new in X" is a changelog, not a question.** It was refused on its
first word by the interrogative opener that correctly catches "What are
PostgreSQL Templates?". An exception rather than dropping `what`, because both
shapes are real — and it is the densest announcement format these publishers
produce: eight consecutive months of *What's new in Swift*, plus Firefox, React
19, Svelte 5, Diffusers and Redis.

### Ordering, which is where the work was

Position — *overtakes*, *in steep decline*, *most popular* — is the only market
class checked **before** the release grammar. "Postgres is now the most popular
database among new projects" matches RELEASE on `(is|are|can|will) now`, the
idiom a changelog uses for every feature it ships, and reads as a release of
Postgres. Safe to jump the queue precisely because no release note says
"overtakes" or "market share"; capital and ownership are *not* safe that way and
stay behind the product classes.

Jumping the queue means position is read before the article shapes get their
say, which cost one false positive immediately: *"Beyond LoRA: Can you beat the
most popular fine-tuning technique?"* was reclassified as market. A market claim
is a claim, so position no longer fires on an interrogative title.

### Measured against the whole archive, not argued about

Every recorded refusal replayed under the new rules. 45 could not be replayed at
all — their deciding phrase matched in the summary, which `story_rejects` does
not keep — and that is reported rather than counted as a win:

```
974  recorded refusals
 45  unreplayable (phrase matched in the summary)
877  still refused
 52  NOW KEPT
       43  change   -- the "What's new in X" changelogs
        9  market   -- the funding rounds, the acquisition, the decline
```

Zero recovered from politics, crime, sport or commerce. And 21 held stories
changed class (`npm run events:reclass`), each read before it was written.

### What was measured and deliberately NOT changed

A source whose `kind` is `releases`, `status` or `research` skips the topical
rules entirely. OpenAI's channel is one of them and carries policy essays
alongside its API changelog — elections, the Department of War, the New York
Times lawsuit — so the bypass is a real hole.

Running the topical rules over those sources anyway was measured: of 1,633 held
stories it would refuse **11, and all 11 are wrong** — "GPT-5.6 Sol is now 50%
off" and "DeepSeek V4 Flash is 90% off through Novita" are pricing
announcements, "Make Firefox your World Cup sidekick" is a feature, "Protecting
against token theft" is security. Closing the hole costs more than it saves at
today's registry, so it stays open and stays written down.

## Growing the registry back, by audition

The registry had been cut to 52 sources under rules with one target. With two
targets and a grammar that now reads a version title and a vendor changelog, the
cut was worth re-running — and the way to re-run it is not to argue about what a
publisher is like. **Every paused source and every candidate had its live feed
fetched and every item put through the whole gauntlet in memory** — retention
window, build noise, topical, event class — and the count of what would survive
is the number beside its name in `seeds/expand.ts`.

193 paused sources auditioned. **14 would produce; 179 produce nothing**, which
is the repository release feeds doing exactly what they were paused for.

### The second number is the interesting one

Alongside "how many would survive", each candidate carries the share kept **only
by the first-party fallback** — the rule that says *a vendor post we cannot
parse is a change*. A high share means the source writes essays that survive on
the publisher's identity rather than on anything the sentence says.

It is a quality signal and deliberately **not** a threshold, because measuring
it against the live registry produced the most uncomfortable number in this
document:

```
registry-wide  55%   over 2,077 stories from 41 sources
median source  64%
NVIDIA 95% · Redis 92% · Hugging Face 85% · Cloudflare 70% · Vercel 43%
AWS What's New 26% · OpenAI changelog 24% · Ubuntu security 5%
```

**Over half of everything in the archive is classified only by the fallback.**
`change` is, for most of the archive, a bucket meaning "a first-party post the
grammar could not place". Rejecting candidates on that measure would mean
rejecting most of what is already there — so it breaks ties and it says out loud
which additions are thin, and nothing more.

### It found a rule gap on the way

`Bun 1.4`, `Deno 2.9`, `Astro 7.2` all landed in the fallback. The
version-title shortcut was gated on the source's `kind`, which is a fact about
the feed and not about the sentence — so a version release, the core event this
archive exists to find, was being filed as *something happened, we cannot say
what*. A title that IS a version is now a release for any first-party source.
Astro's fallback share went 70% → 10%, Deno's 67% → 0%, Bun's 100% → 33%.

### What came back and what did not

**12 unpaused, 18 added, 14 refused with the number that decided each.** The
refusals are kept in the file, because a decision with no record is one somebody
re-litigates in six months — and the three biggest producers offered were all
refused:

| refused | would have kept | why |
|---|---|---|
| Vercel Blog | 379 | the same feed as Vercel changelog — 379 of its URLs already held, of 380 |
| Temporal blog | 54 | 80% fallback: the largest source of unparseable vendor essays offered |
| Prisma blog | 42 | 86% fallback; *"Prisma Is Building the Stack for the Next Million Products"* |
| Raspberry Pi news | 10 | hobby hardware — *"Create your own cyberdeck"* |
| DigitalOcean changelog | 12 | titles are bare dates: *"27 August 2026 (inference)"* |
| MongoDB blog | 5 | 100% fallback: five items, none of them placeable |

Volume was a reason to look harder, never a reason to take one. The largest
single offer in the audition was a duplicate of a source already in the
registry, and taking it would have looked like 379 new stories.

The additions fill the gaps the cut had left: **Python, TypeScript, Ruby, Rails,
Laravel, Svelte, Astro, Bun, Deno, Angular, Chrome, Swift, NixOS, Bazel, Zig** —
languages and runtimes people actually run, most of which the archive could not
see at all.

## Asking what a source we already trust is like

`sitelike.org` answers "what sites are like this one". Pointed at a source that
already produces, it returns the neighbourhood — some of it the exact projects
the archive is missing, most of it personal blogs and link farms. It is a
**candidate generator and nothing else**; the audition decides.

Three stages, and only the first is new:

| | |
|---|---|
| neighbours | sitelike.org, seeded from sources that already produce |
| feed | `link rel=alternate` first, then the common paths |
| audition | every item through the whole gauntlet, in memory |

The seeds are the **producers**, not the famous names. Asking what Vercel is
like returns the neighbourhood of a source whose output has been measured;
asking what a famous site is like returns famous things, which is how a registry
fills with outlets nobody reads for the beat.

### The first run judged strangers as friends

Candidates went through the gauntlet as *first-party technology channels* — the
way `seeds/expand.ts` judges a hand-picked one. That turns on the fallback rule:
**a post from a vendor's own channel that the grammar cannot place is a change.**
Safe for Vercel. Catastrophic for a domain nobody has looked at:

```
18 kept  100% fallback  salon.com           "The high cost of MAGA manhood"
14 kept  100% fallback  101greatgoals.com   "Crystal Palace 1-4 Manchester City"
 4 kept  100% fallback  bellona.org         floating nuclear power
 2 kept  100% fallback  ilgp.org            the Illinois Green Party
```

Every one a `change`, about nothing, from a source the archive had never heard
of — and every one at 100% fallback, which is the tell.

**A stranger gets no benefit of the doubt.** The grammar has to actually say
launch, release, change or market, and the topical gate runs the commerce and
consumer rules that `PRIMARY` skips. That is also exactly how the INSERT files
it — `CONTENT` not `PRIMARY`, `curated = false` — so the audition and the row it
produces finally agree about what the source is. A language gate went in at the
same time: `zenn.dev` came back at 20 kept, good writing the reader cannot read.

The same run after the fix passed two candidates, both at **0% fallback**:
`nextjs.org` and `netlify.com` — both genuinely missing, and Netlify one this
project had already written off as *"no reachable feed at the addresses tried"*.
Discovery found the feed the hand-search missed.

`tests/discover-similar.test.ts` pins the rule down by running all four bad
titles both ways: as a first party every one is an event, as a stranger not one
of them is — and a real announcement from a stranger still gets through, so the
rule is not "refuse everything unfamiliar".

### And a second hole, one level deeper

Scaling the fixed version to fourteen seeds surfaced `itwire.com` at **88 kept**
and `kyma.com` at 2, with titles like *"NASA to launch telescope to teach
scientists about tens of thousands of galaxies"* and *"Imperial County D.A.'s
Office launches first-ever Summer Post"*.

They pass because **`judgeTopic` is a blocklist.** Its job is to catch what
strays off the beat, and anything no rule names is kept — which is right when
somebody chose the source and wrong when nobody has.

> A curated source is trusted to be on the beat and the filter catches what
> strays. A stranger has no such credit: it has to **show** technology — a name
> the vocabulary knows, or a title that reads as technical — not merely fail to
> show football.

Also fixed in the same pass: a domain that redirects into one already polled is
that source under another name. `aws.com` resolves to `aws.amazon.com` and
arrived as a 73-item "discovery" of a source the archive already holds 101
stories from.

## The money lens: the changes with a number attached

The archive exists to learn a stack and to earn or save money with it. Two
thirds of that were already served — what to learn is the registry and the
Articles class, what happened is the event classes. The third was invisible,
and it is the one with a number on it.

| lens | what it catches |
|---|---|
| **Costs money** | pricing, billing, free tiers, quotas, rate limits, discounts |
| **Licence changed** | relicensing, source-available moves, BUSL/SSPL/AGPL, trademark, terms |
| **Ends or retires** | end of life, sunsets, shutdowns, retirements, deprecations |

A rail group on News, and `?money=cost` on any list. Two rules make it a lens
rather than a smear:

**Read the title, and nothing else** — the same rule `classifyEvent` follows.
Measured over 635 stories: title-and-summary matched 29 items, mostly noise (the
first paragraph of half of everything mentions cost); title alone matched 16, of
which 15 were exactly right.

**Every acronym is wrapped in a word boundary.** The first draft listed `SSPL`
bare and matched **Cro-sspl-ane**, a Kubernetes project with no licence news in
it at all. There is a test that holds `\y` in place.

### The lens found a classification error

`/all?money=cost` returned 7 stories and `/news?money=cost` returned 0. The
reason was not the filter:

```
Billing is now enabled for R2 SQL                        -> release
Retirement: Support for Node 22 LTS ends April 30, 2027  -> release
Azure Databricks Runtime 10.4 LTS reaches end of life    -> release
```

They arrive on feeds whose every other entry is a version number, so
`classifyEvent` took the source's word for it — and being filed as releases put
them behind the rule News applies to releases, which is precisely backwards: **a
price change matters most for the things you have not been watching.**

A release feed publishes releases except when it publishes an ending. The money
patterns are now checked before the source's contract is honoured, and only
those patterns: a version string carries no money vocabulary, so this cannot
misfile `Ansible v2.19.1`. 14 stories were reclassified from `release` to
`change`, and there are tests on both directions.

## The list and its counts are now read in one batch

Reported from a real screenshot: the header said **4 stories** while the rail
beside it said **Releases 193**. Both numbers were correct when they were taken,
and they were taken a minute apart — the page ran its list, then two more
awaits, then its counts, while 320 new sources were being tagged. A story is
invisible to a field filter until `stories.stacks` is populated, and the tagger
fills that in asynchronously, so the archive genuinely grew by 200 in-focus
stories between the two queries.

Every count now runs in the same `Promise.all` as the list it describes. That is
not a snapshot — the queries take separate pooled connections and can still
differ by milliseconds — and the honest fix for the remainder would be a
`REPEATABLE READ` transaction, which would serialise eight parallel queries onto
one connection and cost more page time than the residue costs correctness. The
window went from a minute to the width of the slowest query.

The filter logic itself was checked end to end and was right: each dimension is
counted with its own filter lifted (`whereNoKind`, `whereNoField`, `whereNoAbout`
and now `whereNoMoney`), so every number in the rail is the number you get by
clicking it.

---

## The re-roll that would have destroyed the archive's memory

Caught on a review pass, before it ever ran.

Reopening settled months to ingest (above) created a second problem: a story
landing in an already-rolled month leaves that month's analysis understating it.
The fix looked obvious - mark the month `dirty_at`, have the rollup redo it -
and it was written, migrated and tested that way.

Then the review asked what "redo it" does to a month that was PRUNED:

```
2026-04   stories held: 333      stack_month says: 23,561
```

Both numbers are correct. April was rolled while the archive still held 23,561
stories and then pruned, and **the analysis outliving the stories is the entire
point of the retention design**. `rollMonth` is a delete-then-insert for the
month, so re-rolling April would have recomputed it from the 333 rows that
happen to be there now and replaced a complete record with a fragment.
Permanently, on a scheduled job, at 03:10, with nobody watching.

Of everything in this system that can go wrong, that is the one that cannot be
re-derived. The stories it was built from are gone.

### A pruned month is never re-rolled, dirty or not

`dirty_at` survives as a **record rather than a trigger**: this month holds
stories its analysis does not count. The cost is an understatement of history,
and anyone who wants the true number can count the stories - which is the
direction an irreversible operation should be made to fail in.

Verified rather than assumed: `pendingMonths` now returns 15 months, all of them
2011-2013 months that arrived in the back-catalogue sweep and were never rolled.
The seven pruned 2026 months are excluded, and the overlap between "would be
rolled" and "was pruned" is empty.

**The running process was carrying the dangerous version**, which mattered
because the rollup job fires daily at 03:10. Restarted before that.

---

## The archive outranks the live page

Reported 2026-08-29 with a screenshot. A Google Cloud Blog post stored with a
real headline and 4,099 words rendered on `/read/<id>` as:

```
title:  Google Cloud Blog
body:   404. That's an error. The requested URL ... was not found on this server.
words:  26
```

The stored row was **fine** - correct title, correct URL, 4,099 words. Google had
moved the post and served an error page whose `og:title` is the site name, and
every one of those three fields came from the live fetch and overwrote a correct
record.

`readArticle` already had a fallback for a failed fetch. The hole was that
**HTTP 200 was treated as a promise that the article is still there**, and an
error page is served with a 200 more often than not.

### Three changes, one rule

**The stored title always wins.** It was `readable.title ?? base.title`, which is
exactly how "Google Cloud Blog" replaced a headline. The stored title came from
the feed at collection time and is what the reader clicked; a live page can only
contradict it, never improve on it.

**A page that says it is an error is not an article.** Read from the title and
the first 120 characters of the first block only - a real piece about HTTP
semantics says "404" in its body all day, and only an error page says it where
its headline goes.

**A page that returns a fraction of what was collected is not that article any
more.** 4,099 came back as 26. Below a quarter of the archived count the reader
shows the stored summary and says which two numbers it is comparing. Only
applied when the archive has a substantial reading to compare against, so a
genuinely short post stays readable.

That last rule shipped with a units bug that made it fire on nearly everything -
see *[word_count was never words](#word_count-was-never-words)*, below.

The rule underneath all three: **the reading page is a view onto a request, and
when the request stops agreeing with the archive, the archive is the thing that
was verified once and the request is the thing that just failed.**

---

## Keep-forever closed three months to collection

Asked, and rightly: *"why don't you perform my instruction that collect 3 month
news and save to db and display"*. The instruction was standing since
2026-08-28 - May, June, July, August - and it had stopped being met **because of
a change made to protect the archive**.

Setting `RETENTION_KEEP_MONTHS=0` stopped deletion. It also narrowed the
COLLECTABLE window from four months to one, and nothing said so:

| month | in `rollup_log` | open to ingest under keepMonths=0 |
| --- | --- | --- |
| 2026-05 | yes | **CLOSED** |
| 2026-06 | yes | **CLOSED** |
| 2026-07 | yes | **CLOSED** |
| 2026-08 | no | open |

`isOpenMonth(m, 0)` is true only for the current month, and `isArchived` refuses
any earlier month that appears in `rollup_log`. All three did. The measured cost
was **86,000 items refused every six hours** as `already_archived`, from a
collector reporting itself perfectly healthy.

Worse, it was written down as a deliberate limitation - *"the one thing it does
NOT do is reopen a month that rollup already settled"* - which made a broken
instruction look like a design decision.

### The reason a month was closed had already gone away

A settled month was closed to ingest because its stories were about to be
**pruned**: storing into it would put a row in a month whose totals are final
and whose contents are leaving. Under KEEP_FOREVER nothing leaves. The reason
evaporated and the rule stayed.

`isClosedToIngest(monthIsRolled, keepMonths)` now states it in one place: a
month is closed when it has been settled **and** its stories are subject to
deletion. Under keep-forever the second half is never true.

### What that trades, and how the trade is paid

A story landing in an already-rolled month leaves that month's analysis
understating it. Stale, not wrong - and fixable, which a refused story is not.

`rollup_log.dirty_at` (migration 0065) is how the collector says so. Ingest
marks the month; the rollup picks dirty months back up even though they were
pruned, and clears the flag in the same statement that records the roll.
Marked rather than recomputed inline, because rolling a month is minutes of work
and a poll cycle is seconds.

### The result

Every source re-polled from scratch, conditional headers cleared so nothing came
back 304:

| | before | after |
| --- | --- | --- |
| stories held | 2,683 | **5,421** and climbing |
| 2026-05 | 309 | **310** · 35 sources |
| 2026-06 | 504 | **504** · 48 sources |
| 2026-07 | 615 | **625** · 60 sources |
| 2026-08 | 1,255 | **1,279** · 83 sources |
| oldest year reached | 2026 | **2011** |

Three collect cycles took 447, 1,132 and 1,121 new stories. The four requested
months are held, and the archive now also carries the back catalogue each feed
still offers, which is what "keep everything" means when the feeds are asked
without a cutoff. (The `?days=120` reading that used to be quoted here is gone
with the counting: see **Counting our own stories was the fake measurement**.
The windows a report accepts are now 7, 14, 30 and 90 days.)

---

## "The speed is very low and the count of AI is very small"

Two complaints, and they had two different answers: one was a real bug that had
been costing the archive its single most important AI source since the day it
was added, and the other was a measurement artefact.

### The count: the best-known AI source had produced nothing. Ever.

`OpenAI blog` sat in the registry marked healthy, polled hourly, returning
HTTP 200 with 1,157 items every time - and **zero stories, for its entire
life**:

```
fetch_log:  status 200, items_seen 1157, items_kept 0
drops:      already_archived 1069, too_short 48, off_topic 39, build_noise 1
24 hours:   8,097 `too_short` drops from this one source
```

openai.com answers **403** to this collector, and its feed carries 110-160
character summaries. The article fetch that exists precisely to rescue a thin
feed item came back refused, so every item failed the 400-character bar - and a
source that is refused looks exactly like a source with nothing to say.

**The shortness was ours, not theirs.** A publisher who writes two sentences has
told us something; a publisher whose server refuses us has told us nothing.
`gateItem` could not tell those apart.

A curated first-party source whose page is **asked for and refused** is now
admitted on its title. That is the same argument `RELEASE_MIN_LENGTH = 0`
already makes for release feeds - *"release notes are events, not essays"* - and
it costs nothing in accuracy, because `classifyEvent()` reads the title and
nothing else, so the item is classified exactly as it would have been with the
full body.

Deliberately narrow: it needs all three of `tech_only`, `PRIMARY`, and
`pageBlocked`. A short item from a source that answered normally is still short.

**First poll after the change: 0 → 25 stories**, `too_short` 48 → 23.

```
launch   Introducing the Admin plugin for ChatGPT Work and Codex
change   Our decision on Cursor following its acquisition by SpaceX
change   The Hugging Face incident and the road ahead
change   Jalapeño's first results show industry-leading speed and efficiency
```

### The speed: one poll interval, and the frightening number was an artefact

The first measurement said **median 40 hours** from publication to collection,
which would be indefensible for a news system. It was wrong, in a way worth
recording: **every source in this registry was added between 2026-08-26 and
2026-08-29**, and each ingested its back catalogue on arrival. An item published
five days ago and collected on the day its source was added counts as five days
of "latency" and is nothing of the kind.

Measured where backfill cannot reach - items **published** in the last 24 hours:

| | |
| --- | --- |
| median pickup | **77 minutes** |
| p90 | 267 minutes |
| worst | 429 minutes |

That is one poll interval, as designed. Polling itself is healthy: no source
went unfetched for more than three hours, and six hours of `fetch_log` shows
548 × 200 and 722 × 304.

**The archive is four days old.** That, more than any filter, is why the AI
totals look thin - 354 AI stories over "30 days" is really four days of
collection plus whatever each feed still had on offer.

---

## "The last AI news is 6 hours ago, is it correct?"

Asked 2026-08-29. It was correct, and checking it found something else.

**Six hours was right, and normal for the day.** The collector was healthy -
last fetch 24 seconds earlier, 106 fetches in the previous half hour, reporting
`0 new` because nothing new had been published. The archive's sources are
engineering blogs and changelogs, and they keep office hours:

| | Sun | Mon | Tue | Wed | Thu | Fri | Sat |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AI stories/day, 8-week mean | 0.9 | 9.5 | 13.9 | 13.9 | 14.6 | 10.0 | **1.6** |

2026-08-29 was a Saturday. Against a Saturday mean of 1.6 stories, a six-hour
gap is not a stall - the typical gap between AI stories over the previous
fortnight was 1.6 hours with a 90th percentile of 5.

**A quiet feed and a broken collector look identical from the outside**, which
is the reason to check rather than reassure: `items_kept: 0` from a working
source reads exactly like a source that has stopped answering. The distinction
here came from `fetch_log`, not from the story table.

### What the check turned up

Sitting above the newest real story was a Cloudflare changelog entry dated
**2026-08-30 00:00** - collected at **2026-08-28 15:18**, thirty-three hours
before its own publication date.

`parseDate` rejected dates decades out and waved this straight through. The rule
it was missing is simpler than a tolerance: **nothing is published after the
moment it is fetched.** Parsing happens at fetch time, so `now()` there is
collection time, and the only allowance needed is an hour for two clocks
disagreeing.

It was not cosmetic. Every page orders by `coalesce(published_at,
collected_at)`, so that row pinned itself to the top of every newest-first list
until midnight caught up - and `relativeTime()` clamps a negative age to zero,
so it rendered as "now" and hid the reason.

The date becomes **null rather than clamped to `now()`**, which is that
function's existing contract: `published_at` is allowed to be missing, and
`collected_at` is the field the system actually trusts. The one row already in
the archive was corrected the same way - the story kept, the impossible date
cleared.

---

## A button that pointed at the page it was on

Reported 2026-08-29 from `/stacks?sq=datab&cat=data`, with Databricks expanded:
*"I need more detail data but the more detail data don't work"*.

Three of the four buttons on an expanded row were fine. `Full detail` reaches
`/trend/databricks` - stories, months seen, busiest month, peak outlets, kind of
attention, what it appears alongside, and a month-by-month history. The fourth,
labelled `More data`, pointed at:

```
/stacks?sq=datab&cat=data      <- the page it was clicked on
```

It built its href from the current filters plus `{ categories: [category] }`,
which is right when you arrived by browsing and a **no-op when you arrived by
searching**: setting the category that is already set, while keeping the term
that narrowed the list to a single row, is not a change of view.

The button now clears the search, and says `See all data` rather than
`More data` - "more" is a promise about quantity, "see all" is a promise about
scope, and the second one is the one it keeps.

**A no-op link is worse than a missing one.** A missing button is understood in
a moment; a dead one gets clicked twice and then the whole page is distrusted.
`tests/registry-links.test.ts` states the property that was violated - the
destination is never the page it was clicked on - rather than only the example.

---

## The article was on the page the whole time

Reported 2026-08-29, looking at a reader page. The headline was
*"Z.ai's GLM-5.3 goes open weight, but its new license aims at hyperscalers"* -
a licence change, one of the highest-value classes this archive collects - and
the body under it was eighty-three words of somebody else's newsletter signup:

> We're so glad you're here. You can expect all the best TNS content to arrive
> Monday through Friday ... Check your inbox for a confirmation email ...
> Become a TNS follower on LinkedIn.

The first guess - a paywall, a fragment, a site that needs JavaScript - was
wrong. Fetching the page shows the article sitting in plain HTML, nineteen
paragraphs of it.

### A wrapper full of script beat a div full of prose

`pickContainer` scores every candidate and takes the best, so this was never a
first-match bug. The score was the bug:

```
total textContent − linkChars × 1.5 + paragraphs × 25
```

**Total textContent counts inline script, JSON-LD, poll widgets and cookie
text.** On that page the article lives in `<div id="tns-post-body-content">` -
19 paragraphs, 7,919 characters, matching **none** of `CONTENT_SELECTORS`. The
only selector that matched anything was `.content`, a wrapper holding 15,736
characters of script and exactly five paragraphs of chrome. It scored **15,449
against the article's ~8,300** and won.

And because 15,449 cleared the fallback floor of 200, the generic `div, section,
td` scan - the one that would have found the real container - never ran at all.

`densityScore` now counts only text inside block elements, so the wrapper's 15k
characters stop counting because they are not in paragraphs. `tr` and `td` stay
in that list for the reason `BLOCK_SELECTOR` has them: LWN's "Security updates
for Thursday" is a table with no `<p>` in it, and dropping table text would
score every candidate on that page at zero and pick one at random.

### Checked against the archive before being believed

Seventeen live pages, one per source. The first comparison was **wrong and was
thrown away**: it measured the old container by total `textContent` and the new
one by `extractReadable`'s block words - two different rulers - which made the
new scorer look like it lost text on four sites. Re-measured on one ruler:

| | |
| --- | --- |
| container unchanged | **13 of 17** |
| The New Stack | 575 → **7,945** prose characters |
| Databricks Blog | 7,907 → **21,356** |
| The Register | 17,377 → 4,270, article intact, 13k of related-article furniture dropped |
| Laravel News | 2,866 → 2,061, article complete, site promos dropped |

No page lost its article. The two that shrank shrank because a whole-page
container stopped winning.

---

## The same bug, one level up: the winner was the whole page

Reported 2026-08-29 with a screenshot of an InfoQ story that had fetched
perfectly well:

> **Only 561 words came back from a page the archive read as 3,769** — it is
> probably behind a wall now.
> *This is the stored summary, not the article.*
>
> InfoQ Homepage News Google Cloud Launches AI-powered Agents to Simplify
> Database Lifecycle Management Cloud ... Aug 27, 2026 1 min read by Sergio De
> Simone Follow us on Youtube232K Followers Linkedin26K Followers InstagramNew
> RSS19K Readers X57.1k Followers Facebook21K Likes BlueskyNew

One screenshot, two independent defects. The banner is wrong, and the text
underneath it is wrong, and neither causes the other.

### The vote can only ever grow

Counting prose instead of total text fixed which *candidate* wins. It could not
fix the shape of the vote, which is a **total** - and a parent contains
everything its children contain, so an ancestor scores at least as much as the
article inside it, every time.

The only thing pushing back is the link penalty. That is why this survived: on
most sites the chrome **is** links, the penalty pays for the extra text, and the
article wins by accident rather than on purpose. InfoQ's chrome is prose - a
byline, a conference promo, "Related Sponsors" and a paragraph of sponsor copy -
and prose pays nothing. So `div.infoq`, the entire page, beat
`div.article__data`, the article.

The penalty was not merely insufficient here, it was **backwards**: the
follower counts and the related headlines are links, so the furniture discounted
itself, while the article body - which cites its sources - paid full price for
doing so.

### Walking down, and knowing when to stop

`narrowToArticle` walks **down** from the winner while one child still holds most
of the prose. Descent stops where the prose splits between siblings, which is
where the article ends and the furniture begins:

```
div.infoq            6,255  ->  main                    0.96
...                             (four wrappers at 1.00)
div.article__main    5,712  ->  div.article__content    0.64
div.article__content 3,680  ->  div.article__data       0.86
div.article__data    3,168  ->  blockquote              0.14   stop
```

A share, not a score. *"Most of this element's prose is in one place"* is a fact
about distribution, and no amount of tuning a total can express it.

Two guards, both of which were **found by measurement, not by thinking about
it**:

**Words, not characters.** Ruby 3.2.11 collapsed from 278 words to 68. Its
download block is a list of SHA-256 digests, and a digest is sixty-four
characters of one word, so under a character measure the hashes outweighed the
release notes three to one and the walk went straight into them. Counting words
prices a digest at what it is worth to a reader, which is about the same as
"the".

**Stop at an element that owns its own paragraphs.** A share alone follows a long
table down and abandons the announcement above it - Debian 13.5 lost its release
notes to its own package table, Node.js 25.4.0 lost "Notable Changes" to its
commit list. The walk now stops the moment an element holds 40 words of prose
directly: an element with its own paragraphs is a body, not the box a body came
in. Forty is measured - at 25 the guard fires on InfoQ's own wrapper and the bug
survives.

### 89 pages, one per host, old container against new

| | |
| --- | --- |
| pages measured | **89** |
| changed | 67 |
| lost article text | **0** |
| InfoQ | chrome → *"Google Cloud has introduced AI-powered Database Operations Agents..."* |
| Red Hat | 5,123 → **1,233** words; title, share widgets and the whole site footer gone, article intact head to tail |
| Ruby, Netlify | now **end** on the article's last paragraph instead of a related-posts rail |
| Apple | press release stops being counted twice |
| Debian, Node.js | untouched |

### The share is a tuned constant in a six-point window

It shipped at 0.6, and 0.6 was wrong. The repair pass wrote its output to 1,216
rows and one of them came back as somebody's comment:

> Bright8192 Feb 20 Big congrats to GGML and Hugging Face! Great news for the
> Local AI community…

stored as the summary of `huggingface.co/blog/ggml-joins-hf`. On a **short post
with a busy discussion the comments hold more prose than the article**, so the
walk descended into them and left the post behind. Measured, as the tightest
step each page needs or must be denied:

| | | |
| --- | --- | --- |
| must descend | InfoQ | 0.85 |
| | archlinux, Ruby | 0.75 |
| | Cointelegraph | 0.72 |
| **0.70** | | |
| must **not** | Hugging Face | 0.66 |

There is no structural tell to lean on instead. The comment container is
Tailwind utilities with no class worth matching, and the obvious idea - *the
article is the part holding the `<h1>`* - is **false on exactly the pages this
exists to fix**: InfoQ and Cointelegraph both put the headline in a *sibling* of
the body, so that guard blocked both. Tried, measured, discarded.

The limit this leaves, stated exactly: a discussion at 0.66 no longer **wins**,
but it still **blocks**. No child clears the share, so the walk stops at the
wrapper holding nav, article and comments together, and a Hugging Face post
keeps its *"Back to Articles"* prefix — which is what it did before any of this.
Nothing regressed there; nothing improved either. Past 0.7 the thread wins
outright again.

Both walls are held by `tests/extract-container.test.ts`, so moving the number
means answering them.

### A price ticker is not four hundred articles

Reported 2026-08-30 against a Decrypt story about Polygon patching security
flaws. What came back was the site's price bar — *"BTC $77,915.00 ETH $2,422.00
BNB $685.05 XRP $1.36…"* — for the length of the page.

Decrypt marks **every entry in that bar as its own `<article>`**, so the
semantic selector matched hundreds of them, and the per-block bonus did the
rest:

| | blocks | prose chars | blocks ≥ 40 chars | score |
| --- | --- | --- | --- | --- |
| the ticker | 497 | 2,975 | **0** | **13,945** |
| the article | 13 | 2,362 | 11 | 2,524 |

`"BTC$77,828.00-0.28%"` is nineteen characters. Four hundred and ninety-seven of
them collect 12,425 points of `blocks × 25` — a bonus meant to reward genuinely
dense structure, which instead handed a scrolling price bar **five times** the
score of the article beneath it.

**A block too short to be a sentence is a label, and labels are not prose.**
Both the characters and the count now come only from blocks of 40+ characters,
which prices a ticker at what it is worth. Forty because of LWN: *"Security
updates for Thursday"* is a table whose rows read `AlmaLinux ALSA-2026:60215 9
assertj-core 2026-08-27` — about fifty characters. The floor has to sit under a
table row that is genuinely the content and over a price chip that never is.

### How this one got past the last check

The 89-page sweep two days earlier had **verified that no page lost article
text**. It had not verified that every page *gained* it. Decrypt was broken
before and after at a ratio of 1.00, so it sat in the "unchanged" column and was
never read.

The re-check reads the first seventy characters of **every** page rather than
only the ones whose size moved. That also caught a regression the sentence floor
introduced on its own: `div.article__main` on a *different* InfoQ story owns 43
words of byline and follower counts directly, which cleared the 40-word floor
and stopped the walk on top of the furniture. The floor moves to **60** — of 89
pages exactly two are sensitive to it, both want 60 or more, and Debian and
Node.js are unmoved anywhere between 40 and 120.

Six of 89 still lead with chrome: The Register (`MOST POPULAR`), WordPress.com
(`POSTED BY … RELATED READING`), Angular's Medium wrapper, and Notion and
Stripe, whose pages carry no article in the HTML at all.

### The way back is not part of the way in

Two of those six were the same shape, and the audit after the sweep is what
showed it: `← Back to News page` (Zig, 74 rows) and `Back to Articles` (Hugging
Face, 72 rows) — **both still arriving in new rows after the container work was
finished**. Both sit *inside* the element holding the article, so no container
choice can leave them behind.

That is what `FURNITURE` is for, and the destination list is closed on purpose:
a whole block reading *"back to basics"* is a heading somebody wrote, and one
reading *"back to the news page"* is a link out. Naming the eight places a site
links back **to** is what keeps those apart. Both tested, in both directions.


---

## word_count was never words

The banner in that same screenshot is a unit conversion that was never done.

`stories.word_count` has held `bodyText.length` since migration 0005 -
**characters** - and the name said otherwise for sixty-two migrations. Nothing
inside the collector minded, because everything reading it compares one row
against another and the unit cancels. `depthScore` normalises by 12,000, which
is a sensible number of characters and an absurd number of words, and it has
been quietly correct the whole time.

The reading page is where it stopped cancelling:

```ts
if (archived >= 300 && readable.words < archived * 0.25)
```

**561 words and 3,769 characters are the same text.** English runs about six
characters to the word, so `words < chars × 0.25` is true of essentially every
article ever collected. The reading page had been refusing to show pages it had
successfully fetched, falling back to the stored summary, and blaming a wall -
for **every article long enough to be worth reading**. What looked like a
heuristic tuned too tight was arithmetic against the wrong unit.

Renamed rather than converted (migration 0067). Converting would need every row
re-fetched to be counted honestly, and would silently change what `depthScore`
means. The rename keeps every stored number exactly as true as it was and makes
the name agree with it. The floor moves 300 → 1,800 for the same reason: it was
written to mean *"about three hundred words of archived reading"*, and three
hundred words is eighteen hundred characters. The bar has not moved, only its
unit.

### Repairing what was already stored

`npm run refit` re-extracts the rows the old container broke. It **only rewrites
a row it can prove it wrote**: the page is fetched once, and the stored summary
is checked against *every* element on the walk from the whole-page winner down
to the article. If any of them reproduces what is stored, the row is our
handwriting. That is the proof it came from here rather than from a feed that
supplied its own description.

The whole chain rather than just the old container, because this script has now
written two generations of summary — and matching only the old one would have
left it unable to correct its own mistake, which is not a property a repair
should have.

### Two ways a row can be proved ours, because one was not enough

"Only rewrite what you can prove you wrote" is the right instinct and it failed
twice on the same ten rows — the Decrypt price-ticker summaries, the exact thing
the pass had been pointed at.

**A ticker is live data.** The stored summary was
`BTC$78,480.000.37%ETH$2,471.33…` and the page serves different prices every
minute, so an exact comparison can never match. The match now runs with the
digits removed from both sides: two texts identical but for their numbers came
off the same element, and ninety characters of that is not a coincidence
anything else produces.

**And the scorer had moved.** `walk()` starts from whatever `pickContainer`
picks *today*, so it reproduces the old container's output only while the vote
still reaches the same element. The sentence floor changed that vote — the
ticker no longer wins, so the walk starts at the article and never passes
through the ticker at all. Provenance by replay has a horizon, and a scoring
change is where it ends.

So there is a second, weaker claim: **a summary that is not language, replaced
by an extraction that is.** Letters and spaces over everything — the ticker
scores 0.2, English runs above 0.9, and no feed description a publisher wrote by
hand lands below 0.6. It is a weaker claim than *we wrote this* and a stronger
one than *this is better*, and it is the only one available for a row whose
original cannot be reconstructed.

Four of the ten Decrypt rows were rewritten on that basis. The other six were
left alone: their summaries are real prose from the feed, which is exactly what
the guard exists to protect.

**And a third, when a furniture rule moves the horizon again.** Stripping
`← Back to News page` before scoring has the same effect on provenance that
changing the scorer did: no element on the walk can reproduce a summary that
still contains it. Zig's 74 rows came back "not ours" for a rule written the
same afternoon to remove that exact block — and the not-language test does not
save them either, because they *are* language with a nav link on the front.

What can still be shown is the relationship between the two texts: if today's
extraction appears inside the stored summary a short way in, the stored summary
is this extraction with something in front of it — and something in front of an
article, in under sixty characters, is furniture. Zig's prefix is twenty
characters, Hugging Face's seventeen.

`npm run refit -- --like 'Back to Articles%'` exists because of the same
horizon. Seventy-two rows still opened with that phrase after a pass had already
fetched all 1,893 Hugging Face stories — they were left behind because the rule
that recognises them was written afterwards. Re-crawling 1,893 pages to reach 72
of them is not politeness, it is waste, so a known-bad shape can now be repaired
wherever it lives without touching the host it lives on.

Three passes, three ways the horizon moved. The pattern is worth stating on its
own: **every improvement to extraction makes the output it replaces harder to
recognise**, so a repair that can only match its own exact past output gets
weaker precisely as the thing it repairs gets better.

It also sleeps on **every** request rather than only on the ones that turn into
a write. The first version did the latter, so a publisher whose rows mostly
needed no change was asked as fast as the loop could go; Hugging Face answered
the way anyone would, and **205 of 322 rows came back refused** and were filed
as "unreachable". A transient throttle read as a permanent absence. A 429 is a
publisher asking for a slower pace, so the sweep now takes one, waits, and asks
once more before giving up on a row.

Where the page has changed since collection, where the publisher now refuses us,
or where the re-extraction is no better, the row is left exactly as it is. The
asymmetry is deliberate: a summary is the only description most stories ever
get, and this script cannot tell a good one it did not write from a bad one it
did - so it is allowed to recognise its own handwriting and nothing else.

---

## The report had no way in, and then it had too much of one

Asked for on 2026-08-30: *"for /field/security/report create menu"*, and then,
looking at the result: *"Move this page to in explorer pages. this page isn't
enough to be individual menu"*.

`/field/<slug>/report` had existed for a week and was reachable from exactly one
place — a button most of the way down `/field/<slug>`. **The only route to the
summary ran through the raw list it was written to replace.** That is a fair
description of not shipping it: the request was *"I don't want raw news, this
make noise, i want report that summarize related news"*, and a page you can only
reach by first reading the noise does not answer it.

The first fix gave it a tab of its own, and that was too much. A section earns
its place in the top bar by having a rail worth opening, and this one's rail was
fourteen links to fourteen reports — nothing but the index it duplicates, taking
a slot beside News and Stacks to say the same names twice.

So: **one entry in Explore, beside Fields.** The index at `/reports` is the
menu — one card per field. It carried two numbers at first: how much arrived in
the period, and whether that was more or less than the period before. Both were
retired on 2026-09-01 (**Counting our own stories was the fake measurement**),
and the card now leads with what the briefing actually **found**, which is an
answer to the question a reader has. A quiet field keeps its card, because "too
little text to read" is a true answer and a menu that changes shape week to week
is not a menu.

### The distinction a prefix cannot make

Every report lives at `/field/<slug>/report` — *underneath* the entry that owns
the field rivers. A prefix rule cannot separate them, so both entries light, or
the wrong one does. `isOn` takes a suffix rule (`*/report`) for the Reports
entry, and stops prefix rules claiming report paths from the other side.

The breadcrumb moved with it, twice. It read *"Explore / Fields / Security"*
when the page belonged to Reports, then *"Reports / Security"* when Reports
stopped being a section. It now reads **"Explore / Reports / AI & ML"**, which
is where the page actually is. A breadcrumb that names a section the top bar
does not have is worse than none, because it is a claim about where you are.

`tests/reports-menu.test.ts` holds both halves: that a report is reachable
without reading the river first, and that the navigation agrees with itself. It
also covers the failure that would be silent — `sectionFor` returns News for
anything unclaimed, so a broken rule shows up as the wrong tab rather than an
error.

---

## The source list changes itself

Asked for on 2026-08-31, after a list of publishers: *"I don't want to get news
from fixed sources, the source list have to be change to get good news"*.

Of the six named, one was already held (The New Stack). Two were on the
off-topic host list (`cnet.com`, `hackaday.com`). The other three were not in
the registry — and putting them through the gauntlet produced the finding this
whole section rests on.

### The gauntlet is not enough to admit a source unattended

| | | |
| --- | --- | --- |
| howtogeek.com | **10 of 10 kept** | *"A $25 power bank is all you need to stay online during a power outage"* |
| thenextweb.com | **8 of 10 kept** | *"Pinterest CFO Julia Donnelly is leaving to join an early-stage company"* |

Both clear every filter the archive has. Neither belongs in an archive of what
happens to stacks, tools and platforms. **What keeps them out today is a
blocklist of hosts and the fact that nobody added them** — and a blocklist is
not a rule, it is a memory of every mistake made so far. That is exactly the
wrong foundation for a loop that adds sources while nobody is watching.

The obvious measure does not separate them either. Share of kept items naming a
technology or reading like engineering: HowToGeek **70%**, The Next Web **88%**,
against vLLM's 93% and PyTorch's 100%. A threshold in that gap is a coin toss
wearing a number.

### What does separate them

**Does this domain own something the archive already tracks?** pytorch.org is
the home of a stack, snowflake.com of a platform and a company, modal.com and
ollama.com of platforms. howtogeek.com, thenextweb.com, hackaday.com and
cnet.com are the homes of nothing — they write about other people's work.

That test is high-precision and low-recall: it also fails vLLM, LangChain and
Qdrant, which *are* first parties whose `homepage_url` the vocabulary happens
not to record. **For a loop running unattended, that is the right way round.**

### The half that already existed

Every kept story has been contributing its outbound domains to
`source_candidates` for months — 3,113 of them by the time this was written —
and the table carries `evaluated_at`, `verdict` and `promoted_source_id` columns
for a promotion pass described in a comment as *"a separate weekly model pass"*
and never written. The archive had been watching where its sources point and
doing nothing with the answer.

The `sources` job is that pass, and it is not a model pass:

| step | |
| --- | --- |
| take | up to 8 unevaluated domains with **3+ distinct referring sources** — one source linking somewhere repeatedly is a habit, three unrelated ones is a signal |
| find | the feed it advertises, else twenty guessed paths |
| audition | every recent item through the whole gauntlet, judged as **CONTENT, never PRIMARY** — nothing is known about a domain merely found in a link |
| promote | only if it clears the bar **and** owns something the archive tracks |
| defer | everything else that reads well, with its numbers, for a person |

`deferred` is the schema's own word and it already meant the right thing: not
refused, not accepted, waiting on a judgement the job is not entitled to make.

**It only ever adds.** Nothing pauses, retires or deletes — *"don't remove
anyone anymore"* is a standing instruction, and a loop that pruned what it
judged quiet would break it every night with nobody watching. A source that goes
silent stays in the registry and shows as silent.
`tests/sources-loop.test.ts` holds that as a property of the file, not of a
code path: no `UPDATE sources`, no `DELETE`, no `health = 'paused'`.

### The link graph was the wrong place to look

Thirty-two domains examined across two runs. **Nothing promoted. Nothing even
deferred.** github.io, youtube.com, wikipedia.org, apache.org, google.com,
microsoft.com, npmjs.com, arxiv.org, pypi.org, rfc-editor.org — infrastructure
that everything links to, publishing nothing worth polling. Anthropic and
claude.com appeared and were rejected honestly: they advertise no feed.

That is not the loop failing, it is the channel being wrong for the question.
**Vendor blogs link to docs, repositories, standards and social.** Outbound
links are good at discovering *things the archive should track*; they are poor
at discovering *sources*.

### The second channel, which is the one that pays

The opposite question: **the archive tracks 860 stacks and 151 platforms whose
own domain it does not poll at all.**

| mentions | tracked thing | polled? |
| --- | --- | --- |
| 6,246 | Anthropic Claude | no |
| 2,716 | OpenAI (chatgpt.com) | no |
| 1,597 | Model Context Protocol | no |
| 1,019 | Git | no |
| 743 | AT Protocol | no |
| 479 | React | no |

Every candidate here is a first party **by construction** — it *is* the
vocabulary entry — so the test phase one has to prove is satisfied before it
starts, and PRIMARY is earned rather than assumed. Ranked by how often the
archive actually mentions the thing, so the ones that matter are tried first.

The first run examined 20 and promoted 4: **Open Source** (9 of 10 kept),
**C++** (10 of 12), **AT Protocol** (7 of 8) and **Markdown** (6 of 12).
Thirteen publish no discoverable feed at their own domain — Anthropic, OpenAI,
Model Context Protocol, Git, Go, TypeScript, Android — which is now the
channel's binding constraint, not quality.

### By construction was an assumption

The Markdown promotion was wrong, and it was caught within the hour by the
person reading the output: *"'I'm the Guy Who Destroys Antique Books After We
Scan Them Into Our Company's Insatiable AI Platform' — it is unnecessary
news."*

daringfireball.net **is** the home of Markdown. It is also a linkblog. Twenty
stories arrived from it in an hour and eleven were somebody else's page: a
McSweeney's satire, American cheese, a screen-saver revival, a Trump story, a
sponsor ad. The channel had granted it PRIMARY — *the flag that relaxes the
topic filter* — on the reasoning that a domain which is the vocabulary entry
must be writing about its own work.

The bad instinct was to reach for the homepage: *does the link match the site we
registered?* That question scores **Stripe Engineering 0%**, because Stripe is
registered under stripe.com and publishes on stripe.dev. It is the wrong
question. The right one needs no homepage at all:

> **Do the links agree with each other?**

A publisher's items all land on one domain, whichever domain that is. Measured
across the whole registry over 120 days:

| distinct link domains ÷ stories | source |
| --- | --- |
| 55% (11 domains / 20 stories) | Markdown *(the bad promotion)* |
| 1.8% (5 / 283) | Google DeepMind — five Google properties |
| 0.5% (2 / 439) | Notion — notion.so and notion.com |
| one domain | the other **100 of 103** sources |

`SCATTER_CAP` goes in that gap at **one third**. Re-run live against the four
promotions, the separation is not subtle: Daring Fireball **83%** across ten
domains, isocpp 8%, opensource.org 10%, atproto 13%.

Two guards protect the honest end, because the ratio alone is unfair to small
feeds. Scatter is distinct domains over items, so a perfectly good first party
with **two** recent posts scores 50% on its own single domain. Under six items
the question is not asked, and one or two domains is a company with properties
rather than a linkblog. The case this exists to catch had ten domains in twelve
items.

The check runs **before** the keep count in both channels, which is the part
worth remembering: a linkblog scores *well*. It is recommending things worth
reading, so the gauntlet likes it. Daring Fireball kept 6 of 12 and cleared
every bar the archive had.

That count is honest only because the comparison was fixed: matching full
hostnames reported `www.rust-lang.org` as unpolled while `blog.rust-lang.org`
was being read every fifteen minutes. Comparing registrable domains took the gap
from 1,121 to **1,011** and stops the loop wasting a run on a source already
held. A homepage and a blog can still be different domains — typescriptlang.org
is the home of a stack whose posts arrive from devblogs.microsoft.com — so a
discovered feed that is already polled is refused by URL as well.

---

## Three stories in a day

Reported 2026-08-31: *"why does news count is only 3 in a day, also 3 isn't
fixed value but it is very small"*, and then: *"In AI field, there are many
news, so we have to find proper sources, the rule that have to avoid noise is
stable"*.

Both observations were right, and they had different causes.

### The number was innocent

Stories per day of week, published in the last twelve months:

| Tue | Thu | Wed | Mon | Fri | **Sat** | **Sun** |
| --- | --- | --- | --- | --- | --- | --- |
| ~48 | ~46 | ~42 | ~31 | ~29 | **~3** | **~2** |

2026-08-29 was a Saturday (7) and 08-30 a Sunday (6); the Sunday before was 3.
Vendor changelogs and engineering blogs publish on weekdays, in US hours — the
publication peak is 13:00–20:00 UTC, and the question arrived at 10:47.

**Nothing was being dropped.** The live feeds of AWS, Cloudflare, Vercel and
OpenAI were put through the whole gauntlet: every item published in the last
three days was already held. 97 sources polled every fifteen minutes, 8,895
items kept in 24 hours, almost all of it backfill of older posts.

### The ceiling was not

97 healthy sources and **six of them AI-native** — OpenAI's blog and changelog,
DeepMind, Hugging Face, Mistral, NVIDIA's developer blog. The busiest subject in
the archive was covered by six percent of it.

`npm run audition` settles that by measurement. It discovers each candidate's
feed (asks the page for `rel=alternate`, then probes twenty paths), and runs
every item through the gauntlet **ingest** runs, in ingest's order, calling the
same functions. Nothing is relaxed for a candidate — the point is to find
sources the existing rules can already read, which is the whole of *"the rule
that avoids noise is stable"*.

### The harness was wrong first, and its answer was inverted

The first run judged each item on the feed body alone:

```
0/142  OpenAI research    too_short 104
0/100  LangChain blog     too_short 73
0/33   vLLM blog          too_short 32
```

Most feeds carry one line of description, and **ingest fetches the article when
the feed body is short**. With that step restored, vLLM scored **29 of 30** and
LangChain **22 of 30**. A lazy harness does not produce a slightly pessimistic
number — it produces a confident rejection of sources that work.

Two smaller faults from the same run: items with no date were silently dropped
though ingest keeps them, and a feed was recognised by file extension, so
`simonwillison.net/atom/everything/` came back "no feed" after being downloaded
and parsed successfully.

### 63 auditioned, 26 added

| | |
| --- | --- |
| highest rate | vLLM **29/30**, MotherDuck 24/27, Google Research 24/26, Together AI 24/25 |
| every item kept | Modal 18/18, Lambda 10/10, PyTorch 10/10, Ollama 8/8 |
| added | 26 sources, **~391 items per 90 days** — a floor, since the audition samples 30 per feed and nine returned everything they carry |
| registry | 97 → **123 healthy** |

Refusals are recorded with their numbers in `seeds/ai.ts` so they are not
re-litigated. Ars Technica 0 of 20, MIT Technology Review 0 of 10, Import AI
0 of 11 — all refused as articles, which is the event test doing its job on a
magazine. Qwen offered 44 items and **none in the last 90 days**, the exact trap
the 90-day rule exists for.

**Twenty-four candidates have no feed at all** — Anthropic, AI at Meta, Cohere,
Groq, DeepSeek, Fireworks, Cerebras, LlamaIndex, ElevenLabs, Weights & Biases
among them. Probed for `rel=alternate`, then twenty paths, then by hand: 404.
Two answered with an *empty* feed, which is worse than none because it looks
like a working source. These are the biggest names on the list and a feed reader
cannot reach them; they would need a page watcher.

One judgement call is left for a person rather than seeded: simonwillison.net
keeps **20 of 30**, a higher event rate than most first-party vendor blogs here.
A personal link blog scoring like a release feed says as much about the event
classifier as about the blog.

---

## A field, explained instead of listed

Asked for on 2026-08-29: *"I don't want raw news, this make noise, i want report
that summarize related news"*, then *"report that explain about a field by
summarizing related news"*.

The noise was real and countable. `/field/<slug>` is a river - newest first,
thirty rows deep - and on the day it was asked for, the Solana feed alone had
contributed nine changes and three releases while BitMEX contributed eleven
near-identical delistings. Twenty-three rows. Two facts.

`/field/<slug>/report` answers a different question: not *what arrived* but
*what happened*. The same stories, grouped by the technology they are about,
counted by event class, and stated in a sentence:

> **354 stories** in AI & ML over the last 30 days, up 88% on the 30 days before
> it - one market move, 51 launches, 71 releases, 197 changes and 34 pieces of
> writing, from 51 sources.
>
> **AI Agents** · 56 - 2 launches, 8 releases, 39 changes and 7 pieces of
> writing, from 19 sources.

### Grouped by tag, not by cluster

Three things in this schema could mean "related": `story_members` (the same
event reported by several outlets), `simhash` (near-duplicate text) and the
stack tags. The first two group **duplicates**, which the collector already
merges. What a reader wants grouped is *different* stories about the same thing,
and that is the tag.

`from a single source` is printed next to every group on purpose. Nine changes
from one outlet is a changelog; nine from six outlets is a story, and the
sentence should not let them look alike.

### Written from counts, not by a model

There is an LLM router here with budgets and a cache, and it would produce
better prose. It could also say things the archive cannot support, and this
page's entire value is that **every sentence in it is a number a reader can
click through to**. A summary that might be wrong is worse than a list, because
a list is honest about being a list.

Three claims the page refuses to make, each held by a test:

| refusal | why |
| --- | --- |
| no percentage when the prior period had fewer than 5 | "up 400%" from one story to five is arithmetic, not a trend |
| groups are "mentions across" rather than "N of them" | the groups overlap, so their sum exceeded the total - it said *487 of 354* |
| a short report says it may be the registry's fault | a field with no sources covering it is a coverage statement, not a finding |

---

## The sources that made the money lanes non-empty

Before 2026-08-29 the archive held 86 sources, every one an engineering blog or
a release feed. The consequence was arithmetic, not opinion: **3 market events,
3 funding-shaped titles, and 1 story naming any earning platform**, in the whole
archive. The lanes were not badly tuned. They were empty.

Eleven sources added (`npm run seed:money`), auditioned live **with the
speculation gate in force** - which is the only reason a crypto outlet can be in
the registry at all. The filtering is visible in the numbers:

| source | kept | offered |
| --- | --- | --- |
| Kraken Blog | 9 | 10 |
| Solana News | 9 | 20 |
| Tech.eu | 6 | 20 |
| Decrypt | 5 | 57 |
| Cointelegraph | 2 | 30 |
| The Block *(refused)* | 1 | 19 |

A crypto outlet is mostly price talk and the gate removes it. What survives
Cointelegraph is "Capital B raises $24.5M" and "BitGo buys NYDIG trading arm".

**Within an hour: 52 stories collected, and market events went from 3 to 8.**
The AI report's Money section now leads with *"Stability AI raises $76M, with
Warner and Sony investing"*.

### The number that decides it is the last 90 days

The correction that mattered most here, and it was nearly missed. With
`RETENTION_KEEP_MONTHS=0` the audition's "in window" silently became "everything
the feed carries", and several of these feeds carry their entire archive:

```
blog.ethereum.org   100 all-time,  3 in the last 90 days   (636 offered)
akash.network        40 all-time,  1 in the last 90 days
buttondown.com       22 all-time,  1 in the last 90 days
vitalik.eth.limo      9 all-time,  0 in the last 90 days
```

Ranked on lifetime output the Ethereum Foundation blog was the strongest
candidate offered, **at 33x its real rate**, and Akash and Buttondown would have
been admitted as producers on posts from years ago. A retention setting changed
what an unrelated measurement meant. Every number in `seeds/money.ts` is the
90-day one, and `offered` sits next to `kept` because a floor of 3 punishes a
publisher that only exposes ten items - Crunchbase News keeps 2 of 10 and is a
better bet than a 600-item archive feed yielding 3.

---

## The gate that had to exist before the sources did

The archive's second and third targets - market moves, and platforms a person
can earn from - are covered by a press that is mostly speculation. Before
pointing any source at that beat, the filter was measured against it. It was
exactly backwards:

| headline | before |
| --- | --- |
| `Top 10 best crypto to buy now before they explode` | **kept**, as `market` |
| `Bitcoin price prediction: BTC could hit $200,000` | **kept**, as `change` |
| `Binance adds USDC staking with 8% APY` | dropped |
| `Uniswap v5 launches on mainnet with hooks` | dropped |
| `Ethereum Foundation ships Fusaka upgrade to mainnet` | dropped |
| `YouTube raises creator revenue share on Shorts` | dropped |

Adding the sources first would have filled the archive with the worst writing on
the internet and left somebody to discover it afterwards. So the gate came
first. Across the thirteen real announcements and four pieces of noise it was
measured on: **5 of 13 kept and 2 of 4 refused, before. 13 of 13 and 4 of 4,
after.**

### Three parts, and each alone is worse than none

**A `speculation` rule at `rescue: 'none'`.** Nothing overturns it, because
every price prediction names a technology - that is what it is a prediction
*about* - so a technology signal would undo the rule entirely. It is also one of
the very few rules that runs on FIRST PARTIES: an exchange forecasting its own
token is not a vendor announcing a product, it is the thing the rule is for.

**Evidence for the earning beat.** `isTechnicalTitle` returned false for
"Binance adds USDC staking with 8% APY", so it died before its event class was
ever consulted. `EARN_PHRASES` adds the mechanics of being paid - staking,
validators, mainnet, revenue share, payouts, reward structures - spliced into
`TECH_PHRASES` because there is exactly one question being asked and two
functions answering it would drift.

**Earning verbs in the event grammar.** `CHANGE` matched `adds <word>
support|api|backend|driver|integration|mode`: a closed list of nouns predating
this target, with no way to be paid in it. `raises` reached `MARKET` only with a
currency figure after it, and a revenue share is a percentage. `EARN` fills that
gap and files as `change`, not as a new event kind - "Binance adds USDC staking"
is Binance changing, and inventing a kind would mean a migration, a filter and a
fifth word for a reader to hold, to say what `change` already says.

### The first draft cost three real stories

Replayed over the 2,616 stories the archive already held:

```
Moonshot AI Kimi K2.7 Code now available on Workers AI      <- "moonshot"
Training 100x Cheaper Retrieval models                      <- "100x"
Azure Databricks Runtime 10.4 LTS will reach end of life    <- "will reach"
```

An end-of-life notice is among the most useful items here, and it is written
with the same verb as a forecast. A forecast now needs a **figure**; `100x`
needs to be about gains rather than throughput; and `Moonshot AI` is an
exception, because the genre and the company share a word.

**A price is `\d[\d,.]*` and never a bare `\d`.** Written the short way, the
trailing boundary group lands on the SECOND digit of `$500` and the pattern
never fires - which is how `Solana could hit $500 this cycle` survived the first
fix. The commerce rule records this exact bug from the first time it was made.
This is the second.

The final rule costs **zero** of the 2,616, and refuses 10 of 10 in a wider
speculation sample. `tests/speculation.test.ts` holds both halves, because a
gate with no evidence rule refuses the announcements too, and an evidence rule
with no gate lets the pump in.

---

## The platform registry grew, and growing it changed nothing yet

Asked for directly: *"why you don't increase platform's list"*. Fair - the
registry went from **114 platforms to 190**, and six new channels came with it:
crypto exchanges, chains, DeFi, DePIN, web3 infrastructure and NFT markets.
Crypto is first because the instruction put it first: *"if the user can get
crypto, it is high order"*.

Nine channels that were already in the database - freelance, bounty, creator,
content, digital-goods, education, stock, affiliate, compute - were **missing
from `CHANNELS` in `seeds/platforms.ts`**, so every row carrying one rendered on
`/platforms` as "unclassified". They have labels now.

Identity only, still. Not one APY, fee, payout threshold or minimum is written
in that file. Those are the numbers that go stale fastest in this category, and
`platform_facts` exists precisely so a fact carries a source URL and a validity
window instead of being typed into a seed.

### Adding the rows measured the problem instead of fixing it

The header of `seeds/platforms.ts` records why the earning platforms were
retired the first time: fifty-six rows, and not one tagged on a single collected
story. That diagnosis was right and the conclusion was half of one - **the rows
were never the problem, the sources were.** Adding 76 more proved it. After
re-tagging all 2,618 stories against the new registry:

| | |
| --- | --- |
| stories that gained a crypto tag | **22** |
| of those, correct | **0** |

Every one was false, and the failure is worth keeping:

```
7  cosmos    Azure Cosmos DB, NVIDIA Cosmos-H-Dreams, Cosmos3-Nano
6  gate-io   Release Notes for Safari Technology Preview 246-251
1  coinbase  "Your guide to GitHub Universe 2026"
```

### The capital rule stops ordinary words, not other proper nouns

`detectPlatforms` already demands the name exactly as the platform writes it,
capital included, because half this registry is also an ordinary word - Arc,
Impact, Maven, Ghost, Medium, Contra, Polar. That rule works. It does nothing
when the capitalised word is a **different proper noun**, and "Cosmos" is Azure
Cosmos DB far more often than it is the Cosmos Hub.

Crypto names ordinary English words on purpose, so this registry is unusually
full of the failure: Base, Curve, Compound, Foundation, Sky, Avalanche, Polygon,
Optimism, Grass, Blur, Jupiter, Helium, Gate, Cantina, Sherlock, Cosmos.

`AMBIGUOUS` in `seeds/platforms.ts` holds them out of name matching entirely.
They keep their row and their identity and wait for a signal stronger than a
word - a ticker, a domain, a linked announcement - rather than being tagged on a
coincidence in the meantime. **Over-tagging is worse than under-tagging**, which
that file already said and which decides it: a page listing every story
containing "compound" is not a page about Compound.

The 13 false tags were removed and every story re-offered to the corrected
vocabulary. What survives is **one** crypto tag - Coinbase, named in a GitHub
Universe post - and that is the honest state: 190 platforms, and almost nothing
in the archive to measure them with.

### The earning platforms came back

Forty-nine rows were sitting `retired_at IS NOT NULL` — Upwork, Fiverr, Toptal,
Patreon, Substack, Gumroad, HackerOne, YouTube, Twitch and the rest — invisible
on the page and excluded from tagging, retired by the decision the file header
records. The instruction of 2026-08-29 asks for exactly them, so they are back.
Nineteen already carried rollup history, which is the plainest evidence the
retirement was a source problem misread as a registry problem.

`/platforms` now shows **21 channels** rather than six.

### The capital rule does not work on a headline

Bringing them back reproduced the failure the file header predicted, and
explained why the existing defence never worked:

```
ghost   "Every UPDATE Leaves a Ghost: MVCC, Bloat, and VACUUM in PostgreSQL"
ghost   "WAF - WAF Release - 2026-06-15"
impact  "We're launching the Google DeepMind Accelerator program ..."
```

`detectPlatforms` demands the name with its capital, on the theory that a proper
noun is capitalised and an ordinary word is not. **That holds in body prose and
collapses in a title, because titles are Title Case and capitalise every word in
them** — and a title is what this archive matches on. A Postgres MVCC tuple is
not the Ghost CMS.

The header had already named this exact list — Arc, Impact, Maven, Ghost,
Medium, Contra, Polar — as the reason for the capital rule. The rule was the
wrong remedy. Holding them out of name matching is the right one, and they join
`AMBIGUOUS` alongside the crypto names.

### Searching the registry

At 190 rows the page had no way to look anything up: a reader who knew the name
still had to pick a channel tab and scroll. There is a search box now, on `sq` —
the same parameter Stacks, Sources and the Registry use, deliberately not `q`,
which is the masthead's archive-wide search and must not fight it for a box.

It matches **name, slug and address**, because a person looking for a platform
often knows the domain and not the brand: `avax` finds Avalanche and `jup.ag`
finds Jupiter, and neither string is in either name. It does **not** match the
blurb — those come from Wikidata and are written to disambiguate an item in a
list, so nearly every one contains "platform", "service" or "software", and
searching them returns the whole registry for a term that felt specific.

A search keeps the channel you are standing in, which means searching for
Coinbase inside *App and extension stores* finds nothing while the registry
plainly has it. The empty state says so and links to **Search every channel** —
offered only when a channel is actually narrowing the result, because there is
nowhere to send a reader whose term matches nothing anywhere.

### So the list was never the bottleneck

`platform_month` - stories, distinct sources and share per platform per month -
already is the activity metric the brief describes, and it was built before the
brief existed. It needs something to count. The archive holds 86 sources, all
engineering blogs and release feeds, and **not one of them covers crypto,
funding or earning**. Until that changes, a bigger registry produces a longer
page of zeroes.

---

## Nothing is deleted

`RETENTION_KEEP_MONTHS` is **0** since 2026-08-29, on the instruction *"don't
remove anyone anymore"*. Zero is not "no months" — it is **KEEP_FOREVER**, its
own value in `src/lib/retention.ts`, and it is deliberately not a very large
number of months, because a large number still names a date on which something
gets deleted and the instruction was that no such date exists.

Three readers are told what it means in their own terms:

| reader | under KEEP_FOREVER |
| --- | --- |
| `collect/ingest.ts` | nothing is ever too old to accept, at any publication date |
| `maintain/rollup.ts` | **unchanged** — every month before this one still settles into analysis |
| `maintain/retain.ts` | the delete loop does not run, and the log line says so |

One number had to move with it. Both SQL cutoffs subtracted `keepMonths - 1`,
which is **-1** under KEEP_FOREVER - and subtracting a negative interval moves
the boundary *forward* into next month, handing the rollup the month still being
collected into. That is the 0060 bug arriving from the other direction.
`monthOffset()` clamps it at 0, which puts the SQL boundary at the start of this
month and makes it say exactly what `isOpenMonth(m, 0)` says: this month open,
every earlier month free to settle.

The pruner's guard is `for (; !forever;)` rather than a cutoff so old it matches
nothing, because a cutoff that matches nothing today matches something next
month. No month is stamped `pruned_at` when nothing was pruned from it — that
stamp is how the rest of the system learns a month is finished with, and writing
it while deleting nothing is a lie the pruner tells the collector.

**It is also the default.** `num(env, 'RETENTION_KEEP_MONTHS', 0)` — a default
that deletes is the wrong way for this mistake to go, because an archive that
lost a month because nobody set an environment variable cannot get it back.

### What this was three days from doing

The setting was `4`, the archive held May through August, and the `retain` job
runs unattended at **03:40 daily**. On **1 September 2026** the window would have
rolled to June–September and **May's 325 stories would have been deleted by a
scheduled job**, with nobody watching. A prune is the one operation in this
system with no undo. `tests/retention-window.test.ts` holds the rule now.

### The arithmetic, when a window is set

With a positive `RETENTION_KEEP_MONTHS` the cutoff is:

```sql
date_trunc('month', now()) - make_interval(months => keepMonths - 1)
```

With `1`, the cutoff is the **start of the current month** — not thirty days
back. On the 28th that keeps four weeks; on the 1st it keeps a few hours. "One
month of news" was between 1 and 31 days depending on when you asked, and the
thinnest day was the one after a month boundary, when a reader most wants to see
what happened last month. Two makes the shortest possible window a full month
and the longest two. None of this applies while the setting is `0`.

Nothing else about the contract moved: **monthly analysis forever, favourites
exempt, and no story deleted from a month `rollup_log` has not recorded.** The
database still enforces all three as row-level rules rather than as convention.

The sentences that state the window now read it. `/trends` and `/favourites`
render "held for two months" from `getConfig().retention.keepMonths` rather than
from a word typed into a template — a number that appears in prose and in a
config file will disagree with itself the first time one of them changes.

### What "collect a month" can and cannot mean here

Every month before the current one is in `rollup_log` — 161 of them, back to
2010-01 — and a month in that log is closed to ingest by design: its stories
were reduced to analysis and pruned, the history view deliberately skips live
rows inside it to avoid double counting, and the next retention run would delete
them anyway. Three ways of being invisible, for the cost of storing them.

So a backfill cannot repopulate July: the analysis of July's 27,874 stories is
all that survives them, and re-rolling the month to accommodate a few hundred
re-fetched items would replace that analysis with the fragment. What a full
re-read CAN do is take every feed back through the current month with the fixed
pipeline, which is what was run: all 367 sources re-read from scratch with their
conditional-GET state cleared, so anything the entity cap, the length floor or
the rolled-month guard had refused got a second chance.

### The gap in `rollup_log` that let 2006 in

The re-read found the archive reporting its reach as **back to 2006-02-15**, on a
database meant to hold two months.

`already_archived` did not catch those rows and was never going to: it asks
whether a month's *analysis* is settled, and `rollup_log` has gaps — 161 months
between 2010-01 and 2026-08, not the 200 that span implies. A feed carrying its
whole history walks straight through them. What lands is unreachable in both
directions at once: too old to appear in any window a reader can choose, and
**un-prunable**, because retention refuses to delete a story from a month no
rollup has recorded.

So ingest now has a second age rule, `too_old`, measured by the same expression
retention deletes by — `RETENTION_KEEP_MONTHS`, from the start of a calendar
month — so the collector and the pruner cannot disagree about what old means.
Backfill is exempt, for the same reason it is exempt from the archived-month
guard. Confirmed live on the next full re-read of Lua's news feed: 148 items
seen, 142 `already_archived`, **3 `too_old`**, 0 stored.

The 95 rows already holding were cleared the way the contract requires rather
than with a DELETE: `npm run rollup` reduced the 65 orphan months to analysis
first — 79 stories to 63 stack-months, which is now a permanent and honest record
that the archive once saw two stories from February 2006 — and `npm run retain
--keep-months 2 --yes` then pruned them.

```
before   749 stories   oldest 2006-02-15   106 MB
after    605 stories   oldest 2026-07-21    72 MB
```

**Enforcement is still a command you run.** Neither the live collector nor the
Worker cron calls retention, deliberately: an unattended delete of the only copy
of something is not a default anybody should get by accident. The recurring form
is one line — `npm run rollup && npm run retain --yes` — and it is safe to run
daily, because rollup refuses an open month and a pruned one, and retain refuses
any month rollup has not recorded.

### The window was FOUR months, and is now none — superseded 2026-08-29

**This section describes the state before KEEP_FOREVER.** It is kept because the
partition bug it records is still live knowledge. The window is now `0`; see
**Nothing is deleted** above.

`RETENTION_KEEP_MONTHS=4` from 2026-08-28 to 2026-08-29, widened from 2 to
collect May, June, July and August 2026 into one corpus. **This was a working
state, not the contract.** The reason is the open question the archive cannot answer from two
days of its own output: *which filter conditions collect only the news worth
collecting.* Judging `not_an_event`, `too_short` and the topical rules needs a
body of decisions to read — several months of them, kept side by side, refused
items included — rather than whatever happened to arrive this week.

Widening it is one number because of the rule above: the collector, the rollup
and the pruner all read the window from `lib/retention.ts`, so setting it to 4
opens May to ingest, stops the rollup settling it, and stops the pruner deleting
it, in one edit. That is the property the July bug cost a month to buy.

Two things did NOT follow automatically, and both are now fixed:

| | was | now |
|---|---|---|
| `ensure_partitions(1, 3)` | one month back, always | `keepMonths` back — 0062 |
| the running scheduler | holds its config from start-up | restarted; a window change needs one |

The partition one would have been the expensive kind of silent: `stories` is
partitioned by month and a missing partition fails the INSERT rather than
degrading it, so every May story would have been lost to an error nobody was
watching. `stories_2026_05` did not exist and nothing would ever have made it.

**Going back to two months was one edit and one restart**, and the prune that
follows is irreversible — which is why it never happened. The question was
settled the other way on 2026-08-29: the window is gone and nothing is deleted.

The partition lesson survives the change, gets sharper, and was **the third
instance of one shape**: two places that must agree about a range, only one of
which is told when it changes. 0060 was the collector and the pruner. 0062 was
the partition maker and the window. Setting the window to `0` broke it again in
the other direction — `ensure_partitions(0, 3)` builds nothing behind this
month, and a missing partition fails the INSERT rather than degrading it, so the
first story published last month and fetched this month would be lost to an
error nobody watches for.

**Partitions follow what is COLLECTED, not what is KEPT.** They are now
different numbers, read from one place:

```ts
partitionMonthsBack(keepMonths)   // lib/retention.ts — 24 under KEEP_FOREVER
```

Migration `0064_partitions_follow_collection.sql` is the one-time catch-up, and
it is generous on purpose: an unnecessary partition is an empty table, being
wrong the other way costs collected news.

---

## Why the page stopped growing while the archive kept filling

Reported as "the news doesn't increase in real time". The collector was running,
fetching and storing — 20 to 36 stories an hour that day — and News showed 3 of
the 49 collected in six hours. Three separate faults, each invisible on its own.

**1. Nothing was tagging the stories.** News narrows to the fields a reader
follows, and that narrowing is `stories.stacks && stack_expand(fields)`. A story
with no tags cannot appear on the page whatever it says. Tagging is a
deterministic pass — string matching against a closed vocabulary, no model, no
budget, no gate — and it was called from exactly one place: the Worker's cron,
which runs on a deployment that does not exist. On this collector every story
landed untagged and stayed that way. `tagStacks` now runs in the live cycle,
every tick, and the tick reports it:

```
11:32:39   5 due   1 new   11 dup   0 err   0 snap  279 tag   34 q   7.2s
                                                    ^^^^^^^
```

Before: 656 stories, 56 untagged, News showing 51. After one cycle: 0 untagged,
News showing 105. The number that had not moved in hours doubled.

**2. The work queue was 99.9% ghosts.** 24,045 pending jobs, of which **24,011
pointed at stories that no longer existed** — killed by the registry reset, which
deleted stories directly and cleaned six child tables but not `jobs`. A queue is
the one structure where dead entries cost live ones: they are ahead in line. The
reset now sweeps `jobs`, `story_keys` and `snapshot_schedule`, and `npm run
retain` sweeps orphans generally, because the cleanup that runs after every prune
is the right place for it.

**And "generally" was not general enough — see below.**

### A claim without a story is not a claim

`story_keys` is what makes the URL a story's identity: the collector claims an
address before writing anything under it, and an item whose address is already
claimed is a duplicate. Retention cleaned those keys by *joining to the stories
it was about to delete* — which is correct for its own deletions and silent
about everyone else's. A registry reset, a merge, a hand-written DELETE: each
left its claims standing.

A standing claim is not inert the way an orphan member row is. `findManyByUrl`
reads it as *we already hold this address*, so the URL is refused as a duplicate
on every future poll — permanently, and counted under the same `duplicate` label
as the thousands of items the archive correctly already has. Measured on
2026-08-28, two days after the registry was emptied:

```
73,286   url keys
71,274   pointing at a story that no longer exists          (97%)
   374   items inside the retention window, on offer in the
          live feeds, that no source could ever collect
41,795   duplicate drops in thirty days
```

Worst hit were the sources whose whole feed had been re-read during the
emptying: Vercel 103 blocked, AWS Security Bulletins 77, ClickHouse 32, NVIDIA
28, OpenAI 21 — five of the fourteen live sources that had never produced a
single story.

Three changes, and the migration is the least of them, because deleting stories
is a normal operation and the collector has to survive it rather than be
repaired afterwards:

| where | change |
|---|---|
| 0061 | delete the orphans that already exist |
| `findManyByUrl`, `findByUrl` | an address is only held if its holder exists |
| `claimUrls` | `ON CONFLICT … DO UPDATE … WHERE NOT EXISTS`: a dead claim is taken over, not lost |
| `retain.ts` | sweep `story_keys` by absence too, not only by its own predicate |

The `WHERE` on the upsert is what keeps the ordinary race unchanged — two polls
on one URL still produce one story and one membership row. It only fires when
the incumbent is gone.

**3. Quiet feeds were backed off six hours.** The adaptive tuner halves the
interval for productive sources and doubles it for silent ones, up to a ceiling —
and the ceiling for release feeds was `POLL_INTERVAL_COLD_SECONDS`, six hours,
justified in a comment saying nobody needs to hear about a release the same hour.
Measured against that argument: of items published in the last 24 hours, the
median reached the page **3.3 hours** after publication and the 90th percentile
**8.5 hours**.

The argument was wrong in a way worth stating, because it is the same mistake in
both directions: the reason to poll less often is cost, and a quiet feed costs
almost nothing — it answers `304 Not Modified` with no body. What backing off
buys is a few bytes. What it spends is latency, and latency is the entire product
for a news reader. COLD is now one hour, the 268 sources already sitting above it
were capped, and the tiers still exist for the distinction to be expressible.

Arrivals since, measured from each item's own publication timestamp:

```
Rspack crates@0.102.1      13 min late   2 tags
llama.cpp b10647            7 min late  10 tags
Rspack v2.2.1               6 min late   2 tags
SAP CX ...                  5 min late
```

Nothing here can beat the feed's own delay — a publisher who writes the file
twice an hour is collected twice an hour — and no story was ever added by hand.

---

## A chart of one number is not a chart

Every story page drew a **coverage curve**, and on a story carried by one outlet
with one snapshot that is a single bar filling the panel — a picture of the
number 1, rendered at 110 pixels, which reads as a rendering fault rather than as
a fact. It also cannot become interesting later: coverage of 1 at +7d means
nobody else picked the story up.

The curve exists to show how a story SPREAD — one outlet at +1h, nine by +24h is
a shape worth drawing. So the panel appears when there is a shape: **two or more
captures, or more than one outlet.** Otherwise the Coverage stat card above it
has already said "1 outlet", which was the chart's entire content.

The four model scores beside it — importance, niche, novelty, depth — were
rendered unconditionally, as four cards reading `—`. That is worse than absence:
an empty box on a detail page reads as a value that failed to load rather than as
work that has not run, and scoring happens after classification, so on a fresh
archive every story looked broken. They now appear only where there is a score,
and one line explains their absence when there is not.

---

## Sixteen sources, chosen by one test

```
ATF confirms "major incident" after recent Qilin breach claims
```

BleepingComputer, correctly filed as a `change` — to a US federal agency. It is
not a change to a stack, a tool or a platform, and no filter fixes it, because
the source's beat IS incidents at organisations. A registry of 367 sources
contained about sixteen that answered the brief.

**The test every kept source passes:** does it report that a TECHNOLOGY changed —
launched, released, deprecated, repriced, relicensed, retired — rather than that
something happened to somebody who uses one? A breach, an outage at a company, a
funding round, an industry survey and a conference keynote all fail it.

Chosen against the fields this reader follows, because "best" has no meaning
without them: the V8 blog is excellent and irrelevant to somebody who does not
follow browsers.

| | |
|---|---|
| **Platforms you build on** | AWS What's New · Azure updates · Google Cloud release notes · Cloudflare changelog · GitHub changelog · Vercel changelog |
| **Infrastructure and OS** | Linux kernel releases · Ubuntu security notices · Arch Linux news |
| **Data and runtimes** | PostgreSQL news · Python Insider · Go blog |
| **AI** | OpenAI news |
| **Press that reports changes** | LWN.net (93% events) · The New Stack (0 off-topic in 36) · InfoQ (90% technical) |

Security is kept through **advisories** rather than incident reporting: a USN
says which package changed, to which version, against which CVE. That is a change
to a stack. "Agency breached" is not.

`npm run sources:core` shows the cut and `-- --apply` makes it: **329 sources and
633 stories removed, 16 kept.** Nothing was deleted from the world — every
dropped source is still in `seeds/`, with its reasoning, one command from
returning.

**22 sources were paused rather than removed**, and the reason is the schema
telling the truth about provenance: `story_members` records which other outlets
carried a story, it has a real foreign key to `sources`, and it carries
`forbid_orphan_only_delete()`. A dropped outlet that appears in a KEPT story's
coverage cannot leave, because deleting that row would quietly reduce the story's
coverage count to tidy away a bookkeeping problem. They stay, paused, uncurated
and labelled, so they can never look like a choice.

### A changelog is a release feed that publishes prose

Cutting to sixteen exposed the error immediately: 155 of the 169 surviving
stories were classed `release`, and News — which shows releases only for
technologies you track — displayed **11**.

"A release feed publishes releases" is true of a repository's `releases.atom`,
where every entry is a tag. It is false of a vendor changelog, which is the same
feed kind and publishes sentences:

```
Amazon Cognito adds admin API operation to reset user TOTP
Mountpoint for Amazon S3 adds memory usage controls
Global model policy generally available
```

None of those is a new version of anything. The feed's word is now taken only for
a title that IS a version — a bare tag, or a name of at most four words ending in
one — and everything else goes through the grammar, which knows "adds", "now
available" and "generally available" perfectly well. A first-party post the
grammar cannot place still ends as a `change`, never as an article.

126 of the 169 stories were reclassified: 96 to `change`, 29 to `launch`. News
went from 11 to **122**.

### Release feeds now follow the reader, not the other way round

319 repository feeds were being polled for a reader tracking nothing. "Releases
you track" governs what News SHOWS; there was no reason for it not to govern what
is fetched. `npm run sync:releases -- --tracked --apply` adds a feed for each
technology named in Settings and no others, and refuses to run at all when the
list is empty.

---

## Two bugs on one screen

### "Nothing readable on the page" — about a page it had just read

The in-app reader showed LWN's *Security updates for Thursday* with a warning
that the page was **"probably rendered by JavaScript, or behind a wall"**, then
printed 45 words of stored summary underneath it. Both guesses were wrong, and
the evidence was in the same process: `extractArticle()` had pulled 5,963
characters out of that exact HTML.

The two extractors disagree because they work differently. `extractArticle()`
takes the container's `textContent` and does not care about structure — it is
feeding a classifier. `extractReadable()` collects `p, h1…h4, li, blockquote,
pre` because it is building a page a person reads.

**LWN's security updates are a table.** Distribution, advisory id, package, date,
one row each, and not a single `<p>` in the article. The reader found no
paragraphs and reported the page unreadable rather than reporting that it could
not find the shape it expected.

Two changes. `tr` is now a block, mapped to a list item — cells are separated by
whitespace in the source, so a row normalises to `AlmaLinux ALSA-2026:60215 9
assertj-core 2026-08-27`, which is how that table reads aloud. And underneath it,
a net: **if no block matches at all but the container holds 200 characters or
more, the whole text is emitted as one paragraph.** A layout nobody anticipated
should cost the structure, not the article.

```
before   0 blocks      "Nothing readable on the page"   45 words · 1 min
after  107 blocks      the article                   1,189 words · 5 min
```

The word count fixed itself: it was reporting the stored summary because that was
all the page had.

### A menu that truncated the one word identifying the row

```
Relea…  NONE TRACKED  0
```

The rail row is a flex line — label, note, count — and every one of them had the
same shrink factor, so the browser took the space out of the label. The
annotation about the row survived and the row's name did not.

The note now yields first (`flex:0 20 auto`, with its own ellipsis) and the label
holds its width. The note itself is also shorter-lived: it appears only when
nothing is tracked, which is the one state where a zero needs explaining. Once
you track something, the count says it.

---

## Two sources that produced nothing, and said nothing

The registry was cut to sixteen sources chosen by one test. Two of them then
yielded **zero stories, ever**, while reporting themselves healthy — and that
last part is the real fault. A source that fails is visible; a source that
returns 200, parses cleanly and keeps nothing looks exactly like a quiet week.

The question that found them was "is 174 too low?". It was, and only partly for
the obvious reason.

### Google Cloud: one entry per day, not per change

The Atom feed is well-formed and useless as-is. Every entry is titled with a
date — `August 27, 2026` — and links to the same page with a different fragment.
Fragments are stripped when canonicalising a URL, because they have to be: a
fragment is a position on a page, not a different page. So all thirty entries
collapsed onto one URL and twenty-seven were refused as duplicates, every hour.

Measured before the fix: **420 items seen, 0 kept, 0 rejected** — it never even
reached a content gate, which is why nothing appeared in `story_rejects` to
suggest a problem.

The content of each day-entry turns out to be a clean list of that day's notes,
one `<h2 class="release-note-product-title">` per product, so the split is exact
rather than heuristic — the publisher already marked the boundaries. Each note
becomes its own item with its own URL. **0 → 141 stories on the first cycle.**

### OpenAI: the announcement channel has no feed at all

`openai.com/news/rss.xml` is the marketing blog. Measured over 24 hours: **3,395
items examined, 0 kept**, and every refusal was right — "How Cars24 scales
conversations with OpenAI", letters to governors, business posts. The gates were
working perfectly on a source that had nothing for them. It was also 1,154
entries re-parsed hourly, which alone was 25,000 of the 87,648 items the
collector examined each day to keep nothing.

Every alternative was checked before writing a scraper: `platform.openai.com` has
no RSS; `developers.openai.com/rss.xml` exists and is guides, cookbooks and
YouTube links — learning material, not events, and it would be refused too;
`status.openai.com` is incidents, which is not a change to a technology. The
changelog page is the only announcement channel, and it renders server-side.

**0 → 18 stories**, and they are the right ones: *"GPT-5.6 Sol now costs $4 per
million input tokens and $20 per million output tokens"* is a price change the
money lens can see, which is precisely what the blog could never provide.

### What a scraper owes you

Both adapters **throw when they find no entries**, which records an error on the
source and surfaces on `/admin/health`. Returning an empty list would be the
same silent failure over again, one layer up. The selectors match stable class
prefixes — OpenAI's page is built with hashed module class names like
`_ChangelogMarkdown_f3xd6_19`, and the hash changes whenever the stylesheet is
rebuilt — and there are tests pinning both shapes, so a redesign fails in CI
rather than quietly in production.

Neither source has a per-entry URL, so both synthesise one. That is not
cosmetic: a story's identity **is** its canonical URL, so without something
distinct per note they would collapse exactly as before. Query parameters
survive canonicalisation where fragments do not, and the parameters chosen are
not on the tracking-parameter list.

### The length floor is now the largest content filter

With those two fixed, the biggest single refusal is `too_short`: **136 of Google
Cloud's 338 notes** are under `MIN_CONTENT_CHARS_LATIN=400`. A release note
reading "Cloud Run now supports X" is sixty characters and is still the news.
The same gate takes two or three LWN items an hour, from the source measured at
the highest event rate in the registry.

Left alone deliberately — lowering it admits shorter, thinner items everywhere,
and that is a judgement about what the archive is for rather than a bug to fix.
Recorded here so the number is known when the question is asked.

## The general tech press, measured rather than argued about

A screenshot of another reader, with a request: check these sites, add the ones
that fit. Ten domains — CNBC, The Next Web, XDA, Gizmodo, BBC, WIRED, The Verge,
Tom's Hardware, thenewstack.io, blog.google.

The temptation is to answer from taste. Instead each was run through the gates
the pipeline actually runs, over its own most recent output — the same method
that chose the sixteen:

| candidate | refused outright | EVENTS |
|---|---|---|
| Node.js blog | 0% | **53%** |
| Rust blog | 0% | **50%** |
| Kubernetes blog | 0% | **30%** |
| HashiCorp blog | 0% | **25%** |
| Docker blog | 0% | 20% |
| The Verge | 40% | 20% |
| Android Developers | 0% | 16% |
| Google Developers Blog | 0% | 15% |
| XDA Developers | 10% | 10% |
| Tom's Hardware | 35% | 8% |
| CNBC technology | 53% | 7% |
| Gizmodo | 15% | 5% |
| blog.google (Keyword) | 10% | 5% |
| BBC Technology | 20% | 0% |
| The Next Web | 20% | 0% |
| WIRED | 40% | 0% |

**Every domain in the screenshot failed.** Not by a little: BBC, TNW and WIRED
published nothing in their last twenty to forty items that this archive would
call an event. What they publish instead is visible in the refusals — *"Jensen
Huang says Nvidia achieved AGI, again"* (business), *"Americans are cheering for
vigilantes who take down Flock cameras"* (politics), *"Speedo's new smart goggles
module can track all four swim strokes"*. That is the incident-and-industry press
the registry was cut to remove, and adding it back would undo that decision by
the back door.

The four that passed were not in the screenshot. They are first-party project
blogs, and two of them beat sources already kept — InfoQ and The New Stack sit
around 7–20% on the same measure. So they were added, and the registry is twenty.

The measurement is worth more than the verdict: *"is this feed for me"* is a
question about output, and it is answerable in about thirty seconds per
candidate. Sounding like a technology outlet and being one are different
properties.

## Four bugs found by adding four sources

Adding the sources was the easy half. Watching what happened next found four
faults, three of which were older than this change and none of which announced
itself.

### An item whose link is a listing must not be fetched

The OpenAI adapter delivered eighteen distinct announcements. The archive stored
**one**.

The pipeline fetches the article page when an item's own body is too short —
right for almost everything, and exactly wrong here. These items' `link` is the
*listing they were split out of*, so the fetch returned the entire changelog for
every one of them: eighteen stories, each with the same 37,444-word body, each
rewritten to the same `rel=canonical`. Layer-2 dedup then did precisely what it
is built to do and merged them all. **A price change was merged into an unrelated
API launch.**

`FeedItem.complete` says "this is the whole of it; there is no page behind it".
Only the producer can know that, which is why it is a property of the item rather
than a rule about a URL.

### The two collection paths were gating differently

Google Cloud kept 141 of 338 notes. The other 136 were refused as `too_short` —
because `collectViaAdapter` never passed `minLength`, `qualifyTitle` or
`isPrerelease`, all of which the feed path has always passed.

A source is `releases` or it is not. Which function happened to read it is not a
fact about the source. With the three options passed, the same feed keeps **288**.

### Fuzzy dedup was eating single-source changelogs

Layer 2 asks "did somebody **else** carry this story" — that is what coverage
means, and `story_members` and `coverage_count` exist to record it. It never
excluded the story's own source.

On template text that is destructive. Measured on Google Cloud: *"GKE (2026-R35)
version updates"* merged into *"(2026-R34)"* — two different release rounds a week
apart — and *"Distributed Cloud for VMware"* merged into *"for bare metal"*, two
different products. Release notes are boilerplate around a small payload, so the
boilerplate dominates the hash and every note looks like every other.

`bandCandidates` now excludes the story's own source. Layer 1 still catches a
genuine same-source repeat exactly, by URL, rather than by resemblance. This was never specific to the new adapters — it was hurting every
release feed in the registry: **73 stories** were being hidden by it, across
Google Cloud, Azure, Cloudflare, Ubuntu and Node.js, and un-merging them was the
single largest one-off gain in this pass.

Undoing them ran into `forbid_orphan_only_delete`, which refuses to remove the
coverage row while its parent story lives — correctly, and a plain `try/catch`
cannot recover from it, because a failed statement aborts the whole transaction
in Postgres. A `SAVEPOINT` is what lets the rest of the work commit. The coverage
rows stay as history and the recount ignores members from a story's own source.

### An identical title is not always the same story

Layer 3 hashes the English title, which is the whole reason titles are translated
at ingest — it catches one story carried by two outlets in two languages. It
grouped by that hash alone, with no notion of source or date.

A background check caught what the direct test had not: after the layer-2 fix,
three merges reappeared, all from Google Cloud, all *"identical translated
title"*. Their dates were **two weeks apart** — "Scheduled maintenance" on 13
August merged into the same notice on 27 August, "Installed latest packages from
upstream dependencies" on the 23rd into the 9th. A changelog that publishes
boilerplate produces identical titles for genuinely different days, and each
merge lost a day's change.

The rule is not "never merge within a source". Same source, same day, same title
is a real duplicate — a feed serving one item under a second URL — and still
merges. **A date is part of a changelog entry's identity**, so same source plus a
different day is left alone. Cross-outlet merging is untouched, including across
days, because two outlets filing one story a day apart is still one story.

Worth recording how this was found: the direct test — run dedup, count
same-source merges, see zero — passed. It passed because it ran before the 73
old merges were undone, so the stories that would collide were still hidden. The
background watcher, which sampled across a real scheduled `process` run, caught
it. A check that runs at the convenient moment is not the same as one that runs
at an arbitrary one.

### A merge recorded what and why, but never when

The confirmation run for the layer-3 fix came back **negative**: sixty-seven
same-source merges reappeared after a scheduled `process` run that reported
doing nothing, and whose job row shows `last_ok = true`, `failures = 0`,
`last_note = null`.

Both fixes were verified directly and repeatedly — dedup run by hand over 500
stories, as the owner role and as the worker role, produced zero merges and zero
same-source pairs each time. `bandCandidates` was confirmed to return no
same-source candidates against live data. Only one scheduler was running, started
after both fixes. `stories.supersede` has exactly one caller. Every one of those
checks passed, and the merges appeared anyway.

The reason that took an afternoon rather than a query is that **a merge carried no
timestamp**. `superseded_by` says what it became and `supersede_reason` says why,
and nothing said when. `collected_at` is when the story arrived, which for a
re-merged story is hours earlier and answers a different question. So attributing
sixty-seven merges to a job meant correlating counts against a polling loop,
which is guesswork wearing a lab coat.

Migration 0046 adds `superseded_at`, set by `supersede()`. "Which merges happened
in the last ten minutes, and what was running then" is now a `WHERE` clause.
Existing rows are backfilled to NULL rather than to the migration's own
timestamp: a merge whose time is unknown must read as unknown.

`superseded_at` answered it within one cycle, and the answer was not in this
repository's running process at all.

### The other copy of this application

Thirty-seven same-source merges appeared at `20:21:07`, all layer 2, all Google
Cloud, all carrying **no `superseded_at`** — written by code that predates the
column. The only local job that had finished was `collect`, at `20:20:49`.
`process` had not advanced. `collect` cannot merge: it writes `story_members` at
layer 1 and never touches `superseded_by`.

So the writer was asked the only question that separates it from every candidate
already eliminated — *when*:

| minute of hour | merges |
|---|---|
| :00–:02 | 82 |
| :20–:22 | 129 |
| :40–:42 | 70 |
| everything else | 12 |

Two hundred and eighty-one of two hundred and ninety-three merge events land in
three two-minute windows on the clock. The local `process` job runs every 600
seconds from whenever it last finished — it is not aligned to the hour and cannot
produce that. The twelve outliers are dedup runs done by hand while
investigating.

`wrangler.toml`, committed and forgotten:

```toml
[triggers]
crons = [
  "*/5 * * * *",    # tick        : poll everything due, then capture snapshots
  "*/20 * * * *",   # process     : dedup -> classify -> score
  "0 3 1 * *",      # maintenance : partitions, then retune poll intervals
]
```

A Cloudflare Worker, `newstrack-poller`, deployed from an earlier revision, is
running the whole pipeline against the same Neon database every twenty minutes.
Its copy of `bandCandidates` has no same-source exclusion and its copy of
`supersede` does not stamp `superseded_at`, because neither existed when it was
deployed. It re-merged the Google Cloud release notes after every clearing,
which is precisely what was observed.

Every check that "passed" was true and none of them was relevant:

| check | verdict | why it proved nothing |
|---|---|---|
| dedup by hand, both roles, 0 merges | true | ran the fixed code |
| `bandCandidates` returns no same-source candidates | true | ran the fixed code |
| `supersede()` has one caller | true | one caller *in this checkout* |
| no trigger writes `superseded_by` | true | the writer was not in the database |
| only one scheduler process running | true | only one *on this machine* |

The mistake is worth naming precisely, because it is not a coding error. Every
piece of evidence was gathered from the working tree and from `ps` on the
development host, and the conclusion drawn was about **the system**. Editing a
file changes what will run; it does not change what is running somewhere else. A
deployed job is not visible to `grep`.

The unstamped rows were the tell from the beginning, and they were read exactly
backwards: "the running process has the stamping code, so an unstamped row is
impossible" — when the honest reading is "an unstamped row proves the writer is
not the process I am looking at."

**What is fixed and what is not.** The code in this repository is correct: the
same-source exclusion, the layer-3 date rule and `superseded_at` are all in place
and tested, and the local scheduler produces zero same-source merges over the
same 289-row Google Cloud corpus that the deployed Worker re-merges every twenty
minutes. `src/workers/cron.ts` also carries a `schedulerIsRunning()` guard that
makes the Worker stand down when a scheduler is already working the queue.

The diagnosis was then made to earn its keep by predicting something. The next
`*/20` boundary was 20:40; the prediction was a burst of unstamped same-source
merges shortly after it, with no local `process` run responsible. At **20:41** the
count went 71 to 81, every one unstamped, while the local `process` job had run
and stamped nothing. Cloudflare's own API confirmed the rest:

```
GET /accounts/.../workers/scripts/newstrack-poller/schedules
  "*/5 * * * *"    created_on 2026-08-25T04:20:11Z
  "*/20 * * * *"   created_on 2026-08-25T04:20:11Z
  "0 3 1 * *"      created_on 2026-08-25T04:20:11Z
```

**What was done.** The triggers were removed and nothing else. The schedules
endpoint takes an empty array, which detaches the crons from the *current*
deployment without uploading a byte of code — so the Worker still holds its
2026-08-25 revision, and none of the work in this repository was shipped by the
act of stopping it. `wrangler triggers deploy` is the intended route for this and
would have been equivalent; wrangler 3.114 fails it with `accounts/undefined`, so
the API was called directly.

The eighty-one merges were then undone: distinct announcements from one
publisher, restored to the archive rather than left buried. **530 live stories,
back from 449.**

What remains is a single scheduler of one vintage, and a Worker that is deployed,
inert, and honest about it in `wrangler.toml`.

**Closed on 2026-08-31.** For six days the second half of the problem stood: the
Worker was inert but still held the 2026-08-25 code, so the repository and the
deployment disagreed and nobody could tell by looking. `npm run deploy` shipped
the current revision. `crons` stays empty, because arming a trigger is a
separate decision from deploying the code — and it is the decision that caused
the incident.

The stand-down was then verified against the deployed URL rather than reasoned
about. An authenticated `?task=tick`, at a moment when the local scheduler had
finished a job seconds earlier, answered:

```
{"skipped":"a long-running scheduler is active against this database"}
```

It collected nothing. The unauthenticated and wrong-secret cases both answer
404, because an open endpoint that starts a collection cycle is a free denial of
service against this Worker's quota and every source it polls.

### Every restart stranded the work in flight

A runner is identified as `pid@host`, and the pid changes on every restart. So
"clear this runner's stale claims" cleared nothing, and a process killed
mid-cycle left its jobs claimed until the lease expired.

Observed directly: a restart during a collection left `collect` held by the dead
pid with a 600-second lease, and **collection simply stopped for ten minutes**.
Every deploy would have done that, quietly, and the only symptom is a gap in the
archive.

A claim held by a process on *our own host* can be checked — `process.kill(pid, 0)`
answers whether it still exists — so those are taken back at once. A claim from
any other host still waits out its lease, because stealing a job from a live
runner is the worse failure.

## The counts on a list page now move

"I want to look at the page and see the count of news increase."

It did not. `/api/counts` has always refreshed the rail every fifteen seconds,
but it serves the **global** numbers — total, today, favourites — and on `/news`
exactly one entry was live: *Favourites*. Everything a reader actually watches —
`All fields`, `Cloud`, `Launches` — is counted **under the query currently on
screen**, which a global endpoint cannot know.

`/api/rail?for=<path+query>` re-renders that list's own rail. It returns HTML
rather than a tidy JSON of numbers, deliberately: counts and the markup around
them must come from one producer or they drift, which is the same reason the list
and its counts are read in a single batch. The client re-reads it and copies each
number across by matching the row's `href` — nothing in the menu is replaced, no
link loses its place, and a changed number gets the same `bumped` animation the
global counts already used.

Which pages get this is decided in one place. The server marks the body with
`data-live-rail` when it renders a stream; repeating the list of stream paths in
JavaScript is how the two quietly come to disagree.

## Three registries, three tabs

> **Superseded.** The three tabs became one *Registry* section with four lists in
> its rail. The distinction below is real and is still what the four lists are
> for; what was wrong was spending three of seven top-level tabs on it. See *The
> top bar was making the wrong claim*.

A stack is a dependency you ship. A tool is something you operate and never
ship. A platform is where a thing is deployed or sold. Those are three questions
asked at three different moments, so each had a tab: **Stacks**, **Tools**,
**Platforms**.

Every registry row now carries its **lineage** — `Programming Languages ›
Python` beside Django's name. That relationship is the most useful fact about an
entry after its name, and it was buried in a collapsed panel, so a page of 1,361
technologies read as a flat list of words and the tree the whole taxonomy is
built on was invisible to anyone who did not click.

### The counters were sized by eye, and four of the five were too small

A registry row is a CSS grid, and its right-hand counters — aliases, children,
30-day stories, all-time stories, first sighting — had columns typed as round
numbers: 40px, 40px, 58px, 58px, 46px. Every one of those cells is monospaced
text, so its width is not a matter of taste: it is *characters x advance width*,
and JetBrains Mono advances 0.6em. Doing that arithmetic against the type scale
this site actually renders at says the five columns need 32, 46, 46, 71 and
69px. Four of the five guesses were short.

Being short shows up two different ways, and only one of them looks like a
mistake. `434sub` and `54,193all` simply spilled left into the gap, which reads
as cramped rather than broken. `18-12came` **wrapped**, because a hyphen is a
line-break opportunity where a digit is not — and one wrapped cell is taller
than its row, so the row grows and every counter down the page stops lining up
with its neighbours. The visible symptom was a ragged right-hand column; the
cause was one date, one hyphen, 23 missing pixels.

The widths are `calc()` against `--t-12` and `--t-9` now, with the widest value
each has to hold written beside it, so they follow the type scale instead of
going stale the moment it moves. `white-space:nowrap` is the belt to that
calc's braces: a value that ever outgrows its budget now nudges its neighbour
by a pixel instead of folding onto a second line and dragging the row with it.

The same defect existed at the narrow breakpoint from the opposite direction.
The template declared **four** columns, while **five** cells survived its
`display:none` list — so the last count dropped onto a second grid row. A cell
count and a column count are the same fact written twice in two files, with
nothing making them agree, and CSS does not complain when they disagree: it
silently reflows. `tests/registry-grid.test.ts` renders a real row with the
widest values the archive can produce, reads the real stylesheet, and asserts
the two numbers match at both breakpoints.

The breakpoint itself moved from 1080px to 1180px. The counters honestly need
54px more than they were given, and that space comes out of the name column;
below roughly 1180px the wide layout had been ellipsing names down to a couple
of characters in order to keep columns nobody can read at that width anyway.

### A number with no name is decoration

Fixing the widths made the columns line up. It did not make them mean anything.
Five of them were bare figures under two-letter labels — `al`, `sub`, `came` —
which is a label only for somebody who has already read the markup. A reader
looking at `434` beside `265` beside `22,022` has no way to learn that the
first is alternative spellings, the second is entries in the tree beneath it,
and the third is stories collected since the archive began.

So the list has a header now, in words: **Name · Part of · Kind · Status ·
Address · Aliases · Beneath · 30 days · All time · First · Links**. It is
sticky, because a label that scrolls away has explained a number once and left
every screenful after it unlabelled. Each header carries the sentence version
on hover — *"the month it first appeared in the archive, as YY-MM — when the
technology showed up in the news, not when somebody added the row"* — which is
a distinction this registry has always made and never said out loud.

**Eight of the twelve are also the sort.** The whitelist behind the sort
dropdown already had `aliases`, `children`, `activity`, `stories`, `firstseen`,
`name`, `category` and `broken` in it; the header just addresses them, carrying
the current search, categories and filters through so a re-sort is not a reset.
The column the list is actually ordered by is the one wearing the arrow. That
answers *what is this number* and *show me the biggest ones* with one click.

The in-row abbreviations are gone — saying it once at the top in words costs
less width than saying it cryptically on all 816 rows. What it does cost is
that a header word is usually wider than the figures under it, so each column
is now `max(widest value, its own name)`, with room reserved for the sort arrow
on every sortable column rather than only the sorted one, so re-sorting moves
the arrow and not the columns.

**And a header is a third list that has to agree with the other two.** That is
the defect this section opened with, so it is not written a third time: the
header cells, the row cells, and which columns survive the narrow breakpoint
all come from one `COLUMNS` array in `src/ui/registry.ts`, in order. The
stylesheet names the tracks once as `--reg-cols` and once as
`--reg-cols-narrow`, and hides one class — `nw` — that a header cell and a row
cell receive from the same flag. `tests/registry-grid.test.ts`, nine tests,
pins the counts, that every named column explains itself, that a re-sort keeps
your filters, and that exactly one column is ever marked as sorted.

*Sticky inside a rounded container needs `overflow:clip`, not `overflow:hidden`
— the latter makes the list a scroll container and clips the header away.*

---

## Analyse: adoption, not volume

The page used to rank technologies by story count, which answers *which feed is
loudest*. Ranked that way this archive puts `atproto` first on 719 items from
**two** sources — one project's own release feed publishing into a vacuum.

So the ranking is **breadth**: how many distinct outlets carry a technology, and
whether that number is climbing. One project shouting is one source; twenty
outlets independently deciding a thing is worth writing about is a market
moving. Gated at three sources, ordered by the *change* in breadth rather than
its level, so an established name holding steady does not crowd out something
arriving.

**The tool to reach for, by category.** "Best" is not a judgement this system
can make and the page does not pretend to. It shows the tool in each category
that the most independent outlets write about, and the version it is on right
now — read from release feeds rather than from anybody's opinion.

**Where the money is — and this section is incomplete, and says so.**
`platforms.time_to_first_dollar` is NULL on all 56 rows, no source feeds it, and
`platform_facts` is empty. Rates, payout terms and market size are collected by
nothing in this system today. The page shows the registry, the channel and a
real address, plus the only earning-adjacent signal the archive genuinely has —
how many outlets write about each platform. Making the income question properly
answerable needs a source that does not exist yet; inventing a number would be
worse than the gap.

---

## Navigation: pages are not filters

The rail used to hold two different kinds of thing wearing identical clothes.
Destinations — Sources, Companies — sat next to filter toggles like *Rising
fastest* and *Japanese*, and several of those toggles were mutually exclusive, so
a menu that invited you to stack things quietly replaced your selection instead.

The split is now absolute, and it is the rule the whole interface is built on:

| | changes | lives in |
|---|---|---|
| **Navigation** | the page you are on | top bar + left rail |
| **Filters** | what that page shows | the page body, only |

Anything that cannot be combined with its neighbours is not a filter, so it gets
a page. That is the whole reason there are pages at all:

- **Four streams** — `/news`, `/releases`, `/community`, `/all`. Not values of one
  filter: 205 of the sources are GitHub release feeds, and one project cutting
  five release candidates in an afternoon would bury a day of reporting. They are
  different rhythms, so they are different pages, and switching between them
  carries your refinement with you (`/releases?lang=en` → `/news?lang=en`).
- **Four views** — `/today`, `/critical`, `/rising`, `/niche`. A saved question
  with a URL. *Critical* is a threshold and *rising fastest* is an ordering; they
  cannot both be true of one list, which is exactly why they are pages. Each
  arrives with its preset **applied and visible** as removable pills, because a
  page that silently filters is indistinguishable from a page with no data.

**Niche means a niche technology, not a story few outlets ran.** Those are
different questions and the second is the one every other ordering already
answers. `/niche` is news mentioning something with three stories or fewer in the
whole archive — 452 of 3,585. Twelve was the first threshold tried and it caught
1,661, which is not a niche. Rarity is a materialised view refreshed when tagging
changes, because recomputing a group-over-unnest of the archive per page load is
fine at 3,500 stories and ruinous at 350,000.

**Type is its own facet.** *Databases*, *Languages*, *Tooling* — the nineteen
categories, matched against the technologies a story is tagged with rather than
against a list of slugs someone has to know in advance. It combines with
everything else: `?type=db&type=language` reads as "about a database or a
language" and returns 241 where the two alone return 89 and 163.

**Every long facet list has its own search box.** The technology facet went from
28 options to 120 when the vocabulary grew, and a 120-item scroll is a haystack
rather than a filter. It narrows what is already rendered, and a ticked option is
never hidden — filtering away a selection and then submitting the form would
silently drop it.

Five sections in the top bar — **News · Analyse · Explore · Registry ·
System** — and the rail shows only the current section's pages. Repeating all
five everywhere would be the same mistake in a different place.

This count has been five, then seven, and is five again; see *The top bar was
making the wrong claim* below for why the middle number was wrong.

**The top bar is the same grid as the page under it.** The brand holds the rail's
column open, so the section menu starts exactly where the content column starts:
its left border and the rail's right border are one continuous vertical line
rather than two edges a few pixels apart. The brand is `--rail-w` less the bar's
own padding and the flex gap that follows it, so the two move together if the
rail is ever re-sized. Below 900px there is no rail to line up with and the brand
takes what it needs. The menu itself no longer shrinks — a clipped destination is
worse than a shorter search field, so the search is what gives up width first.

`npm run ui` serves it all on 127.0.0.1 only.

**`/` — the overview.** The front page used to be the river, which meant the
product had one page and everything else was a filter applied to it. It now
answers what someone actually arrives with: what happened, is collection healthy,
where should I look first — volume by day published, critical right now, fields
by activity, rising technologies, company announcements, busiest sources. Every
number links to the page that explains it.

**`/news` and the other streams — the reader.** A chronological river grouped by
day: one strong title per row, one quiet metadata line, a two-line summary. Five
sorts including *niche-first* and *velocity*.

**Every facet is multi-select.** `?stack=rust&stack=go&source=LWN` reads as
"about Rust or Go, from LWN" — selecting a second value adds to the selection
rather than replacing it, which is the difference between a filter and a switch.
Two ways to the same URL: tick several in the Refine panel, or click a chip to
toggle one. Active selections show as removable pills. All of it lives in the query string, so every view is a shareable link and
a saved view is just a stored URL.

**Header autocomplete is eight results, not the whole vocabulary.** It used to
be a `<datalist>` of every slug inlined into every page — 230 options, with the
browser deciding how tall that popup should be, which at 230 options was "the
whole screen". It is now a request per keystroke into a box whose height is ours,
and it stays eight results however many thousand entries the taxonomy reaches.

**`/search` — entity resolution first, text second.** Typing `react` is not a
request for documents containing the word; it is a request for React. The term is
resolved against everything this system knows by name — the closed vocabulary,
the **company** registry and the **source** registry — by exact slug → alias →
prefix → trigram, so `kubernets` still finds Kubernetes. The answer *opens* with
what that entity has been doing: volume, 12-week trend, peak importance, most
recent stories. A company opens its page; a source opens its stream.

The text half is real full text search, and it did not used to be. It was
`ILIKE '%term%'` against the title, which is substring matching: `rust async
runtime` matched nothing unless those three words appeared in that exact order,
`vacuuming` never found `vacuum`, and results came back in collection order — so
the best match was wherever it happened to fall. It now runs three tiers, and
widens only when the tighter one finds nothing:

| tier | means | for |
|---|---|---|
| `all` | every word must appear | the default, and usually right |
| `any` | at least one word | words that never co-occur |
| `literal` | the string as written | product names, versions, identifiers |

Widening is never silent — the page says which tier answered, because "103
stories mention at least one of those words" and "103 results" are very different
claims. Ranking is `ts_rank_cd` multiplied by a recency term, so recency lifts a
match but never filters one out. `websearch_to_tsquery` means the syntax people
already know works: `"breaking change"` is a phrase, `rust or zig` is either,
`kubernetes -helm` excludes.

Widening happens on the **parsed** query — the `&` joins are rewritten to `|` —
rather than by re-splitting the input, so a quoted phrase survives it intact.

Matched words are highlighted, in TypeScript rather than with `ts_headline`, so
escaping happens first and the only markup in the output is the `<mark>` this
code put there.

**Nothing found is an answer too.** The old page always offered eight "did you
mean" chips from a similarity sort with no floor, so searching GoHighLevel
suggested Go, Godot and Laravel — and *Developer Tooling* twice, because two
stacks share that name. A suggestion nobody meant is worse than none: it implies
the system understood. Suggestions now need real similarity, are de-duplicated by
display name, and when there are none the page explains the three reasons this
happens instead.

**`/technologies` — the vocabulary as a catalogue.** The taxonomy is *closed*:
753 curated entries whose slug is simultaneously the URL, the filter value and
the only tag a model is allowed to return. If a technology is not in here, no
amount of collection will surface it — so what is missing matters as much as what
is covered, and it deserves to be read rather than scrolled past in a dropdown.

Category is the top-level split because it is the one property every entry has,
it is closed (nineteen values, enforced by a `CHECK` constraint), and it cuts
*across* the parent/child tree rather than repeating it: "which databases do we
track" is a question the hierarchy answers badly. `/technology/db` gives all 51,
each with its aliases, parent, children, status, repo and release feed, and its
story counts at 30 days and all time. Searching here searches the **vocabulary**,
not the archive.

Every category page says how many of its entries have never appeared in a story.
That is a coverage gap, not an error: the vocabulary is curated ahead of
collection on purpose, so a technology is recognised the first time it is
mentioned rather than the first time someone notices it is missing.

**`/stacks` — the registry, one row per entry with its full record.** Aliases,
ancestry, descendants, whether a source polls its release feed, first and last
seen. Filterable by category, by what the record contains, by whether it has ever
appeared, and by whether a person or the system added it.

Every record carries **where to learn it**, in three kinds that are genuinely
different documents:

| kind | what it is |
|---|---|
| official | the reference — complete, precise, usually a poor place to start |
| tutorial | the way in, often but not always the project's own |
| learning | substantial free material by someone else |

The third matters most and is the one a vendor link never gives you: The Rust
Book, Go by Example, MDN, OWASP, fast.ai and the Google SRE Book all beat the
thing they document. **1,814 links across 968 technologies**, and every one of
them has been fetched.

It also reports what it does not know. A completeness panel prints how much of
each column is populated, because an empty column is a curation backlog and one
nobody can see never gets worked through. The GitHub topic import took
`description` from 0 to 1,200 and `homepage_url` from 0 to 730 in a single run,
which is exactly the gap that panel existed to make visible.

**`/settings` — every knob the running code actually reads.** See below.

**`/trends` — per-technology trends.** `/trend/:slug` gives one technology's
trajectory: monthly volume, coverage mix (niche ↔ mainstream), who covers it,
what it appears alongside, and its position in the taxonomy. Following a parent
stack includes everything beneath it — `frontend` returns React news; `react`
does not return Vue news.

**One chart, not two.** There used to be a second chart under the monthly
series: the live window at week resolution, eight buckets, captioned with an
explanation that week resolution exists only as long as the stories do. It was a
strict subset of the chart above it at a finer grain, so all it added to the page
was a lesson in how retention works — and the stories in that window are already
listed under *Recent*, which is the useful form of the same fact.

**The axis starts where the technology starts.** The bounds were a flat
`now() - 120 months`, which is right for the archive and wrong for one entry in
it: a technology first seen in June drew three bars crammed against the right
edge of a decade of blank baseline. The empty stretch is not information — the
archive was not watching and the technology did not exist. Still capped at 120
months, so nothing draws an axis longer than the archive can honestly claim.
Python and Kubernetes still get their full ten years; OpenTofu gets three months.

**And short charts no longer magnify.** `barChart` sets `width="100%"` with
`preserveAspectRatio="none"`, which stretches the drawing — bars, axis and label
text alike — to whatever width the container has. Right for a hundred buckets in
a narrow column; catastrophic for eight, where a 240-unit viewBox blown up to
1,600px is a **6.7× magnification**: fat lozenges with the month labels stretched
across the axis underneath them. That is what the weekly chart actually looked
like. Capped at one CSS pixel per unit, so a short series draws at its natural
size and only a long one is scaled down.

**`/sources` — the registry as a reading surface.** Health, yield and recency
side by side, ordered by what is broken rather than alphabetically.

**`/admin` — every table in the database.** Row counts, browsing with search and
sort, plus three operational panels: the ingest funnel, source health (including
*"fetched but never produced a story"*, which is where dead feeds hide), and
tenant isolation.

---

## The top bar was making the wrong claim

Seven sections, and the shape of them said this was a catalogue with a chart
attached. It is a chart with a catalogue attached: the retention contract deletes
stories and keeps `stack_month` forever, so the month-by-month series is the one
artefact here that cannot be rebuilt from anything else. **Analyse** was sixth of
seven, behind three lists of vocabulary.

Those three were **Stacks**, **Tools** and **Platforms** — and `/stacks`,
`/tools` and `/concepts` are one function, `renderRegistry(url, kind)`, called
with a different kind. Two of the three sections owned exactly one page each, so
two of seven tabs opened a section whose rail had one entry in it. Meanwhile
`concept` — the third peer of `kind` in `src/vocab/kinds.ts` — had no tab at all
and lived in the Stacks rail, so the top bar disagreed with the vocabulary about
how many kinds of thing exist.

**Now five: News · Analyse · Explore · Registry · System.** Analyse moves to
second. The four registry lists — Stacks, Tools, Concepts, Platforms — sit
together in one rail with their counts, and the nineteen categories hang beneath
them, which is the shape Explore already used for fields and companies. The kinds
still differ; they differ one rail-click apart, which is the distance the
difference is worth.

Two entries were also both called **By category**, `/categories` under Explore
and `/technologies` under Stacks. `crumbsFor()` resolves a label to the first
item carrying it, so one of the two was always going to link to the other's page.
Explore's is now *Categories*, which is the name that page already passed, so its
breadcrumb links instead of rendering as dead text. A test asserts no two
destinations share a name, because that failure is silent by construction.

### On a phone there was no navigation at all

The rail is `display:none` below 900px and the section tabs below 720px. Nothing
replaced either. The page shell emits exactly two navigation surfaces and there
was no third, so every screen narrower than a small tablet rendered a wordmark, a
search box, a theme switch — and no way to reach any other page except by
searching for it or finding a link in the body. The rail is where Fields,
Companies, Categories, the registry lists and every filter group live, so a
tablet between 720px and 900px lost those too.

It is a **checkbox**, not a `<details>`, and not script. It has to work with
scripting off like the theme control and the filter links do, and the same
element has to be a disclosure on a phone and plain always-visible markup on a
desktop — which `<details>` cannot be, because its content is hidden by the user
agent in a way author CSS cannot reliably reopen across browsers. The input sits
before both `.top` and `.shell` so `:checked ~` reaches the rail and the tabs
without either of them moving in the DOM.

Below 900px the rail becomes a fixed sheet under the bar rather than a column
beside the content; below 720px the tabs ride at the top of that same sheet in a
strip of a fixed height, because the sheet has to clear them and a wrapping row
has no height anyone can write down.

The icon-only tabs between 720px and 1120px now **clip** their label rather than
`display:none` it. With the span out of the box tree the anchor's accessible name
fell back to the `title` attribute, and a tooltip is not a label.

### Thirteen breakpoints were not a decision

560, 640, 700, 720, 760, 820, 860, 900, 920, 1120, 1180, 2100. Nobody chose
thirteen — each was the width at which one component looked wrong when somebody
happened to drag a window. The page re-flowed in a staircase, and things that
belong together came apart at different widths: 900 shrank the search box while
920 hid the rail and re-flowed the brand that lines up with it.

**Four tiers now**, and a test fails on a fifth:

| | |
|---|---|
| 1120 | the section tabs drop their labels and become icons |
| 900 | the rail stops being a column and becomes a sheet |
| 720 | the tabs join the sheet; one column everywhere |
| 560 | the smallest phones: lists give up their side-by-side rows |

`min-width:2100px` is not a tier. It is a ceiling for ultrawide displays and the
only rule in the stylesheet that grows rather than collapses.

### Two rules wearing one name

`.fieldgrid` was **defined twice**, 650 lines apart, with different track sizing:
168px columns at the top of the file, 232px columns and a bottom margin near the
bottom. Three pages use the class. The later rule wins, so the sign-up field
picker — a grid of small checkboxes — was being laid out on the field-*card* grid
and carrying a margin nobody asked for. Two grids, two names: `.pickgrid` and
`.fieldgrid`.

The **checkbox was implemented twice**, differently. A real `<input>` in the facet
panel and a drawn `<span>` in the rail, which has to be drawn because a checkbox
cannot be a link and every rail row is a shareable address. Same control, same two
states, and they had drifted to different box sizes and different tick geometry —
and the copy carried the only hardcoded colour in 1,600 lines of CSS, `#fff`
where the original said `var(--brand-ink)`. One rule, two selectors.

Six more selectors were each declared in two separate places rather than one:
`.exmonth`, `.btn`, `.stacklist.reg`, `.stackrec .mini`, `.setrow textarea`,
`.searchbox input`. None of them conflict today. That is how `.fieldgrid`
started.

### The scale, applied where it was being bypassed

`theme.ts` opens by saying a fixed type scale, a fixed spacing scale, and nothing
per-page. It was mostly true — exactly one hardcoded colour in the whole file.
The exceptions were in `style=` attributes across the page modules: `font-size:
11px` inline eight times when `--t-11` exists, and margins written as 10px, 12px,
14px, 18px, 22px and 1rem — a second spacing scale of six values living beside
the real one of seven. All of them are on the scale now, and the handful of
one-off gaps between blocks use four named steps (`.mt-2` … `.mt-5`) rather than
an inline pixel each.

Note that `font-size:11px` was not `--t-11`. The scale carries a `--t-scale`
multiplier of 1.12, so those elements were rendering at 11px where the step is
12.32px — off the scale and a little too small, which is exactly the drift a
scale exists to prevent.

**Not changed:** `--n-5`, `--n-6` and `--t-19` are defined and unused. They are
steps of a complete ramp and a complete type scale, and a scale with holes in it
is worse than a scale with unused steps.

## Reviewing news by category

The archive can be entered four ways and each lived on its own page with its own
shape. Every one of them answers the same question — *what kind of thing is this
news about* — so `/categories` puts them in one place:

| section | groups by | example |
|---|---|---|
| Technology | the nineteen stack categories | `/all?type=db` → 651 stories |
| Company | what kind of company | `/all?ctype=ai-lab` → 899 |
| Earning platform | earning channel | `/all?channel=creator` |
| Field | the taxonomy entered at the top | `/field/security` |

Every number is a count of **stories**, not of registry entries — "43 databases"
and "43 stories about databases" are different facts and only the second is news
— and every one is a link into the reader with the filter already applied, so the
count and the list cannot disagree.

That needed four new reader facets. `company` and `platform` filter on indexed
arrays written by their own cheap passes; `ctype` and `channel` join, but only
against 76 and 56 rows. All four combine with everything already there, so
"databases, at NVIDIA, this week" is a URL.

---

## Earning platforms

The Phase 7 registry existed in the schema and held nothing, so "how do I check a
platform" had no answer. `/platforms` now lists **56 platforms across ten earning
channels** — freelance marketplaces, content platforms, creator monetisation,
app stores, bounty programmes, stock media, teaching, affiliate, compute credits
— each with its channel, whether the site still answers, and every story in the
archive that mentions it by name.

**No fee tables, and that is the point.** `platform_facts` models a fact as a
value with a source URL, a confidence and a validity window, superseded rather
than overwritten, precisely because payout thresholds and commission rates change
and a number with no source and no date cannot be told apart from a number that
is wrong. Typing "Fiverr takes 20%" into a seed file produces exactly the
confident, unsourced, undated claim that schema exists to prevent — so identity
is seeded and facts are left to be collected from the pages that state them.
Those pages are recorded against each platform, ready to be diffed. The page says
so rather than leaving an empty column to be read as "no fees".

Matching is by name with word boundaries, and capitalisation is required for the
ones that are ordinary words — `Arc`, `Impact` and `Maven` are all platforms here.

---

## Learning resources: propose, then fetch

Nothing is shown on the strength of a URL pattern. `devdocs.io/rust` exists and
`devdocs.io/some-tool` does not, and there is no way to know which without
asking — so every candidate is fetched and one that does not answer is kept with
its status rather than displayed. A dead link is worse than an absent one,
because the reader has to click it to find out.

The first run proposed 1,791 links and **1,128 were dead**, which is the whole
argument for checking.

Two patterns were then removed rather than kept as guesses. Stack Overflow
answered 403 to all 81 proposals and Exercism to all 7: both block automated
requests outright, so their URLs are **unverifiable rather than wrong**.
`stackoverflow.com/questions/tagged/c` certainly exists — there is just no way to
confirm it from here, and this page does not show links it cannot confirm.

Two more were replaced by asking properly. DevDocs publishes its full index, so
guessing at 700 URLs to find nine became one request and an exact match; and
roadmap.sh has a small fixed set of roadmaps, so proposing 690 that cannot exist
was 690 wasted requests aimed at one host.

**Verification has three outcomes, not two.**

| result | meaning | consequence |
|---|---|---|
| 2xx/3xx | answered | show it |
| 4xx/5xx | refused | hide a derived link |
| no response | proves nothing | hide nothing |

`developer.android.com` came back "fetch failed" on the first run. It is not
missing — the request failed. Treating that as a dead link would have hidden the
Android documentation because of one flaky moment. A HEAD that is refused is
re-asked with GET for the same reason: portswigger.net and codeberg.org both
answer 403 to HEAD and serve the page happily to a real request.

That leaves an asymmetry, and it is deliberate. A **curated** link is shown even
when the check failed, marked *unverified* — a person vouched for it, and this
crawler demonstrably produces false negatives. A **derived** link has no such
vouching, so it appears only on a confirmed answer.

---

## A vocabulary that grows

A hand-seeded stack list is wrong a little more every week. Everything released
after the seed was written is invisible to a system whose entire job is noticing
new technologies, and "edit `seeds/stacks-extra.ts`" is not a process that
survives contact with a running archive.

The closed vocabulary is not what gives way — free-text tags fragment within a
week and break per-user filtering silently. What changes is **who closes it**:

```
archive → discovery proposes → evidence decides → vocabulary → tagging applies
```

**One kind of evidence promotes itself.** `github.com/{owner}/{repo}/releases/tag/…`
is a project announcing itself under its own name — a primary source — so one
release is enough. 174 repositories publish releases into this archive; 154 were
already in the vocabulary once repository decoration is stripped (`nats-server`
is NATS, `flux2` is Flux, `php-src` is PHP), which is exactly the check that
stops the pass proposing a dozen entries that already exist.

**Everything mined from headlines queues instead.** The title tier looks for the
shapes technologies actually use — an internal capital (`OpenTofu`), a dotted
extension (`Next.js`), a technical suffix (`DuckDB`), the `k9s` pattern — and its
first run proposed `servethehome`, `techcrunch`, `spacex`, `youtube` and
`linkedin`, every one of them clearing a "four mentions across two sources" bar
that had sounded reasonable when it was written. **Frequency measures how often
something is written down, not whether it is a technology.** So that tier never
promotes itself: proposals queue with their evidence attached and are accepted or
turned down in one click on `/stacks`. Recall costs a click; a wrong entry in a
closed vocabulary is permanent and silently mis-tags everything it matches.

Publishers and companies are excluded from the queue outright — both are already
tracked elsewhere in this system, and neither is a technology.

### Importing a vocabulary instead of typing one

707 hand-written entries is a lot of work and nowhere near enough. A closed
vocabulary can only tag what it contains, so every technology nobody typed in was
invisible to the entire system.

`github/explore` is the curated index behind GitHub's own topic pages, and each
topic ships exactly the record a stack row needs — `topic`, `display_name`,
`aliases`, `short_description`, `url`, `github_url`. One archive, parsed once:

| | before | after |
|---|---|---|
| entries | 707 | **1,637** |
| with a description | 0 | **1,200** |
| with a homepage | 0 | **730** |

`npm run import:topics` is re-runnable: it adds what is missing and fills nulls on
what exists, without overwriting a decision anyone made.

Shelling out to `tar` failed on Windows — the temp path went through as something
it read as stdin — so the archive is walked in memory instead. A tar file is
512-byte headers each followed by padded content; forty lines beat a dependency.

**A bulk import needs a bulk-import rule.** The topics arrived with `api`, `app`,
`bot`, `list` and `awesome` as aliases, and then `support` and `first` tagged 331
stories between them. Every one is a real GitHub topic. Every one is also an
ordinary English word.

A blocklist of the words that had already gone wrong would have worked until the
next import, so the rule is the actual question — *is this an ordinary English
word* — answered by a list of the ~600 most frequent ones. Past that the
frequency curve flattens and real technologies appear (`rust`, `swift`, `arrow`,
`beam`), so a longer list would cost recall without buying precision.

The rule is asymmetric, because provenance is evidence:

- an ordinary word a **person** put in the vocabulary keeps the capitalised-form
  test — `Go` and `Rust` are real technologies
- the same word arriving from a **bulk import** loses the right to match at all

Eight imported topics were also companies — Apple, Microsoft, Netflix, Spotify —
and were dropped outright. Both registries exist; a company belongs in the one
that already tracks it.

### Four public lists, checked before they were trusted

Each answers a different question, and each was probed before a line was written
against it:

| source | gives | added | note |
|---|---|---|---|
| [github/explore](https://github.com/github/explore) | 1,251 topics with aliases, descriptions, homepages | **930** | one tarball |
| [Linguist](https://github.com/github-linguist/linguist) | 629 languages, 174 with aliases | **460** | what GitHub counts as a language |
| [CNCF landscape](https://github.com/cncf/landscape) | 255 projects, pre-categorised, with maturity | **225** | see below |
| [SO tag synonyms](https://api.stackexchange.com/docs/synonyms) | hand-curated alias mapping | 444 aliases | CC BY-SA 4.0 |

**707 → 2,323 entries · 3,333 → 3,948 aliases · 0 → 1,447 descriptions · 0 → 978
homepages.**

Three things the probing changed:

- **The CNCF landscape is 2,414 items and only 255 are projects.** The rest are
  member companies and commercial products. Importing the lot would have added
  two thousand entries that will never appear in a story, and duplicated the
  company registry while doing it. `project:` is the filter.
- **Stack Overflow caps unauthenticated paging at 25 pages**, whatever the daily
  quota says — page 26 returns `access_denied`. So the ceiling is 2,500 synonyms
  of 5,329 without a key. That is why the request sorts by `applied` descending:
  if only half can be had, the half worth having is the half people use.
  `react → reactjs` has been applied 99,800 times; the tail is single digits.
- **`search/topics?q=is:featured` returns 16 results**, not a corpus. It is
  GitHub's hand-picked feature list, not a bulk source — github/explore is.

Synonyms **never create an entry**. A synonym is evidence that two names mean the
same thing, not evidence that the thing belongs here, and Stack Overflow has tags
for `arrays`, `loops` and `if-statement`. 1,886 of the 2,500 pointed at tags this
vocabulary does not have, and all 1,886 were ignored.

Stack Exchange content is CC BY-SA 4.0, so every page carries attribution in the
footer. That is a licence obligation, not a courtesy.

### Keys raise ceilings; nothing depends on one

Four external keys, all free, all optional. None of them enables a feature — each
raises a limit, which is precisely why a missing one is easy to miss: the import
just comes back smaller.

| key | with it | without it |
|---|---|---|
| `GITHUB_TOKEN` | 5,000 API requests an hour | 60, shared per IP |
| `STACKEXCHANGE_KEY` | all 5,329 synonyms | the 2,500 most-applied |
| `LIBRARIES_IO_KEY` | packages ranked by dependents | source skipped |
| `NVD_API_KEY` | 50 requests / 30s for CVEs | 5 — and nothing reads it yet |

`GITHUB_TOKEN` was already in `.env` and unused by the importers; wiring it in
took the ceiling from 60 requests an hour to 5,000, confirmed against
`/rate_limit`.

They live in the environment and **not** in `app_settings`, unlike every other
knob. A secret a web form can write is a secret a web page can leak, so
`/settings` shows only whether each one is *configured* — never its value — with
a link to where a free one comes from. The importers print the same summary
before they start.

### Every entry has a parent

The taxonomy is a tree and was behaving like a list: **1,617 of 2,323 entries had
no parent**, so the registry printed "a root of the taxonomy" on seventy per cent
of the vocabulary and `stack_expand` had nothing to expand.

The 689 curated relationships were left alone, because they are better than any
rule could be — `django → python` says *a Python framework*, not merely *a
framework*. What the imports left behind is different: an entry with a category
and no position. Category is the one property every entry has, so it decides
where an orphan hangs.

```
Programming Languages → Python
Programming Languages → Python → Django
Programming Languages → JavaScript → Deno
Infrastructure        → Kubernetes → Helm
Domains               → Frontend   → React
```

**1,634 roots → 19.** Depth 1→19, 2→1,959, 3→311, 4→40, 5→1, no cycles — checked
with a recursive walk that carries the visited set, because a tree with a cycle
in it is not a tree and `stack_expand` would loop forever on one.

Seven category roots had to be created (Frameworks, Libraries, Runtimes,
Databases, Protocols, Tooling, Domains); the other twelve already existed as
curated field roots and were reused. Creating a second "Language" root beside the
`languages` that already had 49 hand-placed children would have split the tree in
two.

### Tagging had to become free too

`stories.stacks` was written by the classification pass and by nothing else,
which made the vocabulary inert in both directions: with the model gate shut
nothing was tagged, and adding an entry did nothing to the 3,500 stories already
in the archive that mention it.

Alias matching is plain string work — no inference, no budget, no gate. The
model's job was never to know that `k8s` means Kubernetes; a lookup table knows
that. Its job is to judge what a story *means*. So tagging now runs on
everything, always, and classification keeps the judgement. It took untagged
stories from **1,595 to 487** with no model call at all.

Matching is conservative in the way company tagging had to become, and the rule
that decides is *being an English word*, not being short:

| title | tags |
|---|---|
| `Go 1.24 is out` | `go` |
| `Let it go: why we moved off Kubernetes` | `kubernetes` — not `go` |
| `The D language gets a new frontend` | `frontend` — not `d` |
| `Migrating to k8s at scale` | `kubernetes` |

The first version used "four characters or fewer needs a capital", which quietly
refused to match `k8s`, `npm`, `jq` and `vim` — names nobody has ever
capitalised. A test caught it; `npm` went from 0 stories to 19.

The list of words needing a capital is maintained by reading what the tagger
actually claimed, because the failures are not guessable in advance:

| title | tagged | why |
|---|---|---|
| `Ukraine unveils native jet-powered drone interceptor` | `woodpecker-ci` | Woodpecker was Drone CI |
| `an automatic transmission to cargo bikes` | `rust` | `cargo` is Rust's build tool |
| `Xtracycle's Swoop ASM e-bike` | `assembly` | `asm` |

None of those is a bad alias — each is the real name of a real project. They are
ordinary nouns as well, and in headlines the ordinary noun wins by a wide
margin. Being on the list does not remove an entry from the vocabulary; it
raises the evidence it needs to the capitalised form the project writes itself,
which is the same bar `Go` and `Rust` already clear.

Both passes run inside the ordinary processing cycle, so the list is live rather
than fixed. `npm run discover` runs them on demand.

---

## English only, and why that is a decision rather than a default

Collection ran in four languages on the theory that a Japanese release note or a
German advisory often lands days before the English write-up. That theory is
sound and the implementation was not: **none** of the 296 non-English stories in
the archive had a translated title, because title translation sits behind the
classification gate, which is off. The reader was showing headlines nobody using
this system could read.

So English is now the whole pipeline's answer, in two places that do different
jobs:

- **Collection** (`ALLOWED_LANGUAGES`, default `en`) decides what enters the
  archive at all. It is still on the settings page, because widening it is a
  reasonable thing to want — with translation switched on.
- **Reading** filters on `(lang = 'en' OR title_en IS NOT NULL)` — *readable in
  English*, which is not the same as *written in English*. The 296 existing rows
  stay in the archive, exactly as nothing is ever deleted; they are simply not
  shown. If translation is ever switched on they reappear on their own, with no
  code change, which is the whole reason the clause is written that way.

Language has therefore stopped being a filter facet, and there is no language
control in the reader at all.

---

## Reading without leaving

Every row carries a **read** button (`v` from the keyboard). It fetches the page
*now*, extracts the text, and shows it in a modal with the original one click
away.

Nothing is stored. No article body is ever written to the database — that is a
founding constraint, not an implementation detail — so this holds the text in
memory for ten minutes, which is long enough that closing and reopening a story
costs one fetch and short enough that it is nobody's archive.

What crosses to the browser is **typed blocks of plain text**, never third-party
HTML:

```ts
export type BlockKind = 'p' | 'h' | 'li' | 'quote' | 'code';
```

and the client renders them with `textContent`. No markup from a publisher's page
is ever parsed by the browser, so there is no sanitizer to get subtly wrong —
this is the only version of the feature that is safe by construction.

**A reading request is not a crawl.** A crawler identifies itself as one and
takes what it is given; this is one person opening one article they were already
shown a link to. Plenty of publishers answer a bare library user agent with 403
and serve the identical page to a normal one, so a refusal aimed at the user
agent gets **one** retry asked the way a browser asks — once, never a loop. On a
20-story sample across Azure, GitHub and smaller hosts, 19 read cleanly.

**Failure degrades rather than dead-ends.** When a page genuinely cannot be read
— JavaScript-rendered, walled, or a publisher that means it, like npmjs.com —
the modal says *which* of those happened in plain words, then shows the stored
summary underneath, labelled as the summary and not as the article. A PDF or an
image says what it is instead of being parsed into plausible nonsense.

---

## Settings: an overlay, not a replacement

Configuration comes from the environment and that stays the floor — a Worker has
no other way to be told anything before its first request. What the environment
cannot do is let anyone change a value while the system runs, and a knob nobody
can reach is not a knob.

So resolution has exactly two layers:

```
app_settings row  →  environment variable  →  the code's own default
```

Two rules keep the page from becoming a wall of controls that do nothing:

1. **Every field maps to a value the running code actually reads.** The test
   suite asserts it: each config-scoped key must resolve to a real path in
   `Config`, or the build fails. Anything not on the page is a decision the code
   owns — a knob that looks configurable but is ignored is worse than a constant.
2. **Only values that DIFFER from the environment are stored.** Saving a field
   back to its environment value removes the row, so the table always reads as
   "what someone deliberately changed", and a later `.env` edit still shows
   through everywhere nobody has overridden it.

Every row says where its value came from — *custom*, *environment* or *default* —
and prints what the environment would say underneath. A settings page that cannot
answer "why is it this number" is just a form.

Stored values are validated on **every read**, not on write: definitions change
with the code and rows do not, so a value that no longer fits is ignored and the
environment shows through, which is the same outcome as never having set it.

Changes are kept the way stories are — superseded, never deleted. That includes
*clearing* an override, which is the one action that reverts behaviour and would
otherwise be the one action the audit trail could not see. Two migrations exist
purely to get this right without over-granting: the history trigger is
`SECURITY DEFINER` with a pinned `search_path`, so the app role can cause history
rows as a side effect of a real change but cannot write, forge or backdate them
directly.

---

## Nothing here ran unless somebody typed

This is the defect that mattered most, and it was invisible because the person
who would notice it was the person typing.

Every job this system needs already existed and was good. None of them ran on its
own. There were two half-schedulers and neither ran everything:

| | `npm run live` | the Worker cron |
|---|---|---|
| Poll due sources | yes | yes |
| Snapshots | yes | yes |
| Tagging | yes | yes |
| Dedup, classify, score | **no** | yes |
| Vocabulary discovery | **no** | yes |
| Monthly rollup | **no** | **no** |
| Retention prune | **no** | **no** |
| Release feeds follow Settings | **no** | **no** |

The bottom three rows are the archive's contract. "One month of news, analysis
forever, favourites exempt" and "two months in the database" are not settings —
they are promises, and a promise kept by remembering to run `npm run rollup && npm
run retain -- --yes` is not a promise, it is a plan. The Worker cron, which had
the most of it, ran on a deployment that does not exist.

### One scheduler, and the schedule lives in the database

`src/run/scheduler.ts` runs everything, and `job_runs` holds when each job is next
due. That table rather than `setInterval` for three reasons, each of which is a
failure that had to be made impossible:

**It survives a restart.** `next_run_at` is a fact about the archive, not about
the process. A deploy at 03:02 must not skip the 03:10 rollup, and must not run it
twice because two containers came up.

**It is exclusive.** A job is taken with one statement whose `WHERE` clause holds
everything that decides whether this runner may proceed:

```sql
UPDATE job_runs SET running_since = now(), runner = $2
 WHERE name = $1 AND enabled AND next_run_at <= now()
   AND (running_since IS NULL
        OR running_since < now() - make_interval(secs => lease_seconds))
RETURNING name
```

Two runners racing produce one winner and one empty result. There is no lock
table, no leader election, and no window in which both believe they won — which is
what lets this be deployed as more than one container without the collector
polling every feed twice. A runner that dies holding a claim costs one lease, not
a job that never runs again.

Two runners are also allowed to disagree about their catalogues — a container
with `PROCESSING_ENABLED=0` does not build `process` or `discover`. So a runner
never deletes a row it does not recognise, which was the first version and was
wrong: it would have silently unscheduled work another container was doing
correctly. An unrecognised row survives and reads as *not scheduled here* rather
than as overdue.

**It is observable.** "Did collection run, how long did it take, what did it say"
is a `SELECT`, not a question about a log file on a host nobody can reach.
`/admin/jobs` is that SELECT.

### The schedule

| job | when | what |
|---|---|---|
| `collect` | 30s | poll every source its own interval says is due |
| `snapshot` | 60s | capture coverage-curve points that have come due |
| `tag` | 2m | match new stories against the three vocabularies |
| `process` | 10m | dedup, then classify, then score |
| `tune` | 1h | move intervals toward observed rate; keep partitions ahead |
| `discover` | 6h | propose vocabulary entries; refresh technology rarity |
| `releases` | 6h | make release feeds match Settings, **both directions** |
| `rollup` | 03:00 | reduce every settled month to analysis that outlives it |
| `retain` | 03:00 | delete what is past the window, once its analysis is safe |
| `lapsed` | 04:00 | favourites released more than the grace window ago |

`tag` is not behind the processing switch and runs close behind collection rather
than with the model work. An untagged story is an **invisible** story — News
narrows by `stories.stacks && stack_expand(fields)` — and tagging is string
matching against a closed vocabulary: no model, no budget, no gate.

The order of the daily three is not a preference. Retention refuses to delete a
month whose analysis does not exist; rollup is what clears that condition. If
rollup fails, retain runs, finds an unrolled month, **refuses, and records why** —
which is the correct outcome and visible on the page. There is a test holding
`rollup.atHour <= retain.atHour`, because if those ever swap, retention fails
every night while reporting itself healthy.

### Failure is recorded, not retried in a loop

The delay doubles per consecutive failure to a ceiling of sixteen intervals. A
cause that will clear on its own — a failover, an expired token — is retried soon;
one that will not stops costing anything within the hour.

The exponent is capped *before* the power, and that is not defensive tidiness:
`power(2, 41)::int` raises `integer out of range`, so the first version of the
expression meant a job that had failed forty times could no longer record that it
had failed again — the one moment the bookkeeping matters most.

### Collection now follows the reader in both directions

`sync:releases --tracked` only ever *added* feeds. A technology you stopped
following kept costing a request an hour forever, and the only way to stop it was
to notice and delete a row. The `releases` job does both halves: tracked and
uncollected gets probed and added, collected and untracked gets **paused**.

Paused, not deleted. A source row is the provenance of every story that came from
it, and `stories.source_id` is `ON DELETE NO ACTION` precisely so that a
bookkeeping decision cannot quietly detach an archived story from where it came
from.

### What automation changed about retention

`VACUUM FULL` rewrites a table under an `ACCESS EXCLUSIVE` lock — every read of
`stories` blocks for its duration. That is a fine trade for a command a person
runs while watching it, and an **outage** when a scheduler starts it at 03:40
without telling anybody. So the scheduled prune uses plain `VACUUM`: pages are
marked reusable and nothing blocks.

The consequence is that size on disk stops falling on its own, and that is the
correct trade. The archive's contract is about what is **held**, not about what
the platform bills, and a site that stops answering for a minute every night to
save a few megabytes is a worse system than one that does not. `npm run retain --
--yes --vacuum-full` hands the bytes back, deliberately, while somebody is looking
at it.

### The two old runners

`npm run live` is now a thin alias for the worker half — same jobs, same claims —
so the muscle memory still works and can no longer double-collect. The Cloudflare
Worker **defers**: it checks whether any job finished in the last ten minutes and
returns `{skipped}` if so. It is still a usable fallback if the container is down;
it is no longer a second collector racing the first.

## 84KB on every page, and nobody noticed because it was local

Every page inlined the entire design system and every behaviour: measured on the
overview page, **58,843 bytes of CSS and 25,199 of JavaScript**, in the HTML, on
every single navigation. There was no `content-encoding` header anywhere in the
server, so that is what the browser actually received.

It cost nothing locally, which is exactly why it survived. On a loopback socket
84KB is a rounding error; on a deployed site it is the difference between a page
that appears and a page that arrives.

Three changes, all of them ordinary:

**Content-hashed static files.** The CSS and one concatenated script are served
from `/_/app.<hash>.css` and `.js`. The URL contains a hash of the content, so
`cache-control: immutable` is a statement of fact rather than a hope — that URL
cannot ever hold different bytes, because the bytes are what named it. Change the
CSS and the URL changes with it: there is no cache to bust and no version query
string to remember to bump. Nine `<script>` blocks became one; each was already an
IIFE, since classic scripts share a global scope, so concatenating them in order
is exactly equivalent and is one request rather than nine.

**Compression.** gzip for HTML, brotli for the static files. The split is
deliberate: HTML is compressed on every request, where brotli at a quality that
beats gzip is several times the CPU for a few percent of the bytes; the static
files are compressed **once at startup**, where that trade runs the other way.

**ETags.** A reload that changed nothing costs a 304 with no body — the common
case for a page somebody is watching.

What a browser now receives on a first visit, measured:

| page | before | after | |
|---|---|---|---|
| `/` | 111,996 b | 5,969 b | 18.8x |
| `/news` | 240,312 b | 19,141 b | 12.6x |
| `/all` | 239,623 b | 19,521 b | 12.3x |
| `/stacks` | 446,919 b | 32,657 b | 13.7x |
| `/technologies` | 151,239 b | 8,162 b | 18.5x |

Plus 18.9KB of brotli'd CSS and script, once, then never again.

### Nine stories in ten claimed a corroboration that did not exist

A story page reported **Coverage: 2 outlets**, drew a coverage curve peaking at
2, and listed, under *Also carried by*, the publisher of the story itself. One
outlet, counted twice, three times over.

`story_members` holds two different things under one shape. A layer-2/3/4 merge
records the OTHER outlet that carried a story — that is what coverage means and
what the table exists for. Layer 1 records a second ADDRESS for the same item
from the same publisher, which is the feed link and the page's `rel=canonical`
disagreeing over a tracking parameter. Both writers of `coverage_count` counted
`1 + count(DISTINCT source_id)` across all of it:

```sql
-- before
SELECT 1 + count(DISTINCT source_id) FROM story_members WHERE story_id = $1
-- after
SELECT 1 + count(DISTINCT m.source_id) FROM story_members m
 WHERE m.story_id = s.id AND m.source_id <> s.source_id
```

The scale is the part worth recording. **487 of 542 live stories** — nine in ten
— read as two outlets, and **not one story in the archive genuinely had coverage
above one.** A field that is wrong on 90% of rows and right on none is not a
display defect: `coverage_count` feeds the niche score (inverse coverage), the
ranking, the monthly rollups' `outlet_mentions`, and every coverage snapshot. The
chart reading "peak 2 in one bucket" was this bug drawn as a picture.

Migration 0047 repairs both. The snapshots are repaired too, which needs a word,
because the page says a coverage curve cannot be reconstructed later and that is
true: how many outlets carried a story at +6h is knowable only at +6h, and
writing today's figure into that slot would be a fabrication. This is a different
operation. Every member row carries `seen_at`, so *how many other outlets had
been seen by the moment this snapshot was captured* is a fact that was already
recorded at the time. Correcting arithmetic over retained evidence is not
inventing a measurement — and that distinction is the entire reason `seen_at` is
kept.

One footnote on sequencing: the migration ran while the old code was still
serving, and `collect` put the inflated values straight back for every story it
touched. A backfill and the code that writes the field are one change, and
applying them in the wrong order means doing the backfill twice.

### The story page was a worse copy of the publisher's page

A changelog entry is one line long. Reproducing that line under a heading, beside
four model scores and a chart of a single number, is a worse version of what the
publisher already serves — which is a fair description of what this page was.

What this archive holds and the publisher's page does not is everything AROUND
the entry, so that is what the page now shows:

- **Around this, from &lt;source&gt;** — the same publisher's entries either side of
  this one, as one column with this entry marked in place rather than two lists
  labelled "before" and "after" for the reader to interleave. "The Realtime API
  went GA" reads differently next to "the Realtime API was repriced last week",
  and holding both is the only thing this system can do that the changelog cannot.
- **Elsewhere on &lt;technologies&gt;** — the same technologies as other people
  shipped them.
- **Also published at** — the same-source alternate URLs, shown under what they
  actually are instead of dressed up as coverage.

Sections with nothing in them do not render. The coverage curve already hid
itself for a single-outlet story; *Also carried by* now does the same.

**One shared tag is not a relationship.** Matching on `stacks && stacks` returned,
for a story tagged `openai` and `api`: an Amazon Cognito TOTP endpoint, a Bind
vulnerability notice, and an Apigee point release. Every one a correct match on
`api`; not one of them related to anything. Inverse document frequency was the
obvious reach and does not help here — `api` sits on 41 of 543 stories, which IDF
scores as perfectly discriminating. The tag is not rare, it is BROAD, and rarity
does not measure breadth. So the rule is agreement rather than weighting: share
at least two tags where the story has two to share. The same page then returns
one result — Google Cloud's "API Gateway: route LLM requests, OpenAI-compatible"
— which is the answer. It returns nothing fairly often, and an empty space is the
honest rendering of "nothing here is related".

Both queries are bounded and indexed (`stories_source_idx`, the GIN
`stories_stacks_idx`) and run inside the `Promise.all` that was already there, so
the page costs the round trip it always did: **~0.13s warm, 5.0KB gzipped.**

### Going back threw away the filters

Narrow News to a stack, open a story, come back — and you are on an unfiltered
News, with the narrowing to do again. The reader experiences this as the site
forgetting. It was the site discarding.

Both back paths were built from the referer's `pathname`:

```ts
const path = new URL(referer, 'http://localhost').pathname;   // /news
```

Every filter this application has lives in the query string —
`/news?kind2=change&stack=openai&sort=new` — which is precisely the part that
expression drops. The story page did not even consult the referer: its
breadcrumb was the literal string `/news`.

`backFrom()` in `src/ui/nav.ts` now serves both, and carries the query. The path
is still matched against a fixed list rather than echoed, because a referer is
supplied by whoever links here; the query rides along unvalidated, deliberately,
because the filter parser already ignores parameters it does not recognise and
this value is only ever used as a **relative** href. A referer of
`https://evil.example/news?kind2=change` yields `/news?kind2=change` — the host
comes from the allowlisted path and never from the referer, which is the one
property worth a test of its own.

Two labels, not one: `label` is a breadcrumb noun and `phrase` completes "Back
to …". The same destination needs both, and they are not interchangeable —
"Back to Explore" and "the reader / Story" each read like a bug.

Coming from another story record, or from nowhere at all, still falls back to
News. What does not happen any more is falling back when the answer was sitting
in the referer.

And then: **there was no back button.** The story record's only way back was the
eyebrow trail — `NEWS / STORY`, ten-pixel dim capitals above the title — which is
a breadcrumb, not an affordance. A breadcrumb says where you ARE; the title
beside it already said that. So the trail is gone from that page and both the
story and read records now carry one `.backlink` control that says where the
click GOES and is shaped like something you press: "Back to News", "Back to the
search results", "Back to the story record". Named destination, arrow that moves
on hover, and `prefers-reduced-motion` respected.

### A chart that measured the observer

A technology page led with **Story volume, by month published**. For C++ that is
nine years of empty buckets and one bar at the right-hand end — because the
archive is two months old and C++ is forty. The chart was a picture of when this
system started paying attention, presented as a fact about C++.

What a reader wants from a technology page is how big the thing is. The honest
available answer is how many public projects carry its GitHub topic:

| topic | public repos |
|---|---|
| rust | 119,298 |
| postgresql | 113,068 |
| cpp | 101,630 |
| kubernetes | 51,355 |
| openai | 42,981 |
| astro | 12,821 |
| llama-cpp | 2,511 |

The slugs land on GitHub topics directly, which is not luck: much of this
vocabulary was imported *from* GitHub topics.

**It is not a count of developers, and there is no such number to have.** Not
from GitHub, not Stack Overflow, not libraries.io. Every available proxy measures
something else — stars are interest in one repository, questions are confusion,
downloads are continuous integration. So the page says what was counted, in the
words of what was counted, and `stars` is stored under its own name rather than
folded into a total that would then mean nothing. A column called `developers`
holding something that is not developers is the failure this schema refuses
everywhere else.

A number alone cannot answer "is 12,821 a lot", so the panel ranks the
technology against the largest things in its own category and keeps it in its
place in that order — where it *falls* among its neighbours is the information,
so pinning it to the top would throw that away.

**The rate limit shaped the design.** GitHub's search quota is 30 requests a
*minute*, counted separately from the 5,000-an-hour core quota. Twenty
technologies every fifteen minutes fits inside it with room for the star
lookups, and brings 1,361 technologies round in about seventeen hours. An
adoption figure does not move in an hour, so that is the correct rate to ask at
rather than a concession. Stars come from the core quota and are therefore
nearly free beside the search call.

`measured_at` is on every row, because an adoption number without a date is a
rumour, and `projects` is nullable so that *not measured* and *nobody uses it*
stay distinguishable — a column defaulting to 0 makes those identical and only
one of them is a fact.

One bug worth keeping, found while writing the due query:

```sql
WHERE a.measured_at IS NULL
   OR a.measured_at < now() - ... AND (a.failed_at IS NULL OR ...)
```

`AND` binds tighter than `OR`, so that reads *never measured, OR (stale AND not
backing off)* — and a technology that has never been measured because it fails
every time is never measured and never backing off. It would have returned in
every slice forever and crowded out everything that had not been asked yet. Both
halves are parenthesised now.

### Three ways a page can break that a test does not catch

**A headline ran out through the side of its card.** `trunk/52d08b9519e82b71ababd…`
and `[PyTorch][jit] Avoid IValue copies in unpickler (#193250)` are single
unbroken tokens, and wrapping at spaces has nowhere to break one. `overflow-wrap:
anywhere` breaks mid-token only when the alternative is overflow, so ordinary
prose is untouched; `min-width:0` on the grid item because a grid track otherwise
refuses to shrink below its longest word whatever the wrapping says.

**"Sort" rendered as "So".** `.row` sets a wide column gap, and `.row label`
cancelled it with a negative margin — `calc(7px - var(--s-5))` — so a label sits
7px from its own control while unrelated controls stay far apart. The two numbers
have to agree, and a form overrode `gap` inline to `7px` while the label went on
subtracting `--s-5` from it. The select slid left across its own label. The gap
is a variable now, so overriding it moves both halves of the calculation
together; seven other rows were overriding `gap` the same way and are converted.

**A card said `NICHE 1.00 inverse coverage`.** That explains itself to whoever
wrote it. The explanation existed — in the source, and in this file, which are
the two places a reader of the page is not. Cards now take a `help` string,
rendered as a hover tooltip off `data-tip` and, in the same breath, as a
visually-hidden span in the document. No `tabindex` is added to the plain card
divs: that would put a tab stop on every statistic in the archive to deliver text
already available to assistive technology. The tooltip is the pointer user's copy
of that sentence, not the only copy.

### A technology page that never said what the technology was

The page could tell you how often a thing had been in the news, how many
projects carried its topic and which outlets covered it. It could not tell you
what it *was*. A reader who has just met the name learns nothing from a story
count.

It now opens with the background: what the thing is, who makes it, when it
appeared, what licence it carries, what it is written in. Apache Kafka reads as
"a distributed event store and stream-processing platform… developed by the
Apache Software Foundation, written in Java and Scala", made by the Apache
Software Foundation, appeared 2010, Apache 2.0. The maker links through to the
company page when it is one this archive already tracks.

**Not written by a model, and that is the whole design.** A model would produce
a fluent paragraph about any of these 2,330 technologies without consulting
anything, and some of those paragraphs would be wrong in ways no reader of this
page could detect. Every value is copied from Wikidata or Wikipedia and carries
the URL it came from. The summary is CC BY-SA 4.0, so the table refuses to hold
one without `source_url` and `source_license` — attribution is a licence
condition, and a condition enforced by a `CHECK` is one that cannot be forgotten
later.

**Resolution is the dangerous part.** "Rust" is a video game, a fungal disease
and a programming language, and searching Wikipedia for it returns the game. A
wrong match here would put a confident, sourced, entirely irrelevant paragraph
on a technology page — worse than the blank it replaced. So a candidate is
accepted only when something confirms it beyond the name:

| confirmation | how | covers |
|---|---|---|
| `repo` | the item's source repository is the one already recorded here | 1,006 of 2,330 |
| `website` | its official site is the one already recorded here | 978 of 2,330 |
| `typed` | Wikidata says it is an instance of a technology type we allowlist | the remainder |

Anything else is recorded as unresolved, *with the candidates it rejected*, so a
gap can explain itself instead of being re-investigated by hand forever. The
page prints the weaker confirmation as what it is — "matched by type only, not
by a repository or site we already hold" — because flattening that into the same
confidence as a repository match would be the quiet kind of dishonesty.

The type list is an allowlist rather than a denylist on purpose: a denylist
accepts everything unforeseen, and what gets accepted here is printed as fact.

First pass: **5 resolved, 5 unconfirmed, 29 requests, 4.4s.** Half refused is the
gate working, not the gate failing.

**One field is deliberately collected and not shown.** Wikidata has P348, latest
version, and it gave Kafka as `0.8.1.1` while Kafka was on 3.x. This archive
polls release feeds and already knows the current version from a source that is
authoritative and dated. Printing a stale one would contradict the same page a
few sections further down, so the claim is stored and not rendered.

Ordering puts technologies that actually appear in the archive first — 279 of
2,330 — so the pages a reader can reach from a story are filled in within hours
rather than the days a flat pass would take. Platforms come through the same job;
tools need nothing extra, because a tool is a stack with a kind.

### The platform registry is not what the site says it is

Three complaints about the platform pages — no sort, too few platforms, thin
detail — turned out to have one cause, and it is worth writing down because the
code says so in the first line of the seed file:

```
// Earning platforms.
//
// The Phase 7 registry, seeded with IDENTITY only: slug, name, URL, channel
// and status. Not one fee, payout threshold or country restriction is written
// here, and that is deliberate.
```

These 56 rows are where a **developer gets paid** — freelance marketplaces,
bounties, stock media, teaching, creator tips. Ten channels, hand-curated,
belonging to a Phase 7 feature that was never built. The site's own rail
meanwhile says *"Platforms are where a thing runs or is sold."* Those are two
different registries wearing one name.

So the count is small because it was hand-written for a different purpose, not
because collection failed. The detail was thin because the seed deliberately
wrote identity only and left the facts to `platform_facts` — which models a fact
as a value with a source URL, a confidence and a validity window, and has never
had a row in it, because the watcher that would fill it was part of the same
unbuilt phase.

**Sort was simply missing.** Five orders now, and the key is looked up in a map
whose *value* is interpolated — an ORDER BY built from a query parameter is an
injection with extra steps, so the request never touches the SQL. There is a
test that a dropped table does not come back.

The link-health order shipped with a bug I caught while testing it:

```sql
CASE h.state WHEN 'ok' THEN 3 WHEN 'blocked' THEN 2 WHEN NULL THEN 1 ELSE 0 END
```

A simple `CASE` compares with `=`, and `NULL = NULL` is unknown rather than
true, so `WHEN NULL` never matches and every never-checked platform fell to
`ELSE` — sorting as though it were the most broken thing in the registry. It is a
searched `CASE` now, and a test asserts no order clause contains `WHEN NULL`.

**The detail is fixed by the same background panel the technology pages use**,
once its confirmation gate learned that a platform is not a technology. Checking
marketplaces against a list of programming-language and framework types refused
two thirds of them. The platform allowlist was measured rather than guessed —
app marketplace, freelance marketplace, digital distribution platform, patronage
website — and the interesting half is what it leaves out. The commonest types on
these articles are `business`, `enterprise`, `organization` and `website`, and
every one is useless as confirmation: they would accept almost any company a name
search returned, which is the wrong-match problem in a different hat. A type
confirms only when being that type means the article is about the kind of thing
we were looking for.

Platform resolution went from **3 of 9 to 6 of 9**. Apple's App Store now reads
as an app marketplace made by Apple Inc., appeared 2008, proprietary. Algora, Arc
and AWS Activate are still refused, which is correct: two are small companies
with no article and one is a credits programme rather than a product.

### And then the registry itself

The count was the third complaint and the honest answer was that the registry was
the wrong one. It now holds 65 places software runs and ships — clouds, package
registries, app and extension stores, model hosts, CI, managed data — seeded and
URL-checked in one pass: **64 of 65 answered.** Azure is recorded as `unknown`,
which is the truthful answer: it returns 200 to curl and times out to Node's
fetch, and "we could not tell" is a different claim from "it is down".

The 49 earning platforms are **retired, not deleted**. `platform_month` keys 85
rows of history by slug with no foreign key, so deleting would leave months of
counts pointing at nothing — no error, no constraint violation, just quiet
nonsense. `platform_facts`, `platform_signals` and `page_watches` reference
`platforms.id` and would have refused outright, which is the same objection said
louder. A retired page still resolves and says why it is not listed.

**The re-tag that was measured and then not done.** New registry, so the obvious
next step was to clear `platforms_tagged_at` and let the tagger run over the
archive. Measured first, as a dry run over all 550 live stories, writing nothing:
it would have produced **nine tags, most of them wrong.** "USN-8658-3: Linux
kernel vulnerabilities" matched both Azure and AWS, because Ubuntu ships kernel
variants called `linux-azure` and `linux-aws`. Nine mostly-wrong tags is a worse
archive, not a fuller one, so the re-tag did not happen.

The dry run also explained itself. The platform tagger has a collision rule —
where a name is both a technology and a platform, the technology wins — and
against the new registry it excluded **32 of the 65 names**: Cloudflare, Vercel,
npm, PyPI, Supabase, GitHub Actions, every platform anybody would actually open.
The rule is right. The stories exist and are tagged correctly; they are just
tagged to the *technology*.

So the platform page reads through to it (0051) rather than competing with it:

| platform | reads through | stories |
|---|---|---|
| Cloudflare | `cloudflare` | 60 |
| Microsoft Azure | `azure` | 55 |
| Amazon Web Services | `aws` | 20 |
| Google Cloud | `gcp` | 18 |

The mapping is a stored column, not name matching at query time — `google-cloud`
maps to `gcp` and `pypi` to `pip`, so it is not derivable from the slug and
belongs somewhere it can be corrected by hand. 34 of 65 platforms map to a
technology; the rest are platforms and nothing else, which is also fine.

Platforms with something to show went from **5 to 17**, and the detail page says
which technology it is reading through instead of pretending the stories were
tagged to it.

### One line per row, and the gate that let nine wrong ones through

A list of sixty-five platforms said what each one was called and nothing about
what it was. `entity_reference.summary` is Wikipedia's lead paragraph — right for
the top of a detail page, far too long for a row somebody is scanning.

Wikidata carries a separate field for exactly this: a short description written
to disambiguate an item in a list. *"digital software distribution platform from
Google"*. *"software package manager for macOS and Linux"*. One line, no markup,
already written and already licensed, and free to collect — the same
`wbgetentities` call that fetches the claims returns it when asked. Stored in its
own column rather than truncated out of the summary, because the first sentence
of a paragraph is not a description and cutting one to length produces neither.

Rows resolved before the column existed are treated as due rather than waiting
out the 90-day staleness window, so the archive fills itself in instead of
needing a backfill run by hand.

**Then the descriptions showed me a bug I had shipped.** Reading the new one-line
summaries as they landed:

| platform | resolved to | |
|---|---|---|
| Maven Central | Apache Maven | ✗ |
| Artifact Hub | Helm (package manager) | ✗ |
| Go package index | Apk (file format) | ✗ |
| Buy Me a Coffee | Patreon | ✗ |
| Flathub | Flatpak | ✗ |
| GitLab CI/CD | Forgejo | ✗ |
| Adobe Stock | Adobe Creative Suite | ✗ |
| Deno Deploy | Deno (software) | ✗ |
| MetaCPAN | CPAN | ✗ |

Every one passed the confirmation gate **honestly**. They are all package
managers and distribution platforms, which is what the type allowlist checks.
The error is in what I asked the gate to prove: **a type confirms a category, not
an identity.** Being a package manager does not make you Artifact Hub.

Every `website` and `repo` match, meanwhile, was correct — Linode, Google Cloud
Platform, Homebrew, Medium, and PyPI resolving to "Python Package Index", a title
that shares not one word with it. A URL already held here is much stronger
evidence than a name, which is the whole reason those two tiers exist.

So a type-only match now has to agree on the name as well: every significant word
of the subject must appear in the article title, with bracketed disambiguators
read as part of the title rather than discarded. "Maven Central" against "Apache
Maven" is missing `central` and fails. "Apple App Store" against "App Store
(Apple)" has all three and passes. The URL tiers are deliberately not gated this
way, so PyPI still resolves.

All 37 type-only rows were requeued and re-judged. The nine wrong matches are
gone and refused; nothing correct was lost. There is a test carrying all nine as
a regression list, because this is the exact failure the gate was built to
prevent and it got through anyway.

The same one-line summary now appears on every list that has rows: platforms,
stacks, tools and the per-category technology pages, falling back to the
vocabulary's own description where Wikidata has none.

### Checkboxes, a tail that folds away, and an axis that was already there

**The filter rows never said they combined.** They always did — clicking one adds
it to the selection rather than replacing it — but a plain list of links does not
say so, and it reads as a set of radio buttons. Every multi-select group now
draws a checkbox.

It is a styled box on a link, not an `<input type="checkbox">`, and that is a
choice rather than a shortcut. A real checkbox cannot be a link, so it needs a
form and a submit, and every row would stop being a shareable address for the
selection it produces — a property this rail has and should keep. The link is
also the only version that works with JavaScript off. So: a checkbox to look at
and to click, a link underneath, and `aria-current` telling assistive technology
which ones are on.

**"Also in these stories" was silently truncated to twelve.** The rest were not
hidden, they were *dropped* — the rail called `.slice(0, 12)` and the reader had
no way to know there were another two hundred. It is a disclosure now, and the
label counts what it is holding: "Show 6 more", not "more". The difference
between three and three hundred is the difference between opening it and not
bothering. Built on `<details>` so it opens without JavaScript, and **an active
row is never folded away** — collapsing something the reader has already chosen
makes the page look like it forgot.

**Nineteen categories that were already in the database.** The complaint was that
the types are too few, with freelancer.com's skill list offered as a source. The
vocabulary already holds **2,330 technologies across nineteen categories** —
broader than that list — and it was filterable on the registry and nowhere else.
Nothing needed importing; it needed exposing.

A FIELD is an area of work — Security, Cloud, AI & ML. A CATEGORY is what KIND of
thing the technology is — a language, a database, a framework. Those cut the same
archive along different axes, and only one of them was reachable from the reader.
Now both are, and they combine: `?category=db` gives 68, `?category=language`
116, both together 151, and `?category=db&field=security` narrows to the
intersection.

Category membership is a property of the vocabulary rather than of the taxonomy
tree, so it is a lookup and not a recursive descent — one scan of a 2,330-row
table that Postgres runs once per statement. Filtered pages come back in ~0.2s.

Extracting `CATEGORIES` for the query parser produced a circular import —
`filters → stacks → nav → filters` — which does not fail at build time. It fails
at *import* time, with `STREAMS` undefined and a stack trace pointing at a `.map`
three modules from the mistake. The list lives in `vocab/` now, importing
nothing, which is where a thing both the pages and the parser need belongs.

### Twenty more publishers, under the rule that cut the last three hundred

The other half of "the scope is very small" was 554 stories from ten news
sources. The registry was cut from 367 sources to those reporting that a
*technology* changed rather than that something happened at a company, and these
are added under that same rule: Docker, PostgreSQL, Python, PHP, Firefox, Chrome,
WebKit, Deno, Elastic, GitLab, Grafana, MongoDB, Redis, Debian, Fedora,
Terraform, Swift, Kotlin, .NET. Every one is a vendor publishing its own release
notes. No press, no opinion, no company marketing blog.

**Sources 42 → 82. Live stories 554 → 755 within four minutes of the first poll.**

### The one page that was genuinely slow

`/admin`, `/admin/health` and `/admin/jobs` all took **1.75s** against 50-500ms
for every other page. The cause was in `catalogue()`, which every admin page calls
to build its rail: list the tables, then `SELECT count(*)` from each, one round
trip at a time. Eighty-six tables, eighty-six round trips. The counting was never
the cost.

`query_to_xml` runs a query from a string and returns its result, which makes it
possible to count every table inside a single statement. It is not a trick to
reach for often and it earns its place here: the alternative that *is* one round
trip is `pg_class.reltuples`, an estimate that reads as `-1` for anything never
analysed, and a navigation menu that says a table has minus one rows is worse than
a slow one. The old loop survives as a fallback, because one unrunnable view
aborts the single statement while the loop degrades to `-1` for that row alone.

**1.78s to 0.45s** cold, and `/admin/jobs` to 0.05s warm.

## Admin was safe only because nobody could reach it

`/admin` runs on the **owner** connection. That is deliberate and correct for a
loopback tool — seeing every tenant's rows is the whole point of an admin view —
and it is a data breach the moment the port is reachable, because the owner role
bypasses row-level security by design. The server bound `127.0.0.1` and a comment
said why, which is a control that survives exactly until somebody needs to deploy
it.

The rule is not "add a password". It is that **the privilege and the exposure
cannot both be true**:

- `HOST` defaults to `127.0.0.1`. Binding every interface is opt-in, because doing
  it by default is how a development server ends up on the internet.
- On a public bind with no `ADMIN_TOKEN`, `/admin` serves **nothing at all** — the
  check runs before `catalogue()`, which is the first owner-connection query.
- With `ADMIN_TOKEN` set, only a request carrying it gets through, compared in
  constant time so it cannot be probed a character at a time.

There is no configuration in which an unauthenticated request from off-host
reaches an owner-connection query.

The scheduler makes the same split for the same reason. It holds two connections:
`worker_user` (NOBYPASSRLS) for everything that collects, tags and processes, and
the owner **only** for the two jobs that genuinely need it — creating next month's
partition, which is DDL, and deleting stories, which is not granted to the
collecting role on purpose. A process that can collect should not also be able to
erase what it collected. There is a test holding that too.

## Running it on a PC

```
npm run build:app -- --with-postgres --with-env
dist\NewsTrack\NewsTrack.exe
```

The output is a folder. There is no installer and nothing touches the registry:
the folder **is** the program, deleting it uninstalls it, and replacing it with a
newer one is the upgrade. Data lives in `%LOCALAPPDATA%\NewsTrack` — the cluster,
the logs and the configuration — so an upgrade cannot delete the archive and the
program folder never has to be writable.

`NewsTrack.exe` is 4 KB of C# (`src/launcher/shim.cs`). It finds `runtime\node.exe`,
hands it `src/launcher/launch.ts`, and returns its exit code. Every decision —
which database, which port, when to migrate, when to seed — is in the TypeScript,
where it can be read and changed without a compiler.

### Why not a single executable

Node 22 can bundle a script into a copy of `node.exe`, and that was the first
attempt. `postject`, the tool that injects the blob, loads the whole 92 MB binary
into a LIEF wasm heap and dies with `Fatal process out of memory: Zone` on a
machine with 8 GB. `--max-old-space-size` does not help: the allocation that fails
is wasm's, not V8's.

`csc.exe` has shipped inside Windows since Vista. No download, no npm dependency,
no toolchain, 4 KB instead of 190 MB — and the source stays readable in the folder
rather than sealed inside a binary.

### The order, which is not arbitrary

| step | | skipped when |
|---|---|---|
| config | what the user chose beats anything invented | it exists |
| database | a configured one is used **or fails** | — |
| migrate | as the owner, before anything else connects | already applied |
| roles | so the app half runs `NOBYPASSRLS`, as on a server | the config names them |
| seed | the taxonomy and the source registry | `stacks` is not empty |
| start | the whole system, one process, `ROLE=all` | — |
| browser | only once `/healthz` answers | `--no-browser` |

The second run is the first run minus the waiting.

### A configured database is never replaced by an empty one

If `DATABASE_URL` is set and the server behind it does not answer, that is an
error to report — not a reason to start a fresh cluster. This machine has an
archive in a PostgreSQL service, and an app that greets an outage by showing a
working, **empty** archive has told the user their data is gone. The embedded
cluster is reached only when nothing is configured at all.

It also listens on **54329, not 5432**. 5432 is where the installed service is;
binding there would either fail or, after somebody stopped that service, quietly
serve a different database under the same name.

### Two flags, both off by default

- `--with-postgres` copies `bin`, `lib` and `share` from the newest PostgreSQL
  under `C:\Program Files\PostgreSQL`. Not `data` — that is somebody's archive.
  Without it the build needs a `DATABASE_URL`, and says so on first run.
- `--with-env` includes this machine's `.env`, **API keys and database password
  included**. For your own PC. The build prints a warning when you use it.

### End task, and the job object

`Ctrl+C` and closing the console reach every process on the console, so the
launcher shuts down properly in both — the scheduler releases its job claims,
then Postgres stops with `-m fast`. **End task** in Task Manager does not: it
kills the shim alone and leaves `node.exe` serving on a port the next launch
cannot bind, for a program the user believes they closed.

The shim puts the child in a Job Object with `KILL_ON_JOB_CLOSE`. The handle is
owned by the shim, so however it dies — cleanly, killed, or crashed — the kernel
terminates the job. It is the only shutdown path that does not depend on this
code getting a chance to run.

### A password that went out of scope

`create-app-role.ts` writes the generated password into a config file and never
prints it. Its fallback for a file with no existing line inserted after
`DATABASE_APP_ROLE=` — and the launcher's config file has no such line.
`String.replace` with no match returns the string unchanged, so the role was
created, the password generated, the file written back byte-identical, and the
only copy of that password went out of scope. It now appends: a line at the end
of the file is worth more than a tidy one that does not exist.

## What's new — finding a market before it has a name

Stated on 2026-09-09: *"The purpose of the project is to find new market that will
appear in short period, but currently the project can't enough report that can
find new market and tool and platform."*

### The diagnosis, measured rather than assumed

Every headline in that morning's four briefings named an incumbent:

> AWS brings OpenAI GPT-6 Astra to Amazon Bedrock · Microsoft reaches GA for Azure
> Virtual Desktop Hybrid · Databricks releases Instructed-Retriever-1

And every genuinely new thing was present — in `watch`, the footnote at the bottom
of the page, from which nothing durable happens:

> **Booley**, an open-source IDE for agentic chip design in SystemVerilog ·
> **aic-agent 1.0.2** · **scigantic-surechembl 0.3.0** · **PocketBase Cloud**

The system was finding new tools and throwing them away. Three reasons:

1. **The briefing prompt ranks by importance** — "the single most important thing
   that happened". A new market has no big actor yet, by definition, so it can
   never win that ranking against a hyperscaler.
2. **The taxonomy is closed.** `stacks` has 2,460 rows and every step that turns a
   story into structure matches against them. A tool that is not one of them gets
   no row, no page, no trend line. "Booley" was a substring of a JSON blob.
3. **Nothing tracked a name across days.** A new market *is* "a name that keeps
   coming back from unrelated sources". Without somewhere to write the first
   sighting down, the third sighting looks exactly like the first.

### The ledger

Migrations 0074 and 0075 add `emerging` and `emerging_sightings`. The `names` job
reads **every** story — not a selected corpus — through a cheap model chain and
records the tools, platforms, models and companies it names, together with one
line on what each one does. Names already in `stacks` are dropped; the residue is
the ledger.

Five minutes, ahead of collection, because a name is only worth catching on its
first appearance. `unscanned()` works **oldest first**: newest-first would record
a name's last appearance as its first, inverting the one fact the table holds.

A name with no claim about what it does is discarded. "Booley" is a string;
"an open-source IDE for agentic chip design" is a category a reader can judge.

### The gate, and why it is not two independent sources

A name reaches a reader when **two separate publications** have carried it, or
**one that does not speak for it** has. It was going to be two *independent*
sources — the `source_type` ladder in `src/vocab/intel.ts`. Measured before
shipping:

| source type | stories | corroborates? |
|---|---|---|
| `PRIMARY_VENDOR` | 3,404 | no |
| `PRIMARY_PROJECT` | 228 | no |
| unclassified | 180 | no |
| `PRIMARY_RESEARCH` | 178 | no |
| `TECHNICAL_JOURNALISM` | 15 | **yes** |
| `SPECIALIST_PUBLICATION` | 14 | **yes** |

Twenty-nine stories out of 4,026, and 404 of 476 sources carry no type at all —
`maintain/classify.ts` leaves them NULL on purpose. An independence-only gate on
this archive opens for nothing, ever. **A page that is permanently empty because
its threshold cannot be met reports "no new markets" when it means "I cannot
tell".** Independence is still recorded and still shown; it is no longer the only
way through.

### One sighting per outlet, not per story

0074 keyed sightings on `(slug, story_id)`, quietly assuming one story is one
source. Deduplication makes that false in exactly the cases that matter: `dedup`
merges one event from several outlets into one canonical story and puts the rest
in `story_members`. A name carried by seven publications recorded as having one
source — **the best-attested events in the archive scored lowest on the gate**.
0075 fixes the grain to `(slug, story_id, source_id)`.

The citation is **copied**, not referenced — title, URL and outlet written into
the sighting row, with no foreign key to `stories`. Retention deletes stories and
analysis outlives them, so a sighting holding only a `story_id` becomes
uncitable exactly when it is most useful: a name first seen four months ago and
still appearing is the strongest thing this table can say.

### The gate is never an ordering

`/emerging` lists by `first_seen_at DESC` and nothing else. The counts decide
*whether* a name is shown; they never decide *which comes first*. Sorting by them
would make "the fastest-growing new tool" mean "the one our sources happen to
repeat" — the exact fake ranking the content-v2 rewrite exists to end. Magnitudes
still come only from `stack_adoption`, quoted with the date they were measured.

The evidence line says "3 sources", never "3 mentions", and prints the
independent count only when it is above zero — a `0` beside every row trains a
reader to read the number as a score that everything is failing.

### What "new" honestly means

New **to this archive's vocabulary**, and nothing more is claimed. That covers two
different things the page cannot separate on its own: something genuinely just
launched, and something long established the taxonomy never had a row for. The
first pass returned Booley and aic-agent — and also Apache Iceberg and Google
Kubernetes Engine, which are neither new nor obscure.

Both are worth seeing, for opposite reasons: the first is the market appearing,
the second is a gap in the vocabulary that ought to be filled. A name added to
`stacks` leaves the page. The page says all of this, in the copy, under the list.

## Filtering items, not silencing sources

Asked for on 2026-09-09: *"The news count is very low, I think you block many
sources, I want to filter articles not block sources."*

The premise was half right, and measuring it is what said which half. Of 477
sources, **435 were healthy and 420 had been polled successfully in the previous
24 hours** — almost nothing was blocked. But 42 produced nothing, for two reasons,
neither of them a policy:

| | | |
|---|---|---|
| 21 `paused` | "adapter not implemented yet" | arXiv, CISA, crates.io, Go package index, GitHub Security Advisories |
| 21 `degraded` | "no feed could be discovered" | OpenAI, Anthropic, Google Cloud, HashiCorp, Grafana, Netflix, PostgreSQL, VentureBeat |

Not blocked. **Unbuilt, and undiscovered.** The second group is the expensive one:
those sites do publish feeds, and autodiscovery could not find them.

Probing what each site actually serves recovered **15 of the 21**. The next poll
cycle collected **237 stories against 0–37 before**:

```
19:46:19   collect: 9 due, 0 new
19:47:12   collect: 25 due, 237 new, 1 err     <- the restored sources
```

OpenAI alone serves 1,181 items at `openai.com/news/rss.xml`; heise 151; AWS
Security Bulletins 100; LowEndTalk 98. The six that stayed dark are honest
failures — Anthropic serves no RSS at all, and a guessed URL there would 404 on
every poll forever, which is worse than saying so.

Those URLs are now in the seeds (`feedHint`, and `announce[].feed` for company
channels), so a **fresh install does not have to rediscover them** — which matters
now that the desktop build seeds a brand new database on first run. Autodiscovery
stays the default for everything else: a hardcoded feed URL is a thing that rots
silently, and these are exceptions rather than the rule.

### The one rule that did silence a source for its articles

`isPodcastFeed` paused the whole source when more than half its items carried a
media enclosure, reasoning that dropping them one at a time "would still leave
the source polled forever". That traded a few wasted polls for **every future post
the source ever makes** — and `gate()` already refuses a media item on its own, so
a feed mixing a podcast with written posts lost the posts too.

It is gone. The ratio is still measured and reported as `mostly_media` on
`/admin/sources`, where a person who has looked at the source can act on it. What
stays untouched are the failure paths that are genuinely about the *source* — a
404, an unparseable body, a missing feed. This change is not "never mark a source
unhealthy".

### What the volume is actually spent on

The drop histogram over seven days, which is the real answer to "why so few":

| refused | occurrences | what it is |
|---|---|---|
| `article` | 21,093 | **an article *about* technology rather than an event *in* it** |
| `build:tag_page` | 6,136 | a re-pointed rolling tag, not a release |
| `off_topic_host` | 4,843 | the link's host, per item — YouTube, Vimeo, Spotify |
| `build:no_content` | 3,169 | a release with no notes |
| politics, crime, sport, business, commerce | ~1,100 | not technology |

**58% of everything refused is the `article` gate** — the "two gates" rule at the
top of this README, and the one the collection target asks for: *new stacks, tools
and platforms plus market moves; articles are noise*. It is by far the largest
lever on volume and it is deliberate. Nothing here changed it.

## Strategy, not retelling

Asked for on 2026-09-09, holding up a briefing that had repeated a Databricks
conference post almost verbatim:

> *"This report is only repeat of some news content... you have to collect past
> news that related to the news and analysis all news that are related to same
> field today, and then you can find the trend or fashion or new opportunity or
> new direction, the company's thought... I need strategy info in report not
> repeat of news, The news is only data that prove your analysis result."*

**The complaint was right and the prompt was not the cause.** `fieldCorpus` is
bounded at both ends by the report window — deliberately, since 0073, because
that is what made a daily report actually daily. But a corpus holding one day
cannot support a claim about direction. The model was asked what is going on
while holding a single day's stories; its two options were to repeat the post or
to invent a trend, and repeating is the better of them.

### Two passes, because they want opposite things

`field_briefing` must **not** generalise — v2 abstracted real events up into
categories and every title became a filing label, and the rules that fixed it
are rules against abstraction. Strategy **is** abstraction, done deliberately and
against evidence. One prompt asked for both produces the average: a news summary
with an adjective in front of it.

So `field_strategy` is a second call over the same stories plus
`src/analysis/context.ts` — the **six months before the window**, on the subjects
today's stories actually name. Subject-led, not field-led: six months of a
field's general background *is* background, and a model asked to find a trend in
background will find one.

### The rule that makes it analysis rather than opinion

**A claim about direction must cite an earlier story AND a recent one.**
`then` must land inside the prior corpus, `now` inside today's, and
`validateStrategy()` drops any claim that cannot fill both — in code, not by the
prompt asking nicely.

A model with nothing to compare reaches for two of today's stories and writes a
sentence that sounds like a trend and is a restatement. That sentence is
indistinguishable from a real finding unless something checks the indices, so
something checks the indices. Claims that fail are **dropped, not softened**: a
strategic paragraph a reader cannot check is worse than none, because it reads
exactly like one they can.

### What comes out

| | |
|---|---|
| `read` | one sentence — the useful thing to take from today |
| `direction[]` | what moved between then and now, both ends cited |
| `positioning[]` | what a **named** company appears to be betting on |
| `openings[]` | a gap between what is sold and what the evidence shows is solved |
| `limits` | what this evidence cannot settle |

`positioning` may be read from today alone — what a company ships and chooses to
talk about is visible in one post — but it carries a `firstParty` flag, and the
page says so out loud: *"Read from what they say about themselves. Good evidence
of what they have decided to sell, and none at all that anybody bought it."*
That is exactly the Databricks case: a booth schedule is strong evidence of
intent and no evidence of adoption.

The rule against counting our own stories carries over unchanged. Convergence is
shown by **naming the parties** — "Databricks, Snowflake and Microsoft each
shipped X" is evidence; "vendors are increasingly shipping X" is not.

### Where it sits, and what survives

The reading renders **above** the findings. A reader who has to scroll past the
retelling to reach the analysis is reading a news summary with an appendix.

`now` citations are resolved into real stories and stored; `then` indexes are
**not**. The earlier corpus is a query over stories retention deletes, so keeping
indexes into it would leave a footnote pointing at a page that no longer exists.
The recent end survives as links, the earlier end as a dated span — the honest
limit of what lasts four months.

### The job that starved the analysis

Adding `names` at five-minute cadence over a 1,800-story backlog exhausted every
free provider on its first cycle and kept them there — `names: 10 batches
deferred` every five minutes while the briefing and the strategy pass got
nothing. **The job that runs constantly starved the jobs that run once.**

Fixed twice over: the per-run limit dropped from 120 stories to 24, and the scan
now stops after two consecutive refusals rather than working through a backlog
against a chain that is already down. Yielding costs minutes on a one-off
backlog; continuing costs the analysis its budget permanently.

### Reading it before paying for a key

Every free provider is rate-limited and `ANTHROPIC_API_KEY` is unset, so
`field_strategy` has never once answered. To make the feature judgeable rather
than described, the readings for 2026-09-09 were **written by hand into
`field_briefings.strategy`** — same shape, same validator, citations resolved
from the real corpus so a wrong index crashes instead of producing a plausible
wrong link. Every claim passed `validateStrategy()` unchanged; writing one by
hand earns no exemption from the pairing rule.

The page says so: *"This reading was written by claude-opus-5 (hand-written, not
the model chain)."* A reader must never mistake a stand-in for the pipeline.

## Who the report is for

Stated on 2026-09-09: *"the purpose of this project is detect IT market changes
and find opportunity that I can attend to work remotely and create income as
freelancer."*

Everything before that was built as market intelligence in the abstract. It is
not. The reader is **one person deciding what to learn, what to build and what
contract to chase**, so a finding is only useful if a single person with a laptop
can act on it. An analysis naming *"EDA vendors"* as the party who could take an
opening has failed that reader.

### `work` leads the reading

Each item is something one person could start on remotely, with the evidence from
today that somebody would pay for it, and an honest `horizon`:

| | |
|---|---|
| `now` | the work exists today |
| `months` | it will as the change lands |
| `watch` | plausible, unproven |

An unrecognised horizon is downgraded to `watch` rather than dropped: overstating
how ready a piece of work is costs the reader a week of their life, understating
it costs them a second look.

The prompt names where these come from, in order of reliability: **a forced
migration with a deadline** (every team on the product must move, and most cannot
spare the people), **a tool shipped with no ecosystem**, **a gap between what is
sold and what is needed**, and **a skill going scarce**. It is told explicitly
that "learn AI" is not work.

What the first run produced, across four fields: Jira Data Center migrations as a
contract service; Postgres PII pseudonymisation for teams facing a data-protection
review; model cost-and-accuracy evaluation for teams choosing a provider;
independent Snowflake-versus-ClickHouse cost assessments; workload re-evaluation
as models reach GA on Bedrock. Five marked `now`, four `months`, three `watch`.

### Richer, and falsifiable

Counts raised — direction 3–5, positioning 2–6, openings 2–4 — and two things
added that were missing:

- **`falsifier`** on every directional claim: the specific, checkable thing that
  would show it wrong. A hedge is explicitly not a falsifier. A claim you cannot
  say how to disprove is a claim you should not be making.
- **`tensions[]`**: where two sources point different ways, or a vendor claim the
  independent coverage does not support. A disagreement is a finding, not a flaw
  to be smoothed over — but the model is told to leave the array empty rather
  than manufacture one.

History raised from 24 stories to 40, and the token ceiling from 4,000 to 8,000.

### What the recent readings have established

At the end of every field report: every claim made about that field in the last
30 days, with its date and its falsifier. **Not a model call** — each claim was
already validated and cited on the day it was made, and re-summarising would put
an uncitable layer of paraphrase between the reader and the evidence, on every
page view. It excludes today, which sits directly above it.

The falsifiers are the point. A claim from three weeks ago whose falsifier has
since fired is the most useful line on the page, and the reader can only see that
if it is still written down.

### Why the page looked messy

Reported as *"the current report display style is messy"*, and it had a specific,
findable cause: **`mv-find` and `mv-cites` were used four times by the reading and
defined nowhere.** The most important section on the site rendered as unstyled
headings with the citation links running into one another. Every test passed,
because the HTML was perfectly valid.

Fixed, along with three structural faults:

- **Two ledes.** The briefing summary and the reading's one-liner were stacked as
  consecutive serif paragraphs before any heading — the single biggest reason the
  page read as a wall. The reading wins when there is one; the summary moved down
  to introduce the stories it actually describes.
- **Sprinkled caveats.** A note under the reading, another under the history line,
  a third under the provider, and a bulleted list of its own. Scattered hedging
  reads as evasion and gets skipped; one `.mv-caveat` block reads as a limit and
  gets read.
- **Citations as prose.** Now chips on one line, so the evidence reads as sources
  attached to a claim rather than as a paragraph of links.

`tests/report-shape.test.ts` asserts that **every class the page uses has CSS
defined** — the test that would have caught the original bug.

## Deploying it


```
npm start                 web server and scheduler in one process
ROLE=web    npm start     web only
ROLE=worker npm start     scheduler only
```

One process is the cheapest arrangement and the right default: both halves share a
database pool and the politeness gate. Split them when several web containers
should sit behind a load balancer — and if two workers start anyway, the claim in
`job_runs` means they divide the work rather than duplicate it.

There is no build step. Node 22 runs the TypeScript directly with
`--experimental-strip-types`, so what runs in production is the file in the
repository. A bundler would add a build artefact to debug through and buy nothing —
this is a server, not something shipped to a browser.

The `Dockerfile` uses `tini`, because the default PID 1 in a container does not
forward signals. Every deploy is a `SIGTERM`, and the graceful shutdown in
`src/main.ts` never runs if the signal does not arrive: the request in flight is
dropped and the scheduler leaves a job claimed until its lease expires.

`/healthz` answers **without touching the database**, on purpose. A health check
that fails when Postgres blips gets the container killed during exactly the outage
it should be riding out. Whether the database is healthy is a different question,
and `/admin/health` is where it is asked.

## Real-time collection

Freshness is a property of each source, not of the scheduler. `tuneIntervals`
moves every source's `poll_interval_seconds` toward its observed publication rate
— halving it for sources that produce on most polls, doubling it for sources that
stay silent, inside the configured hot/cold bounds. A newswire converges on
minutes; a blog that posts monthly backs off to six hours and stops costing
anything.

Two runners share one code path (`runCycle`):

| | the `collect` job | the Worker, as fallback |
|---|---|---|
| Cadence | every 30s | every 5 min (cron) |
| Sources per pass | 40, concurrency from settings | 8, concurrency 4 |
| Article pages | yes | no |
| Bound by | nothing | the free plan's limits, below |
| Takes a claim | yes | no — it defers instead |

Measured: one live cycle collected **227 new stories in 64 seconds**.

### What the Workers free plan actually allows

The deployment hit three real ceilings, each of which changed the code:

- **5 cron triggers per account.** Five separate schedules did not fit. They
  collapsed into three, and the poll trigger stopped rotating shards — it now
  asks for whatever is *due*, which is both simpler and fresher.
- **50 subrequests per invocation.** Every query on the Neon HTTP driver is a
  subrequest, so the first tick was killed partway through. The Worker now talks
  to Postgres over a **WebSocket pool** — one subrequest for the whole
  invocation. A tick that was dying now uses **9–11 of 45**.
- **CPU per invocation.** Parsing and hashing a 150-item feed exceeds it. Each
  tick takes 8 sources × the newest 12 items, which runs in ~5s wall and leaves
  headroom for outliers.

A failed tick costs nothing: `next_fetch_at` is only advanced on success, so
unpolled sources are simply taken by the next one.

The honest limit: at 8 sources per 5-minute tick the Worker sustains ~2,300
source-polls a day, which covers this registry once adaptive intervals have
backed off the quiet sources. For genuinely continuous collection across all 327
sources, run `npm run live` on any always-on box, or move the Worker to the paid
plan (1,000 subrequests, 30s CPU) and raise the per-tick limits.

## Tenant isolation — read this before Phase 5

Postgres has **two** ways for a role to skip row-level security, and only one of
them is closed by `FORCE ROW LEVEL SECURITY`:

| Mechanism | Closed by FORCE? |
|---|---|
| Table ownership | Yes |
| The `BYPASSRLS` role attribute | **No — it skips RLS entirely, silently** |

`neondb_owner` has `BYPASSRLS`. Isolation tested on that role reports perfect
separation and proves nothing. So:

- **Migrations** run as the owner (`DATABASE_DIRECT_URL`).
- **The application** runs as `app_user` — `NOBYPASSRLS`, created by
  `scripts/create-app-role.ts`, connection string in `DATABASE_APP_URL`.
- `scripts/verify-rls.ts` proves isolation end-to-end as that role. Run it with
  `--as-owner` to watch the same checks fail, which is the point.

```
PASS  application role does NOT carry BYPASSRLS
PASS  all 11 tenant-scoped tables have RLS enabled and FORCED
PASS  tenant A sees only its own tenant row
PASS  writing a row for another tenant is refused
PASS  with no tenant context, no tenant rows are visible
PASS  app role cannot read tenant_secrets (no GRANT, not just no policy)
```

Slack bot tokens live in `tenant_secrets`, which the app role has **no GRANT on at
all** — a privilege decision, not a policy decision. The admin UI refuses to render
that table's contents whatever the query says.

---

## Things learned from running it against real sources

These are findings from live data, not theory. Each one changed the code.

**SimHash bands are far weaker on a topical corpus than the textbook says.**
The band prefilter assumes documents spread over the hash space. Tech news does
not — it shares vocabulary, so upper bands collide constantly. On 500 real
stories the bands produced **9,763 candidate pairs**, of which the model judged
exactly one to be the same event: 976 model calls to find one merge, against a
budget of under 100 calls a day. A free lexical gate (title token overlap) now
runs first, on the same evidence the model would see. Same corpus, after:
**20 pairs, 2 model calls, 7 merges.**

**A 429 must expire.** The budget check read the health flag rather than the
window, so the first rate limit of the day retired a provider permanently. The
chain drained one provider at a time and then deferred everything with "budget
exhausted" while all three services sat idle. `isUsable()` now treats the window
as authoritative; 95 stories that had been stuck for three cycles classified
immediately after the fix.

**Every model id in the supplied `.env` was already dead.** `llama-3.3-70b-versatile`
(Groq), `llama-3.3-70b` (Cerebras) and `gemini-2.5-flash-lite` (Gemini) all 404.
Current ids were read from each provider's own `/models` endpoint. This is the
same reason quotas are discovered at runtime: published figures rot.

**Checking the URL before fetching the page.** The collector was fetching article
pages and only then discovering it already had the story. Layer-1 dedup now runs
on the feed URL first, before any page fetch.

**The Neon HTTP driver cannot serialize `bytea[]` parameters.** It string-escapes
array elements, which throws on binary values. Scalar `bytea` parameters are fine,
so the two dedup queries use those instead.

**A release feed entry is titled with its tag and nothing else.** "v4.2.0-rc4" is
unreadable in a river of hundreds of projects, so the source now supplies the
subject the feed left out, and prereleases are flagged rather than mixed in.

**Extraction can poison the archive.** GitHub release pages were being fetched
even though the feed already carried the release notes, and the extractor came
back with page chrome — "You must be signed in to change notification settings"
became the stored summary of 28 stories. Self-describing sources are no longer
fetched, extractions that look like chrome are rejected, and the affected
summaries were cleared.

**Rejecting the page is not the same as removing the furniture.** Refusing a
whole extraction cleaned the archive and left the reading page untouched: a
GitHub release still opened with *"Uh oh! There was an error while loading.
Please reload this page."* — a banner the server emits on every render, error or
not, so reloading does nothing and the reader is being told to fix something
that is not broken. Under it sat eight more lines of furniture and then the
actual release notes, which are exactly the content this system exists to
collect.

Furniture is now removed **from the DOM**, in `pickContainer()`, which is the one
place both paths go through — so the collector's text and the reading page's
blocks are fixed together, and it happens before `densityScore()` votes, so
furniture can no longer help a navigation block win the container.

Matching is whole-block and never substring: a paragraph is never *exactly*
"Uh oh!", but plenty of articles contain the word "loading". The pass repeats
until nothing moves, because the banner is not one element — it is
`<p>There was an error while loading. <a>Please reload this page</a>.</p>`, and
taking the link out leaves a parent reading "There was an error while loading. ."
that no longer matches anything until the orphaned punctuation is closed up.

Measured against live pages, before and after: lwn.net, vercel.com,
thenewstack.io and tomshardware.com lost **nothing** — identical block and word
counts — and the Consul release page lost 5 blocks and 14 words, all of them the
banner, keeping its changelog.

**One slow source can own an entire cycle.** Google Cloud's release notes feed
carries 30 items whose pages all time out; per-domain politeness serialized them
and the source spent **653 seconds**. There is now a per-source deadline and a
per-cycle one, and what they skip is reported rather than hidden.

**Check the link, and know what a failed check proves.** 1,128 of 1,791 proposed
documentation links were dead. But `developer.android.com` "failing" meant the
request failed, not that the page was gone — and four sites that answer a browser
and refuse a crawler would have had their documentation hidden by a stricter
reading. Refused and unreachable are different results.

**Probe a data source before designing around it.** Every one of four public
lists worked, and three of them worked differently than documented: the CNCF
landscape is 90% member companies rather than projects, Stack Overflow caps
paging at 25 pages regardless of quota, and GitHub's featured-topics search
returns sixteen rows. Half an hour of curl changed what got built.

**Bulk imports need bulk-import rules.** Adding 938 curated GitHub topics was
right and immediately wrong: `support` and `first` are real topics, and they
tagged 331 stories the same afternoon. The fix was not a blocklist of the words
that had gone wrong but the actual question — is this an ordinary English word —
and an asymmetry: a person's judgement earns the benefit of the doubt, an import
does not.

**Hosting a story is not being the subject of one.** Platform tagging matched the
platform's own hostname, on the theory that a link to upwork.com is unambiguous
evidence. It tagged 9,092 stories — 42% of the archive — because GitHub Sponsors
lives at `github.com/sponsors`, so every GitHub release in the archive became news
about GitHub Sponsors, and every Substack newsletter about Rust became news about
Substack. Dropping URL matching entirely and requiring the name capitalised as the
platform writes it took it to 31. The right number for a technology archive is
small: these platforms are written about by the business press.

**A gate that defaults to off is a feature that does not exist.** The archive sat
at 3,590 stories for days and the reason was `BACKFILL_ENABLED=false` — the
backward collector had three providers `pending` with saved cursors, waiting for
a flag nobody had turned. Switching it on took the archive to **21,754 stories
reaching back to 2013**. Gates are the right design and an unmonitored one is
indistinguishable from a bug, which is why every gate is now on `/settings` with
its state visible.

**A closed vocabulary has to be re-openable, or it rots.** The taxonomy was
right to be closed and wrong to be frozen. Discovery does not weaken the
guarantee — tagging still resolves through one table — it just moves the act of
closing it from a person editing a file to a pass weighing evidence.

**Frequency is not evidence of category.** The most repeated new words in a tech
archive are the outlets writing it. Any promotion rule based on counting alone
will add `techcrunch` to your list of technologies, confidently.

**Duplicate display names are a correctness bug, not a cosmetic one.** 48 pairs
of stacks shared a name while their slugs described different things — `drone`
carried Woodpecker CI's record, so two real stories were labelled with the wrong
technology. In a closed vocabulary the slug IS the identity. They were merged
with the dead slug kept as an alias, so nothing that ever resolved stopped
resolving.

**A four-language pipeline needs a translation step, not just a language gate.**
Collection ran in four languages for the right reason and shipped 296 stories
nobody here could read, because title translation sits behind a gate that is off.
The capability was half-built, and half a capability reads as a bug.

**A section menu needs prefix matching, not equality.** `/admin` owned itself but
not `/admin/t/jobs`, so every database page fell through to the default section
and showed the reading rail — with the table catalogue it should have shown
missing entirely. Invisible until you look at the wrong menu on the right page.
Prefix matching has to be on path *segments*: `/all` must not claim
`/allocations`.

**Search that never fails to return something is not being kind.** Suggestions
with no similarity floor answered every query with eight chips, so a query the
system had never seen looked identical to one it understood. Refusing to guess is
information.

**A trigger runs as the caller, not as the table owner.** Saving a setting failed
with *permission denied for `app_settings_history`* — the audit trigger fired as
the app role, which has no write grant there. Granting one would have fixed it and
would also have let the settings page forge history directly, which is the entire
point of keeping history. `SECURITY DEFINER` with a pinned `search_path` is the
narrow fix: history can only ever be written as a side effect of a real change.

**Removing a setting is a change too.** Clearing an override can triple a poll
interval or switch classification off, and it was the one action that left no
trace — a `DELETE` writes no history row unless you make it. It now records JSON
null, which distinguishes "reverted to the environment" from "never set" without
making the column nullable.

**A menu is not a filter bar.** The rail carried both, they looked identical, and
several entries could not be combined at all — clicking *Rising fastest* silently
discarded *Critical*. The fix was not better labels: it was deciding that anything
which cannot combine with its neighbours is not a filter and must be a page.

**Two sources can resolve to one feed.** "GitHub Blog" and "GitHub Engineering"
both advertise `github.blog/feed`, and `feed_url` is unique — so autodiscovery
crashed the cycle on a duplicate key. The second claimant is now *paused with
that reason* rather than crashing or silently collecting the same items twice
under two names.

**A tagging pass has to record that it ran.** Company tagging re-read the same
500 rows every batch and reported zero, because a story with no company in it
stayed eligible forever. "Examined and found nothing" is a result, and needs a
column of its own — exactly as `classified_at` does for classification.

**Feeds break in ways the spec predicted.** Lobsters serves a bare JSON array
rather than a JSON Feed object; entity-heavy feeds blow past fast-xml-parser's
default 1,000-expansion cap (raised, with expansion *depth* left at its default —
depth is what stops a billion-laughs attack).

---

## Interface

The identity is editorial-terminal: a news product engineers keep open all day.
Newsreader (a face designed for news) carries the wordmark and page titles, Inter
carries the interface, JetBrains Mono carries anything that is data rather than
prose. Dark is the primary mode and light is a selected second, not an inversion.
One accent colour, reserved for critical — if everything is coloured, importance
stops reading as urgent.

**Dark is the default, not "match the system".** It was the latter, which meant a
light desktop served a white page to someone who had never asked for one — a
default that quietly does the opposite of the intent is not a default. "Match the
system" is still offered, as a choice. The moon in the top bar flips it from any
page: a plain form posting the same setting the settings page writes, so the
choice is saved rather than held in the tab, and there is one theme preference
rather than two.

The light palette is written once and applied three ways — to whoever asks the
system for it, and to whoever picked a side in `/settings` — with a `:not()` guard
so an explicit choice beats the media query in *both* directions. Compact density
is not a smaller font: shrinking type makes a dense list harder to read, so what
buys the room back is dropping the summary line and the padding around it.

Everything is server-rendered HTML with one stylesheet and one script, both
served as content-hashed files that a browser fetches once and then never asks
for again — see **84KB on every page**. The script is nine behaviours
concatenated, the ones worth naming being keyboard navigation (`j`/`k` move, `v`
reads here, `enter` opens the article, `o` opens details, `/` focuses search),
the live counts poll, and the reader. No framework, no build step, and no
client-side data fetching beyond a handful of small endpoints: the queries are
fast, so a page renders complete or not at all.

## Architecture notes

**Nothing durable lives in a conversation.** All state is in Postgres. Model calls
are stateless and single-shot. `deliveries` makes delivery resumable: "has this
user seen this story" is a row, not session memory.

**Cheap code does volume; models do judgment.** Fetching, extraction, language
detection, hashing, dedup layers 1–3, coverage counting and relevance matching are
all plain code and SQL. On the collected corpus that is ~8,000 items a day handled
at zero inference cost, against fewer than 100 batched model calls.

**Duplicates are superseded, never removed.** The loser keeps its row, points at
the winner, and contributes a `story_members` row. Every read path filters
`superseded_by IS NULL`.

**Old stories ARE deleted, under a contract the database enforces.** This
replaced a blanket append-only rule in migration 0037, and the difference
matters: whole stories live for two months, and everything older survives as the
monthly aggregate that the trend pages actually read. `rust` reads back across 94
months to October 2017 with the stories themselves long gone.

The rule is row-level rather than table-level, because "never delete" and
"delete freely" were both wrong. A story may be removed only if its month is
recorded in `rollup_log`; a favourite is never removable while it is favourited;
a child row may go only once its parent story has. Everything else still raises.
See **Retention** below.

**Niche is a ranking axis, never a filter.** A major CVE scores terribly on
inverse coverage and still ships as critical. The coverage control in the reader
reorders; it never hides.

**The taxonomy is closed.** Every field a model returns is resolved through
`stack_alias_lookup` and discarded if it does not resolve. Rejected fields are
reported per run — that report is how `database` was found missing as an alias and
added.

**Free tiers may train on submitted data.** `trainingEligible` marks which
providers those are, and the router refuses to send tenant-originated content to
them.

---

## Layout

```
migrations/     27 SQL migrations, checksum-guarded
seeds/          stacks.ts + stacks-extra.ts (curated) · sources.ts (122 + 325 derived)
                companies.ts (76 companies, 39 official channels)
                resources.ts (curated documentation and free courses)
src/settings.ts the knob registry: what is configurable, and what it maps to
src/lib/        url · hash · simhash · text · lang · english   (pure, tested, no I/O)
src/vocab/      sources: linguist · cncf · libraries.io · stackoverflow synonyms
                keys: what each external key unlocks, and whether it is set
src/collect/    fetcher · feed · extract (+ readable) · filters · adapters · pipeline
                ingest · cycle · backfill
src/process/    dedup · classify · score · snapshot · relevance · taxonomy · companies
                discover (proposes vocabulary) · tagstacks (applies it)
src/llm/        router · providers · budgets · jobs · schema
src/db/         client (+ withTenant) · repos (including the settings overlay)
src/ui/         server · overview · reader · article (reading modal) · search
                fields · companies · platforms · stacks · registry · trends · sources
                settings · admin · nav · rail · filters · theme · html
src/workers/    cron entry point (sharded)
scripts/        migrate · seed · create-app-role · verify-rls · live · bench-collect
                dev-poll · dev-process
```

### Commands

| Command | What it does |
|---|---|
| `npm run migrate` | Apply migrations (uses `DATABASE_DIRECT_URL`) |
| `npm run seed` | Idempotent taxonomy + source registry seed |
| `npm run seed:companies` | Company registry + first-party announcement channels |
| `npm run seed:platforms` | Earning-platform registry, every URL checked |
| `npm run tag:companies` | Tag stories with the companies they are about (no model) |
| `npm run discover` | Propose vocabulary entries, promote the evidenced ones, tag the archive |
| `npm run import:topics` | Import the GitHub topic index into the taxonomy |
| `npm run import:vocab` | Import Linguist, the CNCF landscape and Stack Overflow synonyms |
| `npm run resources` | Seed learning resources and fetch every one to check it |
| `npm run tag` | Tag the archive against the vocabulary — stacks, companies, platforms |
| `npm run links` | Check every address the registry offers (`--recheck N`, `--report`) |
| `npm run topics` | What the topic filter refuses, by category and source (`--show`, `--apply`) |
| `npm run events` | What the event classifier keeps and what it calls an article (`--show`, `--apply`) |
| `npm run events:reclass` | Re-judge every held story's event class under the current rules (`--apply`) |
| `npm run sources:expand` | Unpause and add the sources the audition kept (`--apply`) |
| `npm run discover:similar` | Propose sources via sitelike.org, auditioned as strangers (`--seeds`, `--per-seed`, `--floor`, `--apply`) |
| `npm run audit` | Every source scored on its own output (`--social`, `--pause`, `--restore`) |
| `npm run tidy` | Strip page furniture out of summaries already stored |
| `npm run refit` | Re-extract the rows the whole-page container broke; rewrites only what it can prove it wrote |
| `npm run rollup` | Reduce a settled month to its monthly aggregate |
| `npm run retain` | Delete what the rollup has already captured (`--dry-run`, `--lapsed-only`) |

Settings saved in the UI are picked up by `npm run live`, `npm run process`,
`npm run backfill` and the Worker, each of which loads the overlay before reading
a single value off the config.
| `npm run live` | Continuous forward collection (`--tick`, `--concurrency`, `--verbose`) |
| `npm run backfill` | Backward collection (`--provider`, `--pages`, `--until`, `--status`) |
| `npm run bench` | Collection benchmark: queries per item, items per second |
| `npm run deploy` | Deploy the Worker |
| `npm run poll -- --shard N` | One collection cycle |
| `npm run poll -- --url <feed>` | Fetch, parse and gate one feed with no database — the fastest way to find out why a source is silent |
| `npm run process` | dedup → classify → score → snapshot (`--step` to run one) |
| `npm run ui` | Reader, trends and admin on 127.0.0.1:3000 |
| `npm run verify:rls` | Prove tenant isolation as the app role |
| `npm test` | 539 unit tests |

---

## "Recently added by the system" was showing an import

A stack sorted to the top of *newest*, and its page held no news at all. Both
halves were true, and the pairing was the bug.

`stacks.curated` is a boolean, so the vocabulary had two states: a person chose
this, or a person did not. Everything in the second half was then described as
**discovered** — by the origin filter, by the growth panel, and by each row's
own record. Counted:

| origin | rows | never seen in a story |
|---|---|---|
| `topic_index` | 930 | 288 |
| `linguist` | 460 | 229 |
| `cncf` | 225 | 149 |
| `github_release` | 1 | 0 |
| `title` | 1 | 0 |

Discovery has produced **two** entries in the life of this archive. The other
1,615 are published vocabularies — GitHub's topic index, Linguist, the CNCF
landscape — loaded in bulk. The panel headed *"recently added by the system"*
asked for `curated = false` and returned twelve rows of the CNCF landscape, all
stamped with the day the list was imported, eight of them with no coverage,
under a heading promising things the system had noticed. Clicking one is how
this was found.

The distinction is written down once now, in `src/vocab/origins.ts`:

- **discovered** — the archive produced it. A repository under a repo the
  vocabulary did not know published a release, or a term cleared the review
  queue. There is evidence, and by construction there is coverage: it was found
  *by* being covered.
- **imported** — somebody else's curation, loaded in bulk. Worth having, and an
  entry arrives with no coverage and often never gets any.
- **curated** — a person typed it.

The panel asks for discovery origins only and carries each row's coverage, so a
row with none says so instead of looking like news. The import is stated as a
count with a link, because loading a file is not an event. The origin filter
offers the three real answers rather than "not hand-seeded" wearing the word
*discovered*. An unknown origin classes as `curated`: claiming the archive found
something it did not is the failure being fixed here, and the other direction
only understates.

### The name was `"Animal Crossing"`, quotation marks included

Thirteen names and fourteen descriptions carried literal quote characters. The
topic import reads GitHub's frontmatter with a deliberately small YAML reader,
and it never unquoted scalars — so what came through damaged was not a random
thirteen. YAML *requires* quoting when a value holds a colon or a comma, so the
damage landed precisely on the entries that needed it: `"JSON:API"`,
`"CC: Tweaked"`, `"Nashville, Tennessee"`,
`"PSR-15: HTTP Server Request Handlers"`. They were not awkward entries. They
were correctly quoted ones.

Fixed in the reader, repaired by `0053`. Only a matched outer pair is taken: a
name may legitimately contain a quote character, and stripping one end of one
would be the same bug pointing the other way.

The reader now lives in `src/lib/frontmatter.ts` rather than inside the import
script, because that script is executable top to bottom — a test that wanted one
pure function out of it ran the entire import.

---

## Anything is not a fifth option

`Anything` and `All fields` sat in their groups drawn as checkboxes, level with
the options beneath them. They are not options. Every one of these filters means
*all of them* when it is empty, so those rows are the state of having chosen
**none** — and clicking one clears the group rather than adding to it. Drawn
with a box it read as one more thing to tick; tick it, and nothing appears to
happen.

They lose the box, gain a rule beneath them, and light up exactly when nothing
under them is chosen. One flag, `all`, on the rail item.

---

## A company's own announcement is news

The rule this registry is judged by — *does this source report that a technology
**changed**, rather than that something happened to somebody who uses one* — was
read as excluding companies, which is what put "vendor marketing" on the
deliberately-absent list.

That reading was too broad, and it is revised here. A company announcing its own
work **is** the technology changing, and it is the primary record of it: when
Cloudflare writes about its own proxy, or Anthropic about its own model, the
company is the source and the press piece that follows is the copy. The rule was
meant to exclude a breach at an agency and a funding round. It was never meant
to exclude the release note.

**The mechanism already existed and had never been wired up.** `COMPANY_SEEDS`
has carried an `announce` list since it was written — newsrooms, engineering
blogs, security bulletins — under a comment promising that the UI keeps
announcements and coverage apart, and `sources.company_slug` exists to hold the
link. Thirty-nine channels sat in the seed. Zero rows carried a `company_slug`.
Not one had ever been collected.

Thirty-seven of them are sources now: the clouds (AWS, Azure, Google Cloud,
Cloudflare, Red Hat, Canonical), the labs (Anthropic, OpenAI, DeepMind, Meta,
Mistral, Hugging Face, NVIDIA), the tooling vendors (GitHub, GitLab, Docker,
HashiCorp, JetBrains, Vercel, Fly.io, Sentry, Grafana, Tailscale), data
(Databricks, ClickHouse, Supabase), and the engineering blogs whose output other
people end up running (Stripe, Shopify, Netflix, Uber, Spotify, Mozilla, Apple).

Still excluded, and the distinction that keeps the list honest: **status pages**,
because an incident is a bad afternoon rather than a change, filtered out before
this list sees them; and **customer stories**, which are the original failing
case wearing a first-party byline — the event classifier already refuses those
and will now see more of them, which is where that gate earns its keep.

They are `CONTENT` and `PRIMARY`, never `COVERAGE`. A company corroborating
itself is one outlet counted twice, which coverage counting has already had to
be fixed for once.

**Sources 82 → 115.** No feed URL is written for any of them: each is a page
address, and autodiscovery resolves the real feed on the first poll. Ten
advertise none, which shows on `/sources` as a failure rather than as silence.

### Two seeders, and the one that would undo the curation

`npm run seed` turned out to be the **old** path — 484 sources, including the 367
that were deliberately removed. It has also been broken since the first-party
changelogs were added: Terraform's hand-written feed and the one derived from its
repository resolve to the same `releases.atom`, and `feed_url` is unique while
the upsert keys on `url`, so neither saw the other. It now dedupes by feed with
the hand-written row winning, says out loud what it skipped, and names the row
that failed — a unique violation out of a 484-row loop that says only "duplicate
key" costs an afternoon of bisecting a seed file.

`npm run sources:core -- --apply` is the live path, and it is a **landmine**: it
makes the registry *equal* the core list, and the registry has drifted from it.
Run today it removes **59 sources and 192 stories** on the way to adding
anything, because twenty first-party changelogs were added afterwards and never
written into `CORE_NAMES`. So the announcement channels went in through
`npm run seed:announce`, which only inserts. The drift is reported rather than
resolved: which of those 59 belong is a curation decision.

---

## Why the count was not moving

"Why don't news count increase" — it was increasing, 665 to 702 over an
afternoon, and three separate things were holding it down.

**Ten of the biggest channels were silent.** The announcement sources are seeded
with page addresses and left to autodiscovery, and ten of those pages advertise
no feed. OpenAI, Anthropic, Google Cloud, Azure, Meta AI, Netflix, Uber,
Shopify, Fly.io — collected nothing since the day they were added. Five were
recoverable and each was fetched and parsed before it was written down:

| source | feed | items |
|---|---|---|
| OpenAI | `openai.com/news/rss.xml` | 1,156 |
| Fly.io | `fly.io/blog/feed.xml` | 40 |
| Google Cloud | `cloudblog.withgoogle.com/rss/` | 20 |
| Azure | `azure.microsoft.com/en-us/blog/feed/` | 10 |
| Netflix | `netflixtechblog.com/feed` | 10 |

The other five publish nothing an automated reader can take: Anthropic 404s on
all three conventional paths, Shopify's `.atom` answers 200 with HTML, Uber
returns 406 to anything automated. They are paused with the reason and the date
they were checked, in the company registry — a source that can never succeed is
not a source, and the next person should not spend an afternoon rediscovering
it.

**The event gate was refusing them.** Twenty-four hours of collection:

```
items seen         107,016
already archived    74,176   ← the same feed, re-read
duplicate           25,354
not_an_event         5,307   ← the gate
kept                   604
```

Of everything genuinely new, the classifier refused about 72% — and it landed
hardest on exactly the channels just added:

| source | seen | kept | refused as not-an-event |
|---|---|---|---|
| ClickHouse Blog | 1,714 | 1 | 390 |
| Vercel Blog | 1,528 | 0 | 112 |
| OpenAI blog | 1,156 | 0 | 93 |
| Hugging Face | 851 | 1 | 95 |

The classifier reads a headline for the shape of an event, and a company
engineering blog does not write in that shape. "Making our proxy 30% faster" is
a change to the proxy and reads as an article. So the channels were being
fetched and thrown away.

**A company's own channel now bypasses that gate.** `company_slug` is the test,
not the `PRIMARY` role — a project's release feed is PRIMARY too and does not
need it, because a release feed already writes in events. This is only the rows
derived from a company's announce list. The cost is known and was accepted:
"how we built X" arrives alongside the release note. The off-topic gate is
untouched, so a company blogging about its hiring is still refused.

The flag has to survive two separate `SELECT`s to reach the decision, and if
either drops the column nothing errors — the bypass just quietly stops working
and the channels go silent again. `tests/own-channel.test.ts` pins both.

**Sixty-six stories were collected and hidden** by `is_tech = false`. Sampling
them: an Apple Arcade game update and a PHP conference, correctly hidden — and
*"Releasing Windows 11, version 26H2 to the Release Preview Channel"*, which is
a real release. Not chased here; flagged.

---

## Deleting a story, which is not a DELETE

The button says delete. The operation is not one, and the gap is worth stating
where somebody will come looking for the `DELETE` statement.

This archive's contract is that news lives a month and **analysis lives for
ever**. `stack_totals`, `coverage_snapshots` and the month rollups are all
derived from stories, and a settled month is never recomputed. Remove the row
after its month is rolled up and every aggregate counts something that is not
there; remove it before, and a number the reader has already read silently
changes. Neither is a delete. Both are corruption with a friendly name.

So the row stays and stops being shown — the same shape `superseded_by` already
uses for a merge and `is_tech` for off-topic. Three ways of not being shown, and
none of them a `DELETE`. What the reader gets is what the reader asked for: it
is gone from every list, and it can come back.

- `dismissed_at IS NULL` joins the reader's base filter in `buildWhere`, so
  every list inherits it rather than each page remembering.
- A favourite is released on the way out. Keeping a story and deleting it are
  contradictory instructions; the newer one wins, and leaving it starred on a
  shelf the reader cannot see is the worse outcome.
- **/deleted** is where it comes back from. A delete with nowhere to look
  afterwards is a trapdoor — no way to check what went, no way back from a
  misclick. The page also carries the honest account of what "delete" did.
- The bin appears in the rail only once something is in it. An empty bin in
  every reader's menu advertises a feature that is a correction, not a
  destination.
- The control is invisible until its row is hovered, and turns red only under
  the pointer. Favouriting is the gesture this reader is *for*; deleting is the
  correction, and a list of fifty stories should not be a column of fifty bins.
- `dismissed_reason` is optional free text. It exists because "why did I get rid
  of this" is the only interesting thing about a dismissal, and a column of them
  is the raw material for a filter that learns.

`tests/dismiss.test.ts` asserts that nothing in the path issues a `DELETE`, that
the base filter hides dismissed rows under every combination of other filters,
that the route is POST-only, and that it refuses a return path pointing off this
site.

---

## Half the registry produced nothing, and the reason was a setting

"You collect only 700 news for 2 months from above a hundred sources" — a fair
challenge, and mostly right. Two corrections and three real faults.

**It was 39 days, not two months.** Stories ran 2026-07-21 to 2026-08-29:
retention deletes news after a month and keeps the analysis, so the archive is a
rolling window by design. 767 stories over 39 days is about 20 a day.

**57 of 115 sources had never produced a single story.** That is the finding.
AWS News Blog, Cloudflare, Docker, OpenAI, Red Hat, Mozilla, GitLab, Sentry —
all fetching cleanly, zero failures, nothing kept, ever.

### One setting, two files, opposite meanings

`reading.tracked` — Settings → Releases you track — is a display filter, and the
filter says so itself, in `buildWhere`:

> Nothing is lost: the stories are collected, tagged, searchable, counted in the
> archive, and on Explore. What changes is what the river shows.

`src/maintain/releases.ts` read the same setting and paused the feeds. One file
promised the archive still had everything; the other made sure it did not. With
the list empty — which it was — the maintenance job's own comment argued the
case: *"an empty list means show me no release news, and a system that keeps
fetching it anyway is doing work whose output it has been told to hide."* That
describes a different system. Here an empty list is supposed to mean a quiet
river, not a starved archive.

Collection is no longer gated by it. The reading list governs News and nothing
else.

### 300 release feeds that were never wired up

`npm run sync:releases --curated` had 302 first-party feeds ready — Angular,
Ansible, Argo CD, Airflow, Ant Design, most publishing this week — and it died
on `duplicate key value violates sources_feed_url_key`, rolling back all 302 for
one collision. Same shape as the seeder bug: the upsert keys on `url`, `feed_url`
is unique, and a hand-written changelog gives the same `releases.atom` a
different url. It dedupes now, hand-written wins, and the two it skips are named
rather than silently dropped.

**300 added. Registry 115 → 415.**

### Which sources may publish an article

The archive collects events and refuses articles — 86% of what feeds publish —
and sampling the refusals showed the rule is mostly right:

```
Netlify   "How to deploy a React Router 7 site to Netlify"     correctly refused
MongoDB   "That's a Wrap: MongoDB's 2025 in Review"            correctly refused
Chrome    "What's New in WebGPU (Chrome 149-150)"              WRONG
Chrome    "What's new in DevTools (Chrome 149)"                WRONG
```

The last two are changes with a version attached, written by the team that made
them. 60 of the 919 refusals in the archive name a version like that.

The distinction is not the sentence, it is the **source**. A project's own blog,
a company's engineering channel and a release feed publish nothing but
technology, so an article from one is still about a stack. An outlet covering
the industry publishes funding rounds, lawsuits and breaches, and there the
event test is the only thing keeping the archive on subject.

So it is a property of the source — `sources.tech_only`, set once, visible on
`/sources`, adjustable per row — and not a cleverer classifier. Backfilled from
the `PRIMARY` role, which already draws exactly this line: true of all 362
release feeds and 50 first-party blogs, false of the three press outlets in the
registry (InfoQ, The New Stack, The Register).

**It is not a blanket pass.** The off-topic gate runs first and is untouched, so
a tech-only source blogging about its hiring is still refused. The ordering is
asserted rather than assumed.

The flag has to survive two separate `SELECT`s to reach the decision, and if
either drops the column nothing errors — the sources just go quiet again.
`tests/own-channel.test.ts` pins the column in both queries, the row type, the
gate expression, and the fact that the bypass is written after the topical
check.

### What it did

| | before | after |
|---|---|---|
| sources | 115 | 415 |
| sources that have ever produced a story | 58 | 183 |
| stories held | 767 | 1,243 |
| Explore | 702 | 1,167 |
| News | 447 | 447 |

News is unchanged, and that is the design working rather than a failure: 300 new
release feeds went into the archive without touching the river, because
`reading.tracked` is empty and releases are shown there only for what you track.
Explore has everything, as it always claimed to.

One thing worth knowing about the last row: `already_archived` was the most
confusing signal in the diagnosis. OpenAI logged 981 of them while holding zero
stories. It does not mean "we already have this" — it means "published in a
month already rolled up", and OpenAI's feed carries years of back catalogue.
Correct behaviour, misleading name.

---

## The count was the wrong target

Asked why the archive held so little, this project's answer was to add three
hundred repository release feeds. The count went from 702 to 1,167 and the
archive got worse:

```
Release v1.18-latest · elixir-lang/elixir    "Automated release for latest v1.18."
YugabyteDB 2026.1.2.0-b90 / -b89 / -b88      three of six consecutive nightlies
Browsers tags        Incrementing VERSION to 154.0.8029.1
PyTorch releases     trunk/3601a4924cb2…: [MPS] Ignore bias
PyTorch releases     viable/strict/1787914523: Fix integer overflow
Cypress releases     chore: release @cypress/webpack-preprocessor-v8.0.0
CockroachDB tags     v25.2.23: Merge pull request #3795 from DrewKimball/backport
Java tags            jdk-28+13
```

CI branch markers, a Chromium build bot, monorepo package bumps, merge commits,
nightly JDK builds. **A repository's `releases.atom` is a build log, not an
editorial channel.** Ninety-one per cent of the archive became build log, and
every one of those items pushed something written by a person further down the
page.

The three hundred feeds are paused, with the reason recorded on the rows:
*a repository build log is not a publisher.*

### The rule that ended it was one line, and it was the URL

Three title heuristics were written first — pre-release suffixes, machine-written
titles, a name and a version with nothing to say — and they caught 136 of 466.
Then:

> `https://github.com/elixir-lang/elixir/releases/tag` avoid this url pattern

That is the whole thing. **Everything under `/releases/tag/` is a git tag
rendered as a web page**, whatever wording the tag carries and whether or not
somebody wrote notes on it. Measured over the archive it caught exactly 330 —
precisely the set the paused feeds had produced, with nothing else caught and no
other rule needed.

It is checked first, before anything reads a title, because it is the only rule
that does not depend on wording.

What it deliberately does **not** catch is a project writing for readers:
`elixir-lang.org/blog`, `go.dev/blog`, `postgresql.org/about/news`. Those are
announcements. A tag page is written for git.

The title rules stay for feeds that are not repository pages, and one of them
had to be narrowed after it fired on `Announcing Rust 1.90.0`: the name-and-
version rule now allows exactly **one** name token in front of the number.
"Rust 1.90.0" is a tag; "Announcing Rust 1.90.0" is somebody telling you
something, and two words in front of a version is the difference. The GitHub
cases are all caught by the URL anyway, so that rule can afford to be strict.

### Applied backwards as well as forwards

`npm run tidy:builds` runs the same rule over what the archive already holds, so
the fix is not only prospective. It **dismisses** rather than deletes — the row
stays, every aggregate keeps adding up, and a rule that turns out to be too
eager is undoable from `/deleted`.

466 dismissed in total. What remains, in order of publication:

```
OpenAI changelog       Assistants API now supports including file search results
JetBrains Blog         Security Incident Affecting JetBrains Cadence
Databricks Blog        Fast, fault-tolerant PyTorch training on AI Runtime
Vercel changelog       Run Claude Managed Agents with Chat SDK
GitHub changelog       Better label management on issues is generally available
AWS What's New         Cosmos3-Edge, Cosmos3-Nano and Cosmos3-Super on SageMaker
Discord changelog      PRUNE_REQUIRES_ADMIN Guild Feature
```

**698 stories from 55 publishers.** Almost exactly the 702 it started at, and
that is the point: the number never moved, and everything behind it changed.

---

## The URL is the story's identity, and now the database agrees

It always was: deduplication, coverage, membership and the story record all key
on the canonical URL. Nothing enforced it. `stories` is `PRIMARY KEY (id,
collected_at)` — a surrogate uuid and the partition key — and there was no index
on `canonical_url` or `url_hash` at all. Not a unique one. Not any one.

**1,272 stories at 1,202 addresses.** Seventy rows too many.

### First wrong turn: a table that already existed

Migration 0056 added `story_urls`, reasoning that a partitioned table cannot
carry a global unique index on the URL, so the key needs its own table. The
reasoning is correct. The conclusion was wrong: **`story_keys` has been that
table since the archive was built** — `PRIMARY KEY (key_hash)`, not partitioned,
one row per URL for the whole archive. Building a second copy of it is the same
mistake this codebase keeps finding in itself. 0057 drops it.

### The defect was the order of two writes

```
insertStory()    writes the story
registerKeys()   claims the URL, ON CONFLICT (key_hash) DO NOTHING
```

The claim is allowed to fail and the story is already there. Two polls arriving
at one address both insert, one wins the key, and the archive keeps both. That
is why the duplicates come in exact pairs — GitLab releases at 30 rows for 15
addresses, the .NET blog at 14 for 7. A race, not a bad feed.

`claimUrls` now runs **first**, in one statement, and hands back the id to write
each story under. Whoever loses gets a membership row on the story that already
holds the address, which is what layer-1 membership is for. **A story cannot
exist without owning its URL.**

0058 repairs the 70 already stored — superseded, not deleted, so every aggregate
keeps adding up and `story_members` keeps the record that the address was seen
twice.

### And four feeds gave every item the same address

Enforcing identity would have destroyed content, because fifty rows shared four
URLs and were fifty *different* stories:

```
kernel.org  <link>https://www.kernel.org/</link>          on all 9 releases
            <guid>kernel.org,stable,7.2.2,2026-08-28</guid>   distinct
Auth0       <link>…/changelog/rss.xml</link>              the FEED itself
            <guid>https://auth0.com/changelog#2oiLhtKT</guid>  a real per-item URL
Discord     <link>…/change-log#august-27-2026</link>      distinct in the FRAGMENT
Azure       the updates landing page, 25 times
```

**The guid is the answer and always was.** A guid is the publisher's own
identifier for the item — that is its entire purpose in the format — and every
one of these feeds populates it correctly while leaving the link generic.
Auth0's guid is literally the per-item URL its link should have been.

`resolveItemUrls` reaches for it in exactly two cases, both meaning the link
cannot identify the item: the link is the feed's own address, or two items in
the batch share it. A well-formed feed is untouched, because rewriting an
address that is already right would change the identity of everything already
collected.

Discord needed a third rule. Its links **are** distinct — in the fragment — and
canonicalisation strips fragments, which is right everywhere else (two links to
one article with different anchors are one article) and collapsed all fifteen
entries here. So the publisher's own fragment is kept when it settles the
matter, and only the entries it cannot separate fall back to the guid.

### One more layer down

Distinct addresses were still not enough: Discord's ten entries kept collapsing
on the **content** hash, because fetching each anchor returns the same changelog
page. `FeedItem.complete` exists for exactly this and its comment says *"only
the producer knows this, which is why it is a property of the item rather than a
rule about a URL"*.

That was true until the addresses were resolved in one place. An item whose
address had to be disambiguated came off a listing — that is the same fact,
derived instead of declared — so it is now marked complete and no page is
fetched for it.

### What it recovered

| | |
|---|---|
| stories | 1,180 |
| distinct addresses | **1,180** |
| stories not owning their own URL | **0** |
| kernel releases recovered | 9 |
| Azure updates now distinct | 25 |
| duplicate rows merged | 70 |

Auth0's six entries still collapse on their bodies, which are near-identical.
Recorded rather than chased.

---

## Every source, read one by one

`npm run audit:output` reads what each source has actually put in the archive —
story count, distinct addresses, median body length, sample headlines — because
a source is a promise and the only way to check it is the output. Three hundred
repository feeds looked reasonable in a seed file and were a build log.
kernel.org's release feed looked like a release feed and was nine copies of one
front page:

```
10   10    1    4  Linux kernel releases   << THIN
       7.2.2: stable
       7.1.12: stable
       6.18.48: longterm
```

Median body: **four words**. Every address the kernel.org front page under a
different fragment. That one was self-inflicted — it arrived while recovering
"nine lost releases" that were nine copies of a nav menu.

### Kept, 52 of them

The changelogs that carry one entry per change (Google Cloud release notes 296,
Cloudflare 91, Azure updates 25, AWS What's New 22, GitHub, Vercel, OpenAI,
Discord, Notion, Auth0, Docker). Security as **advisories** rather than breach
reporting (22 Ubuntu USNs, each naming the package and the version). Languages
and runtimes first-party (PostgreSQL, Go, Rust, Kotlin, Node.js, WebKit,
Firefox). Infrastructure (Kubernetes, HashiCorp, Grafana, Redis at a median 25
words and the most consistently technical vendor blog measured, Databricks,
ClickHouse, Supabase, Tailscale, Sentry, Debian, Arch). AI where the model is
the technology (OpenAI, DeepMind, Hugging Face, NVIDIA, Mistral). Tooling
vendors, four engineering blogs whose output other people end up running, and
the three press outlets that report changes rather than incidents.

### Rejected, 17, with the headline that decided it

Recorded in `REJECTED` so nobody re-adds them:

```
SAP news         "SAP CX Wins TrustRadius Top Rated 2026"
                 "AI-Powered Memory Games Bring Personal Stories into Dementia Care"
Elastic blog     "Forging India's Digital Future: Elastic{ON} Comes to Mumbai"
WordPress news   "WordPress Signs the Open Weights and American AI Leadership Letter"
Django weblog    "PyCharm & Django Fall Fundraiser"
Raspberry Pi     "LesionIQ skin cancer diagnostic" · "Create your own cyberdeck"
Arduino          "four 17-year-olds are building AI-powered livestock monitoring"
Apple Newsroom   "Exciting updates for Sneaky Sasquatch come to Apple Arcade"
Windows Insider  "Announcing new builds for 21 August 2026"
Unity blog       "Keeping a VR giant fresh: Gorilla Tag's live ops cadence"
Haskell          "[ANN] vulkan-3.27 + lots of new stuff" · mailing-list traffic
Lua news         two items, median five words, version numbers only
```

**Most of these were already named in the "deliberately absent" list at the top
of `seeds/core.ts` and had drifted back in.** Vendor marketing, hobby hardware,
fields this reader does not follow — the list was right and nothing was making
the registry match it. That is the argument for `npm run sources:core` being run
rather than feared, and for the curated list and the registry living in one
place.

### And the two lists became one

The company announcement channels had their own `ANNOUNCE_NAMES` beside
`CORE_NAMES`. They were audited on their output like everything else, and the
survivors now sit in `CORE_NAMES` next to the changelogs they sit next to in the
reader. A second list to keep in step is the mistake this file exists to avoid.

| | before | after |
|---|---|---|
| sources | 415 | **245** |
| sources producing stories | 53 | **37** |
| stories held | 1,242 | **597** |
| visible in Explore | 715 | **573** |

Of the 645 stories removed, **465 were already dismissed** as build noise and
tag pages — this cleared them out for good. The 119 genuinely visible losses are
the marketing, the hobby projects and the kernel front pages listed above.

---

## Marking a story read

The third per-story state, and deliberately the weakest of the three:

| | |
|---|---|
| **favourite** | keep this, exempt it from retention |
| **delete** | I do not want this, take it out of every list |
| **read** | I have seen this |

A read story **stays exactly where it is**, in every list, marked. The risk in
this feature is conflating the last two: "I read that" is not "I do not want
that", and a read mark that hides things is a soft delete wearing a friendlier
name. Most of `tests/readstate.test.ts` is about the mark not hiding anything —
that the base filter gains no `read_at` clause, under any combination of the
other filters, unless the reader explicitly asks for unread.

- **Opening marks it read**, which is a state change on a GET and worth being
  honest about. Every feed reader does it, because the alternative — a button
  you press *after* reading — is a button nobody presses. The cost is that a
  prefetch would mark something unread; the manual toggle on every row is the
  way back, and that is why it is on every row.
- `coalesce(read_at, now())`, not `now()`: re-opening keeps the moment it was
  first read, which is the only thing the column records.
- The toggle is **visible without hovering**, unlike delete. It is the control a
  reader uses most, and its state is the thing they most need to see at a
  glance. Unread is an open ring, read is a tick — one control in two states.
- A read row dims its **title**, not the whole row. The metadata is already
  grey, and fading that further makes a read row look broken rather than
  finished.
- **Unread only** composes with every other filter rather than resetting the
  page, and is off by default: a reader arriving at a filtered page expects the
  filter they chose, not one the site chose for them.
- **Mark all read** appears only when there is something to catch up on.

### The badge that could not be cleared

The first version counted unread with a predicate written by hand in the rail.
It reported **598 against a page showing 580**. The difference was exactly the
eighteen `article` rows the reader hides by default — eighteen stories that
could never be cleared by reading, because reading them was not something the
page would let you do.

Then, once the count went through `buildWhere`, News reported **427 unread on a
page holding 377 stories** — a badge larger than the list it counts. The count
was parsing filters without the reading preferences, so it was answering for a
different stream: which releases are shown and which fields are followed are
*preferences*, and omitting them silently changes the question.

The badge is now counted through the same `buildWhere`, on the same path, with
the same preferences, with `unread=1` added — so it is by construction the
number of rows behind its own link:

```
/all    page 581   badge 580   ?unread=1 → 580
/news   page 377   badge 377   ?unread=1 → 377
```

That required the server to fetch preferences *before* the rail rather than
alongside it. A count and the list it describes are one fact, and this file has
now been wrong about that in three different places.

---

---

# A source is not one number

Asked for on 2026-08-31: a platform that answers *"which technologies are
actually being adopted"* rather than *"what was published today"*. The brief
that arrived with it is long, and almost all of it turns on one distinction —
**an announcement is not an adoption** — plus one rule that makes the rest
honest: **do not invent facts about sources.**

The registry had carried `trust_weight` since the beginning: one float doing
the work of authority, technical depth, market relevance and signal density at
once. Reuters Technology and a Kubernetes operator's blog can hold the same
`trust_weight` and mean entirely different things, and nothing in the schema
could say so.

## What the measurement found before any of it was built

Four numbers, taken from the archive before writing a line, because three of
them changed the design:

| | |
| --- | --- |
| Healthy sources that are **first-party vendor or project** | 110 of 127 |
| Healthy sources that are **independent** | **9** |
| Stories that **more than one source** reported | 326 of 24,568 — **1.3%** |
| Sources with a country set / non-English sources | 29 of 308 / **0** |

**The archive was a release tracker, not a market intelligence system.** 13,086
of the last 30 days' stories came from 25 changelog feeds. Cross-source
confirmation — the mechanism that separates a trend from a press release —
essentially never fired, because there was nobody independent to do the
confirming. That is not a scoring problem, and fifty more vendor blogs would
have made it worse.

## Three kinds of column, split by where the value came from

The important part of migration 0068 is not *what* it stores but *how it knows*.

- **DECLARED** — a checkable fact. `source_type`, country, region, categories.
  Being wrong about one of these is falsifiable: somebody can go and look.
- **MEASURED** — computed from this archive's own history, never typed in.
  Lives in `source_metrics`, one row per source per window, because "track
  historical performance" only means something if last month's number is still
  there to compare against.
- **PRIOR** — a judgement that cannot be derived from the record. Authority and
  technical expertise, and only those two. Stored *with its reason and its
  date*, and a `CHECK` constraint refuses a prior that has no reason.

Everything else is NULL, and **NULL means UNKNOWN, never zero**. A source with
four stories has no meaningful duplicate rate; writing 0 would put it top of the
ranking for cleanliness. The composite score drops missing dimensions and
renormalises, then reports how many it actually had — a 78 built from two
dimensions and a 78 built from eight are different claims, and the caller is not
allowed to forget which one it is holding.

The reading surface honours the same rule: priors render in *italic* carrying
their reason, measurements render plainly, unknowns render as a dash. A measured
number and a guessed one must not look the same.

## Three axes, not one list

The brief's categories A–J, twelve source types and forty technology domains
read like one taxonomy. They are three, and keeping them apart is what makes
corroboration possible:

- `source_type` — what kind of **claim** this source can make. Exactly one, and
  **the only axis allowed to affect how strongly evidence counts.**
- `categories[]` — what **beat** it covers. Many; Ars Technica is both major and
  technical journalism and forcing a choice loses that.
- `tech_domains[]` — what **technology** it is about. Many; drives coverage-gap
  analysis.

Collapsing them is how *"TechCrunch said it"* starts counting as *"engineers
verified it"*.

Each type carries the highest rung of the adoption ladder it can establish
unaided, and whether two sources of that type corroborate each other:

| type | proves at most | two of them = two confirmations? |
| --- | --- | --- |
| `PRIMARY_VENDOR` | announcement | **no** |
| `PRIMARY_PROJECT` | developer adoption | no |
| `COMMUNITY` | interest | no |
| `DISCOVERY` | interest | no |
| `TECHNICAL_JOURNALISM` | production adoption | yes |
| `MARKET_ANALYSIS` | commercial adoption | yes |

Four vendors moving into one area is **`VENDOR_CONVERGENCE`** — a real and
strong leading signal — and it is still not four independent confirmations.

## Classifying 308 rows without guessing at any of them

Every value comes from a column the row already carries, or from a small map of
organisations whose identity is a matter of public record. Anything else is left
NULL, set to `EVALUATING`, and reported.

Two versions of `deriveType()` were wrong before this one, and both failures are
worth keeping:

**A fallback that always fires is not a derivation.** The first version ended
with *"first-party role and no company registered, therefore a project"*. It
typed 260 of 308 sources in one stroke and reported **zero** undecided — which
looked like success and was the exact failure the brief warns about. It also
called the AWS Machine Learning Blog a project rather than a vendor, and that
distinction is the one thing allowed to affect evidence strength.

**Hosting is not authorship.** The fix was to look the domain up in the
archive's own vocabulary — `companies.homepage_url`, `stacks.homepage_url`. That
was worse in a new way: **179 release feeds live on `github.com`**, and the
company vocabulary quite correctly records `github.com` as GitHub's homepage. So
every one of them — `.NET releases` included — was typed *"GitHub, the vendor,
announcing"*. A release feed is the project's own versions whoever hosts it, so
that question is now asked first, and a list of hosting domains is excluded from
ownership lookups entirely.

The honest result: **288 typed by derivation, 20 left for a person.** The 20 are
Anyscale, CoreWeave, LangChain, MotherDuck, Pinecone, Qdrant, Weaviate, dbt and
others — real vendors that are simply not in the 76-entry company vocabulary
yet. That is a finding, not a failure.

## Measuring: two denominators that looked right and were not

**`items_kept / items_seen` is not signal density.** `items_kept` counts items
*newly stored*, so any feed the archive has already backfilled reports zero.
Measured live: TechCrunch **0%** on 280 items, InfoQ 0% on 2,070, Stripe 0% on
12,601. Those are not noisy sources, they are finished ones.

So the denominator is not what the feed *offered*, it is what the gauntlet
*judged*. `already_archived`, `duplicate` and `duplicate_url` are the archive
recognising something it has seen and say nothing about quality; they are
excluded. What remains — kept, `off_topic`, `too_short`, `not_an_event`,
`build_noise` — is the set on which a judgement about worth was actually made.

**Freshness over all rows measures the import.** Lag is `first_seen_at −
published_at`, and across the archive that read 13,086 hours for Vercel — and
still 1,155 after excluding each source's first days of polling, because every
row in `sources` carries a `first_seen_at` from the week the table was last
rebuilt. A lag only means something for a story published *after the archive
started watching*, which the record can answer directly: the first story ever
stored from that source. Cut there, AWS What's New goes from 165 hours to
**3.3**.

Freshness is now measurable for **28 of 126** sources and NULL for the rest,
which is the truthful answer rather than a flattering one.

## What the registry turned out to be made of

`/sources/intel`, reported and never corrected — nothing removes a source to
hit a target:

| category | have | share | target |
| --- | --- | --- | --- |
| Vendor & primary | 271 | **88%** | 15–20% |
| Major technology journalism | 5 | 2% | 20–25% |
| Technical & engineering journalism | 4 | 1% | 20–25% |
| Developer ecosystem | 7 | 2% | 10–15% |
| Research | 5 | 2% | 10–15% |
| IT business & market | 5 | 2% | 10–15% |

There is also a caution the page states about its own ranking: the composite
currently favours vendor changelogs, because they are trivially on-topic and
perfectly reliable, while the two dimensions that would count against them —
authority and originality — are unmeasured for everybody. Scores are computed on
a mean of **4.3 of 8** dimensions. That is why `known` is reported alongside the
number instead of being hidden inside it.

## Degradation without removal

The brief asks for `SOURCE_PROMOTION` and `SOURCE_DEGRADATION`. The standing
instruction here is *"don't remove anyone anymore"*. Both are satisfied by one
decision: **degradation changes priority, weight and status — never deletion,
never pausing.** Migration 0068 adds no way to retire a source, and a test
asserts it against the file.

It is also better science. A source going quiet is itself a signal, and deleting
the row is how that gets lost.

The first real use was `daringfireball.net`, promoted in error and now typed
`DISCOVERY` — *read to find things, never counted as evidence*. It keeps being
collected, keeps its history, and carries no weight. Nobody was removed.

## The job

`evaluate`, daily at 06:00, classifies then measures — in that order, because
measurement reads `source_type` when it decides what a source's evidence is
worth, and a run that measured first would score today's new sources against
yesterday's idea of what they are.

## Still missing, and named rather than implied

The bottom three rungs of the ladder have no source behind them at all:

| rung | evidence needed | have it? |
| --- | --- | --- |
| Announcement | vendor posts | abundantly |
| Interest | discussion volume | partly |
| Developer adoption | releases, ecosystem growth | partly |
| Production adoption | engineering case studies | thin |
| Commercial adoption | contracts, revenue, pricing | **no** |
| Market expansion | funding, hiring, entrants | **no** |

Non-English intake is zero, so every conclusion is currently biased toward the
anglophone market — and neither discovery channel can fix it, because both are
seeded from an English, US-centric archive. Bias reproduces itself. That needs a
different method and is marked UNKNOWN rather than pretended at.

---

# The day the port stopped being loopback

Asked for on 2026-08-31: *"Run this project on 162.246.23.43:3000"*. The change
in configuration is one line. The change in what the software has to be is not,
because two things were true that had never mattered before.

**The reader has no login.** There is no session, no cookie, and
`SESSION_SECRET` is not referenced anywhere in `src/`. That is a perfectly
reasonable thing for a tool that has only ever answered on 127.0.0.1, and it
stops being reasonable the moment the port is reachable — because eight of the
routes change something, and `/dismiss` removes stories from the reader.

**`/admin` runs on the database owner connection**, which bypasses row-level
security by design. That was already handled: the rule has always been that the
privilege and the exposure cannot both be true, so on a public bind `/admin`
serves nothing at all unless `ADMIN_TOKEN` is set, and then only to a request
carrying it.

## Read is open, change is local

The smallest rule that makes a public bind safe without inventing a login the
project has not designed yet:

> Anyone may read. Only the machine itself may change anything.

`writeDecision()` is checked once, before any write route, rather than inside
each of the eight. A rule that has to be remembered at eight call sites is a
rule that will be missed at the ninth.

Locality is read from `req.socket.remoteAddress` **and from nowhere else**.
`x-forwarded-for` is a claim made by the client; trusting it would mean anyone
could assert they were local and get the write routes back. If a reverse proxy
is ever put in front of this, that decision has to be made deliberately rather
than inherited from a header that happened to be present.

## A guard that was only safe because of its caller

The first version of `isLoopback()` ended with `addr.startsWith('127.')`, which
also accepts `127.0.0.1.evil.com`. Nothing could reach it — a socket address is
always a bare IP, never a hostname — so the bug was unreachable in this
codebase, on this call path, today.

It was still wrong. The function is exported, and a guard that is only safe
because of who happens to call it is a guard waiting for a second caller.
127.0.0.0/8 is now matched as four numbers.

The test that caught it asserts the hostile string directly, and every other
guard case with it: mapped IPv4 (`::ffff:127.0.0.1`, which is what a v4
loopback connection looks like to a dual-stack listener), the public address the
server is bound to, and the empty and undefined cases.

## Bound to 0.0.0.0, not to the address

Binding `162.246.23.43` specifically would have been tighter by one measure and
worse overall: it removes loopback, and loopback is exactly where the write
routes are still meant to work. `HOST=0.0.0.0` keeps both, and `PUBLIC` is
derived from it, which is what arms both guards.

## Verified against the running port

Not reasoned about — asked:

| | |
| --- | --- |
| `GET /` over 162.246.23.43 | **200** |
| `POST /dismiss` from off-host | **403**, with the reason in the body |
| `POST /dismiss` over loopback | 400 — reached the handler and rejected the fake id |
| `GET /admin` off-host, no token | **403** |
| `GET /admin` off-host, right token | 200 |
| `GET /admin` off-host, wrong token | **403** |

Windows Firewall had no rule for 3000 and all three profiles enabled, so an
inbound allow was added for TCP 3000.

## What this is still not

It is not authentication. Anyone who reaches the port reads the whole archive,
and that is what was asked for. Two things follow from it:

- **The `.env` on this host still holds credentials flagged for rotation.** They
  are not served by the application, so the exposure is indirect — but the box
  is now internet-facing, which changes what a compromise would cost.
- **Reachability beyond this machine is not something the code can confirm.**
  The listener, the firewall rule and the guards are verified. Anything upstream
  — a cloud security group, a provider firewall — is outside what these tests
  can see.

---

# The reader, as a Worker

Asked for on 2026-08-31, after the poller went out: *"deploy site to cloudflare"*.

**https://newstrack-site.market-research.workers.dev**

Two Workers now, in two config files, because they have two different jobs and
two different risk profiles: `newstrack-poller` writes to the database on a
schedule and serves nothing, `newstrack-site` serves everything and writes
nothing. One file with two environments would let a `wrangler deploy` typed in
the wrong directory publish the wrong one.

## One handler, two runtimes

`src/ui/server.ts` already exports `handle(req, res)` and routes forty-eight
paths through it. `src/workers/site.ts` is an **adapter and nothing else** — it
turns a `Request` into the two objects that handler expects and turns what it
writes back into a `Response`.

Reimplementing the routes for Workers would have produced two route tables that
agree on the day they are written and drift forever after, and the one drifting
unnoticed would be the one on the public internet.

The surface that needed shimming turned out to be four properties and two
methods: `req.method`, `req.headers`, `req.url`, `req.socket`, `res.writeHead`,
`res.end`.

## The guards had to be forced on, not inherited

Both protections added when the reader was first bound to a public address are
derived from `HOST` — which does not exist in a Worker. Left to default they
would **both** have disarmed at exactly the moment they mattered most.

`PUBLIC` comes from `HOST !== '127.0.0.1'`. Unset, it is false, and `/admin` —
which runs on the database owner connection and bypasses row-level security by
design — would have been served to the open internet with no token at all.

So `HOST` is a var in `wrangler.site.toml`, and `site.ts` **refuses to serve at
all** if it is missing or loopback. A var can be dropped by an edit to a toml
file and nothing else in this system would notice.

The write guard needed nothing: it reads `req.socket.remoteAddress`, there is no
socket, and `undefined` is correctly not loopback. Every mutating route is
refused. That is the behaviour we want and it is load-bearing rather than
incidental, which is why it is written down.

Verified against the deployed URL:

| | |
| --- | --- |
| `/admin` with no token | **403** |
| `/admin` with the token | 200 |
| `POST /dismiss`, `/settings`, `/favourite`, `/read-all`, `/api/dismiss` | **403** |

## Three faults, none of which the type checker could see

**Double compression.** `server.ts` negotiates on `accept-encoding` and returns
a gzipped body with the matching header — exactly right when it owns the socket.
Handed to `new Response()` with that header set, workerd encodes it *again*.
`curl --compressed` peeled one layer off and found binary underneath. The fix is
to delete the request header the negotiation reads: compression is the edge's
job here, and the handler should produce identity.

**A page that rendered perfectly and returned 500.** `end()` was guarded against
being called twice; `writeHead()` was not. So a late rejection — after the
response had already been captured — mutated the status on the very object the
`Response` was about to be built from. `/sources/intel` and `/reports` shipped
correct HTML under a 500, and the body looked so right that the status read like
a database error. `writeHead` is now guarded too, `end()` resolves with a
snapshot nothing can reach afterwards, and a late error is logged rather than
swallowed — it is the only trace of a fault the page itself hides.

**200, 200, 200, 500, 500, 500.** The one worth remembering, because it was a
*count* rather than a flake. `src/ui/db.ts` did `connect()`, `query()`,
`release()` — the right shape for a long-lived Node process and the wrong one
everywhere else. Neon's `connect()` opens a WebSocket session, the pool holding
it is a module global, and a Worker isolate is reused between requests while its
sockets are not guaranteed to survive. The fourth request got a dead one.

Nothing in the UI has ever run a transaction — every caller is a single SELECT —
so nothing needed a session in the first place. `q()` now calls `pool.query()`,
and the Worker sets `neonConfig.poolQueryViaFetch`, which makes a single
statement a stateless HTTP round trip that cannot go stale. In Node the
behaviour is unchanged, because the pool checks a connection out and back
internally.

Eight consecutive requests to `/stacks` after the change: eight 200s. All
fourteen pages: 200.

## What it connects as

`DATABASE_APP_URL` — the `app_user` role, `NOBYPASSRLS`. The owner connection
exists on this Worker only for `/admin`, and `/admin` is behind the token.

## What is not deployed

The **scheduler**. Collection, classification, scoring and the thirteen other
jobs run on the host in `job_runs`, not here. This Worker has no `scheduled`
handler and no cron triggers, and adding one would recreate the two-schedulers
incident recorded in `wrangler.toml`. It serves pages; it does not collect.

So the site is now in two places — the host on port 3000 and the edge — reading
one database. The host remains the only thing that writes.

---

# Who is asking

Asked for on 2026-08-31: authentication, a seeded administrator, signup with a
username and password and an *optional* email, a common user who can set their
focus fields and nothing else — and one bug report: *"the button that change
theme is working incorrectly on deployed sites."*

Those turned out to be the same piece of work.

## The theme button was never broken. It was refused.

The toggle in the top bar is a form that posts to `/settings`, and `/settings`
is installation-wide configuration. When the reader went onto a public address
the only identity available was *the machine itself*, so writes were accepted
only from loopback. Pressing the button from anywhere else answered **403**.

The button did exactly what it was told. The server could not tell an owner
from a stranger, so it said no to everybody.

Now the theme is a column on `accounts` and the toggle posts to `/me/theme`.
It is a property of the person reading, not of the installation — which also
fixes the thing nobody had hit yet: one theme setting shared by every user, so
the first person to prefer light changed it for everyone.

## The model

| | |
| --- | --- |
| **Anonymous** | `/login`, `/signup`, `/healthz`, assets. Everything else redirects to sign in. |
| **Reader** | Reads the whole archive. Writes exactly two things: `/me/fields` and `/me/theme`. |
| **Administrator** | Everything, including `/admin` and `/settings`. |

`isPublicPath` lists what is **open**, not what is closed, so a route added
tomorrow is protected by default and forgetting to list it shows up as a
redirect to the login page rather than as an exposure.

Admin surfaces are refused on **GET** as well as on write. Without that a reader
could navigate to `/admin` and read every tenant's rows off the owner
connection.

A signed-in administrator no longer needs `ADMIN_TOKEN`; the role is the
authorisation. The token stays for headless access.

The default administrator is created at startup, only when the table holds no
admin at all — so it cannot resurrect an account somebody changed, and running
it twice does nothing. Username `admin`, password `Password@026`, and it should
be changed.

## Four faults, each of which looked like something else

**PBKDF2 at 210,000 iterations does not run on Cloudflare Workers.** OWASP
recommends 210,000 for PBKDF2-SHA256, so that is what this used, and on the edge
every login answered 401 and every signup said "could not create the account".
The cause was invisible because `verifyPassword` catches everything and returns
false — a swallowed error is indistinguishable from a wrong password, which is
precisely the silent failure its own test file warns about. Made to speak, it
said:

```
Pbkdf2 failed: iteration counts above 100000 are not supported (requested 210000)
```

A platform ceiling, not a preference. Both runtimes read one database, so a hash
written on the host has to verify on the edge and the count cannot differ
between them: **100,000 everywhere**, the most the stricter of the two allows,
and below what OWASP would like.

The hashes already written carried 210,000 and could never verify on the edge.
They are upgraded by `needsRehash` on the next successful sign-in — the one
moment the plaintext exists — so nobody is locked out and nothing needs a
password reset.

**A `Secure` cookie makes the login silently fail over http.** Set
unconditionally, on the reasoning that a session in the clear is a session
anybody on the path can take. True, and it meant signing in at
`http://162.246.23.43:3000` would post the form, redirect, and land back on the
login page with no error anywhere — because a browser discards a Secure cookie
received over plain http. `curl` stores it regardless, so a request-level test
would have passed. The flag now follows the connection.

**A redirect to the literal `/null`.** Written as
`(body.get('next') ?? '/').startsWith('/') ? body.get('next')! : '/'` — the
fallback was applied to the *test* and not to the value. Read once.

**The Google Fonts URL printed on the page.** `FONTS_HREF` is a bare URL, not a
tag; `page()` in html.ts has always wrapped it in a `<link>` and the newer
sign-in page interpolated it straight into the document, where it rendered as
visible text above the form.

## What is stored

`accounts`, separate from `users` — which is Slack-shaped, `slack_user_id NOT
NULL`, and belongs to the delivery phase that has not been built. Widening it to
mean two things would have left both meanings worse.

Email is nullable and its uniqueness index skips NULLs, so "no address" is not a
value that can collide with another "no address".

`app_user` is granted INSERT and UPDATE explicitly. Default privileges on this
database give a new table SELECT only, which would have let somebody sign in and
then fail to sign up, fail to save a focus field, and fail to change the theme —
the last being the bug this work started from.

---

# The filter was selecting the registry

Asked for on 2026-08-31: *"Expand source list that collect news."*

The obvious reading is "add more feeds". Following it would have made the
archive worse, because the shape of the problem was not a short list.

## What the gap actually was

| category | sources | the brief's target |
| --- | --- | --- |
| vendor | 271 | 15–20% |
| journalism | 5 | 20–25% |
| research | 5 | 10–15% |
| market | 5 | 10–15% |
| engineering | 4 | 20–25% |
| **security** | **2** | *(a whole category)* |

Fifty-four candidates were auditioned against that gap — none of them vendor
blogs. Thirteen cleared the bar, worth about 1.5 items a day. A thin result, and
the refusal column said why, in the same word almost every time:

```
Krebs on Security       0 of 10   not_an_event
Schneier on Security    0 of 10   not_an_event
Dark Reading            0 of 30   not_an_event
IEEE Spectrum           1 of 27   not_an_event
The Pragmatic Engineer  0 of 14   not_an_event
```

## Which is not a judgement about quality

`classifyEvent` ends like this:

```ts
if (opts.firstParty && shape === undefined) return { kind: 'change', matched: 'first-party post' };
return { kind: 'article', matched: shape };
```

A first party gets the benefit of the doubt when nothing in the grammar matches.
Everybody else falls through to `article` — and with `EVENTS_ONLY`, on by
default, ingest drops articles unless `allowsArticles(source)`.

**A vendor post that matches no pattern is kept. The identical sentence from a
newsroom is dropped.**

So the registry was not 88% vendor because of what somebody happened to add. It
was 88% vendor because the pipeline admits vendors and refuses everyone else by
default. Adding journalism to a filter shaped like that just produces more
`not_an_event` rows.

## The switch already existed, under a misleading name

`tech_only` sounds like a topic restriction. What it does is
`allowsArticles()`. Re-auditioned with it, the same feeds on the same day:

| | events only | articles allowed |
| --- | --- | --- |
| IEEE Spectrum | 1 of 27 | **27 of 27** |
| Simon Willison | 3 of 30 | **28 of 30** |
| InfoWorld | 3 of 20 | **19 of 20** |
| The Pragmatic Engineer | 0 of 14 | **14 of 14** |
| Schneier on Security | 0 of 10 | **8 of 10** |
| Krebs on Security | 0 of 10 | **5 of 10** |
| Rest of World | 0 of 12 | **9 of 12** |

And the refusals that remain are real topical judgements — `off_topic:crime`,
`off_topic:politics`, `too_short` — rather than a structural veto.

**This is a deliberate change of character and it is worth saying plainly.**
*"Release notes are events, not essays"* is a rule this project chose, and for a
vendor changelog it is exactly right. For a publication whose entire value is
the essay, it excludes the category. `tech_only` is set on the fourteen
reporting and analysis sources and on no vendor feed, and it is one column —
reversible on any row, at any time.

## What was added

23 sources. Ten filed as events, thirteen with articles allowed.

Security went from 2 to 11: Krebs, Schneier, BleepingComputer, The Record,
Talos, Rapid7, ESET, ProjectDiscovery, SANS ISC. Research from 5 to 8 with MIT
News, Allen AI and arXiv cs.SE. Engineering from 4 to 9, regional from 2 to 4
with TechNode and Rest of World.

**Independent sources — the ones that can corroborate anything — went from 9 to
26.** That is the number that decides whether the archive can ever tell an
announcement from an adoption; two vendors are never two confirmations.

Among the 150 sources actually polled, vendor fell from 91% to 61%.

## What was deliberately not done

**The brief's Category A was not added.** Ars Technica, TechCrunch, The Verge,
WIRED, Engadget and VentureBeat are all on this project's off-topic host list,
and they were put there with forty days of measurement rather than taste:

```
TechRadar Computing   126 items, 67 off-topic,  5 events
Ars Technica           32 items,  6 off-topic,  3 events
The New Stack          36 items,  0 off-topic, 92% technical
```

Three events in forty days is not a feed. Adding those hosts means reversing a
measured decision, which belongs to whoever owns the archive rather than in a
seed file. It is worth noting that the `tech_only` flag would change those
numbers too — the measurement above was taken under the events-only rule.

**The 181 paused release feeds were left paused.** They are healthy, zero
failures, and paused on purpose: *"not polled; kept only because a story that
survives cites it."* Turning them on adds roughly 30 items a day of pure vendor
release notes — real volume, and the exact opposite of what the portfolio is
short of.

**Dark Reading and SecurityWeek were refused even with articles allowed**: 27 of
30 and 9 of 10 refused `too_short`, because those feeds carry headlines and the
pages did not yield text. A source whose body cannot be read is not a source
this archive can use, whatever its reputation.

---

# Choosing a technology should tell you what it is

Asked for on 2026-08-31: *"when I choose a stack or tool, platform, tool, get
wide news and doc of the one"*.

Most of it turned out to be already collected and shown nowhere.

## Tools are not a separate thing

The `tools` table holds **zero rows**, and `/tools` does not read it: it renders
`renderRegistry(url, 'tool')`, which is `stacks WHERE kind = 'tool'` — **153 of
them**. A tool is a stack with a kind, so one entity page already serves stacks,
tools and concepts alike. The empty table is a leftover.

## The documentation existed and no page read it

`stack_resources` holds **1,892 links across 990 technologies** — 1,588
official, 154 reference, 123 learning, 27 tutorials — gathered by the
`reference` job and read by nothing. Meanwhile the technology page showed a
single `docs` chip built from `stacks.docs_url`, a column populated for **24 of
2,338** rows.

So `docsPanel()` renders what was already there, on four shelves: Official,
Reference, Learning, Tutorials. `/trend/kubernetes` now carries eight links —
the docs home, the repository, DevDocs, Kubernetes the Hard Way, Killercoda,
the roadmap — where before it had one chip.

A link whose last check failed is still shown, marked `unreachable`. Silence
would be worse: a reader cannot tell "we have nothing" from "we have something
broken", and only one of those is worth fixing.

The background panel — what the thing is, who makes it, licence, latest version
— was already rendered on both the technology and platform pages from
`entity_reference`, and is untouched.

## Wide news, and where it was narrow

The technology page was already wide: it matches
`s.stacks && stack_expand(ARRAY[$1])`, which walks the stack tree, so choosing
Kubernetes has always included everything tagged beneath it.

The platform page was not. It matched `ARRAY[p.stack_slug]` — the exact tag and
nothing below it. Switched to the same `stack_expand`, two platforms
immediately see more:

| platform | before | after |
| --- | --- | --- |
| aws | 280 | 308 |
| google-cloud | 45 | 73 |

Only two of thirty-four changed, which is worth stating plainly: most platforms
map to a leaf stack with no children, so the widening is correct rather than
dramatic.

---

# A favourite belongs to somebody

Reported by clicking the star and being told:

> That changes something everybody sees, and this account is a reader.

The refusal was accurate. The design behind it was wrong.

## The authorisation rule was right about the schema

`favourites` had one column that mattered — `story_id` — and `PRIMARY KEY
(story_id)`. There was **one favourites list for the whole installation**.
`stories.read_at` was the same shape: one timestamp per story, so opening an
article marked it read for everybody who would ever sign in.

Both were correct when the reader ran on 127.0.0.1 and there was one person.
They stopped being correct the moment accounts existed, and the permission
check was the thing that noticed — it had to call a personal act "shared
state", because in the schema it genuinely was.

**So the fix was not to relax the permission.** Letting a reader write those
would have produced a worse bug than the refusal: two people sharing one
favourites list, each wondering why articles they never saved kept appearing.

## What 0070 changed

`favourites` gained an owner and `PRIMARY KEY (account_id, story_id)`. Read
state moved out of `stories.read_at` into `story_reads` — a row per account per
story, absent meaning unread, so the common case costs nothing to store.

Existing rows were **claimed, not deleted**: the one favourite and seventy read
marks from the single-user era belong to the seeded administrator, because that
is who made them. A favourite is a deliberate act and losing one silently is
worse than attributing it to the operator who made it.

Every function that touches either now takes the account **first, and not
optionally**. An omitted argument would silently mean "somebody", and the whole
point is that there is no such reader.

## What stays global, deliberately

`dismissed_at`. Dismissing is *moderation* — it removes something from every
reader because it should not have been collected, which is what happened to
eleven Daring Fireball links that were somebody else's page. That is shared
state, it stays admin-only, and it is a different act from "I have read this".

Retention is unchanged and still correct: the exemption asks whether **any**
account favourited a story, which now spans accounts rather than assuming one.

## Two bugs the change introduced, and how they showed

**The type checker found the call sites; SQL had to be found by hand.** Adding a
required parameter turned every caller into a compile error — twelve of them,
across the reader, the rail and the routes. What it could not see was raw SQL:
`buildWhere` still emitted `s.read_at IS NULL` against a column nothing writes
any more, and it would have silently shown every story as unread forever.

**Pushing the account onto the shared parameter array broke every query that
shared it.** The row query needed the account for its read flag, so it went onto
`params` — which the count and eight facet queries also use, and none of them
reference it. Postgres refuses a bind supplying more parameters than the
statement uses:

```
bind message supplies 2 parameters, but prepared statement "" requires 1
```

The row query worked perfectly while the page around it returned 500. It has
its own array now.

## The database went away and took the web server with it

On 2026-09-05 the Neon project exhausted its data-transfer allowance. Every
query failed, `SELECT 1` included. That is a billing fact and not a bug — what
the archive *did* about it was three bugs, none of which are about quotas.

**The process died.** `Scheduler.start()` registers the job catalogue, and its
first query threw. `main.ts` awaits that at the top level, so an unreachable
database took the whole process down — web server included. "The archive cannot
reach its database" became "there is nothing listening on port 3000", which is a
worse outage than the one that caused it and far harder to diagnose from
outside. Start-up now treats a failure as a failed tick and hands it to the
backoff; the catalogue is written by the first tick that gets through, which is
safe because the upsert was already idempotent.

**It retried forever, at full speed.** A failed tick rescheduled on the same
five-second cadence: 17,280 attempts a day against a dependency that had already
said no, and an identical log line for every one. The failures that reach that
handler are the database being down, out of quota, or refusing credentials — all
three want waiting, not retrying, and job-level errors never surface there
anyway. The delay now doubles per consecutive failure and resets on the first
success, capped at five minutes. A day of outage costs about 250 attempts
instead of 17,280. The cap matters as much as the growth: a scheduler backed off
to an hour stays down long after its database came back.

**It told everyone why.** The 500 page printed the raw internal message to
whoever asked, so every visitor was shown *"Your project has exceeded the data
transfer quota. Upgrade your plan to increase limits."* — the hosting provider's
billing state, on a deployment bound to `0.0.0.0` from a public repository. That
was the polite version; the same path renders SQL errors, which name tables and
columns. An administrator sees the detail now because they are the person who
can act on it, everyone else gets a sentence, and the log always has it either
way. `role` had to be hoisted out of the `try` for this: it was declared inside,
so the handler could not see it and would have hidden the message from the
administrator too.

### What it was spending

No Neon API key is configured here, so the usage breakdown is the console's to
give. One thing was measurable from the code and was plainly wrong: the browser
polls `/api/counts` every **15 seconds** while a tab is visible, and the counts
cache expired after **5**. The cache never hit once. Every tick of every open tab
re-ran a dozen aggregates over 38,578 stories — 5,760 times a day per tab — to
move a number that only changes when the collector runs, every 30 seconds. The
TTL is now 30 seconds, which is inside the honesty of a badge that already says
"collected 18m ago".

`tests/outage.test.ts` holds the backoff arithmetic, the exponent clamp (`2 **
1000` is `Infinity`, and an infinite delay fires immediately), the role gate, and
an assertion that the counts cache outlives the interval that asks for it.

## The archive can now live somewhere that does not bill by the byte

Asked on 2026-09-08, three days into the outage: *"I want the site work
forever."* No change to this code makes a metered service unmetered, so the
answer was to stop requiring one.

**What made it impossible before.** Every connection went through
`@neondatabase/serverless`. That driver does not speak to a Postgres server --
it speaks to Neon's proxy, over HTTP or a WebSocket. It is the right driver in a
Cloudflare Worker, where there are no TCP sockets, and it was the *only* driver
here. So the archive could only ever live on one metered hosted service, and
when the meter ran out the site went with it.

`src/db/driver.ts` is the whole change: `pg` for a real Postgres server, Neon's
driver for a Neon host, chosen by looking at the hostname.

**Detected, not configured.** A flag is a thing to get wrong — set it while
pointing at Neon and every query fails with a socket error nobody expects. The
connection string already says where it goes, and `.neon.tech` is the only case
where the specialised driver is *required* rather than merely possible. The
check is on the suffix, so `neon.tech.example.com` is treated as the ordinary
server it is. Moving between the two is a change of URL and nothing else, which
is what keeps the Worker deployment working.

The two drivers are API-compatible where this project touches them --
`pool.query(text, params)` resolving to `{ rows, rowCount }`, an `'error'`
event, `connect()`, `end()` — because Neon's Pool is deliberately modelled on
node-postgres. That is what made this a choice of constructor across 15 files
rather than a rewrite.

### Standing it up locally

PostgreSQL 17 via `winget`, then a database and the three extensions the schema
uses (`pg_trgm`, `pgcrypto`, `unaccent` — all bundled). `scripts/migrate.ts`
applies all 73 migrations; 0069 needs the login roles to exist first, so
`scripts/create-app-role.ts` runs between 0068 and 0069, twice, once with
`--worker`. Then the seeds, in an order that matters: `seed` before
`seed:companies` leaves a foreign key unsatisfied and drops a handful of
sources, so companies go first or `seed` runs twice.

Result: **473 sources, all healthy; 2,460 technologies; 141 platforms**, and 269
stories in the first collection cycle. No quota, no meter, no monthly bill, and
queries over a loopback interface instead of the public internet.

### What is still in Neon

The old archive — 38,578 stories and every daily report — is only there, and
cannot be copied out while the transfer quota is exhausted, because a dump is a
read like any other. The Neon URLs are kept in `.env` as `NEON_DATABASE_URL`
and friends, read by nothing, so that when the billing period rolls over the
history can be copied across.

`.gitignore` was widened from `.env` to `.env.*` in the same pass. Taking a
backup called `.env.neon-backup` before a database move is the obvious thing to
do, `.env` does not match it, and that is exactly how a file holding every API
key in a project ends up in a public repository.

## The past was being read and never shown

Reported on 2026-09-09, after the strategy pass had already shipped: *"still you
focus on only current news, you don't analysis the relationship between past and
current of the fields, and I still can't find the market change."*

The strategy pass **was** reading history. Three separate faults made that
invisible, and each is worth writing down because none of them would have shown
up in a test that only asked whether the page rendered.

### 1. The history was not history

`priorContext` took the top 40 stories by importance, ties broken by date
descending, out of an archive that holds 557 stories from August and 93 from
March. Recency won twice: once because recent months are simply busier, and
again in the tiebreak. Measured for `practice` on the day this was reported:

| | Mar | Apr | May | Jun | Jul | Aug | Sep |
|---|---|---|---|---|---|---|---|
| before | 0 | 1 | 3 | 0 | 5 | 14 | 17 |
| after | 6 | 4 | 7 | 6 | 7 | 9 | 1 |

Thirty-one of forty stories from the last five weeks, four from before July. A
model asked how six months changed, holding one month of stories, writes about
one month and calls it a trend. **The report was not ignoring history; it was
being handed last week and told it was six months.**

The lookback is now cut into `PERIODS` equal spans, each diversified on its own
so that no publisher defines what any one month looked like, and then drawn from
in rotation. An empty period costs nothing — the rotation skips it and the
others take its share, so a field that genuinely went quiet in April is not
padded.

Returned **oldest first**, which is not cosmetic: the packet numbers stories in
array order, so the numbering now runs forwards through time and a claim citing
P3 against P37 is visibly a claim about a span. The packet groups them under
month headings for the same reason. Forty stories in a flat list are forty
stories; under month headings they are a sequence, and "what is different
between the top and the bottom of this list" is a question with a shape.

### 2. The earlier end of every claim was invisible

Storage kept `now` as resolved citations and reduced `then` to `thenCount`. The
page then said, under every claim about change:

> The earlier end of this comparison is 4 stories; those are summarised in the
> reasoning above rather than linked, because retention deletes them and a dead
> link is worse than a description.

The reasoning given was that retention deletes those stories within four months,
so an index would rot into a pointer at nothing. **That is true of the index and
false of the copy.** `emerging_sightings` has copied its citations — title,
source, date, url — for exactly this reason since 0074, and a copy survives
retention precisely as well as a number does while telling the reader what the
earlier end actually said.

So both ends are copied at write time and both are rendered, side by side.
`thenCount` is kept as well, for the readings written before this, whose pages
would otherwise lose their only indication that an earlier end had existed.

### 3. Nothing said what changed

`direction` was already the past-to-present relationship, but it arrived as
three separate claims some way down the page. Nowhere did the report say, in one
line, what is different now from before.

So there is now a **`shift`** at the top of every reading — `before`, `after`,
and one sentence naming what moved — held to the same pairing rule as
`direction`: `before` is drawn from the earlier corpus, `after` from today's,
and a shift missing either citation is discarded. It is the most prominent
paragraph on the page, which makes it the one most worth inventing and the one a
reader is least likely to check, so it is the one checked hardest.

The prompt asks for it as a change of subject, never a change of volume: *"In
March the argument was whether these models could do the work; today it is what
a run costs and who is liable when it is wrong"* is a shift, and "there is more
activity in this space" is a count, which rule 2 already forbids. And it is told
that a field standing still is a real finding — inventing motion in one is the
worst thing this can do to a reader deciding where to spend six months.

## "The number of news is very low"

Reported the same day, quoting the analysis page back: *"you said '1,633 stories
analysed across 144 months, 2010-10 to 2026-09', it means you don't analysis
news, for 144 months, you only get 1633 news, it is big fuck."*

The arithmetic was the only part of that which was not a fault. Three things
were wrong and one of them was large.

### The parser could not read half of Atom

RFC 4287 gives `<content>` two forms. `type="html"` carries escaped markup and
arrives as a string. `type="xhtml"` carries **real nested XML** — a `<div>` with
paragraphs inside it — and arrives as a parsed object tree with no `#text` of
its own. `text()` looks for a string or a `#text`, found neither, and returned
null.

Vercel's feed carries 1,563 entries with paragraphs of prose in every one. All
1,563 arrived with an empty body, and 1,103 of them were refused by the
400-character length bar — on every poll, every thirty minutes, for as long as
the collector had been running. ClickHouse, Hugging Face, Shopify and Stripe
were failing the same way. Between them, 92,000 of the 97,302 `too_short`
refusals in three days.

Exactly the mistake the walled-announcement comment in `ingest.ts` already
names — *"the shortness was ours, not theirs"* — except that here nothing was
even walled. The tree is now walked and rebuilt into markup, so `stripHtml`
makes prose of it and `extractLinks` can still see the anchors.

Measured on the same feed in the same hour, before and after: **Vercel went from
5 stories kept in a poll to 781.**

One honest limit, stated in the code: fast-xml-parser does not preserve document
order between an element's `#text` and its children unless `preserveOrder` is
set, and setting it would rewrite every accessor in `feed.ts`. So a sentence with
a link in the middle can come back with the link's words moved to the end. Every
word survives, the anchors survive, and the order within any run of text
survives. For a length gate, a classifier and a summariser that is the right
trade; for quoting a sentence verbatim it is not, which is why the reader still
links to the source.

### A refusal left no trace

Only kept stories get a row, so dedup could recognise what was accepted and
nothing else. A refused item arrived on the next poll indistinguishable from a
new one, and was fetched, extracted, gated and refused again.

The waste was not mainly the gate call. `ingest.ts` allows **25 article fetches
per source per poll**, and an item whose page cannot be read took one of those 25
on every poll and never gave it back. As unreadable items accumulate at the head
of a feed the budget fills with them and the number of new stories that source
can contribute falls towards zero. Hugging Face publishes a title-only feed of
860 entries against a budget of 25.

So `refused_items` (0077) remembers what the gate refused and skips it before a
fetch slot is spent — **with an expiry, because the reasons are not all
permanent**. `retry_after` is how the difference is expressed: `too_short` waits
21 days because publishers do not go back and lengthen posts, `page_blocked`
waits 3 because a 403 often stops, and the wait grows linearly with attempts up
to a 120-day ceiling. Nothing is ever permanent, and the Atom fix in this same
commit is the argument for that: it turned 1,103 of those refusals into readable
stories, and a permanent refusal would have kept every one of them out.

This defers **one item**, for a bounded time. It never defers a source — the
distinction the registry has held since *"I want to filter articles not block
sources"*.

### The page conflated two spans

`archive_history` buckets stories by the month they were **published**, and a
feed serves its back catalogue as well as its latest post. Collecting on a
Tuesday puts one story in 2010-10 and two in 2011-06, and the min-to-max of the
result reads as the age of the archive.

It was nine days old. Every story in the database had been collected on
2026-09-08 or later.

The sentence was wrong in the way that is hardest to catch, because every number
in it was correct. Both facts are now shown and named as different things:
collecting since — taken from `fetch_log`, not from the oldest surviving story,
because retention would otherwise report the archive getting younger every
month — and, separately, the span of publication dates, with the reason a feed
produces one.

## Developer communities, which is where the work is

Asked for on 2026-09-09: *"expand the source list that collect news"*, then *"the
developer's community site is very important."*

Both are right, and the second is the more useful instruction. The strategy
prompt names four things that make billable work: a forced migration with a
deadline, a tool shipped with no ecosystem, a gap between what is sold and what
is needed, and a skill going scarce. A vendor blog is the wrong place to look for
any of them — a vendor announces the migration and never mentions who is stuck
with it. A project's own forum is where the people who are stuck say so, in their
own words, with the version numbers attached.

"How do I get workflows across in the Data Center move" is not news, and it is
the most direct evidence in this archive that somebody would pay for that
afternoon of work.

**Discourse turned out to be the whole story.** `/latest.rss` is a standard
endpoint on every Discourse instance and it carries the opening post in full:
median body between 600 and 2,900 characters, every item dated — better
structured than most vendor feeds already in the registry. Twenty-two forums
probed, twenty-two parsed, and the median kept 28 of 30 against the gates
actually in force.

Thirty sources added, measured rather than estimated:

| kept/sampled | source |
|---|---|
| 30/30 | Grafana Community |
| 29/30 | Rust internals, Elastic Discuss, Temporal, Home Assistant |
| 28/30 | Python Discourse, Go Forum, Swift Forums, LLVM, PyTorch, Hugging Face, OpenAI Developer Community, NixOS, Streamlit, Julia, Hugo, Plotly |
| 26–27/30 | Rust users, Kubernetes Discourse, Django, n8n, Auth0 |
| 25/30 | HashiCorp Discuss |
| 12/12, 17/17 | DEV Community, Ray Discuss |
| 19–23/30 | GitLab Forum, CircleCI, Discourse Meta |
| 12–20/30 | Stack Overflow Blog, The Pragmatic Engineer newsletter |

Filed as **articles**, deliberately. A forum thread is never a release, so with
`EVENTS_ONLY` on and `tech_only` off, all twenty-two forums would have been
admitted and would then have contributed exactly nothing. That is the same
finding `measured-breadth.ts` recorded for publications whose value is the
essay, reached from the other direction. It is one column and reversible per row.

`primary` is false on every forum even though they sit on the projects' own
domains. The Rust project speaks for Rust; the people posting on
users.rust-lang.org do not, and marking these primary would let a user's
complaint about a release be read as the project's position on it — the exact
confusion `firstParty` exists in the strategy reading to prevent.

`seeds/communities.ts` also records the six refusals with their reasons, so
nobody probes them again. Reddit is the one worth knowing about: HTTP 429 on
fourteen of fifteen subreddit `.rss` endpoints, both in parallel and serialised
at one request every 2.5 seconds. Reddit rate-limits anonymous RSS from
datacentre ranges, so adding them would have added fifteen sources that report
themselves failing. It needs an OAuth application credential, which is separate
work and not yet done.


## Nothing had reloaded the code

Reported on 2026-09-09: *"5,276 this number is less when it is a month's news
from 507 sources, And in the report there aren't change."*

The second half had an embarrassing cause and it is worth writing down because
it will happen again. The running process — web server and scheduler in one —
had been started at 14:55. The report page was edited at 16:49. Node loads
modules once at startup, so the page being served and the collector doing the
collecting were both running code from before every fix of that afternoon: no
Atom xhtml parser, no refusal memory, no `shift` section.

There were also **eleven** copies of `src/main.ts` running, ten of them orphans
dating from 1 September. They divide work rather than duplicating it — the
scheduler takes a claim per job — so they were not corrupting anything, but they
were holding database connections and running four different generations of the
code.

**A code change is not deployed until the process restarts.** Nothing in this
repository restarts it, and `npm run live` is a foreground process with no
supervisor. That is the gap; the fix for this instance was to kill all eleven
and start one.

## 406 of 507 sources had produced nothing

The first half of the same report was the more serious one, and the arithmetic
behind it was sound. 507 sources, 5,276 stories. Where is everything?

| | sources |
|---|---|
| have produced at least one story | 101 |
| produced nothing, and report an error | 43 |
| **produced nothing, and report no error at all** | **363** |

Those 363 fetch, parse, see items, and keep zero. gihyo.jp had offered 4,145
items and kept none. Every one of the 363 had `tech_only = false`, and the
dominant refusal was `not_an_event`.

This is the finding `seeds/measured-breadth.ts` already recorded on 2026-08-31 —
*IEEE Spectrum 1 of 27 → 27 of 27*, *InfoWorld 3 of 20 → 19 of 20* — once
`tech_only` was set. The flag was then applied to the ten sources named in that
file and to none of the other 363. With `EVENTS_ONLY` on, a publication that
writes about technology is vetoed sentence by sentence while a vendor changelog
sails through.

`npm run audition:silent` finishes that job the way it was started: it re-runs
every silent source against its own live feed with articles allowed, and sets
the flag only on those that clear `KEEP_BAR` on the measurement. Seven cleared —
TC39 proposals 17/17, GitHub Engineering 10/10, Xe Iaso 10/10, @IT 16/30,
Console.dev 5/6, JavaScript Weekly 4/4, This Week in Rust 4/4.

**356 did not, and their refusals are real:**

| refusal | what it is |
|---|---|
| `lang_gate` | gihyo.jp, OSCHINA, heise, ITmedia, InfoQ 中国, Mercari. `ALLOWED_LANGUAGES` is `['en']`. These are good sources refused for being in Japanese, German and Chinese — a real decision with real cost, and one that belongs to whoever decides what languages this archive reads, not to a script about a boolean column. |
| `blocked_host` | see below |
| `build:tag_page` | Bun, Pulumi, Unsloth, PEFT "releases" feeds that serve a tag listing rather than release notes |

The script deliberately does not touch any of those three, does not lower
`KEEP_BAR`, and does not unblock a host.

## The blocklist was answering a question the project had stopped asking

Reported minutes later, with fourteen headlines and their URLs: *"This the AI
news title and their url I collected, but you can't find these news, it means
there are big problem in your source list."*

There was a problem and it was not the size of the list. **Seven of the twelve
domains were refused at the host level**, before any filter saw them, by this
entry in `src/vocab/offtopic.ts`:

```
// Startup and venture press: the beat is who raised money, not what shipped.
'techcrunch.com', 'venturebeat.com', 'sifted.eu', 'crunchbase.com',
```

That comment was a correct reading of the purpose on the day it was written. The
purpose then changed underneath it, twice:

- **2026-08-28** — *"The purpose of this project is finding new stacks and market
  via news."* `market` became the second target and an `event_kind`.
- **2026-09-09** — *"detect IT market changes and find opportunity that I can
  attend to work remotely and create income as freelancer."*

Under either of those, "who raised money" is not a reason to refuse an outlet; it
is one of the two things being collected. So the archive ran for three weeks with
`market` as a first-class event kind and every outlet covering it blocked at the
host level — which is the actual explanation for a note recorded weeks earlier
and never resolved: *the market lane held 3 stories against 1,560 `change`.*

Two of the fourteen domains were not blocked at all. Schneier on Security was
simply never registered.

### Measured before deciding, including the ones that stayed out

Sampling each live feed through the whole gauntlet with the host block lifted.
`market` counts items the event classifier filed as a market move — the lane
that was empty:

| source | kept | market | outcome |
|---|---|---|---|
| SiliconANGLE | 29/30 | 6 | added |
| Ars Technica | 15/20 | 0 | unblocked |
| Crunchbase News | 8/10 | 4 | added |
| Schneier on Security | 5/10 | 0 | added |
| The Next Web | 3/10 | 0 | added |
| TechCrunch | 1/20 | 0 | unblocked — see below |
| **The Verge** | **9/10** | 0 | **stays blocked** |
| Wired | 0/30 | 0 | not admitted |

Crunchbase returned the exact headline reported missing — *"Mistral AI Raises
$3.5B At $24B Valuation In Another Record European AI Round"* — and Schneier
returned both of the ones attributed to it.

**The Verge is the control, and it is why `CONSUMER_HOSTS` survives.** It clears
every gate at 9 of 10, and what it clears with is *"there aren't AirPods with
cameras yet and I hope it stays that way"* and *"the black iPhone Pro returns"*.
The consumer-press judgement is still exactly right about the outlets it was
written about. So the venture and industry press moved to a separate
`MARKET_PRESS_HOSTS` list rather than the consumer list being deleted.

### An audition reads the feed; ingest reads the page

TechCrunch scored **1 of 20**, with 18 refused as `too_short`. It was admitted
anyway, on its beat rather than its score, with the number written down and the
reason stated: an audition sees only the feed, while ingest fetches the article
page for anything short.

Polled for real, immediately afterwards: **19 of 20 kept.** The caveat was worth
writing and the source was worth admitting on it. Wired stays out on a different
number — 11 of 30 refused as `off_topic:commerce`, which is a shopping-guide
business attached to a magazine, and no amount of page fetching changes that.

Registry 507 → 511. Three of the fourteen reported headlines are now in the
archive under their own bylines.


## The reading may now research outside the archive

Asked for on 2026-09-09: *"I want to you research all news that related to the
target news when you generate report, This mans when you make report, don't be
limited to db's past news, I want to know trend of the tech, not summary of the
news."*

**The limit was structural, not a matter of prompt wording.** The pairing rule in
`strategy.ts` discards any claim about change whose earlier end it cannot cite.
That rule is right — it is the only thing separating a finding from a
restatement — and it silently caps every reading at the depth of our own
collection. This archive began collecting on 2026-09-08. Asked how a field had
changed since March, it could answer only from whatever March-dated items
happened to be sitting in some feed's back catalogue.

So the earlier end may now come from outside, in two forms, and `then` **or**
`thenOutside` satisfies the rule. Neither being present still drops the claim.

| | |
|---|---|
| **adoption series** | daily downloads from the registry that publishes the package, reaching back six months |
| **outside coverage** | stories about our subjects that we never collected, from the public Hacker News index, with dates and links |

Every registry used is **keyless** — `api.npmjs.org`, `pypistats.org`,
`crates.io`, `hn.algolia.com` — which matters because this has to run unattended
and a key is a thing that expires while nobody is looking.

### Why this is not "counting our own stories" in disguise

That rule exists because an archive count answers *how many of these did WE
catch*, which measures a feed list. Everything here is published by somebody
else under its own name and is true whether or not this repository runs — and it
is **more** checkable than our own corpus, because anybody can re-run the same
query against the same public API and get the same answer. It is the argument
`public.ts` already makes for GitHub topic counts, extended from a census to a
series, because a snapshot cannot express a trend and a trend is the ask.

### It nearly published two wrong numbers, and both are the same mistake

Everything else on a field report is a sentence with a story under it, and a
reader can open the story. A download curve is the first thing on the page that
is **a number with no story** — and a number reads as more certain than a
sentence, so a wrong one does more damage than any wrong paragraph could.

**The name is not the package.** The first version guessed that a technology's
slug is its package name on the first registry that answers. Measured before it
was wired into anything:

```
kubernetes  npm:kubernetes   29/day ->  158/day   +441%
polars      npm:polars        4/day ->    2/day    -52%
```

Neither is the technology. `npm:kubernetes` is an abandoned client with a
hundred installs a day. `npm:polars` declares `github.com/ritchie46/polars`
while the project lives at `pola-rs/polars` and ships 1.9M/day through PyPI —
four orders of magnitude apart. *"Kubernetes adoption rose 441%"* is exactly the
confident, checkable-looking, wrong finding this archive exists to refuse.

So a package is accepted only when **the registry's own declared repository
matches the repository the taxonomy holds**. The name is not the evidence; the
repository is. Verification also makes a second guess safe: a project is often
known by its organisation and ships under its artefact's name, so the
repository's own name is tried too — which is how `huggingface` correctly
resolves to `pypi:transformers`.

**And then the taxonomy is not the world.** Verifying against `stacks.repo_url`
makes that column the single point of failure, and one step after the above was
fixed, `jinja` resolved cleanly to `pypi:django` — because the taxonomy row for
jinja carries `github.com/django/django`. Correct by construction and wrong
about the world, which is the first failure wearing the fix for it as a
disguise. The guard is that the slug must appear somewhere in the repository it
claims: `pola-rs/polars`, `huggingface/transformers`, `langchain-ai/langchain`
and `pypa/pip` all pass; `django/django` does not contain "jinja" and is
refused, with the taxonomy row named in the refusal so the data can be
corrected rather than the number quietly published.

74 taxonomy rows have that shape and most are legitimate — `blazor →
dotnet/aspnetcore`, `delta-lake → delta-io/delta` — so the guard refuses some
real curves too. **No curve is better than a wrong curve**, and that trade is
made deliberately.

### What a movement actually measures

A mean over **28 days at each edge**, not the first day against the last.
Package downloads are violently weekly — a Sunday is a third of a Tuesday — so
two single days can differ by 200% while nothing has happened. Below two full
edges, no percentage is computed at all: a figure drawn from four days is a
number with no meaning, and printing one is worse than printing nothing.

Verified curves at the time of writing:

| | | |
|---|---|---|
| polars | `pypi:polars` | 1,580,369/day → 1,990,894/day **+26%** |
| fastapi | `pypi:fastapi` | 12,310,986/day → 15,023,472/day **+22%** |
| huggingface | `pypi:transformers` | 4,227,661/day → 4,558,529/day **+8%** |
| langchain | `pypi:langchain` | 7,567,002/day → 6,784,138/day **−10%** |

The page states, next to the table, that **downloads are not users** — they
include continuous integration and mirrors, so a move is a change in how often
something is installed and nothing more.

### Two subject lists, because they want opposite things

The first run produced **zero curves across all four fields**, on a day when
polars, langchain, streamlit and huggingface all had six months of series
available. The subjects leading a day's corpus are category tags — `ai`,
`cloud`, `open-source`, `startups` — plus vendor organisations whose `repo_url`
is `github.com/aws`. None of them is a package, so every lookup correctly
refused and the block was empty for a correct reason.

A curve needs a named project with a repository; coverage search wants the
opposite, because `open-source` is a useless package and a perfectly good
search. So the curve list is filtered to subjects the taxonomy gives a
repository, drawn from a wider slice of the day's corpus (333 technologies were
named; 69 have a real repository), while search takes the head of the frequency
order.

### What is stored, and what is not

The research is **stored with the reading**, not re-fetched on view. A registry
answers with today's numbers, so a page that researched on render would show a
different curve every day underneath a claim written once — and the claim is
what was published. `adoption_lookup` also records misses, so a technology that
is not on any registry is not looked up again tomorrow.

Outside coverage is **listed and never summarised**. We have the headline and
the date and did not fetch the article, and writing a summary of something
nobody read is the one thing this archive must never do. It is also deduplicated
against our own stories by URL before it is offered, because an item we already
hold is not outside evidence and presenting it as an independent second sighting
would be the worst error this module could make.


## The report that is not about a field

Two reports minutes apart on 2026-09-09, and they are the same objection from
both ends:

> you make report on only fields that user selected, but the most important
> report is about new appearing fields and market, tool, platform

> You make all field's report even user didn't select favourite fields

`briefArchive` loops over `FIELDS`, a taxonomy written in advance, and asks what
happened inside each one. **That shape can only ever report on categories
somebody already thought of.** A genuinely new thing arrives without a field: it
is one launch from one vendor, tagged with whichever existing label its words
happened to match, and it reads as an ordinary event in an established category.

So `/new` answers the other question, and it is the only report here that is not
about a field.

### Nothing on it is written by a model

The emerging ledger (0074) does this properly, reading names out of prose. On
the day this was asked for it had **3,064 stories unscanned and had added
nothing since 23 June**, because the `names` job needs a model and every
provider was rate-limited. The most important report in the system was one that
could not be written at all.

So `/new` reads the pipeline's own verdicts instead:

| | |
|---|---|
| `launch` | the event classifier's verdict that a story introduces rather than updates |
| `market` | money and ownership moving &mdash; 8 today, and it was 3 in the whole archive before the venture press came off the host blocklist |
| names | product names pulled out of those headlines, lexically |

### The first version of the name-finder asked the wrong question

It computed a set difference over our own tagging: technologies named today
that the archive had never attached to a story before. Measured, the answer was
**`gmail`, `nasa`, `cooling`, `hacking`** &mdash; every one an established thing
whose taxonomy row says `origin: seed` or `origin: topic_index`. That list
reports **tagger coverage**: which known names the matcher happened to hit for
the first time. Useful to somebody maintaining the tagger and worthless to
somebody asking what is new in the world.

A genuinely new thing is in no registry at all. It is a word in a headline, so
the names come out of the headline &mdash; and only out of `launch` and `market`
headlines, because introduction is what makes a capitalised word a product name
rather than a person, a place, or the first word of a sentence.

It found `booley`, `volanti`, `cymphony`, `consort`, `geordie` and `lightfield`
on the first run. It also found **`an-open` and `a-free`**, from *"Show HN: An
open-source SAS interpreter"* and *"Show HN: A free, open-source agent
orchestrator"* &mdash; those authors did not name their tool in the headline,
and inventing a name from the first two words is worse than reporting nothing.
Headlines beginning with a determiner are now refused.

`slugify` and `NOT_A_PRODUCT` are shared with the emerging ledger rather than
duplicated: two opinions about what a product name is would drift, and the one
deciding unattended would be the one that drifted.

**An absence on this page means nothing**, and the page says so. It can only
find a name somebody put in a headline in a form a pattern recognises.

### The daily report now asks for the fields somebody chose

`accounts.fields` has held that answer since the taxonomy was written and
nothing read it, so the job attempted fourteen readings a day whether or not
anybody had asked for them &mdash; a model call each, with a strategy call
behind it. The union across accounts now decides, so two people choosing
different fields get both.

It **falls back to everything when nobody has chosen**, and the fallback is not
laziness: an archive that writes nothing until somebody visits Settings looks
broken on the day it is installed. The job note says which of the two happened,
so *"why is it writing about robotics"* is answerable from the log.


## A failed report ate the news it could not read

Reported as *"there are no change"*, then *"I mean the report don't change"*.
Two things were stale and only one was the code.

The site was **four commits behind on disk**: Node loads modules once at
startup and the process predated them. Underneath that, the stored report had
not been rewritten since 07:00 — and the report is a stored artifact, not
something rendered from the stories on each view, so the code was live while the
page was twelve hours old.

Forcing a re-run exposed the real defect. `covered_to` is the **read cursor**:
`lastCoverage` takes `max(covered_to)` and the next run starts there.
`saveArchiveReport` wrote it unconditionally.

| provider | state at 20:53:48 |
|---|---|
| cerebras | `down` until 20:54:43 |
| gemini-flash, gemini-flash-lite | `exhausted` until 20:54:51 |
| groq | `exhausted` until 21:52:06 |
| claude | no key |

All fourteen fields failed in **9.7 seconds**, nothing was written, and the row
still claimed coverage to 20:53:48. The **291 summarised, tagged stories**
collected since 07:00 would never have been read by any future report. The job
logged success, because it did run — it just had nothing to say.

Coverage is now claimed **only when at least one field was actually briefed**.
The day row is still written, because a day the report could not be produced is
a fact worth keeping, and `covered_to IS NOT NULL` in `lastCoverage` means a
null simply leaves the window open. A **partial** report still claims the whole
window; that needs a per-field cursor, and it is recorded as an open hole rather
than implied to be handled.

### The repetition was citations, not sentences

Asked separately: *"why do you repeat same sentences in report"*. Measured
across the whole day's report: **199 distinct prose sentences, zero duplicates.**
Nothing written was repeated.

What repeated was **evidence**. `cloud` and `data` carried **26 of 32 identical
outside stories**, and one headline appeared in all four fields. The cause is
that outside search subjects were the head of the frequency list, and that head
is the same broad tags in every field:

```
cloud    aws, ai, google, cloud, gcp, cve
data     data, google, database, cms, ai, cve
```

Three shared terms is three shared searches is one shared list. Two changes: the
field's own category tag and the generic words in `NOT_A_PRODUCT` come out of
the search list — searching Hacker News for `cloud` returns what Hacker News
discussed, whichever field asked — and **one seen-set spans the whole run**, so
the first field to want a story keeps it.

### NaN in the reports rail

Every dated row was stamped `data-count="fields"`, and `counts.fields` is the
News rail's **array** of fields. The fifteen-second poller painted
`Number([...])` over three correct server-side counts. A per-day count cannot be
keyed globally at all — one key would paint one number onto all ten rows — so
the key is gone, and the painter now refuses a value that is not finite.


## Week, month and year reports

Asked for on 2026-09-09, against a screenshot of `/reports`: *"at the top of
list, you have to display report that summary all day's news and about new
market and things like tool, platform and so on. And make weekly report and
month report. And generate a year's report by collecting all news."*

```
/reports/day/2026-09-09     /reports/month/2026-09
/reports/week/2026-09-09    /reports/year/2026
```

One renderer for all four spans. They differ in how much they show and in what
the caveats say, not in shape — four pages that drift apart is how the same
question gets four different answers.

### No model writes any of it

This is a decision, not a shortcut, and it has three reasons in the order they
bind:

1. **A year does not fit in a prompt.** The archive holds 5,461 stories back to
   2010. Any model-written year report is really a report about whichever slice
   was sampled, and the sampling would be the finding.
2. **The providers are not there.** Measured hours before this was written: the
   daily report failed all fourteen fields in 9.7 seconds with every provider in
   cooldown. A monthly report that needs a model is a monthly report that does
   not exist on the day you want it.
3. **The material is already written.** Every daily briefing in the period was
   model-written once, cited, and checked by the pairing rule. Re-reading the
   same stories to say the same thing again is a second chance to be wrong, not
   a second opinion.

So a period report **composes**, from three things that answer different
questions:

| section | what it is |
|---|---|
| **What appeared** | launches, funding and acquisitions, and names never seen before — the pipeline's own verdicts. The *"new market and things like tool, platform"* half of the ask. |
| **What moved** | public download curves measured across the period. The only magnitudes on the page, and the only real trend. |
| **What was read** | the claims the daily readings already made, quoted, deduplicated, never re-summarised. |

Measured on the day it was built:

| span | launches | market | new names | curves | findings |
|---|---|---|---|---|---|
| day 2026-09-09 | 12 of 13 | 6 | 5 | — | 14 |
| week to 09 Sept | 25 of 26 | 10 | 13 | 5 | 14 |
| September 2026 | 40 of 41 | 15 | 16 | — | 14 |
| 2026 | 60 of 61 | 19 | 19 | 5 | 14 |

### Calendar periods, and an edge that scales

A month is **September**, not the last thirty days: two of them are only
comparable if the boundaries are the same boundaries each time. A week is the
seven days *ending* on the date, because there is no calendar week a reader of
this archive already thinks in.

The curve comparison uses **a quarter of the period at each end, capped at 28
days and floored at 3**. The daily reading compares two 28-day means because it
asks about six months; 28 days of a seven-day period is the whole period twice.
The floor of three exists because package downloads are violently weekly — a
Sunday is a third of a Tuesday — so one day at each end would report the shape
of the calendar rather than the shape of the adoption. Below twice the edge
there is no comparison to make and **no number is printed**, which is why the
day report and an incomplete month show no curves.

### No story counts anywhere

Counting our own stories measures the feed list, not the world: *"launches rose
40% this month"* is a fact about which sources answered. Lists are shown and
never totalled into a trend. Every figure on a period page comes from PyPI, npm
or crates.io and can be re-run by anybody against the same public API.

### A withdrawn resolution now takes its curve with it

`adoption_lookup` caches the answer, so once a slug resolves the series is
fetched daily and kept for ever — and tightening the guard afterwards only stops
*new* rows. `jinja` had been resolved to `pypi:django` before the "the repo must
mention the slug" rule existed, and **181 days of django's downloads were still
sitting in `adoption_series` under the name `jinja`**, ready for the first
period report to put on a page. Withdrawing a resolution now deletes the curve
with it, and `movementsIn` joins the lookup so a withdrawn resolution cannot
reach a page even if a row survives.

### The index leads with what appeared

`/reports` opened with fourteen field buttons and then a list of days, so the
first thing on the page was navigation and the second was an archive. A launch
belongs to whichever field its words happened to match and a funding round
belongs to none of them, so neither was reachable from a per-field index at all.
The lead card is now first, and it summarises **the latest day that has
stories** rather than the calendar day — the archive works in UTC, so for
several hours every morning "today" holds a handful of overnight items and would
read as a broken page.


## Not built, and why

- **Slack, multi-tenant install, the interactive agent** — Phases 4–6.
- **API adapters** for Bluesky, Mastodon, package registries, NVD, OSV, status
  pages and Product Hunt. Hacker News and Show HN are implemented; the rest are
  listed in `PLANNED_ADAPTERS` and their sources are *paused with a reason* rather
  than failing silently every hour.
- **Newsletter IMAP ingest.** Cloudflare Workers has no IMAP; this needs either a
  small polling process elsewhere or a mail-to-webhook bridge.
- **RSSHub** for WeChat and Zhihu. The only non-free infrastructure dependency.
- **Backfill for package registries.** npm and PyPI expose per-package version
  history, but walking it is a request per package rather than per page.
- **Recall measurement.** The spec's own test — pick 20 stories you know mattered
  last month and check whether the pipeline caught them — has not been run. Above
  ~85%, further source-hunting has poor returns.
