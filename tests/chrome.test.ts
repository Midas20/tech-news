// The navigation has to exist at every width, and the breakpoints have to stay
// a scale.
//
// Both of these were broken in a way no unit test could have caught, because
// both are properties of the STYLESHEET rather than of any function: the rail
// was hidden below 920px and the section tabs below 760px, nothing replaced
// either, and so every screen narrower than a small tablet rendered a product
// with a wordmark, a search box and no way to reach anything. It typechecked,
// every test passed, and the pages themselves were all correct.
//
// So these assert against the CSS text itself. That is a blunt instrument and
// it is the right one here: what went wrong was not a value, it was the absence
// of a rule.

import { describe, it, expect } from 'vitest';
import { CSS } from '../src/ui/theme.ts';
import { page } from '../src/ui/html.ts';

const shell = page({
  title: 'T', body: '<p>body</p>', rail: '<a href="/news">News</a>',
  nav: '<nav class="nav"><a href="/news">News</a></nav>',
});

/** Every @media(max-width:<w>px) block in the stylesheet, brace-matched. */
function mediaBlocks(width: number): string[] {
  const open = `@media(max-width:${width}px){`;
  const out: string[] = [];
  for (let i = CSS.indexOf(open); i !== -1; i = CSS.indexOf(open, i + 1)) {
    let depth = 0;
    for (let j = i + open.length - 1; j < CSS.length; j++) {
      if (CSS[j] === '{') depth++;
      else if (CSS[j] === '}' && --depth === 0) { out.push(CSS.slice(i, j + 1)); break; }
    }
  }
  return out;
}

describe('the page is navigable at every width', () => {
  it('ships a control that reveals the rail', () => {
    // The rail is display:none below 900px. Something has to turn it back on.
    expect(CSS).toContain('.navtoggle:checked ~ .shell .rail{display:block}');
  });

  it('ships a control that reveals the section tabs', () => {
    // Below 720px the tabs leave the bar; they reappear inside the same sheet.
    expect(CSS).toMatch(/\.navtoggle:checked ~ \.top \.nav\{/);
  });

  it('shows the menu button on exactly the widths that hide the rail', () => {
    // The button is off by default and turned on inside the 900px query -- the
    // same query that hides the rail. If those two ever come apart, one of them
    // is a screen with no menu and no button on it.
    expect(CSS).toMatch(/\.navbtn\{\s*display:none;/);
    const block = mediaBlocks(900).find((b) => b.includes('.navbtn'));
    expect(block, 'no 900px block turns the menu button on').toBeDefined();
    expect(block).toContain('.navbtn{display:inline-flex}');
    // ...and it is the same block that took the rail away.
    expect(block).toContain('.rail{');
    expect(block).toContain('display:none;');
  });

  it('puts the toggle before both the bar and the shell', () => {
    // ':checked ~' only reaches LATER siblings. If the input is ever moved
    // inside the header, every rule above silently stops matching.
    const input = shell.indexOf('id="navtoggle"');
    expect(input).toBeGreaterThan(-1);
    expect(input).toBeLessThan(shell.indexOf('<header class="top"'));
    expect(input).toBeLessThan(shell.indexOf('<div class="shell">'));
  });

  it('gives the toggle a label that is a real control', () => {
    expect(shell).toContain('<label for="navtoggle"');
    expect(shell).toMatch(/id="navtoggle"[^>]*aria-label=/s);
  });

  it('keeps the tab labels as the accessible name when they are hidden', () => {
    // The icon-only tabs clip their label rather than removing it. With
    // display:none the accessible name fell back to the title attribute, and a
    // tooltip is not a label.
    const at1120 = CSS.slice(CSS.indexOf('@media(max-width:1120px){'));
    const block = at1120.slice(0, at1120.indexOf('\n}'));
    expect(block).toContain('clip-path:inset(50%)');
    expect(block).not.toMatch(/\.nav a span\{display:none\}/);
  });
});

describe('breakpoints are a scale', () => {
  // Four tiers, documented in theme.ts. 2100 is a ceiling for ultrawide
  // displays rather than a tier, so it is allowed and named separately.
  const TIERS = [560, 720, 900, 1120];

  it('uses no width outside the scale', () => {
    const widths = [...CSS.matchAll(/@media\s*\(\s*max-width:\s*(\d+)px/g)]
      .map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(0);
    const stray = [...new Set(widths)].filter((w) => !TIERS.includes(w));
    // There were thirteen distinct widths before this. Naming the strays makes
    // the failure tell you which rule to move rather than that a number is off.
    expect(stray).toEqual([]);
  });

  it('grows at exactly one width', () => {
    const mins = [...CSS.matchAll(/@media\s*\(\s*min-width:\s*(\d+)px/g)]
      .map((m) => Number(m[1]));
    expect(mins).toEqual([2100]);
  });
});

describe('one control is drawn once', () => {
  it('has a single checkbox implementation', () => {
    // A real <input> in the facet panel and a drawn <span> in the rail, which
    // has to be a span because a rail row is a link. Same control, so one rule.
    expect(CSS).toContain('.fopt input,.group.checks .box{');
    // The tick was duplicated with different geometry, and the copy carried the
    // only hardcoded colour in the file.
    expect(CSS).not.toMatch(/border:solid #fff/);
  });

  it('gives the two field grids two names', () => {
    // Both were '.fieldgrid'. The later rule won, so the sign-up picker was
    // laid out on the field-card grid.
    const rules = [...CSS.matchAll(/^\.fieldgrid\{/gm)];
    expect(rules).toHaveLength(1);
    expect(CSS).toMatch(/^\.pickgrid\{/m);
  });
});
