// Developer communities: where the work shows up before anybody writes it up.
//
// Asked for on 2026-09-09, twice and plainly: "expand the source list that
// collect news", then "the developer's community site is very important."
//
// WHY THIS IS THE RIGHT LIST FOR THIS ARCHIVE, and not merely more feeds.
//
// The reader is one person deciding what to learn, build and quote for. The
// strategy prompt names four things that make billable work: a forced migration
// with a deadline, a tool shipped with no ecosystem, a gap between what is sold
// and what is needed, and a skill going scarce. A vendor blog is the wrong
// place to look for any of them -- a vendor announces the migration and never
// mentions who is stuck with it. A project's own forum is where the people who
// are stuck say so, in their own words, with the version numbers attached.
//
// "How do I get workflows across in the Data Center move" is not news, and it
// is the most direct evidence in this archive that somebody would pay for that
// afternoon of work.
//
// WHAT WAS MEASURED, on 2026-09-09, against the gates actually in force -- the
// topic filter, build noise, the event classifier and the length bar -- taking
// 30 items per feed. `kept` is what survived. These are not estimates.
//
// Discourse turned out to be the whole story. /latest.rss is a standard
// endpoint on every Discourse instance and it carries the opening post in full:
// median body between 600 and 2,900 characters, every item dated, which is
// better structured than most vendor feeds already in this registry. Twenty-two
// forums probed, twenty-two parsed, and the median kept 28 of 30.
//
// FILED AS ARTICLES, DELIBERATELY. Every row here is `articles: true`, which
// ingest reads as `allowsArticles`. A forum thread is never a release, so with
// EVENTS_ONLY on and this flag off, all twenty-two forums would contribute
// exactly nothing. That is the same finding measured-breadth.ts recorded for
// publications whose value is the essay, reached from the other direction. It
// is one column and reversible per row.
//
// The refusals at the bottom are kept for the reason that file keeps its own:
// so the decision is not made twice.

import type { MeasuredSource } from './measured-breadth.ts';

/**
 * A project's own forum, filed as COMMUNITY.
 *
 * `primary: false` even though a forum sits on the project's own domain, and
 * the distinction matters. The Rust project speaks for Rust; the people posting
 * on users.rust-lang.org do not. Marking these primary would let a user's
 * complaint about a release be read as the project's position on it, which is
 * the confusion `firstParty` exists in the strategy reading to prevent.
 */
export const COMMUNITIES: MeasuredSource[] = [
  { name: 'Python Discourse', url: 'https://discuss.python.org/',
    feed: 'https://discuss.python.org/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['python', 'open-source'], kept: 28, sampled: 30,
    why: 'Where PEPs are argued and packaging pain is reported, by the people having it.' },

  { name: 'Rust users forum', url: 'https://users.rust-lang.org/',
    feed: 'https://users.rust-lang.org/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['rust', 'open-source'], kept: 27, sampled: 30,
    why: 'Practitioners hitting real edges in Rust, with the versions attached.' },

  { name: 'Rust internals', url: 'https://internals.rust-lang.org/',
    feed: 'https://internals.rust-lang.org/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['rust', 'open-source'], kept: 29, sampled: 30,
    why: 'Language direction argued in public, months before any of it ships.' },

  { name: 'Kubernetes Discourse', url: 'https://discuss.kubernetes.io/',
    feed: 'https://discuss.kubernetes.io/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['kubernetes', 'cloud-computing'], kept: 26, sampled: 30,
    why: 'Operational pain in the platform most teams cannot staff for.' },

  { name: 'Go Forum', url: 'https://forum.golangbridge.org/',
    feed: 'https://forum.golangbridge.org/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['golang', 'open-source'], kept: 28, sampled: 30,
    why: 'Go in production, asked about by the people running it.' },

  { name: 'Swift Forums', url: 'https://forums.swift.org/',
    feed: 'https://forums.swift.org/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['swift', 'open-source'], kept: 28, sampled: 30,
    why: 'Evolution proposals and compiler work, in the open.' },

  { name: 'LLVM Discourse', url: 'https://discourse.llvm.org/',
    feed: 'https://discourse.llvm.org/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['compilers', 'open-source'], kept: 28, sampled: 30,
    why: 'Compiler and toolchain direction. Upstream of most languages here.' },

  { name: 'PyTorch Forums', url: 'https://discuss.pytorch.org/',
    feed: 'https://discuss.pytorch.org/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['ai', 'community'],
    domains: ['machine-learning', 'python'], kept: 28, sampled: 30,
    why: 'What breaks when people actually train things.' },

  { name: 'Hugging Face Forums', url: 'https://discuss.huggingface.co/',
    feed: 'https://discuss.huggingface.co/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['ai', 'community'],
    domains: ['machine-learning', 'llms'], kept: 28, sampled: 30,
    why: 'Model and inference problems, from the people deploying them.' },

  { name: 'OpenAI Developer Community', url: 'https://community.openai.com/',
    feed: 'https://community.openai.com/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['ai', 'community'],
    domains: ['llms', 'ai-agents'], kept: 28, sampled: 30,
    why: 'API changes felt before they are announced, and priced in public.' },

  { name: 'Grafana Community', url: 'https://community.grafana.com/',
    feed: 'https://community.grafana.com/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['observability', 'devops'], kept: 30, sampled: 30,
    why: 'Observability as it is run, not as it is sold. Kept every sampled item.' },

  { name: 'Django Forum', url: 'https://forum.djangoproject.com/',
    feed: 'https://forum.djangoproject.com/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['python', 'web-development'], kept: 26, sampled: 30,
    why: 'A framework with a long upgrade tail and teams stuck on old versions.' },

  { name: 'Elastic Discuss', url: 'https://discuss.elastic.co/',
    feed: 'https://discuss.elastic.co/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['data', 'community'],
    domains: ['search', 'observability'], kept: 29, sampled: 30,
    why: 'Licence changes and version migrations, argued by the people paying for them.' },

  { name: 'Ray Discuss', url: 'https://discuss.ray.io/',
    feed: 'https://discuss.ray.io/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['ai', 'community'],
    domains: ['machine-learning', 'distributed-systems'], kept: 17, sampled: 17,
    why: 'Distributed training and serving. A quieter feed that kept everything it had.' },

  { name: 'NixOS Discourse', url: 'https://discourse.nixos.org/',
    feed: 'https://discourse.nixos.org/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['linux', 'devops'], kept: 28, sampled: 30,
    why: 'Reproducible builds and packaging, argued in depth.' },

  { name: 'GitLab Forum', url: 'https://forum.gitlab.com/',
    feed: 'https://forum.gitlab.com/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['devops', 'developer-tools'], kept: 19, sampled: 30,
    why: 'Self-managed upgrades and CI breakage: the shape of a paid afternoon.' },

  { name: 'Streamlit Community', url: 'https://discuss.streamlit.io/',
    feed: 'https://discuss.streamlit.io/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['data', 'community'],
    domains: ['python', 'data-visualisation'], kept: 28, sampled: 30,
    why: 'Where internal data apps are actually built, largely by non-specialists.' },

  { name: 'n8n Community', url: 'https://community.n8n.io/',
    feed: 'https://community.n8n.io/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['automation', 'ai-agents'], kept: 27, sampled: 30,
    why: 'Automation and agent plumbing, built by people who will outsource the hard part.' },

  { name: 'Temporal Community', url: 'https://community.temporal.io/',
    feed: 'https://community.temporal.io/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['distributed-systems', 'backend'], kept: 29, sampled: 30,
    why: 'Durable execution: a specialism with far more demand than practitioners.' },

  { name: 'HashiCorp Discuss', url: 'https://discuss.hashicorp.com/',
    feed: 'https://discuss.hashicorp.com/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['devops', 'cloud-computing'], kept: 25, sampled: 30,
    why: 'Terraform and Vault in anger, through a licence change that moved everybody.' },

  { name: 'Julia Discourse', url: 'https://discourse.julialang.org/',
    feed: 'https://discourse.julialang.org/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['scientific-computing', 'open-source'], kept: 28, sampled: 30,
    why: 'Numerical and scientific computing, where the users are also the authors.' },

  { name: 'Home Assistant Community', url: 'https://community.home-assistant.io/',
    feed: 'https://community.home-assistant.io/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['iot', 'open-source'], kept: 29, sampled: 30,
    why: 'The largest self-hosting community there is, and an integration market of its own.' },

  { name: 'Hugo Discourse', url: 'https://discourse.gohugo.io/',
    feed: 'https://discourse.gohugo.io/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['web-development', 'open-source'], kept: 28, sampled: 30,
    why: 'Static sites, and migrations off heavier stacks onto them.' },

  { name: 'CircleCI Discuss', url: 'https://discuss.circleci.com/',
    feed: 'https://discuss.circleci.com/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['devops', 'developer-tools'], kept: 23, sampled: 30,
    why: 'CI breakage and pricing, which is when a team goes looking for somebody.' },

  { name: 'Auth0 Community', url: 'https://community.auth0.com/',
    feed: 'https://community.auth0.com/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['security', 'community'],
    domains: ['identity', 'security'], kept: 27, sampled: 30,
    why: 'Identity integration: specialist, badly documented, and reliably paid for.' },

  { name: 'Plotly Community', url: 'https://community.plotly.com/',
    feed: 'https://community.plotly.com/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['data', 'community'],
    domains: ['data-visualisation', 'python'], kept: 28, sampled: 30,
    why: 'Dash and analytics dashboards, a great deal of it contracted out already.' },

  { name: 'Discourse Meta', url: 'https://meta.discourse.org/',
    feed: 'https://meta.discourse.org/latest.rss', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['open-source', 'web-development'], kept: 21, sampled: 30,
    why: 'The platform every other forum here runs on, and a plugin market with money in it.' },

  { name: 'DEV Community', url: 'https://dev.to/',
    feed: 'https://dev.to/feed', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'community'],
    domains: ['developer-tools', 'web-development'], kept: 12, sampled: 12,
    why: 'Practitioner write-ups, carried in full in the feed. Kept every item sampled.' },

  { name: 'Stack Overflow Blog', url: 'https://stackoverflow.blog/',
    feed: 'https://stackoverflow.blog/feed/', primary: false, articles: true,
    sourceType: 'COMMUNITY', categories: ['engineering', 'market'],
    domains: ['developer-tools'], kept: 20, sampled: 30,
    why: 'Survey data on what developers use, which is a public figure and not our own count.' },

  { name: 'The Pragmatic Engineer newsletter', url: 'https://newsletter.pragmaticengineer.com/',
    feed: 'https://newsletter.pragmaticengineer.com/feed', primary: false, articles: true,
    sourceType: 'SPECIALIST_PUBLICATION', categories: ['engineering', 'market'],
    domains: ['developer-tools', 'enterprise-software'], kept: 12, sampled: 20,
    why: 'The labour-market half of this archive: who is hiring, for what, at what rate.' },
];

/**
 * Probed and refused, with the reason, so that nobody probes them again.
 *
 * Every one of these is a site worth reading. That is not the question the
 * registry asks -- it asks whether the FEED carries enough for the pipeline to
 * work with, and each of these fails that for a different, checkable reason.
 */
export const REFUSED_COMMUNITIES = [
  { name: 'Reddit (r/programming and fourteen others)',
    note: 'HTTP 429 on fourteen of fifteen subreddit .rss endpoints, both in '
      + 'parallel and serialised at one request every 2.5 seconds, from this '
      + 'address. Reddit rate-limits anonymous RSS from datacentre ranges. '
      + 'Adding them would add fifteen sources that report themselves failing. '
      + 'It needs an OAuth application credential, which is separate work.' },
  { name: 'programming.dev and lemmy.world',
    note: '3 of 19 and 3 of 20. Lemmy communities are link aggregators: an '
      + 'entry is a title and a URL, so fifteen of nineteen fell to the length '
      + 'bar. The links themselves already reach us from their own sources.' },
  { name: 'changelog.com',
    note: '0 of 3, every one a media_enclosure. It is a podcast feed and this '
      + 'archive holds text. The written companion is not separately syndicated.' },
  { name: 'Apache TVM Discourse',
    note: '0 of 1. The feed carried a single item inside the audition window. A '
      + 'forum this quiet costs a poll and returns nothing; worth revisiting if '
      + 'TVM activity picks up.' },
  { name: 'console.dev, indiehackers.com, hashnode.com',
    note: 'One HTTP 404 and two unparseable responses. No feed to point at.' },
  { name: 'community.cloudflare.com, forum.dbt.com, community.render.com, '
      + 'discuss.developer.mozilla.org, forum.astronomer.io',
    note: 'Discourse instances behind bot protection: HTTP 403, or a TLS '
      + 'handshake that never completes. The same software as the twenty-two '
      + 'admitted above, with a different edge configuration.' },
];
