// The vocabulary's own categories: what KIND of thing a technology is.
//
// Lives in vocab/ and imports nothing, because both the registry pages and the
// query-string parser need it. Reaching it through the page module created a
// cycle -- filters -> stacks -> nav -> filters -- which does not fail at build
// time. It fails at import time, with STREAMS undefined and a stack trace
// pointing at a `.map` three modules away from the actual mistake.

export interface Category {
  id: string;
  label: string;
  blurb: string;
  /** Identity colour. Category is information here, so it earns colour. */
  color: string;
}

export const CATEGORIES: Category[] = [
  { id: 'language', label: 'Languages', color: '#6e8bff', blurb: 'Programming languages and their toolchains.' },
  { id: 'framework', label: 'Frameworks', color: '#4ec3d9', blurb: 'Opinionated application scaffolding.' },
  { id: 'library', label: 'Libraries', color: '#54b689', blurb: 'Focused packages a project depends on.' },
  { id: 'runtime', label: 'Runtimes', color: '#7f9ff5', blurb: 'Where the code actually executes.' },
  { id: 'db', label: 'Databases', color: '#d99a4e', blurb: 'Stores, engines and query layers.' },
  { id: 'data', label: 'Data', color: '#c98f5a', blurb: 'Pipelines, warehouses, formats and processing.' },
  { id: 'ai', label: 'AI & ML', color: '#b07fe8', blurb: 'Models, training, inference and the tooling around them.' },
  { id: 'infra', label: 'Infrastructure', color: '#5aa9d6', blurb: 'The substrate: orchestration, networking, storage.' },
  { id: 'cloud', label: 'Cloud', color: '#4d9be6', blurb: 'Managed platforms and their services.' },
  { id: 'devops', label: 'DevOps', color: '#63b8a5', blurb: 'Build, deploy, observe, page someone.' },
  { id: 'security', label: 'Security', color: '#e0715f', blurb: 'Defence, cryptography, identity and disclosure.' },
  { id: 'os', label: 'Operating systems', color: '#8f97a8', blurb: 'Kernels, distributions and desktops.' },
  { id: 'web', label: 'Web platform', color: '#5fbfa0', blurb: 'Browsers, standards and what ships in them.' },
  { id: 'mobile', label: 'Mobile', color: '#c78ad0', blurb: 'Phone and tablet platforms and their SDKs.' },
  { id: 'hardware', label: 'Hardware', color: '#d4a054', blurb: 'Silicon, accelerators and the boards they sit on.' },
  { id: 'protocol', label: 'Protocols', color: '#8ba3c7', blurb: 'Wire formats and specifications.' },
  { id: 'tooling', label: 'Tooling', color: '#9aa4b2', blurb: 'Editors, build tools and everything on the side.' },
  { id: 'practice', label: 'Practice', color: '#a3937c', blurb: 'How teams work, rather than what they run.' },
  { id: 'domain', label: 'Domains', color: '#7d8c9e', blurb: 'Fields of application: fintech, gaming, science.' },
];