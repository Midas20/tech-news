// Tools are not stacks.
//
// The registry grew as one list because everything in it is "a technology", and
// that is true in the way "an object" is true of a hammer and a house. What a
// reader actually asks is one of two questions:
//
//   what does this product RUN ON      -- React, Postgres, Kubernetes
//   what do I WORK WITH while building -- Claude, VS Code, Git, ESLint
//
// The line is whether it ships. A stack is a dependency: take it away and the
// product stops. A tool is operated by a person and never appears in the build
// output: take it away and the work gets slower, not broken.
//
// A third bucket is unavoidable, and pretending otherwise is what would make the
// split useless. "Sharding", "Agile", "Fintech" and "Programming Languages" are
// in the registry as tags and as tree scaffolding. They are not installed at
// all, and forcing them into either list would put "Capacity Planning" on a page
// of editors. They are concepts.

export type Kind = 'stack' | 'tool' | 'concept';

export const KINDS: { id: Kind; label: string; blurb: string }[] = [
  {
    id: 'stack',
    label: 'Stacks',
    blurb: 'What a product is built from. It ships, and the product stops without it.',
  },
  {
    id: 'tool',
    label: 'Tools',
    blurb: 'What a person works with. Never ships — remove it and the work is slower, not broken.',
  },
  {
    id: 'concept',
    label: 'Concepts',
    blurb: 'Practices, fields, and the groupings the tree hangs from. Nothing to install.',
  },
];

export const KIND_IDS: Kind[] = KINDS.map((k) => k.id);

/**
 * Categories that decide the answer on their own.
 *
 * Only the ones where the category IS the answer. `tooling` is deliberately
 * absent: the discovery loop files anything it cannot place under `tooling`, so
 * that column holds Prettier and "Nashville, Tennessee" with equal confidence
 * and is evidence of nothing.
 */
const BY_CATEGORY: Record<string, Kind> = {
  practice: 'concept',
  domain: 'concept',
  language: 'stack',
  framework: 'stack',
  library: 'stack',
  runtime: 'stack',
  db: 'stack',
  protocol: 'stack',
  hardware: 'stack',
  os: 'stack',
};

/**
 * Head nouns, read out of the definition sentence.
 *
 * The topic index writes real definitions -- "Babel is a compiler for writing
 * next generation JavaScript" -- and the noun after "is a" classifies better
 * than anything else available, because it is what somebody who knew the thing
 * chose to call it. Longest phrase wins, so "testing framework" is decided
 * before the bare "framework" sitting inside it.
 */
const NOUNS: [phrase: string, kind: Kind][] = [
  // Tools: operated by a person.
  ['text editor', 'tool'], ['code editor', 'tool'], ['source code editor', 'tool'],
  ['editor', 'tool'], ['ide', 'tool'], ['integrated development environment', 'tool'],
  ['compiler', 'tool'], ['transpiler', 'tool'], ['bundler', 'tool'], ['minifier', 'tool'],
  ['linter', 'tool'], ['linting utility', 'tool'], ['formatter', 'tool'], ['debugger', 'tool'],
  ['profiler', 'tool'], ['disassembler', 'tool'], ['decompiler', 'tool'],
  ['package manager', 'tool'], ['dependency manager', 'tool'], ['version manager', 'tool'],
  ['build tool', 'tool'], ['build system', 'tool'], ['build automation tool', 'tool'],
  ['task runner', 'tool'], ['test runner', 'tool'], ['testing framework', 'tool'],
  ['testing tool', 'tool'], ['testing library', 'tool'], ['test framework', 'tool'],
  ['version control system', 'tool'], ['continuous integration', 'tool'],
  ['automation server', 'tool'], ['ci/cd platform', 'tool'],
  ['web browser', 'tool'], ['browser', 'tool'],
  ['command-line tool', 'tool'], ['command line tool', 'tool'],
  ['command-line interface', 'tool'], ['cli', 'tool'], ['command-line utility', 'tool'],
  ['terminal emulator', 'tool'], ['shell', 'tool'],
  ['note taking app', 'tool'], ['note-taking app', 'tool'], ['notetaking app', 'tool'],
  ['design tool', 'tool'], ['diagramming tool', 'tool'], ['screenshot tool', 'tool'],
  ['api client', 'tool'], ['http client', 'tool'], ['rest client', 'tool'],
  ['scanner', 'tool'], ['vulnerability scanner', 'tool'], ['static analysis tool', 'tool'],
  ['reverse engineering framework', 'tool'], ['penetration testing', 'tool'],
  ['migration tool', 'tool'], ['deployment tool', 'tool'], ['provisioning tool', 'tool'],
  ['monitoring tool', 'tool'], ['issue tracker', 'tool'], ['bug tracker', 'tool'],
  ['project management tool', 'tool'], ['workspace', 'tool'], ['chat app', 'tool'],
  ['software suite', 'tool'], ['desktop app', 'tool'], ['desktop application', 'tool'],
  ['plugin', 'tool'], ['extension', 'tool'], ['add-on', 'tool'],
  ['generator', 'tool'], ['scaffolding tool', 'tool'], ['code generator', 'tool'],
  ['emulator', 'tool'], ['simulator', 'tool'], ['virtual machine manager', 'tool'],
  ['assistant', 'tool'], ['ai assistant', 'tool'], ['coding assistant', 'tool'],

  // Stacks: the product depends on them at run time.
  ['programming language', 'stack'], ['language', 'stack'], ['dialect', 'stack'],
  ['markup language', 'stack'], ['query language', 'stack'], ['scripting language', 'stack'],
  ['framework', 'stack'], ['web framework', 'stack'], ['library', 'stack'],
  ['runtime', 'stack'], ['engine', 'stack'], ['virtual machine', 'stack'],
  ['database', 'stack'], ['database management system', 'stack'], ['datastore', 'stack'],
  ['data store', 'stack'], ['message broker', 'stack'], ['message queue', 'stack'],
  ['operating system', 'stack'], ['kernel', 'stack'], ['distribution', 'stack'],
  ['protocol', 'stack'], ['specification', 'stack'], ['file format', 'stack'],
  ['data format', 'stack'], ['standard', 'stack'], ['api', 'stack'],
  ['toolkit', 'stack'], ['sdk', 'stack'], ['module', 'stack'], ['package', 'stack'],
  ['web server', 'stack'], ['proxy', 'stack'], ['load balancer', 'stack'],
  ['microcontroller', 'stack'], ['processor', 'stack'], ['chip', 'stack'],
  ['board', 'stack'], ['device', 'stack'],

  // Concepts: nothing to install. Most of these are the shape of a definition
  // rather than a noun -- an entry whose description opens "is the act of" or
  // "involves writing" is a glossary entry, whatever noun follows.
  ['act of', 'concept'], ['art of', 'concept'], ['practice of', 'concept'],
  ['process of', 'concept'], ['study of', 'concept'], ['percentage of', 'concept'],
  ['arrangement of', 'concept'], ['representation of', 'concept'],
  ['refers to', 'concept'], ['involves', 'concept'], ['encompass', 'concept'],
  ['can either mean', 'concept'], ['distinct meanings', 'concept'],
  ['subject', 'concept'], ['medium', 'concept'], ['location connected', 'concept'],
  ['methodology', 'concept'], ['method', 'concept'], ['practice', 'concept'],
  ['technique', 'concept'], ['approach', 'concept'], ['pattern', 'concept'],
  ['design pattern', 'concept'], ['paradigm', 'concept'], ['principle', 'concept'],
  ['concept', 'concept'], ['discipline', 'concept'], ['field', 'concept'],
  ['branch', 'concept'], ['area', 'concept'], ['process', 'concept'],
  ['community', 'concept'], ['movement', 'concept'], ['event', 'concept'],
  ['conference', 'concept'], ['hackathon', 'concept'], ['competition', 'concept'],
  ['city', 'concept'], ['country', 'concept'], ['company', 'concept'],
  ['organization', 'concept'], ['organisation', 'concept'], ['foundation', 'concept'],
  ['term', 'concept'], ['acronym', 'concept'], ['collection of', 'concept'],
  ['set of', 'concept'], ['group of', 'concept'], ['type of', 'concept'],
  ['form of', 'concept'], ['study of', 'concept'],
];

// Longest first, so a phrase is never pre-empted by a word inside it.
const NOUNS_SORTED = [...NOUNS].sort((a, b) => b[0].length - a[0].length);

/**
 * The names the rules get wrong, keyed by slug.
 *
 * Every one of these was read in a dry run and moved by hand. They sit here
 * rather than in the rules because each is a real exception -- Docker genuinely
 * is both a command you run and a runtime you ship on -- and widening a rule
 * until it swallows its exceptions is how a classifier stops meaning anything.
 */
export const OVERRIDES: Record<string, Kind> = {
  // Operated, never shipped.
  anthropic: 'tool', openai: 'tool', 'ai-coding-tools': 'tool', ollama: 'tool',
  'lm-studio': 'tool', comfyui: 'tool', cursor: 'tool', copilot: 'tool',
  git: 'tool', github: 'tool', gitlab: 'tool', 'github-actions': 'tool',
  jenkins: 'tool', circleci: 'tool', buildkite: 'tool', argocd: 'tool',
  'slack-platform': 'tool', 'woodpecker-ci': 'tool', 'flux-cd': 'tool',
  pulumi: 'tool', opentofu: 'tool',
  terraform: 'tool', packer: 'tool', ansible: 'tool', puppet: 'tool', chef: 'tool',
  vagrant: 'tool', helm: 'tool', kustomize: 'tool', dagger: 'tool',
  figma: 'tool', sketch: 'tool', notion: 'tool', obsidian: 'tool', slack: 'tool',
  discord: 'tool', atlassian: 'tool', jira: 'tool', confluence: 'tool', linear: 'tool',
  datadog: 'tool', 'new-relic': 'tool', honeycomb: 'tool', sentry: 'tool',
  grafana: 'tool', kibana: 'tool', 'elastic-apm': 'tool', metabase: 'tool',
  looker: 'tool', 'power-bi': 'tool', tableau: 'tool', 'apache-superset': 'tool',
  postman: 'tool', insomnia: 'tool', curl: 'tool', wireshark: 'tool', nmap: 'tool',
  'burp-suite': 'tool', metasploit: 'tool', ghidra: 'tool', semgrep: 'tool',
  codeql: 'tool', trivy: 'tool', snyk: 'tool', sonarqube: 'tool',
  eslint: 'tool', prettier: 'tool', biome: 'tool', ruff: 'tool', oxc: 'tool',
  babel: 'tool', postcss: 'tool', webpack: 'tool', vite: 'tool', rollup: 'tool',
  parcel: 'tool', esbuild: 'tool', turbopack: 'tool', rspack: 'tool', rolldown: 'tool',
  gradle: 'tool', maven: 'tool', bazel: 'tool', make: 'tool', nx: 'tool', turborepo: 'tool',
  npm: 'tool', yarn: 'tool', pnpm: 'tool', pip: 'tool', poetry: 'tool', uv: 'tool',
  cargo: 'tool', homebrew: 'tool', nix: 'tool', devbox: 'tool', alembic: 'tool',
  jest: 'tool', vitest: 'tool', mocha: 'tool', cypress: 'tool', playwright: 'tool',
  selenium: 'tool', pytest: 'tool', storybook: 'tool',
  browsers: 'tool', chrome: 'tool', firefox: 'tool', safari: 'tool', edge: 'tool',
  chromium: 'tool', 'brave-browser': 'tool', vscode: 'tool', 'visual-studio-code': 'tool',
  vim: 'tool', neovim: 'tool', emacs: 'tool', 'sublime-text': 'tool', jetbrains: 'tool',
  intellij: 'tool', xcode: 'tool', 'android-studio': 'tool', zed: 'tool',
  'adobe-acrobat': 'tool', 'google-workspace': 'tool',

  // Shipped, despite being best known as a command you type.
  docker: 'stack', podman: 'stack', kubernetes: 'stack', containerd: 'stack',
  deno: 'stack', bun: 'stack', 'node-js': 'stack', nodejs: 'stack',
  // Filed under `tooling` by the import, but each of these ends up inside the
  // thing you ship: a typesetting language, a document format, two inference
  // servers, a workload spec.
  typst: 'stack', mdx: 'stack', vllm: 'stack', 'llama-cpp': 'stack',
  score: 'stack', sigstore: 'stack',

  // Umbrella tags, not things.
  editors: 'concept', 'developer-tooling': 'concept', libraries: 'concept',
  tooling: 'concept', terminal: 'concept', analytics: 'concept', utility: 'concept',
  cms: 'concept', api: 'concept', 'feature-flags': 'concept',
  'dependency-scanning': 'concept', 'product-analytics': 'concept',
  'edr-xdr': 'concept', 'smoke-tests': 'concept', 'zero-day': 'concept',
  malware: 'concept', ddos: 'concept', agile: 'concept', ajax: 'concept',
  dotfiles: 'concept', demoscene: 'concept', 'advent-of-code': 'concept',
  // Generic topic tags that a category alone would misfile. `compiler` is
  // filed as a language and `llm` as an AI product; both are subjects.
  compiler: 'concept', llm: 'concept', 'rest-api': 'concept',
  authentication: 'concept', 'code-quality': 'concept', 'self-hosted': 'concept',
  'application-security': 'concept', 'software-as-a-service': 'concept',
  'cves-vulnerabilities': 'concept', 'test-coverage': 'concept',
  'utility-software': 'concept', 'hackathon-kit': 'concept',
  deployment: 'concept',
  // The topic index has an article about electrical generators under this slug.
  generator: 'concept',
  // Generic tags whose names read like a product.
  extension: 'concept', cli: 'concept', waf: 'concept',
  // Plural tree roots. Every one is a heading with 20-50 entries beneath it,
  // and a heading is not something you install.
  frameworks: 'concept', databases: 'concept', runtimes: 'concept',
  protocols: 'concept',
  'semantic-web': 'concept', devsecops: 'concept',
  // Syntax, components and servers that a keyword read as tools.
  jsx: 'stack', webview: 'stack', tensorrt: 'stack', scikit: 'stack',
  gunicorn: 'stack', openclaw: 'stack',
};

/** Everything a rule may look at. Nothing else is consulted. */
export interface Classifiable {
  slug: string;
  name: string;
  category: string;
  description?: string | null;
  /** Whether a person placed this entry, rather than the discovery loop. */
  curated?: boolean;
}

export interface Verdict {
  kind: Kind;
  /** Which layer decided, so a dry run can be read and argued with. */
  why: 'override' | 'category' | 'definition' | 'name' | 'default';
  detail: string;
}

/**
 * The definition sentence, reduced to the noun its author reached for.
 *
 * Only the run-up to the first "is a"/"are" is skipped, and a match later in the
 * sentence is ignored on purpose: "Prettier is an opinionated code formatter
 * that supports many languages" must not be decided by "languages".
 */
function fromDefinition(description: string): [Kind, string] | null {
  const text = description.toLowerCase().replace(/["'“”]/g, '').replace(/\s+/g, ' ');
  const m = /\b(?:is|are|was)\s+(?:an?\s+|the\s+)?(.{0,60})/.exec(text);
  const head = m ? m[1]! : text.slice(0, 60);
  for (const [phrase, kind] of NOUNS_SORTED) {
    const safe = phrase.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    if (new RegExp(`\\b${safe}\\b`).test(head)) return [kind, phrase];
  }
  return null;
}

/** Names that say what they are. A last resort before the default. */
function fromName(name: string): [Kind, string] | null {
  const n = name.toLowerCase();

  // Wikipedia-style disambiguation pages arrived with the topic import. They
  // are an article about a word, and there is nothing to install.
  if (/\(disambiguation\)/.test(n)) return ['concept', 'a disambiguation page'];

  if (/\b(cli|command line|command-line)\b/.test(n)) return ['tool', 'name says CLI'];
  if (/\bextensions?\b/.test(n)) return ['tool', 'name says extension'];
  if (/\b(engineering|management|planning|analysis|testing|development)\b/.test(n)
    && !/\b(tool|kit|suite|studio|server)\b/.test(n)) {
    return ['concept', 'name is an activity'];
  }

  // A one-word gerund is an activity, not a product: Learning, Logging,
  // Programming, Marketing. Seven characters and up, because the short ones are
  // where the real names live -- Spring is a framework and Bling is a library.
  if (/^[a-z]{4,}ing$/.test(n)) return ['concept', 'name is a gerund'];

  return null;
}

/**
 * One entry, one answer.
 *
 * Layers run most-specific first and the first to fire wins, so an override is
 * never argued with by a keyword, and a category never overrules a definition
 * written by somebody who knew the thing.
 */
export function classify(row: Classifiable): Verdict {
  const override = OVERRIDES[row.slug];
  if (override) return { kind: override, why: 'override', detail: 'set by hand' };

  // Ahead of the category, because a disambiguation page inherits the category
  // of whatever it disambiguates: "Query (disambiguation)" is filed as a
  // language and would otherwise be listed as something you can build on.
  if (/\(disambiguation\)/i.test(row.name)) {
    return { kind: 'concept', why: 'name', detail: 'a disambiguation page' };
  }

  const byCategory = BY_CATEGORY[row.category];
  if (byCategory) return { kind: byCategory, why: 'category', detail: row.category };

  if (row.description) {
    const hit = fromDefinition(row.description);
    if (hit) return { kind: hit[0], why: 'definition', detail: `"${hit[1]}"` };
  }

  const byName = fromName(row.name);
  if (byName) return { kind: byName[0], why: 'name', detail: byName[1] };

  // `tooling` is where two different things end up. A person filing something
  // under it meant "this is a tool". Discovery files everything it cannot place
  // under it too, which is why the column also holds Font, Promise, NASA and
  // Reddit -- of the entries that reached this line with any news coverage at
  // all, the uncurated ones were wrong about three times in four.
  //
  // So curation is the signal, not the category. A hand-filed tool is a tool;
  // an auto-filed one with no definition and no name to go on is topic-index
  // residue, and residue is a concept.
  if (row.category === 'tooling' || row.category === 'devops') {
    return row.curated
      ? { kind: 'tool', why: 'default', detail: 'filed under tooling by hand' }
      : { kind: 'concept', why: 'default', detail: 'unplaced topic import' };
  }
  return { kind: 'stack', why: 'default', detail: 'no signal' };
}
