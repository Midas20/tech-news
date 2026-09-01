// The taxonomy roots.
//
// Lifted out of src/ui/fields.ts so that things which are not the web UI can
// name a field without dragging a database pool in behind it. src/settings.ts
// needs this list to offer a focus preference, and settings is loaded by the
// Worker, the collector and the scripts -- none of which should import a page
// renderer to find out that "security" is a field.
//
// A field is a ROOT of the stack tree, not a parallel taxonomy. Everything
// beneath the root counts toward it, which is what makes "Security" mean CVEs,
// cryptography and identity rather than only stories literally tagged
// "security". That also means every slug here must exist in `stacks`.

export interface Field {
  slug: string;
  label: string;
  icon: string;
}

/** In reading order rather than alphabetical. */
export const FIELDS: Field[] = [
  { slug: 'ai', label: 'AI & ML', icon: 'spark' },
  { slug: 'security', label: 'Security', icon: 'shield' },
  { slug: 'infra', label: 'Infrastructure', icon: 'layers' },
  { slug: 'cloud', label: 'Cloud', icon: 'globe' },
  { slug: 'data', label: 'Data', icon: 'table' },
  { slug: 'backend', label: 'Backend', icon: 'queue' },
  { slug: 'frontend', label: 'Frontend', icon: 'stream' },
  { slug: 'languages', label: 'Languages', icon: 'tag' },
  { slug: 'devops', label: 'DevOps', icon: 'pulse' },
  { slug: 'os', label: 'Operating systems', icon: 'table' },
  { slug: 'hardware', label: 'Hardware', icon: 'gem' },
  { slug: 'web-platform', label: 'Web platform', icon: 'globe' },
  { slug: 'mobile', label: 'Mobile', icon: 'feed' },
  { slug: 'practice', label: 'Practice', icon: 'scale' },
];

export const FIELD_SLUGS = FIELDS.map((f) => f.slug);

export function fieldLabel(slug: string): string {
  return FIELDS.find((f) => f.slug === slug)?.label ?? slug;
}
