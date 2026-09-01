import { describe, it, expect } from 'vitest';
import { githubRepo, summariseAdoption, SLICE, SEARCH_PER_MINUTE } from '../src/collect/adoption.ts';

describe('githubRepo', () => {
  it('pulls owner/repo out of a GitHub URL', () => {
    expect(githubRepo('https://github.com/rust-lang/rust')).toBe('rust-lang/rust');
  });

  it('drops a trailing .git', () => {
    expect(githubRepo('https://github.com/ggerganov/llama.cpp.git')).toBe('ggerganov/llama.cpp');
  });

  it('keeps a dot that is part of the name', () => {
    // llama.cpp is not llama, and stripping to the last dot would say it was.
    expect(githubRepo('https://github.com/ggerganov/llama.cpp')).toBe('ggerganov/llama.cpp');
  });

  it('ignores deep links to a file or subpage', () => {
    expect(githubRepo('https://github.com/vercel/next.js/tree/canary/docs')).toBe('vercel/next.js');
  });

  it('returns null for a repository that is not on GitHub', () => {
    expect(githubRepo('https://gitlab.com/group/project')).toBeNull();
    expect(githubRepo('https://git.kernel.org/pub/scm/linux/kernel.git')).toBeNull();
  });

  it('returns null for a GitHub URL that names no repository', () => {
    expect(githubRepo('https://github.com/rust-lang')).toBeNull();
    expect(githubRepo('https://github.com/')).toBeNull();
  });

  it('returns null rather than throwing on rubbish', () => {
    expect(githubRepo(null)).toBeNull();
    expect(githubRepo('not a url')).toBeNull();
  });
});

describe('the slice fits the quota', () => {
  it('never asks for more searches than GitHub allows in a minute', () => {
    // The search quota is 30/min and counted separately from the 5,000/hr core
    // quota. A slice larger than that guarantees 403s halfway through a pass.
    expect(SLICE).toBeLessThanOrEqual(SEARCH_PER_MINUTE);
  });
});

describe('summariseAdoption', () => {
  it('says what happened', () => {
    expect(summariseAdoption({ measured: 20, absent: 3, failed: 0, requests: 27 }))
      .toBe('20 measured, 3 with no topic, 27 request(s)');
  });

  it('reports a skip on its own when nothing was measured', () => {
    expect(summariseAdoption({
      measured: 0, absent: 0, failed: 0, requests: 0,
      skipped: 'GITHUB_TOKEN is not set, so no adoption figure was refreshed.',
    })).toBe('GITHUB_TOKEN is not set, so no adoption figure was refreshed.');
  });

  it('keeps the skip note when a pass was cut short partway', () => {
    // Quota exhaustion after real work is a different event from never starting,
    // and the note has to show both halves or the job log implies a clean run.
    const line = summariseAdoption({
      measured: 8, absent: 0, failed: 0, requests: 11,
      skipped: 'GitHub search quota exhausted after 11 request(s).',
    });
    expect(line).toContain('8 measured');
    expect(line).toContain('quota exhausted');
  });

  it('is empty when there was nothing due', () => {
    expect(summariseAdoption({ measured: 0, absent: 0, failed: 0, requests: 0 })).toBe('');
  });
});
