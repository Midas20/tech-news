// The design system.
//
// What separates a product from an exercise is not decoration, it is
// consistency: a fixed type scale, a fixed spacing scale, one accent with one
// job, and a small set of components that every page is assembled from. Nothing
// here is per-page CSS.
//
// The identity is editorial-terminal: a news product that engineers keep open
// all day. Newsreader (a face designed for news) carries the wordmark and page
// titles; Inter carries the interface; JetBrains Mono carries anything that is
// data rather than prose. Dark is the primary mode -- this is a tool people sit
// in front of for hours -- and light is a considered second, not an inversion.

export const FONTS_HREF =
  'https://fonts.googleapis.com/css2' +
  '?family=Inter:wght@400;500;600;700' +
  '&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400' +
  '&family=JetBrains+Mono:wght@400;500' +
  '&display=swap';

/** Wordmark glyph: a rising bar chart, which is what the product actually does. */
export const LOGO_SVG = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" class="logo">
  <rect x="2"  y="14" width="4" height="8"  rx="1.2"/>
  <rect x="8"  y="9"  width="4" height="13" rx="1.2"/>
  <rect x="14" y="4"  width="4" height="18" rx="1.2"/>
  <circle cx="20.4" cy="4.6" r="2.4" class="pulse"/>
</svg>`;

export const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<rect width="24" height="24" rx="5" fill="#0b0b0e"/>` +
    `<rect x="3" y="14" width="4" height="7" rx="1.2" fill="#8b93a7"/>` +
    `<rect x="9" y="9" width="4" height="12" rx="1.2" fill="#c3c9d6"/>` +
    `<rect x="15" y="4" width="4" height="17" rx="1.2" fill="#e8ebf2"/>` +
    `</svg>`,
  );

/**
 * Icons, 16px, single stroke, no fills. Inline so there is no icon font, no
 * sprite request, and no flash of missing glyphs.
 */
const ICON_PATHS: Record<string, string> = {
  stream: 'M3 5h18M3 12h12M3 19h7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3',
  undo: 'M3 8h11a5 5 0 0 1 0 10H8M3 8l4-4M3 8l4 4',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  gem: 'M6 3h12l3 6-9 12L3 9l3-6ZM3 9h18M9 3 6.5 9 12 21M15 3l2.5 6L12 21',
  trending: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  scale: 'M12 3v18M5 8l7-3 7 3M5 8l-2 6a4 4 0 0 0 8 0L5 8Zm14 0-2 6a4 4 0 0 0 8 0l-6-6Z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c-3 3-3 15 0 18m0-18c3 3 3 15 0 18M3.6 9h16.8M3.6 15h16.8',
  layers: 'M12 3 2 8l10 5 10-5-10-5ZM2 16l10 5 10-5M2 12l10 5 10-5',
  feed: 'M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 19h.01',
  tag: 'M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01',
  pulse: 'M3 12h4l3 8 4-16 3 8h4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  table: 'M3 9h18M3 15h18M9 3v18M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z',
  queue: 'M4 6h16M4 12h16M4 18h10',
  search: 'M21 21l-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  spark: 'M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  check: 'M20 6 9 17l-5-5',
  // An empty ring: unread. The read state is the tick above, and the pair
  // has to read as one control in two states rather than two controls.
  circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m11.4 0 1.4 1.4M4.9 4.9l1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  building: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M14 9h4a2 2 0 0 1 2 2v10M8 7h2M8 11h2M8 15h2M18 13h.01M18 17h.01M2 21h20',
  // Tools got their own registry, so they get their own mark rather than
  // borrowing the sliders icon the filter panel already uses.
  wrench: 'M14.7 6.3a4 4 0 0 0 5 5l-9.5 9.5a2.1 2.1 0 0 1-3-3l9.5-9.5a4 4 0 0 0-5-5l3 3-2 2-3-3a4 4 0 0 1 5-1Z',
  // The reading page is the one place you arrive at from somewhere else and
  // expect a way back that is not the browser chrome.
  'arrow-left': 'M19 12H5m0 0 7-7m-7 7 7 7',
  copy: 'M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z',
  // Favourites. Outline when it is not kept, filled by CSS when it is -- the
  // same glyph in two states rather than two glyphs, so the button never moves.
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z',
  'star-off': 'M3 3l18 18M12 3.5l2.6 5.3 5.9.9-4.3 4.1M9.6 9.6l-3.4.5 4.3 4.1-1 5.8 5.2-2.7 2.4 1.3',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
};

export function icon(name: keyof typeof ICON_PATHS | string, size = 15): string {
  const d = ICON_PATHS[name];
  if (!d) return '';
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><path d="${d}"/></svg>`;
}

const LIGHT_VARS = `
  color-scheme: light;
  --bg:#fcfcfd; --bg-sunken:#f5f6f8; --surface:#ffffff; --surface-2:#f4f5f7;
  --raised:#ffffff; --line:#e5e7ea; --line-strong:#d2d6dc;
  --ink:#111318; --ink-2:#3c434f; --ink-3:#697280; --ink-4:#98a0ad;
  --brand:#2f5fe0; --brand-ink:#ffffff; --brand-soft:rgba(47,95,224,.10);
  --link:#2557c7; --critical:#c62a34; --ok:#177a3f; --warn:#9a6a10;
  --series-1:#2f5fe0;
  --shadow:0 1px 2px rgba(16,18,24,.05), 0 8px 24px -14px rgba(16,18,24,.16);
  --glow:none;
`;

export const CSS = `
/* ---------- tokens ---------- */
:root {
  color-scheme: dark;

  /* Neutral ramp, very slightly cool. A professional instrument is mostly
     greyscale: colour is information, not decoration, so 95% of the surface
     carries none and the eye goes where colour appears. */
  --n-0:#0a0b0d; --n-1:#0e0f12; --n-2:#141619; --n-3:#191c20;
  --n-4:#1f2329; --n-5:#2a2f36; --n-6:#3c424b; --n-7:#5e6672;
  --n-8:#8a929e; --n-9:#c2c8d0; --n-10:#e9ecf0;

  --bg:var(--n-1);
  --bg-sunken:var(--n-0);
  --surface:var(--n-2);
  --surface-2:var(--n-3);
  --raised:var(--n-4);
  --line:#212429;
  --line-strong:#2e333a;

  --ink:var(--n-10);
  --ink-2:var(--n-9);
  --ink-3:var(--n-8);
  --ink-4:var(--n-7);

  /* ONE accent, one job: it marks the thing you selected or are focused on.
     Everything else is ink. */
  --brand:#4d7cfe;
  --brand-ink:#ffffff;
  --brand-soft:rgba(77,124,254,.14);
  --link:#7aa2f7;
  --critical:#e5484d;       /* reserved for critical, nothing else */
  --ok:#46a758;
  --warn:#d9922a;
  --series-1:#4d7cfe;       /* charts: the same accent, one hue, one job */

  /* Type scale.
     The names are the ORIGINAL pixel sizes and stay that way: they are how the
     steps relate to each other, and renaming them every time the scale moves
     would make the CSS unreadable and the git history worse. One multiplier
     moves the whole system, which is also the only way to move it without the
     proportions drifting -- bumping sizes individually is how a scale stops
     being a scale. */
  --t-scale:1.12;
  --t-11:calc(11px * var(--t-scale)); --t-12:calc(12px * var(--t-scale));
  --t-13:calc(13px * var(--t-scale)); --t-14:calc(14px * var(--t-scale));
  --t-15:calc(15px * var(--t-scale)); --t-17:calc(17px * var(--t-scale));
  --t-19:calc(19px * var(--t-scale)); --t-21:calc(21px * var(--t-scale));
  --t-27:calc(27px * var(--t-scale));
  /* The few things below the scale's floor: chips, unit suffixes, the mono
     labels on a count. Kept as their own step so they move with everything
     else instead of being left behind at 9px. */
  --t-10:calc(10.5px * var(--t-scale));
  --t-9:calc(9.5px * var(--t-scale));

  /* spacing scale */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:24px; --s-6:32px; --s-7:48px;

  --r-1:4px; --r-2:7px; --r-3:11px; --r-full:999px;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -12px rgba(0,0,0,.7);

  --sans:'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  --serif:'Newsreader',Georgia,'Times New Roman',serif;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;

  --rail-w:244px;
  --top-h:52px;
}

/* ---------- breakpoints ----------
   FOUR TIERS, AND NOTHING BETWEEN THEM.

     1120   the section tabs drop their labels and become icons
      900   the rail stops being a column and becomes a sheet
      720   the tabs join the sheet; one column everywhere
      560   the smallest phones: lists give up their side-by-side rows

   There were thirteen: 560, 640, 700, 720, 760, 820, 860, 900, 920, 1120, 1180
   and 2100. Nobody chose thirteen -- each was the width at which one component
   looked wrong when somebody happened to drag a window, so the page re-flowed
   in a staircase and things that belong together came apart at different
   widths. 900 and 920 hid the rail and re-flowed the brand that lines up with
   it; 640, 700 and 720 were three names for "a phone".

   A media query is not per-component CSS, and these are not free: each one is a
   width at which the whole page has to be checked. Snap to a tier, or argue for
   a fifth one. Do not add a fourteenth silently.

   (min-width:2100px is not a tier. It is a ceiling for ultrawide displays, and
   the only rule in this file that grows rather than collapses.) */

/* Light is a considered second mode rather than an inversion, so the palette is
   written once and applied three ways: to whoever asks the operating system, and
   to whoever chose a side explicitly in /settings. An explicit choice must beat
   the media query in BOTH directions, which is what the :not() guard buys. */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) { ${LIGHT_VARS} }
}
:root[data-theme="light"] { ${LIGHT_VARS} }

/* ---------- base ---------- */
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--bg);color:var(--ink);
  font:400 var(--t-14)/1.5 var(--sans);
  font-feature-settings:'cv05' 1,'ss03' 1;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
a{color:inherit;text-decoration:none}
a:hover{text-decoration:none}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:var(--r-1)}
::selection{background:color-mix(in srgb,var(--brand) 28%,transparent)}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.muted{color:var(--ink-3)}

/* The one concession to utilities, and the reason it exists.
   A handful of one-off gaps between blocks were written as inline style=
   attributes in raw pixels -- 10px, 12px, 14px, 18px, 22px, 1rem -- which is a
   per-page spacing scale of six values living beside the real one of seven.
   These four names cover every case that was there. Anything that needs a fifth
   probably needs a class of its own instead. */
.mt-2{margin-top:var(--s-2)}
.mt-3{margin-top:var(--s-3)}
.mt-4{margin-top:var(--s-4)}
.mt-5{margin-top:var(--s-5)}
/* Two utilities the scheduler table needed and nothing else had: one step down
   in size, and the colour that means "this is the thing that is wrong". Next to
   .muted because they are the same kind of thing -- emphasis, never meaning. */
.small{font-size:var(--t-11)}
.bad{color:var(--critical)}
.dim{color:var(--ink-2)}
.num{font-variant-numeric:tabular-nums}
.ico{flex:none;opacity:.85}

/* ---------- chrome ---------- */
.top{
  position:sticky;top:0;z-index:40;height:var(--top-h);
  display:flex;align-items:center;gap:var(--s-3);padding:0 var(--s-4);
  background:color-mix(in srgb,var(--bg) 86%,transparent);
  backdrop-filter:saturate(1.4) blur(12px);
  border-bottom:1px solid var(--line);
}

/* Primary navigation: sections, not filters. Five destinations, always in the
   same place, so the rail underneath is free to be about ONE of them. */
.nav{display:flex;align-items:center;gap:2px;padding:2px;flex:none;
  background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-2)}
.nav a{
  display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 11px;
  border-radius:var(--r-1);font-size:var(--t-12);font-weight:500;color:var(--ink-3);
  white-space:nowrap;transition:color .12s,background .12s;
}
.nav a:hover{color:var(--ink)}
.nav a.on{background:var(--raised);color:var(--ink);box-shadow:var(--shadow)}
.nav a.on .ico{color:var(--brand);opacity:1}
/* Narrow: the tabs go to icons only. The label is CLIPPED rather than
   display:none, so it is still the anchor's accessible name -- with the span
   removed from the box tree the name fell back to the title attribute, and a
   tooltip is not a label. */
@media(max-width:1120px){
  .nav a span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  .nav a{padding:0 9px}
}

/* ---------- the menu, on a screen too narrow for the rail ----------
   Below 900px the rail is a sheet you open, and below 720px the tabs join it.
   Before this they were simply hidden and nothing replaced them, so a phone had
   no navigation at all -- see the note on the toggle in html.ts.

   Everything here hangs off :checked on an input that sits before both .top and
   .shell, which is what lets one control reach two elements that are in
   different parts of the document without either of them moving. */
.navtoggle{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.navbtn{
  display:none;align-items:center;justify-content:center;flex:none;
  width:32px;height:32px;border-radius:var(--r-2);
  color:var(--ink-3);background:var(--surface);border:1px solid var(--line);
  cursor:pointer;transition:color .12s,background .12s,border-color .12s;
}
.navbtn:hover{color:var(--ink);background:var(--surface-2);border-color:var(--line-strong)}
.navtoggle:focus-visible + .top .navbtn{outline:2px solid var(--brand);outline-offset:2px}
.navtoggle:checked ~ .top .navbtn{
  color:var(--ink);background:var(--raised);border-color:var(--line-strong)}
/* The brand holds the rail's column open, so the nav starts exactly where the
   content column starts: the nav's left border and the rail's right border are
   the same vertical line, and the top bar stops being a separate grid from the
   page under it. Width = rail, less this bar's own left padding and the flex
   gap that follows the brand. */
.brand{display:flex;align-items:center;gap:9px;white-space:nowrap;
  flex:none;width:calc(var(--rail-w) - var(--s-4) - var(--s-3))}
/* No rail below means nothing to line up with; the brand takes what it needs. */
@media(max-width:900px){.brand{width:auto;padding-right:var(--s-2)}}
.brand .logo rect{fill:var(--ink-3)}
.brand .logo rect:last-of-type{fill:var(--ink)}
.brand .logo .pulse{fill:var(--brand)}
.brand b{
  font:600 var(--t-17)/1 var(--serif);letter-spacing:-.01em;color:var(--ink);
}
.brand span{font-size:var(--t-11);color:var(--ink-4);letter-spacing:.12em;text-transform:uppercase}
/* Search lives on the right, grouped with the other things that act on the
   whole app rather than on this page. It no longer takes flex:1 -- as the
   middle element it was the only thing that grew, so on a wide screen the
   nav sat far left and the search stretched across the gap between them. */
.searchbox{width:clamp(200px, 26vw, 420px);min-width:0;position:relative;display:flex;align-items:center}
.searchbox input{min-width:0}
.searchbox .ico{position:absolute;left:10px;color:var(--ink-4)}
.searchbox input{
  width:100%;height:32px;padding:0 var(--s-3) 0 32px;font:inherit;font-size:var(--t-13);
  color:var(--ink);background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-2);transition:border-color .12s,background .12s;
}
.searchbox input::placeholder{color:var(--ink-4)}
.searchbox input:focus{outline:none;border-color:var(--line-strong);background:var(--surface-2)}
.searchbox kbd{
  position:absolute;right:8px;font:500 var(--t-10)/1 var(--mono);color:var(--ink-4);
  border:1px solid var(--line-strong);border-radius:var(--r-1);padding:3px 5px;
}
.topright{margin-left:auto;display:flex;align-items:center;gap:var(--s-3);
  font-size:var(--t-12);color:var(--ink-3)}
/* Narrow: the search field shrinks before anything else disappears, because it
   is the one control on this bar that cannot be reached another way. */
@media(max-width:900px){.searchbox{width:clamp(150px, 34vw, 260px)}}
/* Figures inside a read article. */
.rd-fig{margin:var(--s-3) 0;text-align:center}
.rd-fig img{max-width:100%;height:auto;border-radius:var(--r-2);border:1px solid var(--line)}
.rd-fig figcaption{margin-top:6px;font-size:var(--t-12);color:var(--ink-4);text-align:left}
/* Documentation shelves on the technology page. */
.docs{margin:var(--s-4) 0}
.docs h2{margin-bottom:var(--s-2)}
.docshelf{margin-bottom:var(--s-3)}
.docshelf h3{font-size:var(--t-13);margin:0 0 6px;color:var(--ink-2)}
.docshelf h3 .muted{font-weight:400;font-size:var(--t-11);margin-left:6px}
.doclist{list-style:none;margin:0;padding:0;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px}
.doclist li{display:flex;align-items:center;gap:6px;padding:7px 10px;
  border:1px solid var(--line);border-radius:var(--r-2);font-size:var(--t-13);min-width:0}
.doclist li:hover{border-color:var(--line-strong)}
.doclist a{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Sign in / sign up, and the account page's field picker. */
.signin{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.signin-card{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-3);padding:26px 24px}
.signin-brand{display:flex;align-items:center;gap:8px;margin-bottom:18px;
  color:var(--ink-3);font-size:var(--t-13);font-weight:600}
.signin-brand svg{width:20px;height:20px}
.signin-card h1{font-size:19px;margin:0 0 14px}
.signin-card label{display:block;font-size:var(--t-12);color:var(--ink-3);margin:12px 0 5px}
.signin-card .txt{width:100%;box-sizing:border-box}
.signin-card .btn{width:100%;margin-top:16px;justify-content:center}
.signin-error{background:var(--surface-2);border:1px solid var(--critical);color:var(--ink);
  border-radius:8px;padding:9px 11px;font-size:var(--t-13);margin-bottom:4px}
.signin-note{background:var(--surface-2);border:1px solid var(--ok);border-radius:8px;
  padding:9px 11px;font-size:var(--t-13);margin-bottom:10px}
.signin-hint{font-size:var(--t-11);color:var(--ink-4);margin-top:5px}
.signin-alt{margin:16px 0 0;font-size:var(--t-12);color:var(--ink-4);text-align:center}
/* THE FIELD PICKER, which is not the field CARD grid.
   Both were called .fieldgrid, 650 lines apart, and the later one -- 232px
   tracks with a bottom margin, built for /fields and /reports -- won. So the
   sign-up picker, a grid of small checkboxes, was laid out on the card grid and
   carried a margin nobody asked it for. Two grids, two names. */
.pickgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:var(--s-2)}
.fieldpick{display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--line);
  border-radius:9px;font-size:var(--t-13);cursor:pointer}
.fieldpick:hover{border-color:var(--line-strong)}
.fieldpick input{accent-color:var(--link)}
.whoami{display:flex;align-items:center;gap:7px;font-size:var(--t-12);color:var(--ink-4)}
.whoami a{color:var(--ink-3)}
.themetoggle{display:flex}
.themetoggle button{
  display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;
  padding:0;border-radius:var(--r-2);cursor:pointer;color:var(--ink-3);
  background:var(--surface);border:1px solid var(--line);transition:color .12s,border-color .12s;
}
.themetoggle button:hover{color:var(--ink);border-color:var(--line-strong)}
@media(max-width:720px){.topright .live span,.topright .live{display:none}}
.live{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.live i{width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 18%,transparent)}
.live.stale i{background:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 18%,transparent)}
.live.down i{background:var(--critical);box-shadow:0 0 0 3px color-mix(in srgb,var(--critical) 18%,transparent)}

.shell{display:grid;grid-template-columns:var(--rail-w) minmax(0,1fr);align-items:start}

/* The rail stops being a column and becomes a sheet. Fixed rather than sticky so
   a long menu scrolls itself instead of the page under it, and z-index below
   .suggest (60) so the search results still come out on top of it. */
@media(max-width:900px){
  .navbtn{display:inline-flex}
  .shell{grid-template-columns:1fr}
  .rail{
    display:none;
    position:fixed;left:0;right:0;top:var(--top-h);bottom:0;z-index:45;
    height:auto;padding:var(--s-3) 0 var(--s-7);
    background:var(--bg);border-right:0;
  }
  .navtoggle:checked ~ .shell .rail{display:block}
}

/* Narrower still: the tabs are gone from the bar, so they ride at the top of the
   same sheet. A fixed strip height, because the sheet below has to clear it and
   a wrapping row has no height anyone can write down. The tabs scroll sideways
   inside it rather than wrapping. */
@media(max-width:720px){
  .nav{display:none}
  .navtoggle:checked ~ .top .nav{
    display:flex;align-items:center;gap:var(--s-1);
    position:fixed;top:var(--top-h);left:0;right:0;height:44px;z-index:47;
    padding:0 var(--s-3);overflow-x:auto;
    background:var(--surface);border-bottom:1px solid var(--line);
  }
  .navtoggle:checked ~ .top .nav a span{
    position:static;width:auto;height:auto;overflow:visible;clip-path:none}
  .navtoggle:checked ~ .shell .rail{padding-top:calc(44px + var(--s-3))}
}

/* ---------- credits ---------- */
.credits{
  max-width:none;margin:var(--s-7) 0 0;padding:var(--s-4) var(--s-5) var(--s-6);
  border-top:1px solid var(--line);font-size:var(--t-11);line-height:1.7;color:var(--ink-4);
}
.credits a{color:var(--ink-3);text-decoration:underline;text-underline-offset:2px}
.credits a:hover{color:var(--link)}

/* ---------- suggestions ----------
   A <datalist> was shipping 230 options into every page and letting the browser
   decide how tall the popup should be -- which, given 230 options, was "all of
   it". This is bounded, scrollable, and asks the server as you type, so it stays
   the same size however large the vocabulary gets. */
.suggest{
  position:absolute;top:calc(100% + 5px);left:0;right:0;z-index:60;
  max-height:min(340px,60vh);overflow-y:auto;padding:4px;
  background:var(--raised);border:1px solid var(--line-strong);
  border-radius:var(--r-2);box-shadow:0 12px 32px -12px rgba(0,0,0,.5);
}
.suggest[hidden]{display:none}
.suggest .sg{
  display:flex;align-items:center;gap:9px;padding:6px 9px;border-radius:var(--r-1);
  font-size:var(--t-13);color:var(--ink-2);cursor:pointer;
}
.suggest .sg:hover,.suggest .sg.on{background:var(--brand-soft);color:var(--ink)}
.suggest .sg .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.suggest .sg .kd{
  margin-left:auto;flex:none;font:500 var(--t-9)/1 var(--mono);letter-spacing:.05em;
  text-transform:uppercase;color:var(--ink-4);
}
.suggest .sg .n{flex:none;font:500 var(--t-10)/1 var(--mono);color:var(--ink-4)}
.suggest .empty{padding:9px;font-size:var(--t-12);color:var(--ink-4);text-align:left}

/* ---------- rail ---------- */
.rail{
  position:sticky;top:var(--top-h);height:calc(100vh - var(--top-h));overflow-y:auto;
  padding:var(--s-3) 0 var(--s-7);border-right:1px solid var(--line);
  background:var(--bg-sunken);scrollbar-width:thin;
}
.rail::-webkit-scrollbar{width:8px}
.rail::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:var(--r-full)}
.rail h3{
  margin:var(--s-4) var(--s-4) var(--s-1);font:600 var(--t-10)/1.4 var(--sans);
  letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4);
}
.rail a{
  display:flex;align-items:center;gap:9px;margin:1px var(--s-2);padding:5px 9px;
  border-radius:var(--r-2);color:var(--ink-2);font-size:var(--t-13);line-height:1.35;
  transition:background .1s,color .1s;
}
.rail a:hover{background:var(--surface-2);color:var(--ink)}
.rail a.on{background:var(--raised);color:var(--ink);font-weight:600;box-shadow:inset 0 0 0 1px var(--line)}
.rail a.on .ico{color:var(--brand);opacity:1}
.rail a .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto}
.rail a .n{margin-left:auto;font:500 var(--t-11)/1 var(--mono);color:var(--ink-4)}
.rail a.on .n{color:var(--ink-3)}
.rail a .n.alert{color:var(--critical)}
.rail .sub a,.rail .sub .off{padding-left:32px;font-size:var(--t-12)}
/* What a group is FOR, where the title alone does not say it. One line, the
   same size as the counts, so it reads as a caption rather than as an entry. */
.rail .gnote{
  margin:0 var(--s-4) var(--s-2);font-size:var(--t-11);line-height:1.45;color:var(--ink-4);
}
/* An entry with nothing behind it right now. Present so the menu keeps its
   shape, dimmed and inert so it is not offered as somewhere to go. */
.rail .off{
  display:flex;align-items:center;gap:9px;margin:1px var(--s-2);padding:5px 9px;
  border-radius:var(--r-2);color:var(--ink-4);font-size:var(--t-13);line-height:1.35;
  opacity:.55;cursor:default;
}
.rail .off .n{margin-left:auto;font:500 var(--t-11)/1 var(--mono);color:var(--ink-4)}
/* The "first seen" stamp beside a new technology: the reason it is in the list. */
/* A note yields before the label does. With equal shrink factors "Releases ·
   NONE TRACKED · 0" rendered as "Relea… NONE TRACKED 0", which loses the one
   word identifying the row and keeps the annotation about it. */
.rail .nt{
  margin-left:auto;font:500 var(--t-10)/1 var(--mono);letter-spacing:.04em;
  text-transform:uppercase;color:var(--ink-4);opacity:.8;
  flex:0 20 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.rail .nt + .n{margin-left:9px}

/* ---------- page ---------- */
main{min-width:0;padding-bottom:var(--s-7)}
/* The content column fills what the rail leaves.
   It used to stop at 1180px, which on a wide screen left a third of the window
   empty while the story list -- a table of title, meta and sparkline -- was the
   thing being squeezed. A measure cap is right for PROSE and wrong for a
   dashboard: the reading page sets its own (see .reading) and everything else
   uses the room it has. */
.wrap{max-width:none;padding:0 var(--s-5) 0 var(--s-5)}
/* Except where the content really is prose. These read badly at 2000px. */
.wrap:has(.setrow),.wrap:has(.reading){max-width:1180px}
.head{padding:var(--s-5) 0 var(--s-3)}
.head h1{
  margin:0;font:500 var(--t-27)/1.15 var(--serif);letter-spacing:-.015em;color:var(--ink);
}
.head p{margin:6px 0 0;font-size:var(--t-13);color:var(--ink-3);max-width:78ch}
h2.sec{
  margin:var(--s-5) 0 var(--s-2);font:600 var(--t-12)/1.4 var(--sans);
  letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);
  display:flex;align-items:center;gap:var(--s-2);
}
h2.sec::after{content:"";flex:1;height:1px;background:var(--line)}
p.note{margin:-2px 0 var(--s-2);font-size:var(--t-12);color:var(--ink-4);max-width:78ch}

/* Related lists: a date column that lines up, and a title that wraps under
   itself rather than under the date. Dates are fixed-width because a column of
   them is being scanned, not read. */
ol.rel{list-style:none;margin:0 0 var(--s-4);padding:0;max-width:80ch}
ol.rel li{
  display:grid;grid-template-columns:9ch 1fr auto;gap:0 var(--s-2);
  align-items:baseline;padding:6px 0;border-bottom:1px solid var(--line);
  font-size:var(--t-13);
}
ol.rel li:last-child{border-bottom:0}
ol.rel .when{font-variant-numeric:tabular-nums;color:var(--ink-4);font-size:var(--t-12)}
ol.rel li.here{background:var(--brand-soft);margin:0 calc(var(--s-2) * -1);
  padding-left:var(--s-2);padding-right:var(--s-2);border-radius:var(--r-1)}
ol.rel li.here > span:nth-child(2){color:var(--ink);font-weight:600}
@media (max-width:560px){
  ol.rel li{grid-template-columns:1fr;gap:2px}
  ol.rel .when{grid-row:2}
}

/* ---------- filter bar ---------- */
.filters{
  position:sticky;top:var(--top-h);z-index:30;padding:var(--s-2) 0 var(--s-3);
  background:color-mix(in srgb,var(--bg) 92%,transparent);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--line);
}
.segs{display:inline-flex;padding:2px;gap:2px;background:var(--surface-2);
  border:1px solid var(--line);border-radius:var(--r-2);margin-bottom:var(--s-2)}
.segs a{
  padding:4px 11px;border-radius:var(--r-1);font-size:var(--t-12);font-weight:500;color:var(--ink-3);
}
.segs a:hover{color:var(--ink)}
.segs a.on{background:var(--raised);color:var(--ink);box-shadow:var(--shadow)}
/* Two different gaps, on purpose.
   A label belongs to the control beside it, so those stay tight; one filter has
   nothing to do with the next, so those get room. At a single 6px gap the two
   spacings were indistinguishable and the row read as one long strip of words
   rather than as five separate questions. The negative margin is how you get
   both out of one flex gap: the row spaces everything at --s-5, and the label
   pulls itself back toward its own select. */
/* A label belongs to the control after it, so the two sit 7px apart while
   unrelated controls stay a full --row-gap apart. That is done by cancelling
   the gap with a negative margin, which means the two numbers MUST agree.
   
   They stopped agreeing: a form overrode 'gap' inline to 7px, the label kept
   subtracting --s-5 from it, and the select slid left over its own label --
   "Sort" rendered as "So". The gap is a variable now, so overriding it moves
   both halves of the calculation together and the two cannot drift apart. */
.row{
  --row-gap:var(--s-5);
  display:flex;flex-wrap:wrap;gap:var(--s-2) var(--row-gap);align-items:center;
}
.row label{
  font-size:var(--t-11);color:var(--ink-4);
  margin-right:calc(7px - var(--row-gap));
  flex:none;
}
/* Filter chips: the two dimensions worth browsing, laid out so the SHAPE of
   the archive is visible without opening anything. That AI has 80 stories and
   Astro has 2 is the useful fact, and a dropdown hides it. */
.chiprow{display:flex;gap:var(--s-3);align-items:flex-start;padding:5px 0}
.chiprow + .chiprow{border-top:1px solid var(--line)}
.crlab{
  flex:none;width:52px;padding-top:5px;
  font:600 var(--t-9)/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-4);
}
.crset{display:flex;flex-wrap:wrap;gap:5px;min-width:0}
.fchip{
  display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:999px;
  font-size:var(--t-12);color:var(--ink-3);background:var(--surface);
  border:1px solid var(--line);white-space:nowrap;transition:border-color .12s,color .12s;
}
.fchip:hover{border-color:var(--line-strong);color:var(--ink)}
.fchip.on{background:var(--raised);border-color:var(--line-strong);color:var(--ink);
  font-weight:600;box-shadow:var(--shadow)}
.fchip .dot{width:7px;height:7px;border-radius:50%;flex:none;
  background:hsl(var(--hue,220) 70% 60%)}
.fchip .cn{color:var(--ink-4);font:500 var(--t-11)/1 var(--mono);font-variant-numeric:tabular-nums}
.fchip.on .cn{color:var(--ink-3)}
@media(max-width:720px){.chiprow{flex-direction:column;gap:4px}.crlab{width:auto}}

/* Searchable select. The native control stays in the DOM and stays the thing
   that submits; it is hidden only once the input beside it exists, so a page
   with no scripting is still a working form. */
.combo{position:relative;display:inline-flex}
.combo select{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}
.comboin{
  height:28px;min-width:120px;max-width:230px;padding:0 var(--s-2);
  font:inherit;font-size:var(--t-12);color:var(--ink);
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-2);
  cursor:pointer;transition:border-color .12s;
}
.comboin:hover{border-color:var(--line-strong)}
.comboin:focus{outline:none;cursor:text;border-color:var(--brand);
  box-shadow:0 0 0 3px var(--brand-soft)}
.combolist{
  position:absolute;top:calc(100% + 4px);left:0;min-width:100%;width:max-content;
  max-width:340px;max-height:min(320px,52vh);overflow-y:auto;z-index:60;padding:4px;
  background:var(--raised);border:1px solid var(--line-strong);border-radius:var(--r-2);
  box-shadow:0 12px 32px -12px rgba(0,0,0,.5);
}
.comboopt{
  padding:5px 8px;border-radius:var(--r-1);font-size:var(--t-12);color:var(--ink-2);
  white-space:nowrap;cursor:pointer;
}
.comboopt:hover,.comboopt.hot{background:var(--surface-2);color:var(--ink)}
.comboopt.on{color:var(--ink);font-weight:600}
.combonone{padding:6px 8px;font-size:var(--t-12);color:var(--ink-4)}

/* Date range. Native inputs on purpose: the browser's picker is keyboard
   accessible, localised and already known to the reader, and min/max stop it
   offering a day the archive no longer holds. */
.dt{
  height:28px;padding:0 6px;font:inherit;font-size:var(--t-12);color:var(--ink);
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-2);
  color-scheme:dark light;
}
.dt:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.dtsep{color:var(--ink-4);font-size:var(--t-11);margin:0 calc(7px - var(--s-5)) 0 0}

/* A multi-value filter that a single select cannot represent, said plainly
   instead of shown as a dropdown that would have to lie about it. */
.manysel{
  display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 var(--s-2);
  border:1px solid var(--line);border-radius:var(--r-2);background:var(--surface);
  font-size:var(--t-12);color:var(--ink-3);
}
.manysel .lbl{color:var(--ink-4);font-size:var(--t-11)}
.manysel b{color:var(--ink);font-weight:600}
.manysel a{color:var(--link);font-size:var(--t-11)}
.manysel a:hover{text-decoration:underline}

.txt{
  height:28px;min-width:210px;padding:0 var(--s-2);font:inherit;font-size:var(--t-12);
  color:var(--ink);background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-2);transition:border-color .12s;
}
.txt::placeholder{color:var(--ink-4)}
.txt:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
select,.btn{
  height:28px;padding:0 var(--s-2);font:inherit;font-size:var(--t-12);color:var(--ink);
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-2);cursor:pointer;
  transition:border-color .12s;
}
select:hover,.btn:hover{border-color:var(--line-strong)}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:var(--s-2)}
.pill{
  display:inline-flex;align-items:center;gap:6px;height:23px;padding:0 var(--s-2);
  font-size:var(--t-11);border-radius:var(--r-full);background:var(--surface-2);
  border:1px solid var(--line);color:var(--ink-3);
}
.pill b{font-weight:600;color:var(--ink)}
.pill a{color:var(--ink-4);font-size:var(--t-13);line-height:1}
.pill a:hover{color:var(--critical)}
.pill.on{background:var(--brand-soft);border-color:color-mix(in srgb,var(--brand) 45%,transparent);color:var(--ink)}
/* Three states a scheduled job can be in. Colour carries the same word the text
   does -- "failing x3" is legible with no colour at all -- so this is emphasis,
   never the only signal. */
.pill.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
.pill.bad{color:var(--critical);border-color:color-mix(in srgb,var(--critical) 45%,transparent)}
.pill.muted{color:var(--ink-4)}

/* ---------- refine panel: multi-select facets ---------- */
.refine{margin-top:var(--s-2);border:1px solid var(--line);border-radius:var(--r-2);background:var(--surface)}
.refine summary{
  display:flex;align-items:center;gap:8px;padding:7px var(--s-3);cursor:pointer;
  font-size:var(--t-12);font-weight:500;color:var(--ink-2);list-style:none;user-select:none;
}
.refine summary::-webkit-details-marker{display:none}
.refine summary::after{content:"\\25BE";margin-left:auto;color:var(--ink-4);font-size:var(--t-10);transition:transform .15s}
.refine[open] summary::after{transform:rotate(180deg)}
.refine summary:hover{color:var(--ink)}
.refine summary .hint{color:var(--ink-4);font-weight:400;font-size:var(--t-11)}
.on-n{
  display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;
  padding:0 5px;border-radius:var(--r-full);font:600 var(--t-10)/1 var(--mono);
  background:var(--brand);color:var(--brand-ink);
}
.fform{padding:0 var(--s-3) var(--s-3)}
.fgrid{display:grid;gap:var(--s-4);grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
  padding-top:var(--s-3);border-top:1px solid var(--line)}
.fgroup h4{
  margin:0 0 6px;display:flex;align-items:center;gap:6px;
  font:600 var(--t-10)/1.4 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4);
}
.fgroup h4 .fcount{
  margin-left:auto;font:400 var(--t-10)/1 var(--mono);color:var(--ink-4);letter-spacing:0;
  text-transform:none;
}
.fsearch{
  width:100%;height:25px;margin-bottom:5px;padding:0 8px;font:inherit;font-size:var(--t-12);
  color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:var(--r-1);
}
.fsearch::placeholder{color:var(--ink-4)}
.fsearch:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 2px var(--brand-soft)}
.fnone{margin:6px 2px;font-size:var(--t-11);color:var(--ink-4)}
.fopts{display:flex;flex-direction:column;gap:1px;max-height:248px;overflow-y:auto;padding-right:4px}
.fopts::-webkit-scrollbar{width:6px}
.fopts::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:var(--r-full)}
.fopt{
  display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:var(--r-1);
  font-size:var(--t-12);color:var(--ink-2);cursor:pointer;
}
.fopt:hover{background:var(--surface-2);color:var(--ink)}
.fopt.on{color:var(--ink);font-weight:500}
/* ONE CHECKBOX, DRAWN ONCE.
   There were two of these. A real <input> in the facet panel, and a <span> in
   the rail -- which has to be drawn rather than input, because a checkbox
   cannot be a link and every rail row is a shareable address. Same control,
   same two states, and they had drifted to different box sizes, different tick
   geometry, and one of them was the only hardcoded colour in the stylesheet.
   The tick is the same mark either way, so it is one rule with two selectors. */
.fopt input,.group.checks .box{
  appearance:none;width:14px;height:14px;flex:none;border:1px solid var(--line-strong);
  border-radius:3px;background:var(--bg);cursor:pointer;position:relative;
}
.fopt input:checked,.group.checks a.on .box{background:var(--brand);border-color:var(--brand)}
.fopt input:checked::after,.group.checks a.on .box::after{
  content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;
  border:solid var(--brand-ink);border-width:0 2px 2px 0;transform:rotate(42deg);
}
.fopt .fname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fopt .fn{margin-left:auto;font:400 var(--t-10)/1 var(--mono);color:var(--ink-4)}
.factions{display:flex;gap:var(--s-2);align-items:center;margin-top:var(--s-3);
  padding-top:var(--s-3);border-top:1px solid var(--line)}
.btn.primary{background:var(--brand);border-color:var(--brand);color:var(--brand-ink);font-weight:600}
.btn.primary:hover{filter:brightness(1.08)}
a.btn{display:inline-flex;align-items:center;text-decoration:none;color:var(--ink-2)}
a.chip.on{background:var(--brand-soft);border-color:var(--brand);color:var(--ink)}

/* ---------- the river ---------- */
.daymark{
  position:sticky;top:calc(var(--top-h) + 1px);z-index:10;
  display:flex;align-items:center;gap:var(--s-3);margin-top:var(--s-4);padding:var(--s-2) 0 6px;
  background:var(--bg);font:600 var(--t-10)/1 var(--sans);letter-spacing:.12em;
  text-transform:uppercase;color:var(--ink-4);
}
.daymark::after{content:"";flex:1;height:1px;background:var(--line)}

.item{
  display:grid;grid-template-columns:1fr auto;gap:var(--s-4);align-items:start;
  padding:11px var(--s-3) 11px var(--s-3);margin:0 calc(var(--s-3) * -1);
  border-bottom:1px solid var(--line);border-left:2px solid transparent;
  scroll-margin-top:calc(var(--top-h) + 60px);
}
.item:hover{background:var(--surface)}
.item.crit{border-left-color:var(--critical)}
.item.sel{background:var(--brand-soft);border-left-color:var(--brand)}
.item h2{
  margin:0;font:600 var(--t-15)/1.38 var(--sans);letter-spacing:-.008em;color:var(--ink);
}
.item h2 a:hover{color:var(--link)}
.item:visited h2 a{color:var(--ink-2)}
.item .sum{
  margin:3px 0 0;font-size:var(--t-13);line-height:1.5;color:var(--ink-3);max-width:88ch;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.item .meta{
  margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;gap:5px 10px;
  font-size:var(--t-11);color:var(--ink-4);
}
.item .meta .src{color:var(--ink-2);font-weight:500}
.item .meta .src:hover{color:var(--ink)}
.item .meta .dot{width:2px;height:2px;border-radius:50%;background:var(--ink-4);opacity:.6}
.item .side{display:flex;flex-direction:column;align-items:flex-end;gap:6px;padding-top:2px}

.sev{
  display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;
  padding:0 6px;border-radius:var(--r-1);font:600 var(--t-11)/1 var(--mono);
  background:var(--surface-2);color:var(--ink-3);border:1px solid var(--line);
}
.sev.hi{
  background:color-mix(in srgb,var(--critical) 14%,transparent);
  color:var(--critical);border-color:color-mix(in srgb,var(--critical) 34%,transparent);
}
.sev.mid{color:var(--ink-2);border-color:var(--line-strong)}
.chip{
  display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:var(--r-1);
  font:500 var(--t-10)/1 var(--mono);background:var(--surface-2);border:1px solid var(--line);
  color:var(--ink-3);letter-spacing:.01em;
}
a.chip:hover{border-color:var(--line-strong);color:var(--ink)}
.lang{font:500 var(--t-10)/1 var(--mono);text-transform:uppercase;color:var(--ink-4)}

/* ---------- favourites ---------- */
/* One glyph in three states rather than three glyphs: the outline is the
   default, the fill is "kept", and the muted outline is "released, counting
   down". Filling by CSS keeps the button exactly the same size in every state,
   so a river of stars does not reflow when one is clicked. */
.fav{display:inline-flex;margin:0}
.fav button{
  display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 5px;
  background:none;border:1px solid transparent;border-radius:var(--r-1);
  color:var(--ink-4);cursor:pointer;font:500 var(--t-11)/1 var(--sans);
  transition:color .12s,border-color .12s,background .12s;
}
.fav button:hover{color:var(--warn);border-color:var(--line);background:var(--surface-2)}
.fav.on button{color:var(--warn)}
.fav.on .ico{fill:currentColor}
/* Released: still on the page, visibly on its way out. */
.fav.off button{color:var(--ink-4);opacity:.75}
.fav.off button:hover{opacity:1}

/* Read. The control a reader uses most often, so unlike delete it is visible
   without hovering -- its state is the thing they most need to see at a glance.
   Unread is an open ring, read is a tick; one control in two states rather than
   two controls. */
.rd{display:inline-flex;margin:0}
.rd button{
  display:inline-flex;align-items:center;height:22px;padding:0 5px;
  background:none;border:1px solid transparent;border-radius:var(--r-1);
  color:var(--ink-4);cursor:pointer;
  transition:color .12s,border-color .12s,background .12s;
}
.rd button:hover{color:var(--ink-2);border-color:var(--line);background:var(--surface-2)}
.rd.on button{color:var(--ok)}

/* A read story stays exactly where it is and says so quietly. Dimming the
   TITLE and not the whole row: the metadata is already grey, and fading it
   further makes a read row look broken rather than finished. */
.item.seen h2 a{color:var(--ink-3)}
.item.seen .sum{color:var(--ink-4)}

/* "I am caught up." */
.readall{display:inline-flex;margin:0}
.readall button{
  display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;
  font:500 var(--t-11)/1 var(--sans);color:var(--ink-3);cursor:pointer;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-1);
}
.readall button:hover{color:var(--ink);border-color:var(--line-strong)}

/* Delete, beside the star and deliberately quieter than it.
   Favouriting is the gesture this reader is FOR; deleting is the correction.
   It stays invisible until the row is hovered, so a list of fifty stories is
   not a column of fifty bins, and it turns red only under the pointer -- a
   control that looks dangerous at rest reads as a warning nobody asked for. */
.dis{display:inline-flex;margin:0;opacity:0;transition:opacity .12s}
article:hover .dis,.side:focus-within .dis,.dis:focus-within{opacity:1}
.dis button{
  display:inline-flex;align-items:center;height:22px;padding:0 5px;
  background:none;border:1px solid transparent;border-radius:var(--r-1);
  color:var(--ink-4);cursor:pointer;
  transition:color .12s,border-color .12s,background .12s;
}
.dis button:hover{color:var(--critical);border-color:var(--line);background:var(--surface-2)}
/* On the deleted page every row is already gone, so the control is the way
   back and is always visible. */
.dis.on{opacity:1}
.dis.on button:hover{color:var(--ok)}

.delrow{
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--s-3);align-items:center;
  padding:10px var(--s-3);border-bottom:1px solid var(--line);
}
.delrow:last-child{border-bottom:0}
.delrow:hover{background:var(--surface-2)}
.delrow .dt{font-size:var(--t-13);color:var(--ink);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.delrow .dt a{color:inherit}
.delrow .dt a:hover{color:var(--link)}
.delrow .dm{margin-top:3px;font-size:var(--t-11);color:var(--ink-4);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Beside the other page actions, the star wears the same clothes as a button. */
.rd-acts .fav button,.head-acts .fav button,.pagehead .fav button{
  height:30px;padding:0 11px;border-color:var(--line);background:var(--surface);
  font-size:var(--t-12);
}

.fav-item.lapsing{opacity:.72}
.fav-item .lapse{color:var(--warn);font-weight:500}
.fav-item .lapse.now{color:var(--critical)}
.fav-item .held{color:var(--ink-4)}
/* Live status. One word, coloured, in the registry rows and on platform cards.
   Deliberately not the same shape as .chip: a chip is a link you can click to
   filter, this is a state you are being told about. */
/* A count that just changed. Brief, and only a background tint -- the number
   must not move, because a rail whose entries jump as you aim at them is worse
   than one that lies quietly. */
@keyframes bump{from{background:var(--brand-soft)}to{background:transparent}}
.rail .n.bumped{animation:bump 1.2s ease-out;border-radius:4px}
@media(prefers-reduced-motion:reduce){.rail .n.bumped{animation:none}}

.act{
  display:inline-flex;align-items:center;height:17px;padding:0 6px;border-radius:999px;
  font:600 var(--t-10)/1 var(--sans);letter-spacing:.03em;text-transform:uppercase;
  border:1px solid var(--line);color:var(--ink-4);background:var(--surface-2);
}
.act.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 32%,transparent);
  background:color-mix(in srgb,var(--ok) 10%,transparent)}
.act.ok.soft{opacity:.78}
.act.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 32%,transparent);
  background:color-mix(in srgb,var(--warn) 10%,transparent)}
.act.muted{color:var(--ink-4)}

/* Exemplars: the headlines that outlive the stories they point at. */
.exemplars{display:grid;gap:var(--s-3);grid-template-columns:repeat(auto-fill,minmax(300px,1fr));
  margin:var(--s-3) 0 var(--s-5)}
.exmonth{padding:var(--s-3);background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-3)}
.exmonth h3{margin:0 0 8px;font:600 var(--t-11)/1 var(--mono);letter-spacing:.04em;
  color:var(--ink-4)}
/* A headline is arbitrary text out of somebody else's CMS, and some of it is a
   single unbroken token: a git ref like trunk/52d08b9519e82b71ababd98473077dff,
   a package path, a 40-character hash. Wrapping at spaces has nowhere to break
   one of those, so it runs straight out through the side of the card and over
   the column beside it. 'anywhere' breaks mid-token only when the alternative
   is overflow, so ordinary prose is untouched. min-width:0 because a grid item
   otherwise refuses to shrink below its longest word regardless. */
.ex{margin:0 0 9px;font-size:var(--t-13);line-height:1.45;overflow-wrap:anywhere}
.exmonth{min-width:0}
.exmonth h3{overflow-wrap:anywhere}

/* Adoption comparison: a technology against the largest things in its category.
   A bar is only useful next to other bars, which is the whole reason this is a
   list and not the single number it started as. The row for the technology the
   page is about keeps its place in the ranking rather than being pinned first,
   because where it FALLS among its neighbours is the information. */
ol.adopt{list-style:none;margin:var(--s-3) 0 var(--s-5);padding:0;max-width:720px}
ol.adopt li{
  display:grid;grid-template-columns:minmax(90px,190px) 1fr minmax(64px,auto);
  gap:0 var(--s-3);align-items:center;padding:5px 0;font-size:var(--t-12);
}
ol.adopt a{color:var(--ink-2);overflow-wrap:anywhere}
ol.adopt a:hover{color:var(--link)}
ol.adopt .bar{display:block;height:8px;background:var(--bg-sunken);border-radius:999px}
ol.adopt .bar > span{
  display:block;height:100%;border-radius:999px;background:var(--line-strong);
}
ol.adopt .num{text-align:right;font-variant-numeric:tabular-nums;color:var(--ink-3)}
ol.adopt li.here a{color:var(--ink);font-weight:600}
ol.adopt li.here .bar > span{background:var(--brand)}
ol.adopt li.here .num{color:var(--ink)}

/* Reference panel: what the technology IS. Set apart from the page's own
   measurements with a rule rather than a box, because it is quoted material and
   should not be mistaken for something this archive worked out. */
.ref{
  margin:var(--s-3) 0 var(--s-4);padding-left:var(--s-3);
  border-left:2px solid var(--line-strong);max-width:80ch;
}
.refsum{margin:0;font-size:var(--t-14);line-height:1.6;color:var(--ink-2)}
dl.reffacts{
  display:flex;flex-wrap:wrap;gap:var(--s-2) var(--s-5);margin:var(--s-3) 0 0;
}
dl.reffacts > div{display:flex;flex-direction:column;gap:1px}
dl.reffacts dt{
  font:600 var(--t-10)/1.4 var(--sans);letter-spacing:.09em;
  text-transform:uppercase;color:var(--ink-4);
}
dl.reffacts dd{margin:0;font-size:var(--t-13);color:var(--ink-2)}
.refsrc{margin:var(--s-2) 0 0;font-size:var(--t-11);color:var(--ink-4)}
.refsrc a{color:var(--ink-4);text-decoration:underline}
.refsrc a:hover{color:var(--link)}

/* One line under a list row saying what the thing is. Clamped to two lines:
   these come from Wikidata and are usually short, but a long one must not push
   the rows out of alignment with each other. */
.blurb{
  margin-top:3px;font-size:var(--t-12);line-height:1.45;color:var(--ink-3);
  max-width:78ch;overflow-wrap:anywhere;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
/* Inside a collapsed registry row the blurb sits under the summary grid, so it
   needs the indent the grid columns would otherwise give it. */
.rowblurb{padding:0 var(--s-3) var(--s-2) 26px;margin-top:-2px}

/* MULTI-SELECT RAIL ROWS
   ---------------------------------------------------------------------------
   These rows always combined -- clicking one adds it to the selection rather
   than replacing it -- and a plain list of links never said so, so readers
   treated them as radio buttons. The box is what says "pick several".

   It is drawn, not an <input>: a real checkbox cannot be a link, so it would
   need a form and a submit, and every row would stop being a shareable address
   for the selection it produces. The link also works with JavaScript off. */
.group.checks a,.group.checks .off{padding-left:6px}
.group.checks .box{margin-right:1px}
.group.checks a:hover .box{border-color:var(--ink-4)}

/* The group's everything row: Anything, All fields, All companies.
   It has no box because it is not one of the options -- it is the state of
   having ticked none of them, and clicking it CLEARS the group. Drawn as a
   checkbox it read as one more thing to tick, so readers ticked it and nothing
   appeared to happen. A rule beneath it separates the reset from the choices;
   the indent keeps its label in line with the boxed ones below. */
.group a.all{font-weight:600}
.group.checks a.all{padding-left:6px}
.group.checks a.all .lbl{margin-left:20px}
.group a.all::after{
  content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:1px;background:var(--line);
}
.group a.all{position:relative;margin-bottom:5px}
.group a.all.on{color:var(--ink)}

/* The tail of a long group, behind a disclosure that says how much it is
   holding -- "more" alone does not distinguish three from three hundred, and
   that is the difference between opening it and not bothering. */
details.more > summary{
  list-style:none;cursor:pointer;padding:5px 8px 5px 6px;margin-top:2px;
  font:500 var(--t-11)/1 var(--sans);color:var(--ink-4);border-radius:var(--r-1);
}
details.more > summary::-webkit-details-marker{display:none}
details.more > summary:hover{color:var(--ink-2);background:var(--surface)}
details.more > summary::before{content:"▸ ";font-size:9px;vertical-align:1px}
details.more[open] > summary::before{content:"▾ "}
details.more[open] > summary .op,details.more:not([open]) > summary .cl{display:none}
@media (max-width:560px){
  ol.adopt li{grid-template-columns:1fr auto;gap:2px var(--s-2)}
  ol.adopt .bar{grid-column:1 / -1}
}
.ex a{color:var(--ink)}
.ex a:hover{color:var(--link)}
.ex .muted{display:block;font-size:var(--t-11);color:var(--ink-4);margin-top:2px}

h2.sect{
  margin:var(--s-5) 0 var(--s-2);font:600 var(--t-13)/1.2 var(--sans);
  letter-spacing:.02em;text-transform:uppercase;color:var(--ink-4);
}

/* ---------- field cards ---------- */
.fieldgrid{display:grid;gap:var(--s-3);grid-template-columns:repeat(auto-fill,minmax(232px,1fr));
  margin:var(--s-4) 0 var(--s-5)}
.fieldcard{
  display:block;padding:var(--s-3);background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-3);transition:border-color .12s,background .12s;
}
.fieldcard:hover{border-color:var(--line-strong);background:var(--surface-2);text-decoration:none}
.fc-top{display:flex;align-items:center;gap:8px;color:var(--ink-3)}
.fc-name{font-size:var(--t-13);font-weight:600;color:var(--ink)}
.fc-n{margin:6px 0 8px;font:600 var(--t-21)/1.1 var(--sans);letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}
.fc-n small{font:400 var(--t-11)/1 var(--sans);color:var(--ink-4);margin-left:5px}
.fc-spark{opacity:.85}
.chip-n{margin-left:4px;color:var(--ink-4);font-size:var(--t-9)}
.chip.announce{
  background:var(--brand-soft);border-color:color-mix(in srgb,var(--brand) 40%,transparent);
  color:var(--link);
}

/* ---------- panels ---------- */
.cards{display:grid;gap:var(--s-3);grid-template-columns:repeat(auto-fit,minmax(168px,1fr));margin:var(--s-4) 0 var(--s-5)}
.card{
  padding:var(--s-3);background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-3);
}
.card h3{margin:0 0 6px;font:600 var(--t-10)/1.4 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4)}
.stat{font:600 var(--t-21)/1.1 var(--sans);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat small{font:400 var(--t-12)/1 var(--sans);color:var(--ink-4);letter-spacing:0}

/* CARD TOOLTIPS
   ---------------------------------------------------------------------------
   A card reading "NICHE 1.00 inverse coverage" is a number and a phrase that
   explains itself only to whoever wrote it. The explanation exists; it was in
   the source and in the README, which are the two places a reader of the page
   is not.
   
   Driven off 'data-tip', so the same rule serves both card components -- the
   '.kpi' links on the dashboard and the '.card' divs everywhere else -- without
   either of them needing to know a tooltip is possible.
   
   Hover and keyboard focus both open it. No 'tabindex' is added to the plain
   card divs: that would put a tab stop on every statistic in the archive to
   deliver text that is already on the page for assistive technology, in the
   visually-hidden span the helper writes beside it. The tooltip is the sighted
   pointer user's copy of that text, not the only copy. */
.card[data-tip],.kpi[data-tip]{position:relative}
.card[data-tip] h3::after,.kpi[data-tip] h3::after{
  content:"i";margin-left:6px;vertical-align:1px;
  display:inline-grid;place-items:center;width:12px;height:12px;
  border:1px solid var(--line-strong);border-radius:50%;
  font:600 9px/1 var(--sans);color:var(--ink-4);
  text-transform:none;letter-spacing:0;
}
.card[data-tip]:hover h3::after,.kpi[data-tip]:hover h3::after{
  color:var(--ink-2);border-color:var(--ink-4);
}
.card[data-tip]::after,.kpi[data-tip]::after{
  content:attr(data-tip);
  position:absolute;left:0;top:calc(100% - 4px);z-index:40;
  width:max-content;min-width:100%;max-width:min(300px,78vw);
  padding:8px 10px;
  border:1px solid var(--line-strong);border-radius:var(--r-2);
  background:var(--bg-sunken);color:var(--ink-2);
  font:400 var(--t-12)/1.45 var(--sans);text-transform:none;letter-spacing:0;
  text-align:left;white-space:normal;
  opacity:0;transform:translateY(-4px);pointer-events:none;
  transition:opacity .12s ease,transform .12s ease;
}
.card[data-tip]:hover::after,.kpi[data-tip]:hover::after,
.kpi[data-tip]:focus-visible::after{opacity:1;transform:translateY(0)}
/* The last column would open its tooltip off the right edge of the viewport. */
.cards > .card[data-tip]:last-child::after,
.kpis > .kpi[data-tip]:last-child::after{left:auto;right:0}
@media (prefers-reduced-motion:reduce){
  .card[data-tip]::after,.kpi[data-tip]::after{transition:none}
}

/* Present to assistive technology, absent from the layout. */
.vh{
  position:absolute;width:1px;height:1px;margin:-1px;padding:0;
  overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;
}

.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r-3);background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:var(--t-12)}
th,td{text-align:left;padding:7px var(--s-3);border-bottom:1px solid var(--line);vertical-align:top}
th{
  position:sticky;top:0;background:var(--surface-2);z-index:2;
  font:600 var(--t-10)/1.4 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-4);white-space:nowrap;
}
th .type{text-transform:none;letter-spacing:0;font-weight:400;color:var(--ink-4);opacity:.75}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--surface-2)}
td.mono{font-family:var(--mono);font-size:var(--t-11)}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.null{color:var(--ink-4);font-style:italic}
td a{color:var(--link)}
.ok{color:var(--ok)}.warn{color:var(--warn)}.accent{color:var(--critical)}

figure.chart{margin:0 0 var(--s-2)}
figure.chart figcaption{font-size:var(--t-10);color:var(--ink-4);margin-top:4px}
svg.spark{display:block;opacity:.9}
details.values{margin:var(--s-1) 0 var(--s-4);font-size:var(--t-12);color:var(--ink-4)}
details.values summary{cursor:pointer}
details.values summary:hover{color:var(--ink-3)}

.pager{display:flex;gap:var(--s-4);align-items:center;margin:var(--s-5) 0;font-size:var(--t-12);color:var(--ink-4)}
.pager a{color:var(--link)}
.pager a:hover{text-decoration:underline}

.notice{
  display:flex;gap:10px;padding:11px var(--s-3);margin:var(--s-3) 0 var(--s-4);
  background:var(--surface);border:1px solid var(--line);
  border-left:2px solid var(--warn);border-radius:0 var(--r-2) var(--r-2) 0;
  font-size:var(--t-12);color:var(--ink-3);
}
.notice strong{color:var(--ink)}
/* The default notice is a warning. This one is for a condition that is already
   wrong rather than one worth watching. */
.notice.bad{border-left-color:var(--critical)}
code{font:400 var(--t-11) var(--mono);background:var(--surface-2);border:1px solid var(--line);
  padding:1px 5px;border-radius:var(--r-1);color:var(--ink-2)}
.empty{padding:var(--s-7) 0;text-align:center;color:var(--ink-4);font-size:var(--t-13)}
.empty .ico{display:block;margin:0 auto var(--s-3);opacity:.4}

.shortcuts{
  margin:var(--s-6) 0 0;padding-top:var(--s-3);border-top:1px solid var(--line);
  display:flex;gap:var(--s-4);flex-wrap:wrap;font-size:var(--t-11);color:var(--ink-4);
}
.shortcuts kbd{
  font:500 var(--t-10)/1 var(--mono);border:1px solid var(--line-strong);border-radius:var(--r-1);
  padding:3px 5px;color:var(--ink-3);margin-right:3px;
}

/* ---------- density ----------
   Compact is not a smaller font. Shrinking type makes a dense list harder to
   read, not easier; what buys the room back is dropping the summary and the
   padding around it. */
:root[data-density="compact"] .item{padding:7px var(--s-3)}
:root[data-density="compact"] .item .sum{display:none}
:root[data-density="compact"] .item h2{font-size:var(--t-14)}
:root[data-density="compact"] .item .meta{margin-top:3px}

/* ---------- page head ---------- */
.eyebrow{
  display:flex;align-items:center;gap:7px;margin-bottom:7px;
  font:600 var(--t-10)/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-4);
}
.eyebrow a{color:var(--ink-4)}
.eyebrow a:hover{color:var(--ink-2)}
.eyebrow .sep{opacity:.5}
.headrow{display:flex;align-items:flex-end;gap:var(--s-4);flex-wrap:wrap}
.headrow .actions{margin-left:auto;display:flex;gap:6px;align-items:center}

/* ---------- sub-navigation: the pages inside one section ---------- */
.subnav{
  display:flex;gap:2px;flex-wrap:wrap;margin:var(--s-3) 0 var(--s-2);
  padding-bottom:var(--s-2);border-bottom:1px solid var(--line);
}
.subnav a{
  display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:var(--r-2);
  font-size:var(--t-13);color:var(--ink-3);border:1px solid transparent;
}
.subnav a:hover{background:var(--surface-2);color:var(--ink)}
.subnav a.on{background:var(--surface);border-color:var(--line);color:var(--ink);font-weight:600}
.subnav a.on .ico{color:var(--brand);opacity:1}
.subnav a .n{font:500 var(--t-11)/1 var(--mono);color:var(--ink-4)}

/* ---------- overview ---------- */
.kpis{display:grid;gap:var(--s-3);grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin:var(--s-4) 0}
.kpi{
  position:relative;overflow:hidden;padding:var(--s-3) var(--s-3) var(--s-2);
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-3);
}
.kpi h3{margin:0;font:600 var(--t-10)/1.4 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4)}
.kpi .v{margin-top:4px;font:600 var(--t-27)/1.05 var(--sans);letter-spacing:-.025em;font-variant-numeric:tabular-nums}
.kpi .d{margin-top:2px;font-size:var(--t-11);color:var(--ink-4)}
.kpi .d b{color:var(--ok);font-weight:600}
.kpi .d b.down{color:var(--warn)}
.kpi .bg{position:absolute;right:0;bottom:0;left:0;opacity:.45;pointer-events:none}
a.kpi:hover{border-color:var(--line-strong)}

.panels{display:grid;gap:var(--s-4);grid-template-columns:repeat(auto-fit,minmax(330px,1fr));margin-top:var(--s-3)}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-3);overflow:hidden}
.panel > header{
  display:flex;align-items:center;gap:8px;padding:10px var(--s-3);
  border-bottom:1px solid var(--line);background:var(--surface-2);
}
.panel > header h3{margin:0;font:600 var(--t-12)/1.4 var(--sans);letter-spacing:.04em;color:var(--ink-2)}
.panel > header a.more{margin-left:auto;font-size:var(--t-11);color:var(--link)}
.panel .body{padding:var(--s-3)}
.panel .body.flush{padding:0}

.lst a.row,.lst .row{
  display:flex;align-items:center;gap:10px;padding:8px var(--s-3);
  border-bottom:1px solid var(--line);font-size:var(--t-13);color:var(--ink-2);
}
.lst a.row:last-child,.lst .row:last-child{border-bottom:0}
.lst a.row:hover{background:var(--surface-2);color:var(--ink)}
.lst .row .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lst .row .n{margin-left:auto;font:500 var(--t-11)/1 var(--mono);color:var(--ink-4)}
.lst .row .bar{
  margin-left:auto;width:84px;height:5px;border-radius:var(--r-full);
  background:var(--surface-2);overflow:hidden;flex:none;
}
.lst .row .bar i{display:block;height:100%;background:var(--brand);opacity:.75}

/* ---------- technology catalogue ---------- */
.catgrid{display:grid;gap:var(--s-3);grid-template-columns:repeat(auto-fill,minmax(205px,1fr));margin:var(--s-3) 0 var(--s-5)}
.catcard{
  display:block;padding:var(--s-3);border-radius:var(--r-3);
  background:var(--surface);border:1px solid var(--line);
  border-left:3px solid var(--cat,var(--ink-4));transition:background .12s,border-color .12s;
}
.catcard:hover{background:var(--surface-2)}
.catcard .cn{font-size:var(--t-13);font-weight:600;color:var(--ink)}
.catcard .cd{margin-top:3px;font-size:var(--t-11);color:var(--ink-4);line-height:1.45}
.catcard .cm{margin-top:8px;display:flex;gap:10px;font:500 var(--t-11)/1 var(--mono);color:var(--ink-3)}

.stacklist{border:1px solid var(--line);border-radius:var(--r-3);background:var(--surface);overflow:hidden}
.stackrow{
  display:grid;grid-template-columns:minmax(0,1fr) 92px 104px 132px;gap:var(--s-3);
  align-items:center;padding:9px var(--s-3);border-bottom:1px solid var(--line);
}
.stackrow:last-child{border-bottom:0}
.stackrow:hover{background:var(--surface-2)}
.stackrow .nm{display:flex;align-items:center;gap:8px;min-width:0}
.stackrow .nm .dotc{width:7px;height:7px;border-radius:2px;background:var(--cat,var(--ink-4));flex:none}
.stackrow .nm b{font-weight:600;font-size:var(--t-13);color:var(--ink)}
.stackrow .nm .sl{font:400 var(--t-11)/1 var(--mono);color:var(--ink-4)}
.stackrow .al{margin-top:3px;font-size:var(--t-11);color:var(--ink-4);
  display:flex;align-items:baseline;gap:8px;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* On a platform row the address leads, so it does not shrink away first. */
.stackrow .al .addr{flex:0 1 auto;max-width:60%}
.stackrow .num{text-align:right;white-space:nowrap;font:500 var(--t-12)/1 var(--mono);color:var(--ink-2)}
.stackrow .num small{color:var(--ink-4);font-size:var(--t-10)}
/* Row actions.
   These were 11px of --ink-4 with no underline, no border and no padding: the
   dimmest, smallest text in the row was also the only way out of it, and the
   whole hit area was the six characters of the word. Below 860px they were
   set to display:none, so on a phone the detail page had no link to it at all.
   Now: readable size and ink, a real target, and the LAST action in each row
   carries a chip, because that one is the destination and the rest are asides. */
.stackrow .lnk{display:flex;gap:6px;justify-content:flex-end;align-items:center;
  font-size:var(--t-12);flex-wrap:wrap}
.stackrow .lnk a{
  display:inline-flex;align-items:center;min-height:28px;padding:0 9px;
  border:1px solid transparent;border-radius:var(--r-1);
  color:var(--ink-3);font-weight:500;white-space:nowrap;
  transition:color .12s,border-color .12s,background .12s}
/* The destination. Bordered at rest so it can be found without hunting. */
.stackrow .lnk a:last-child{color:var(--ink-2);border-color:var(--line)}
.stackrow .lnk a:hover{color:var(--link);border-color:var(--link);background:var(--surface-2)}
.stackrow .lnk a:focus-visible{outline:2px solid var(--link);outline-offset:2px}
/* A row is a link target, so say so before the pointer arrives. */
.stackrow:hover .lnk a:last-child{color:var(--link);border-color:var(--link)}
@media(max-width:900px){
  .stackrow{grid-template-columns:minmax(0,1fr) 80px}
  .stackrow .cw{display:none}
  /* Not hidden -- moved. On a phone the actions get their own full-width line
     with a real touch target, rather than being dropped from the page. */
  .stackrow .lnk{grid-column:1/-1;justify-content:flex-start;margin-top:6px}
  .stackrow .lnk a{min-height:36px;padding:0 12px;
    border-color:var(--line)}
}
/* The field report. A page of sentences with the stories under them, rather
   than a river of rows -- see src/ui/report.ts for why it exists. */
.rep-lede{margin:0 0 20px;padding:14px 16px;border:1px solid var(--line);
  border-radius:var(--r-2);background:var(--surface-2)}
.rep-lede p{margin:0 0 6px;font-size:var(--t-14);line-height:1.55}
.rep-lede p:last-child{margin:0;font-size:var(--t-13)}
.rep-groups{display:grid;gap:14px}
.rep-group{padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-2)}
.rep-group h3{margin:0 0 2px;font-size:var(--t-14);font-weight:600;
  display:flex;align-items:center;gap:8px}
.rep-group h3 a{color:var(--ink)}
.rep-group h3 a:hover{color:var(--link)}
.rep-n{font:500 var(--t-11)/1 var(--mono);color:var(--ink-3);
  border:1px solid var(--line);border-radius:var(--r-full);padding:3px 7px}
/* The sentence. This is the part that makes it a report. */
.rep-say{margin:0 0 8px;font-size:var(--t-13);color:var(--ink-2)}
.rep-list{list-style:none;margin:0;padding:0;display:grid;gap:5px}
.rep-list li{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;
  font-size:var(--t-13);line-height:1.45}
.rep-list li > a{color:var(--ink);min-width:0}
.rep-list li > a:hover{color:var(--link)}
.rep-kind{flex:none;font:500 var(--t-10)/1 var(--mono);text-transform:lowercase;
  border:1px solid var(--line);border-radius:var(--r-full);padding:3px 6px;color:var(--ink-3)}
.k-market{color:var(--warn);border-color:var(--warn)}
.k-launch{color:var(--ok);border-color:var(--ok)}
.rep-src{flex:none;font-size:var(--t-11);color:var(--ink-4)}
.rep-more a{font-size:var(--t-12);color:var(--ink-3)}
.rep-more a:hover{color:var(--link)}
.rep-money{margin-bottom:18px}
@media(max-width:720px){.rep-list li{gap:6px}.rep-src{width:100%}}
.catlabel{
  display:inline-flex;align-items:center;gap:6px;height:18px;padding:0 7px;border-radius:var(--r-full);
  font:500 var(--t-10)/1 var(--mono);letter-spacing:.02em;
  color:var(--cat,var(--ink-3));background:color-mix(in srgb,var(--cat,var(--ink-4)) 12%,transparent);
  border:1px solid color-mix(in srgb,var(--cat,var(--ink-4)) 30%,transparent);
}
.statusdot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--ok)}
.statusdot.maintenance{background:var(--warn)}
.statusdot.deprecated{background:var(--critical)}
.statusdot.unknown{background:var(--ink-4)}

/* ---------- registry search ----------
   The first thing on a page listing 2,323 entries, and sized like it. It used to
   sit below the KPIs, the growth panels and the add form, which on a list this
   long meant scrolling past everything to reach the one control that makes it
   navigable. */
.regsearch{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:var(--s-4) 0 var(--s-2)}
.rs-box{position:relative;display:flex;align-items:center;flex:1 1 340px;min-width:260px}
.rs-box .ico{position:absolute;left:11px;color:var(--ink-4)}
.rs-box input{
  width:100%;height:38px;padding:0 32px 0 36px;font:inherit;font-size:var(--t-14);
  color:var(--ink);background:var(--surface);border:1px solid var(--line-strong);
  border-radius:var(--r-2);transition:border-color .12s,box-shadow .12s;
}
.rs-box input::placeholder{color:var(--ink-4)}
.rs-box input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
/* While a live search is in flight the old list stays put and dims. Blanking it
   would make every keystroke flash the page empty, which reads as "no results"
   for 200ms each time. */
#reglist[data-busy]{opacity:.55;transition:opacity .12s}
#reglist{min-height:120px}
.rs-clear{
  position:absolute;right:10px;width:18px;height:18px;display:flex;align-items:center;
  justify-content:center;border-radius:50%;background:var(--surface-2);
  color:var(--ink-4);font:400 var(--t-13)/1 var(--sans);
}
.rs-clear:hover{color:var(--critical);background:var(--raised)}

/* ---------- stack registry ----------
   One row per entry, its full record one click down. <details> rather than a
   modal: the record belongs WITH the row, and this way every one of them is
   open to a browser's find-in-page. */
/* Sticky, so it works inside a rounded container: overflow:hidden would make
   this a scroll container and clip the header away; overflow:clip rounds the
   corners without doing that. */
.stacklist.reg{border-radius:var(--r-3);overflow:clip;--cols:var(--reg-cols)}

/* One template, used by the header and by every row, so a column cannot exist
   in one and not the other. The cells themselves come from COLUMNS in
   registry.ts, in this order. */
.stacklist.reg{
  --mch:calc(var(--t-12) * .6);   /* one character of a monospaced value */
  --hch:calc(var(--t-10) * .72);  /* one character of an uppercase header */
  /* Each counter is as wide as the longer of the two things it must hold: the
     widest value, or its own name. Both are arithmetic -- characters x advance
     width -- rather than a round number typed by eye, which is how "18-12"
     came to wrap inside 46px and drag its row out of line with every other. */
  /* Reserved on every sortable column, not only the one currently sorted, so a
     re-sort moves the arrow and not the columns. */
  --hpad:14px;
  --w-al:max(calc(var(--mch) * 3), calc(var(--hch) * 7 + var(--hpad)));    /* 999     ALIASES  */
  --w-sub:max(calc(var(--mch) * 4), calc(var(--hch) * 7 + var(--hpad)));   /* 1,234   BENEATH  */
  --w-30d:max(calc(var(--mch) * 5), calc(var(--hch) * 7 + var(--hpad)));   /* 12,345  30 DAYS  */
  --w-all:max(calc(var(--mch) * 6), calc(var(--hch) * 8 + var(--hpad)));   /* 123,456 ALL TIME */
  --w-came:max(calc(var(--mch) * 5), calc(var(--hch) * 5 + var(--hpad)));  /* 18-12   FIRST    */
  --reg-cols:9px minmax(0,1.1fr) minmax(0,.8fr) 96px 62px minmax(0,1.2fr)
    var(--w-al) var(--w-sub) var(--w-30d) var(--w-all) var(--w-came) 84px;
  --reg-cols-narrow:9px minmax(0,1fr) minmax(0,1.2fr) var(--w-30d) var(--w-all);
}

/* The header. Every number under it used to be labelled in the row itself, by
   a two-letter abbreviation -- al, sub, came -- which is a label only for
   somebody who already knew. Saying it once in words, at the top, costs less
   width than saying it cryptically on all 816 rows. */
.reghead{
  display:grid;grid-template-columns:var(--cols);gap:var(--s-3);align-items:center;
  position:sticky;top:var(--top-h);z-index:12;
  padding:7px var(--s-3) 7px calc(var(--s-3) + 3px);
  background:var(--surface-2);border-bottom:1px solid var(--line);
}
.reghead .hc{
  font:600 var(--t-10)/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;
  color:var(--ink-4);white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;
}
.reghead .hc.r{text-align:right}
a.hc{color:var(--ink-4)}
a.hc:hover{color:var(--ink-2)}
/* The column the list is actually ordered by. */
a.hc.on{color:var(--ink)}
.sortmark{
  display:inline-block;width:0;height:0;margin-left:4px;vertical-align:middle;
  border-left:3px solid transparent;border-right:3px solid transparent;
  border-top:4px solid currentColor;
}

.stackrec{border-bottom:1px solid var(--line);background:var(--surface)}
.stackrec:last-child{border-bottom:0}
.stackrec > summary{
  display:grid;grid-template-columns:var(--cols);
  gap:var(--s-3);align-items:center;padding:9px var(--s-3);cursor:pointer;
  list-style:none;border-left:3px solid var(--cat,var(--ink-4));
}
.stackrec > summary::-webkit-details-marker{display:none}
.stackrec > summary:hover{background:var(--surface-2)}
.stackrec[open] > summary{background:var(--surface-2)}
.stackrec .dotc{width:7px;height:7px;border-radius:2px;background:var(--cat,var(--ink-4))}
.stackrec .nm{display:flex;align-items:baseline;gap:8px;min-width:0}
.stackrec .nm b{font-weight:600;font-size:var(--t-13);color:var(--ink);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stackrec .nm .sl{font:400 var(--t-11)/1 var(--mono);color:var(--ink-4);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* What this is a part of: "Languages > Python" beside the name. The tree is
   the point of a taxonomy and it used to be visible only after a click. */
.stackrec .lin{
  display:flex;align-items:center;gap:4px;min-width:0;
  font-size:var(--t-11);color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.stackrec .lin a{color:var(--ink-3)}
.stackrec .lin a:hover{color:var(--link)}
.stackrec .lin .sep{color:var(--ink-4);margin:0 1px}
.stackrec .catcell,.stackrec .actcell{display:flex;align-items:center;min-width:0}
.stackrec .catcell .catlabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.stackrec .pth{font-size:var(--t-11);color:var(--ink-3);min-width:0;
  display:flex;align-items:baseline;gap:6px;overflow:hidden;white-space:nowrap}

/* The address: this registry's reason to exist, so it reads as a link and not
   as another grey column of metadata. */
.addr{
  font:500 var(--t-12)/1.3 var(--mono);color:var(--link);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;
}
.addr:hover{text-decoration:underline}
.addr.bad{color:var(--critical);text-decoration:line-through;text-decoration-thickness:1px}
.addr.muted{color:var(--ink-3)}
.addr.none{color:var(--ink-4);font-family:var(--sans)}
.moved{font:400 var(--t-10)/1 var(--mono);color:var(--ink-4);flex:none}
.lstate{
  flex:none;font:600 var(--t-9)/1 var(--sans);letter-spacing:.04em;text-transform:uppercase;
  padding:2px 4px;border-radius:3px;border:1px solid var(--line);color:var(--ink-4);
}
.lstate.bad{color:var(--critical);border-color:color-mix(in srgb,var(--critical) 34%,transparent)}
/* nowrap is the belt to the calc's braces: if a value ever outgrows the width
   budgeted above it now nudges its neighbour by a pixel or two instead of
   folding onto a second line and dragging the row's height with it. */
.stackrec .mini,.stackrec .num{
  text-align:right;white-space:nowrap;
  font:500 var(--t-12)/1 var(--mono);color:var(--ink-2);font-variant-numeric:tabular-nums}
.stackrec .mini{color:var(--ink-3)}
.stackrec .lnk{display:flex;gap:6px;justify-content:flex-end;align-items:center;
  font-size:var(--t-12);flex-wrap:wrap}
.stackrec .lnk a{display:inline-flex;align-items:center;min-height:28px;padding:0 9px;
  border:1px solid transparent;border-radius:var(--r-1);
  color:var(--ink-3);font-weight:500;white-space:nowrap}
.stackrec .lnk a:last-child{color:var(--ink-2);border-color:var(--line)}
.stackrec .lnk a:hover{color:var(--link);border-color:var(--link);background:var(--surface-2)}
.stackrec .lnk a:focus-visible{outline:2px solid var(--link);outline-offset:2px}
@media(max-width:1120px){
  /* Narrow: keep the name, the address and the two story counts. Taxonomy,
     aliases and links are what the expanded record is for.

     Which columns survive is decided once, in COLUMNS: everything not marked
     as surviving renders with an nw class, on the header cell and the row cell
     alike, and both disappear here. The template used to name the hidden
     classes itself and declare four columns while five cells survived, so the
     last count dropped onto a second grid row -- a cell count and a column
     count are one fact, and it was written twice.

     The switch moved from 1080px to 1180px at the same time. The counters
     honestly need the width their own names take, and that comes out of the
     name column; below about 1180 the wide layout had been ellipsing names to
     a couple of characters to keep columns nobody can read at that width. */
  .stacklist.reg{--cols:var(--reg-cols-narrow)}
  .stackrec .nw,.reghead .nw{display:none}
}

dl.rec{
  margin:0;padding:var(--s-3) var(--s-3) var(--s-4) calc(var(--s-3) + 19px);
  display:grid;grid-template-columns:112px minmax(0,1fr);gap:7px var(--s-3);
  border-top:1px solid var(--line);background:var(--bg-sunken);
}
dl.rec dt{
  font:600 var(--t-10)/1.5 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-4);
}
dl.rec dd{margin:0;font-size:var(--t-12);line-height:1.6;color:var(--ink-2)}
dl.rec dd .sep{color:var(--ink-4);margin:0 2px}
dl.rec dd a{color:var(--link)}
dl.rec dd.reslist{display:flex;flex-direction:column;gap:3px}
a.res{
  display:inline-flex;align-items:baseline;gap:8px;padding:2px 0;
  font-size:var(--t-12);color:var(--link);
}
a.res:hover{text-decoration:underline}
a.res .by{font:400 var(--t-10)/1 var(--mono);color:var(--ink-4)}
a.res .by.warn{color:var(--warn)}
dl.rec dd.acts{display:flex;gap:6px;flex-wrap:wrap}
dl.rec dd.acts a{color:var(--ink-2)}
@media(max-width:720px){dl.rec{grid-template-columns:1fr;padding-left:var(--s-3)}}

.queue{display:flex;flex-direction:column;gap:2px}
.qrow{
  display:flex;align-items:center;gap:var(--s-3);padding:8px 0;
  border-bottom:1px solid var(--line);
}
.qrow:last-child{border-bottom:0}
.qname{display:flex;align-items:baseline;gap:8px;font-size:var(--t-13);font-weight:600;color:var(--ink)}
.qname .sl{font:400 var(--t-11)/1 var(--mono);color:var(--ink-4);font-weight:400}
.qev{margin-top:3px;font-size:var(--t-11);color:var(--ink-4);line-height:1.5}
.qev a{color:var(--link)}
.qacts{display:flex;gap:6px;margin-left:auto;flex:none}
.qacts .btn{height:26px;font-size:var(--t-11)}

/* ---------- settings ---------- */
.setgrid{border:1px solid var(--line);border-radius:var(--r-3);
  background:var(--surface);overflow:hidden;margin-bottom:var(--s-4)}
.setrow{
  display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:var(--s-4);
  padding:var(--s-3);border-bottom:1px solid var(--line);align-items:start;
}
.setrow:last-of-type{border-bottom:0}
.setrow .lab{font-size:var(--t-13);font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.setrow .hlp{margin:4px 0 0;font-size:var(--t-12);line-height:1.5;color:var(--ink-3);max-width:70ch}
.setrow .src{margin-top:5px;font:400 var(--t-11)/1.4 var(--mono);color:var(--ink-4);
  display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.setrow .ctl{display:flex;flex-direction:column;gap:6px;align-items:stretch}
.setrow input[type=text],.setrow input[type=number],.setrow select,.setrow textarea{
  width:100%;height:30px;padding:0 9px;font:inherit;font-size:var(--t-13);color:var(--ink);
  background:var(--bg);border:1px solid var(--line-strong);border-radius:var(--r-2);
}
.setrow textarea{height:auto;min-height:74px;padding:7px 9px;font:400 var(--t-12)/1.5 var(--mono);resize:vertical}
.setrow input:focus,.setrow select:focus,.setrow textarea:focus{
  outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.setrow .opts{display:flex;flex-direction:column;gap:2px;max-height:190px;overflow-y:auto}
/* The tracked-releases picker: a filter box over chips, above the textarea that
   actually posts. Bounded height, because three hundred names must not push the
   Save button off the page. */
.picker{display:flex;flex-direction:column;gap:6px}
.picker .pfilter{
  width:100%;height:28px;padding:0 9px;font:inherit;font-size:var(--t-12);color:var(--ink);
  background:var(--bg);border:1px solid var(--line-strong);border-radius:var(--r-2);
}
.picker .pfilter:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.picker .pchips{
  display:flex;flex-wrap:wrap;gap:4px;max-height:168px;overflow-y:auto;
  padding:6px;border:1px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);
}
.picker .pchip{
  border:1px solid var(--line);background:var(--surface);color:var(--ink-3);
  font:inherit;font-size:var(--t-11);padding:2px 7px;border-radius:var(--r-full);cursor:pointer;
}
.picker .pchip:hover{border-color:var(--line-strong);color:var(--ink)}
.picker .pchip.on{
  background:var(--brand-soft);color:var(--link);
  border-color:color-mix(in srgb,var(--brand) 40%,transparent);
}
.picker .pchip[hidden]{display:none}
@media(max-width:900px){.setrow{grid-template-columns:1fr}}
.origin{
  display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:var(--r-full);
  font:500 var(--t-9)/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;
  border:1px solid var(--line);background:var(--surface-2);color:var(--ink-4);
}
.origin.custom{background:var(--brand-soft);border-color:color-mix(in srgb,var(--brand) 40%,transparent);color:var(--link)}
.setrow .reset{
  align-self:flex-end;background:none;border:0;padding:0;cursor:pointer;
  font:inherit;font-size:var(--t-11);color:var(--ink-4);text-decoration:underline;
}
.setrow .reset:hover{color:var(--critical)}
/* A key that is not set is a gap worth seeing, not an error. */
.setrow.missing{box-shadow:inset 2px 0 0 color-mix(in srgb,var(--warn) 60%,transparent)}
.tagwarn{
  font:500 var(--t-9)/1 var(--mono);letter-spacing:.04em;color:var(--warn);
  border:1px solid color-mix(in srgb,var(--warn) 35%,transparent);
  background:color-mix(in srgb,var(--warn) 12%,transparent);padding:3px 6px;border-radius:var(--r-full);
}
.switch{display:inline-flex;align-items:center;gap:9px;cursor:pointer;font-size:var(--t-13);color:var(--ink-2)}
.switch input{appearance:none;width:36px;height:20px;border-radius:var(--r-full);flex:none;
  background:var(--surface-2);border:1px solid var(--line-strong);position:relative;cursor:pointer;
  transition:background .15s,border-color .15s}
.switch input::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;
  border-radius:50%;background:var(--ink-3);transition:transform .15s,background .15s}
.switch input:checked{background:var(--brand);border-color:var(--brand)}
.switch input:checked::after{transform:translateX(16px);background:var(--brand-ink)}
.savebar{
  position:sticky;bottom:0;z-index:20;display:flex;align-items:center;gap:var(--s-3);
  margin-top:var(--s-3);padding:var(--s-3);border:1px solid var(--line);border-radius:var(--r-3);
  background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(8px);
}
.savebar .msg{font-size:var(--t-12);color:var(--ink-3)}
.flash{
  display:flex;align-items:center;gap:9px;padding:10px var(--s-3);margin:var(--s-3) 0;
  border-radius:var(--r-2);font-size:var(--t-13);
  background:color-mix(in srgb,var(--ok) 12%,transparent);
  border:1px solid color-mix(in srgb,var(--ok) 32%,transparent);color:var(--ink);
}

/* ---------- search ---------- */
mark{
  background:color-mix(in srgb,var(--brand) 26%,transparent);
  color:var(--ink);border-radius:2px;padding:0 1px;
}
ul.reasons{margin:var(--s-2) 0 0;padding-left:18px;max-width:78ch}
ul.reasons li{margin:0 0 8px;font-size:var(--t-13);line-height:1.6;color:var(--ink-3)}
ul.reasons strong{color:var(--ink-2)}
ul.reasons a{color:var(--link)}

/* ---------- reading modal ---------- */
/* The one action in a metadata line that DOES something rather than navigating,
   so it is the one thing there that looks like a button. It sat on --surface-2
   with a --line border, which against a row that is already --surface made it
   indistinguishable from the text beside it. */
.readbtn{
  display:inline-flex;align-items:center;gap:5px;height:21px;padding:0 9px;
  border-radius:var(--r-1);font:600 var(--t-10)/1 var(--mono);letter-spacing:.02em;
  color:var(--link);background:var(--brand-soft);
  border:1px solid color-mix(in srgb,var(--brand) 38%,transparent);
  cursor:pointer;transition:background .12s,border-color .12s,color .12s;
}
.readbtn:hover{background:var(--brand);border-color:var(--brand);color:var(--brand-ink)}
.readbtn:active{transform:translateY(1px)}
.readbtn .ico{width:12px;height:12px;opacity:1}

/* The neutral buttons gain a surface of their own for the same reason: a border
   alone disappears on a card that already has one. */
.btn{background:var(--surface-2)}
.btn:hover{background:var(--raised);border-color:var(--line-strong)}
.qacts .btn:not(.primary){background:var(--surface-2)}

/* ---------- the briefing ----------
   What replaced the movement report, and the CSS says why. There are no verdict
   badges here because there are no verdicts: the old page coloured a technology
   green for "surging" on a ratio of story counts, and story counts measure the
   feed list rather than the industry. A colour is a very confident way to say a
   thing, and that one was confident about the wrong quantity.

   So this is typography and citation, greyscale throughout. The only emphasis
   left is on provenance -- whether a source speaks for the subject it describes
   -- because that is the distinction a reader genuinely cannot recover for
   themselves. */
.mv-body{margin:0 0 var(--s-3);font:400 var(--t-14)/1.7 var(--serif);color:var(--ink-2);max-width:74ch}
.mv-lede{margin:0 0 var(--s-4);font:400 var(--t-15)/1.6 var(--serif);color:var(--ink-2);
  max-width:74ch}
.mv-list{margin:0 0 var(--s-4);padding-left:var(--s-4)}
.mv-list li{margin:0 0 var(--s-2);font-size:var(--t-13);line-height:1.6;max-width:80ch}
h2.sect{margin:var(--s-6) 0 var(--s-3);padding-bottom:var(--s-2);
  border-bottom:1px solid var(--line);font:600 var(--t-17)/1.2 var(--serif);color:var(--ink)}

/* THE READING. These four classes were used by the strategy section and never
   defined, which is why it rendered as a wall of unstyled headings with the
   citation links running into each other. The section is the reason the page
   exists, so it gets the strongest structure on it. */

/* One finding: a claim, the argument for it, its evidence. The left rule makes
   the boundary between findings visible without a horizontal line for each,
   which at four or five findings turns the page into a ladder. */
.mv-find{margin:0 0 var(--s-5);padding-left:var(--s-4);
  border-left:2px solid var(--line)}
.mv-find h3{margin:0 0 var(--s-2);font:600 var(--t-15)/1.35 var(--sans);
  color:var(--ink);max-width:68ch}
.mv-find p{margin:0 0 var(--s-2);font:400 var(--t-14)/1.7 var(--serif);
  color:var(--ink-2);max-width:74ch}
.mv-find .note{font:400 var(--t-12)/1.6 var(--sans);color:var(--ink-4);max-width:74ch}
.mv-find .note b{color:var(--ink-3);font-weight:600}

/* Citations as chips on one line rather than as a paragraph of links. Anything
   longer wraps; the point is that the evidence reads as a row of sources
   attached to the claim, not as prose. */
.mv-cites{display:flex;flex-wrap:wrap;gap:var(--s-2);margin:var(--s-2) 0 0}
.mv-cites a{display:inline-block;max-width:34ch;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;
  padding:2px var(--s-2);border:1px solid var(--line);border-radius:3px;
  font:500 var(--t-11)/1.5 var(--sans);color:var(--ink-3);text-decoration:none}
.mv-cites a:hover{border-color:var(--ink-4);color:var(--ink)}
/* First-party: the source speaking for the thing it describes. Same rule as
   .bf-fp, and the only colour on the page. */
.mv-cites a.fp{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,var(--line))}

/* NAMES THIS ARCHIVE HAD NEVER SEEN. A name, what corroborates it, and the
   headlines it came out of -- nested, because the headline is the evidence for
   the name and putting it anywhere else would separate a claim from its proof. */
.mv-new-names{list-style:none;margin:0 0 var(--s-5);padding:0}
.mv-new-names>li{padding:var(--s-3) 0;border-bottom:1px solid var(--line)}
.mv-new-names>li>a{font:600 var(--t-15)/1.4 var(--sans);color:var(--ink);
  text-decoration:none}
.mv-new-names>li>a:hover{text-decoration:underline}
.mv-new-names>li>.muted{display:inline-block;margin-left:var(--s-2);
  font:400 var(--t-11)/1.6 var(--sans);color:var(--ink-4)}
.mv-new-names .mv-elsewhere{margin:var(--s-2) 0 0;padding-left:var(--s-4)}
.mv-new-names .mv-elsewhere li{border-bottom:0;padding:2px 0}

/* THE REPORT AS AN INDEX. One card per finding: the claim, one line of why,
   and a way in. Asked for on 2026-09-09 -- "the report have to simple with core
   content and when user click each content, show detail page" -- against a
   field report that had grown to 41KB of prose. A whole card is the link, so
   the target is the size of the thought rather than the size of a heading. */
.mv-items{display:grid;gap:var(--s-3);margin:0 0 var(--s-5)}
.mv-item{display:block;padding:var(--s-4);border:1px solid var(--line);border-radius:4px;
  text-decoration:none;color:inherit;background:var(--bg-2,transparent);
  transition:border-color .12s ease}
.mv-item:hover{border-color:var(--ink-3,var(--ink-4))}
.mv-item h3{margin:0 0 var(--s-2);font:600 var(--t-15)/1.35 var(--sans);color:var(--ink);
  max-width:70ch}
.mv-item p{margin:0;font:400 var(--t-14)/1.65 var(--serif);color:var(--ink-2);max-width:74ch}
.mv-item .mv-more{display:inline-block;margin-top:var(--s-3);
  font:600 var(--t-11)/1.6 var(--sans);letter-spacing:.04em;text-transform:uppercase;
  color:var(--ink-4)}
.mv-item:hover .mv-more{color:var(--ink-2)}
/* The lead card carries the one sentence the whole page exists to deliver. */
.mv-lead{border-left:3px solid var(--ink)}
.mv-tag{display:inline-block;margin-left:var(--s-2);padding:1px 6px;border-radius:3px;
  font:600 var(--t-11)/1.7 var(--sans);letter-spacing:.03em;text-transform:uppercase;
  border:1px solid var(--line);color:var(--ink-4);vertical-align:middle;white-space:nowrap}
.mv-tag.now{color:var(--good,#1a7f37);border-color:currentColor}
.mv-tag.months{color:var(--ink-2)}
.mv-tag.watch{color:var(--ink-4)}

/* A detail page: the claim, then the facts that qualify it, as a definition
   list rather than as more prose. */
.mv-facts{display:grid;grid-template-columns:auto 1fr;gap:var(--s-2) var(--s-4);
  margin:var(--s-4) 0;max-width:74ch}
.mv-facts dt{font:600 var(--t-11)/1.7 var(--sans);letter-spacing:.04em;
  text-transform:uppercase;color:var(--ink-4)}
.mv-facts dd{margin:0;font:400 var(--t-14)/1.65 var(--sans);color:var(--ink-2)}

/* WHAT THE PUBLIC NUMBERS DID. The only quantities on a field report that come
   with no story attached, so they are set as a table rather than as prose -- a
   number in a sentence reads as an assertion, and a number in a row with its
   date and its registry beside it reads as a measurement somebody can go and
   repeat. */
.mv-curve{width:100%;border-collapse:collapse;margin:0 0 var(--s-5);
  font:400 var(--t-13)/1.5 var(--sans)}
.mv-curve th{text-align:left;padding:0 var(--s-3) var(--s-2) 0;
  font:600 var(--t-11)/1.6 var(--sans);letter-spacing:.05em;text-transform:uppercase;
  color:var(--ink-4);border-bottom:1px solid var(--line)}
.mv-curve td{padding:var(--s-2) var(--s-3) var(--s-2) 0;border-bottom:1px solid var(--line);
  vertical-align:baseline;color:var(--ink-2)}
.mv-curve td:first-child{color:var(--ink);font-weight:500}
.mv-curve .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.mv-curve .muted{display:block;font:400 var(--t-11)/1.5 var(--sans);color:var(--ink-4)}
.mv-curve .up{color:var(--good,#1a7f37);font-weight:600}
.mv-curve .down{color:var(--bad,#b3261e);font-weight:600}

/* A four-column table of magnitudes does not fit a phone. It scrolls inside its
   own box rather than widening the page: a body that scrolls sideways moves
   every paragraph on it, and the reader loses the column they were reading. */
.mv-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 0 var(--s-5)}
.mv-scroll .mv-curve{margin:0}

/* COVERAGE WE DO NOT HOLD. A list of headlines and dates, deliberately not
   styled like a finding: there is no body behind any of these and nothing here
   was summarised. */
.mv-elsewhere{list-style:none;margin:0 0 var(--s-5);padding:0}
.mv-elsewhere li{padding:var(--s-2) 0;border-bottom:1px solid var(--line)}
.mv-elsewhere a{color:var(--ink);text-decoration:none;font:400 var(--t-14)/1.5 var(--sans)}
.mv-elsewhere a:hover{text-decoration:underline}
.mv-elsewhere .muted{display:block;font:400 var(--t-11)/1.6 var(--sans);color:var(--ink-4)}

/* WHAT HAS CHANGED. The first thing on a field report and the reason the page
   exists: the field then, the field now, side by side so the comparison is a
   comparison rather than a paragraph claiming to be one. Reported on
   2026-09-09 as "I still can't find the market change" -- it was findable only
   by reading three claims and trusting each one's summary of a past the page
   never showed. */
.mv-shift{margin:0 0 var(--s-6);padding:var(--s-4) 0 0;border-top:2px solid var(--ink)}
.mv-moved{margin:0 0 var(--s-4);font:500 var(--t-17)/1.5 var(--serif);color:var(--ink);
  max-width:70ch}
.mv-then-now{display:grid;grid-template-columns:1fr 1fr;gap:var(--s-4)}
.mv-then-now>div{padding:var(--s-3);border:1px solid var(--line);border-radius:4px;
  min-width:0}
/* The earlier column reads as background and the later one as the point, so the
   eye lands on "now" without either being hidden. */
.mv-then-now>div:first-child{background:var(--bg-2,transparent);border-style:dashed}
.mv-then-now h3{margin:0 0 var(--s-2);font:600 var(--t-11)/1.6 var(--sans);
  letter-spacing:.06em;text-transform:uppercase;color:var(--ink-4)}
.mv-then-now p{margin:0 0 var(--s-3);font:400 var(--t-14)/1.7 var(--serif);
  color:var(--ink-2)}
@media(max-width:720px){.mv-then-now{grid-template-columns:1fr}}

/* WHERE THE WORK IS. The section a reader is here for, so it is the one block
   that does not look like the rest of the page. */
.mv-op{margin:0 0 var(--s-4);padding:var(--s-4);border:1px solid var(--line);
  border-radius:4px;background:var(--bg-2,transparent)}
.mv-op h3{margin:0 0 var(--s-2);font:600 var(--t-15)/1.35 var(--sans);color:var(--ink);
  max-width:68ch}
.mv-op p{margin:0 0 var(--s-2);font:400 var(--t-14)/1.7 var(--serif);color:var(--ink-2);
  max-width:74ch}
.mv-op dl{display:grid;grid-template-columns:auto 1fr;gap:2px var(--s-3);margin:var(--s-3) 0 0}
.mv-op dt{font:600 var(--t-11)/1.6 var(--sans);letter-spacing:.04em;
  text-transform:uppercase;color:var(--ink-4)}
.mv-op dd{margin:0;font:400 var(--t-13)/1.6 var(--sans);color:var(--ink-2)}
@media (max-width:560px){.mv-op dl{grid-template-columns:1fr;gap:0}
  .mv-op dt{margin-top:var(--s-2)}}

/* The caveats, gathered into one block instead of sprinkled between sections.
   Scattered notes read as hedging; one honest block reads as a limit. */
.mv-caveat{margin:var(--s-5) 0 0;padding:var(--s-3) var(--s-4);
  border-left:2px solid var(--line);background:transparent}
.mv-caveat p{margin:0 0 var(--s-2);font:400 var(--t-12)/1.65 var(--sans);color:var(--ink-4);
  max-width:78ch}
.mv-caveat p:last-child{margin-bottom:0}
.mv-caveat b{color:var(--ink-3);font-weight:600}


/* A field, as one block a reader can take in before deciding to open it. */
.bf-field{margin:0 0 var(--s-6);padding-left:var(--s-4);border-left:2px solid var(--line)}
.bf-h{margin:0 0 var(--s-2);display:flex;align-items:center;gap:var(--s-2);
  font:600 var(--t-12)/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;
  color:var(--ink-4)}
.bf-h a{color:inherit;text-decoration:none}
.bf-h a:hover{color:var(--ink-2)}
.bf-head{margin:0 0 var(--s-2);font:600 var(--t-17)/1.3 var(--serif);color:var(--ink);
  max-width:70ch}

/* A finding and its sources are one unit, and the border says so. Indented
   under the field rather than sitting beside it: the nesting is the argument
   -- field, then finding, then the stories the finding came from. */
.bf-theme{margin:0 0 var(--s-4)}
.bf-theme h4{margin:0 0 var(--s-2);font:600 var(--t-14)/1.35 var(--sans);color:var(--ink);
  max-width:70ch}

/* CITATIONS ARE OPEN BY DEFAULT WHEN THERE ARE FEW.
   A claim whose evidence is one click away is a claim most people will never
   check, and the whole design of this page is that checking is easy. Collapsed
   only past three, where the list starts to push the next finding off screen. */
.bf-ev{margin:var(--s-2) 0 0}
.bf-ev>summary{cursor:pointer;font:500 var(--t-11)/1 var(--sans);color:var(--ink-4);
  letter-spacing:.02em;padding:2px 0}
.bf-ev>summary:hover{color:var(--ink-2)}
.bf-ev[open]>summary{margin-bottom:var(--s-2)}
.bf-cites{margin:0;padding-left:var(--s-4);list-style:disc}
.bf-cites li{margin:0 0 var(--s-2);font-size:var(--t-13);line-height:1.5}
.bf-cites li .muted{display:block;font-size:var(--t-11);margin-top:1px}

/* The one thing on the page worth a colour. "First-party" means the source is
   the subject describing itself: authoritative about what shipped, worthless as
   evidence that anyone wanted it. A reader cannot infer that from a domain
   name, so it is marked. */
.bf-fp{color:var(--warn);font-weight:600}

.bf-more{margin:0 0 var(--s-3)}
.bf-more>summary{cursor:pointer;font:500 var(--t-12)/1 var(--sans);color:var(--ink-3);
  padding:var(--s-2) 0}
.bf-more>summary:hover{color:var(--ink)}
.bf-more[open]>summary{margin-bottom:var(--s-3)}

.bf-gap{max-width:78ch}

/* Public figures, set in the mono face because they are the only numbers here
   and they came from somewhere else. */
.bf-figs{margin:0 0 var(--s-4);padding-left:var(--s-4);list-style:none}
.bf-figs li{margin:0 0 var(--s-2);font-size:var(--t-13);line-height:1.5}
.bf-figs li .muted{display:block;font:400 var(--t-11)/1.5 var(--mono);color:var(--ink-4)}

/* ---------- the listings ----------
   Every report is kept, and both ways of reaching one are lists of the same
   shape: a label on the left, what the briefing FOUND on the right. A day and a
   field are different axes onto the same grid, so they get the same row rather
   than two designs a reader has to learn separately.

   The headline is the point of the row. An earlier version led with counts --
   how many stories a field produced that week -- which is a number about the
   feed list and not an answer to any question a reader has. */
.bf-days{margin:0 0 var(--s-4);padding:0;list-style:none}
.bf-days li{padding:var(--s-2) 0;border-bottom:1px solid var(--line)}
.bf-days li:last-child{border-bottom:0}
.bf-days a{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--s-1) var(--s-3);
  text-decoration:none}
.bf-when{flex:0 0 auto;min-width:11ch;display:inline-flex;align-items:center;gap:6px;
  font:600 var(--t-11)/1.4 var(--mono);letter-spacing:.02em;color:var(--ink-4)}
.bf-days a:hover .bf-when{color:var(--ink-2)}
.bf-what{flex:1 1 22ch;font:400 var(--t-13)/1.45 var(--serif);color:var(--ink)}
.bf-days a:hover .bf-what{text-decoration:underline;text-underline-offset:2px}
.bf-days li>.muted{display:block;margin-top:2px;padding-left:calc(11ch + var(--s-3));
  font-size:var(--t-11)}

/* One day in the index. Same left border as a field block: both are "a report
   about something", one indexed by date and one by subject. */
.bf-day{margin:0 0 var(--s-5);padding-left:var(--s-4);border-left:2px solid var(--line)}

/* Fourteen field links. A wrapped row rather than a grid of cards: the label is
   the whole content, so a card would be padding around one word. */
.bf-fields{display:flex;flex-wrap:wrap;gap:var(--s-2);margin:0 0 var(--s-5)}
.bf-fields .btn{gap:6px}

@media (max-width:560px){
  /* The date and the headline stop sharing a line before either has to hyphenate. */
  .bf-when{min-width:100%}
  .bf-days li>.muted{padding-left:0}
}

/* ---------- the reading page ----------
   A measured column and nothing beside it. The old modal capped the article at
   the height of a dialog and put a scrollbar inside a scrollbar; this is the
   one screen here that is meant to be read rather than scanned, so it gets the
   viewport and a line length chosen for prose instead of for data.

   The measure is in px on purpose. It was 74ch, and the ch unit resolves against the
   font of the element it is written on -- which here is the inherited 14px sans,
   not the serif of the prose inside. That made the column ~520px rather than the
   ~630px intended, and pinned it there at every window size. Fluid px says what
   it means, and the type scales with it so the line does not simply get longer:
   at the widest the column nearly doubles and the prose goes up to 19px with it. */
.reading{
  --measure:clamp(620px, 74vw, 1000px);
  max-width:min(100%, var(--measure));
  margin:0 auto;padding-bottom:var(--s-7);
}
/* "Back to where you were", as an affordance rather than a breadcrumb.
   The eyebrow trail (NEWS / STORY) says where you ARE. It is dim, uppercase and
   ten pixels tall, and it was the only way back off a story record -- which is
   a fair definition of not having one. This says what the click DOES, looks
   like something you press, and names the destination it is actually going to
   ("Back to News" vs "Back to the search results"). */
.backlink{margin:0 0 var(--s-4)}
.backlink a{
  display:inline-flex;align-items:center;gap:6px;
  padding:5px 10px 5px 8px;
  border:1px solid var(--line);border-radius:var(--r-1);background:var(--surface);
  font:500 var(--t-12)/1 var(--sans);color:var(--ink-3);
}
.backlink a:hover{
  color:var(--ink);border-color:var(--line-strong);background:var(--surface-2);
}
.backlink a svg{transition:transform .12s ease}
.backlink a:hover svg{transform:translateX(-2px)}
@media (prefers-reduced-motion:reduce){.backlink a svg{transition:none}}

.rd-head{padding-bottom:var(--s-4);border-bottom:1px solid var(--line);margin-bottom:var(--s-5)}
.rd-head h1{
  margin:0 0 var(--s-3);
  font:600 clamp(23px, 1.1vw + 17px, 34px)/1.2 var(--serif);
  letter-spacing:-.015em;color:var(--ink);
}
.rd-meta{
  margin:0 0 var(--s-4);font:400 var(--t-12)/1.6 var(--sans);color:var(--ink-3);
}
.rd-meta .sep{color:var(--ink-4);margin:0 2px}
.rd-acts{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:var(--s-3)}
.rd-acts .btn{display:inline-flex;align-items:center;gap:6px}
.rd-acts .btn.done{
  background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok);
  border-color:color-mix(in srgb,var(--ok) 45%,transparent);
}
.rd-src{margin:0;font:400 var(--t-11)/1.5 var(--mono);color:var(--ink-4);
  overflow-wrap:anywhere}
.rd-src a{color:var(--ink-4)}
.rd-src a:hover{color:var(--link)}

/* Serif, fluid, generous leading. The list is 13px sans because it is a table
   of contents; this is the article, and the two should not look like the same
   thing. Leading rises with the measure -- a long line is far easier to track
   back to the start of the next one when the lines are further apart. */
.rd-body{
  font:400 clamp(15.5px, 0.42vw + 12.6px, 19px)/1.8 var(--serif);
  color:var(--ink-2);
}
.rd-body > *:first-child{margin-top:0}
.rd-body p{margin:0 0 var(--s-4)}
.rd-body h2{
  margin:var(--s-6) 0 var(--s-3);
  font:600 clamp(17px, 0.5vw + 14px, 22px)/1.3 var(--sans);
  letter-spacing:-.01em;color:var(--ink);
}
.rd-body ul{margin:0 0 var(--s-4);padding-left:var(--s-5)}
.rd-body li{margin:0 0 var(--s-2);list-style:disc}
.rd-body blockquote{
  margin:0 0 var(--s-4);padding:2px 0 2px var(--s-4);
  border-left:2px solid var(--brand);color:var(--ink-3);font-style:italic;
}
.rd-body pre{
  margin:0 0 var(--s-4);padding:var(--s-3);overflow-x:auto;
  border-radius:var(--r-2);background:var(--bg-sunken);border:1px solid var(--line);
}
.rd-body pre code{font:400 var(--t-12)/1.6 var(--mono);color:var(--ink-2)}
.rd-body a{color:var(--link)}

/* A page that could not be read says so above the space where the text is not,
   rather than presenting an empty column as a result. */
.readnote{
  display:flex;gap:10px;align-items:flex-start;margin:0 0 var(--s-5);
  padding:var(--s-3) var(--s-4);border-radius:var(--r-2);
  background:var(--surface);border:1px solid var(--line);
}
.readnote svg{flex:none;margin-top:2px;color:var(--warn)}
.readnote p{margin:0;font:400 var(--t-13)/1.6 var(--sans);color:var(--ink-2)}
.readnote p.dim{margin-top:4px;color:var(--ink-4);font-size:var(--t-11)}
.readnote.bad{border-color:color-mix(in srgb,var(--critical) 35%,var(--line))}
.readnote.bad svg{color:var(--critical)}

.rd-foot{
  margin-top:var(--s-6);padding-top:var(--s-4);border-top:1px solid var(--line);
  font:400 var(--t-12)/1.6 var(--sans);color:var(--ink-4);
}
.rd-foot p{margin:0 0 6px}
.rd-foot a{color:var(--link)}

/* The reading page is the one view with nothing beside the text, so it is not
   held to the 1180px the data pages share. */
main:has(.reading) .wrap{max-width:1320px}
/* A very wide window is a reason to show MORE per row, not to stretch six
   columns across two feet of glass. The story list gets a ceiling well above
   the old one; the rail keeps its width because a wider menu is just a longer
   line to read. */
@media(min-width:2100px){.wrap{max-width:2000px;margin:0 auto}}

/* On a phone the column is the screen. Nothing to cap, and a none inside the
   min() above would be an invalid length, so the max-width is replaced outright
   rather than the measure being unset. */
@media(max-width:720px){
  .reading{max-width:100%}
}
`;

/**
 * Keyboard navigation (spec 6.8: j/k move, enter open, / search).
 *
 * A reading tool people keep open all day is navigated with the keyboard or it
 * is not really used. No dependency, no framework -- 30 lines against the DOM.
 */
export const KEYS_JS = `
(function(){
  var items = Array.prototype.slice.call(document.querySelectorAll('.item'));
  if (!items.length) return;
  var i = -1;
  function sel(n){
    if (i >= 0 && items[i]) items[i].classList.remove('sel');
    i = Math.max(0, Math.min(items.length - 1, n));
    items[i].classList.add('sel');
    items[i].scrollIntoView({block:'nearest', behavior:'smooth'});
  }
  document.addEventListener('keydown', function(e){
    var t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'j': case 'ArrowDown': e.preventDefault(); sel(i + 1); break;
      case 'k': case 'ArrowUp':   e.preventDefault(); sel(i - 1); break;
      case 'g': sel(0); break;
      case 'G': sel(items.length - 1); break;
      case 'Enter': {
        // The title is the story page now, so enter goes there in this tab
        // rather than throwing the reader into a new one.
        if (i < 0) return;
        var a = items[i].querySelector('h2 a');
        if (a) window.location.href = a.href;
        break;
      }
      case 'o': {
        // The original, externally. The row no longer carries a link to it --
        // the read button knows the URL, so that is where it comes from.
        if (i < 0) return;
        var btn = items[i].querySelector('a.readbtn[data-url]');
        var href = btn && btn.getAttribute('data-url');
        if (href) window.open(href, '_blank', 'noopener');
        break;
      }
      case '/': {
        e.preventDefault();
        var s = document.querySelector('.searchbox input');
        if (s) { s.focus(); s.select(); }
        break;
      }
      case 'Escape':
        if (i >= 0 && items[i]) items[i].classList.remove('sel');
        i = -1;
        break;
    }
  });
})();
`;

/**
 * The reading modal.
 *
 * Nothing is stored: the server fetches the page when asked, extracts the text,
 * and returns typed BLOCKS of plain text. So this renders with textContent and
 * never with innerHTML -- no markup from a third-party page is ever parsed by
 * the browser here, which is the only version of this feature that is safe by
 * construction rather than by sanitizer.
 */
export const READ_JS = `
(function(){
  // What is left of the reader after the modal became a page.
  //
  // The dialog owned the fetch, the chrome, the scroll trap and the focus ring;
  // /read/:id owns all of that now, server-rendered. Two things could not move
  // with it, because they belong to the page you leave rather than the one you
  // arrive at:
  //
  //   v   follow the selected row's read link
  //   o   open that row's original in a new tab
  //
  // and one belongs only to the reading page itself: copying the article.

  // ---- the reading page: copy text, copy link ----------------------------
  var payload = document.getElementById('rd-text');
  if (payload) {
    var data = {};
    try { data = JSON.parse(payload.textContent || '{}'); } catch (e) { data = {}; }

    document.addEventListener('click', function(e){
      var btn = e.target.closest ? e.target.closest('[data-copy]') : null;
      if (!btn) return;
      e.preventDefault();
      var what = btn.getAttribute('data-copy');
      var text = what === 'link' ? data.url : data.text;
      if (!text) return;
      var label = btn.innerHTML;
      copy(text).then(function(ok){
        btn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
        btn.classList.add('done');
        setTimeout(function(){
          btn.innerHTML = label;
          btn.classList.remove('done');
        }, 1600);
      });
    });
  }

  /**
   * Clipboard, with the old way as a fallback.
   *
   * navigator.clipboard needs a secure context. 127.0.0.1 counts as one, so it
   * works in development -- but the same page over plain http on a LAN address
   * would not, and silently doing nothing is the worst outcome for a button
   * whose whole job is invisible.
   */
  function copy(text){
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function(){ return true; },
        function(){ return legacy(text); });
    }
    return Promise.resolve(legacy(text));
  }

  function legacy(text){
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // ---- the list: v follows the read link --------------------------------
  document.addEventListener('keydown', function(e){
    var t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'v') return;
    var sel = document.querySelector('.item.sel a.readbtn')
           || document.querySelector('.item a.readbtn');
    if (sel) { e.preventDefault(); window.location.href = sel.href; }
  }, true);
})();
`;

/**
 * Search suggestions.
 *
 * The header used to carry a <datalist> of every slug in the vocabulary, which
 * was 230 options and became unusable the moment the vocabulary started
 * growing -- the browser sizes that popup itself, and at 230 entries it covers
 * the screen. This asks the server for eight, in a box whose height is ours.
 */
export const FAV_JS = `
(function(){
  // The star works with scripting off -- it is a form that posts and redirects
  // back to where you were standing. That round trip is correct and slightly
  // rude: it reloads a fifty-story river to change one glyph, and on the reading
  // page it re-fetches the article you were halfway through.
  //
  // So when scripting is on, the same form is submitted in the background and
  // the button is flipped in place. The server is the same endpoint doing the
  // same thing; only the navigation is skipped.
  document.addEventListener('submit', function(e){
    var form = e.target;
    if (!form || !form.classList || !form.classList.contains('fav')) return;
    e.preventDefault();

    var keepField = form.querySelector('input[name=keep]');
    var idField = form.querySelector('input[name=id]');
    if (!keepField || !idField) return;

    var keep = keepField.value === '1';
    var btn = form.querySelector('button');
    if (btn) btn.disabled = true;

    var payload = new URLSearchParams();
    payload.set('id', idField.value);
    payload.set('keep', keep ? '1' : '0');

    fetch('/api/favourite', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: payload.toString(),
    }).then(function(r){ return r.json(); }).then(function(data){
      // Trust the server's answer rather than assuming the flip landed: saving
      // a story retention has already taken comes back as 'none', and the star
      // should show that instead of lying about it.
      var state = data && data.state;
      var on = state === 'kept';
      form.classList.toggle('on', on);
      form.classList.toggle('off', state === 'released');
      keepField.value = on ? '0' : '1';
      if (btn) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.title = on ? 'Favourite — click to remove'
          : state === 'released' ? 'Removed — click to favourite again'
          : 'Add to favourites';
        var label = btn.querySelector('span');
        if (label) label.textContent = 'Favourite';
      }
      // On the favourites page itself the row's fate line is now wrong, and
      // there is no honest way to recompute the countdown here -- the grace
      // window is the server's to know. Reload just that page.
      if (location.pathname === '/favourites') location.reload();
    }).catch(function(){
      // The network failed, so nothing changed. Fall back to the plain form.
      form.submit();
    }).then(function(){ if (btn) btn.disabled = false; });
  });
})();
`;

export const LIVE_JS = `
(function(){
  // Live counts.
  //
  // Collection runs continuously, so every number in the rail is stale the
  // moment the page renders. That is not a cosmetic problem: a reader watching
  // a river whose counts never move cannot tell a working collector from a
  // stopped one, and the freshness badge in the corner is the only other clue.
  //
  // Polling, not server-sent events. The counts are already cached for five
  // seconds server-side, the payload is a few hundred bytes, and an SSE
  // connection per open tab is a lot of machinery to save one request every
  // fifteen seconds on a loopback server.
  var EVERY = 15000;
  var timer = null;

  function paint(data){
    if (!data || !data.counts) return;

    document.querySelectorAll('[data-count]').forEach(function(el){
      var key = el.getAttribute('data-count');
      var next = data.counts[key];
      if (next === undefined || next === null) return;
      var shown = Number(String(el.textContent).replace(/[^0-9]/g, ''));
      var value = Number(next);
      // A key that does not name a number must not paint one. counts.fields is
      // an array, and a rail row that claimed that key rendered "NaN" over a
      // correct server-side count every fifteen seconds. Leaving the markup
      // alone is always better than replacing it with nonsense.
      // (No backticks in this comment: it lives inside a template literal.)
      if (!isFinite(value)) return;
      if (shown === value) return;
      el.textContent = value.toLocaleString('en-US');
      // A number that changes without moving is a number nobody notices.
      el.classList.remove('bumped');
      void el.offsetWidth;
      el.classList.add('bumped');
    });

    var badge = document.querySelector('.topright .live');
    if (badge && data.badge) {
      var holder = document.createElement('div');
      holder.innerHTML = data.badge;
      var fresh = holder.firstElementChild;
      if (fresh) badge.replaceWith(fresh);
    }
  }

  // The counts in a News rail are counted UNDER THE CURRENT QUERY, so a global
  // endpoint cannot supply them -- which is why, before this, the only number
  // that moved on /news was "favourites". /api/rail re-renders this list's own
  // rail; the numbers are copied across by matching each row's href, so nothing
  // in the menu is replaced and no link loses its place.
  // Which pages have a query-scoped rail is decided in one place -- filters.ts
  // knows the streams -- and the server marks the body when it renders one.
  // Repeating the list of paths here is how the two quietly disagree.
  function isStream(){ return document.body.hasAttribute('data-live-rail'); }

  function paintRail(html){
    var rail = document.querySelector('.rail');
    if (!rail || !html) return;
    var holder = document.createElement('div');
    holder.innerHTML = html;
    holder.querySelectorAll('a[href]').forEach(function(fresh){
      var n = fresh.querySelector('.n');
      if (!n) return;
      // The href is the row's identity: it encodes exactly the filter the
      // count was taken under, so matching on it cannot pair up two rows that
      // mean different things.
      var here = rail.querySelector('a[href="' + fresh.getAttribute('href').replace(/"/g, '&quot;') + '"] .n');
      if (!here || here.textContent === n.textContent) return;
      here.textContent = n.textContent;
      here.classList.remove('bumped');
      void here.offsetWidth;
      here.classList.add('bumped');
    });
  }

  function tick(){
    // Nothing is gained by counting rows for a tab nobody is looking at, and a
    // laptop lid closed on twenty tabs should not keep a database busy.
    if (document.hidden) return;
    fetch('/api/counts', { headers: { accept: 'application/json' } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(paint)
      .catch(function(){ /* a blip; the next tick tries again */ });

    if (isStream()) {
      fetch('/api/rail?for=' + encodeURIComponent(location.pathname + location.search))
        .then(function(r){ return r.ok ? r.text() : null; })
        .then(paintRail)
        .catch(function(){ /* same: the next tick tries again */ });
    }
  }

  function start(){ if (!timer) timer = setInterval(tick, EVERY); }
  function stop(){ if (timer) { clearInterval(timer); timer = null; } }

  document.addEventListener('visibilitychange', function(){
    if (document.hidden) { stop(); } else { start(); tick(); }
  });

  start();
})();
`;

export const COMBO_JS = `
(function(){
  // Searchable selects.
  //
  // A native <select> type-ahead matches from the first character only, which
  // is useless for a list where the useful word is in the middle -- "Hacker
  // News" is not findable by typing "news", and the Source list is forty
  // outlets long. So each select is wrapped in a combobox: a text input that
  // filters, a listbox that shows what matched, and the original select kept in
  // the DOM as the thing that actually submits.
  //
  // Keeping the select is what makes this safe. With scripting off, or if this
  // file throws, the page is still a working form -- the select was never
  // replaced, only hidden, and it carries the value either way.

  function build(sel){
    if (sel.dataset.combo) return;
    // Two options is a toggle, not a search problem.
    if (sel.options.length < 6) return;
    sel.dataset.combo = '1';

    var wrap = document.createElement('div');
    wrap.className = 'combo';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'comboin';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-autocomplete', 'list');
    var label = sel.id ? document.querySelector('label[for=' + JSON.stringify(sel.id) + ']') : null;
    if (label) input.setAttribute('aria-label', label.textContent.trim());

    var list = document.createElement('div');
    list.className = 'combolist';
    list.setAttribute('role', 'listbox');
    list.hidden = true;

    wrap.appendChild(input);
    wrap.appendChild(list);

    var opts = Array.prototype.map.call(sel.options, function(o){
      return { value: o.value, label: o.text.trim() };
    });
    var active = -1;

    function current(){
      var o = sel.options[sel.selectedIndex];
      return o ? o.text.trim() : '';
    }
    input.value = current();

    function render(term){
      var q = term.trim().toLowerCase();
      // Substring, not prefix: the whole reason this exists.
      var hits = opts.filter(function(o){ return o.label.toLowerCase().indexOf(q) !== -1; });
      list.innerHTML = '';
      hits.slice(0, 60).forEach(function(o, i){
        var row = document.createElement('div');
        row.className = 'comboopt' + (o.value === sel.value ? ' on' : '') + (i === active ? ' hot' : '');
        row.setAttribute('role', 'option');
        row.textContent = o.label;
        row.addEventListener('mousedown', function(e){
          e.preventDefault();
          choose(o.value);
        });
        list.appendChild(row);
      });
      if (hits.length === 0) {
        var none = document.createElement('div');
        none.className = 'combonone';
        none.textContent = 'Nothing matches.';
        list.appendChild(none);
      }
      return hits;
    }

    function open(){
      active = -1;
      render('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function close(){
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.value = current();
    }
    function choose(value){
      sel.value = value;
      close();
      // The form listens to change, exactly as it did before this ran.
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }

    input.addEventListener('focus', function(){ input.select(); open(); });
    input.addEventListener('input', function(){ active = 0; render(input.value); list.hidden = false; });
    input.addEventListener('blur', function(){ setTimeout(close, 120); });
    input.addEventListener('keydown', function(e){
      var rows = list.querySelectorAll('.comboopt');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.hidden) { open(); return; }
        active += (e.key === 'ArrowDown' ? 1 : -1);
        if (active < 0) active = rows.length - 1;
        if (active >= rows.length) active = 0;
        rows.forEach(function(r, i){ r.classList.toggle('hot', i === active); });
        if (rows[active]) rows[active].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        // Only swallow Enter when a suggestion is highlighted; otherwise let
        // the form submit, which is what Enter means in a filter row.
        if (!list.hidden && rows[active]) {
          e.preventDefault();
          rows[active].dispatchEvent(new Event('mousedown'));
        }
      } else if (e.key === 'Escape') {
        close();
        input.blur();
      }
    });
  }

  function scan(){ document.querySelectorAll('.row select, .fform select').forEach(build); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else { scan(); }
})();
`;

export const SUGGEST_JS = `
(function(){
  var form = document.querySelector('.searchbox');
  if (!form) return;
  var input = form.querySelector('input[name=q]');
  var box = form.querySelector('.suggest');
  if (!input || !box) return;

  var items = [], cursor = -1, timer = null, controller = null, lastQuery = '';

  function close(){ box.hidden = true; cursor = -1; }

  function render(list){
    items = list;
    box.textContent = '';
    if (!list.length) { close(); return; }
    list.forEach(function(it, i){
      var a = document.createElement('a');
      a.className = 'sg';
      a.href = it.href;
      a.setAttribute('role','option');
      var nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = it.label;
      a.appendChild(nm);
      if (it.count) {
        var n = document.createElement('span');
        n.className = 'n';
        n.textContent = it.count;
        a.appendChild(n);
      }
      var kd = document.createElement('span');
      kd.className = 'kd';
      kd.textContent = it.kind;
      a.appendChild(kd);
      a.addEventListener('mouseenter', function(){ select(i); });
      box.appendChild(a);
    });
    box.hidden = false;
    cursor = -1;
  }

  function select(n){
    var kids = box.querySelectorAll('.sg');
    if (cursor >= 0 && kids[cursor]) kids[cursor].classList.remove('on');
    cursor = n;
    if (cursor >= 0 && kids[cursor]) {
      kids[cursor].classList.add('on');
      kids[cursor].scrollIntoView({block:'nearest'});
    }
  }

  function ask(){
    var q = input.value.trim();
    if (q.length < 2) { close(); return; }
    if (q === lastQuery) return;
    lastQuery = q;
    if (controller) controller.abort();
    controller = new AbortController();
    fetch('/api/suggest?q=' + encodeURIComponent(q), { signal: controller.signal })
      .then(function(r){ return r.json(); })
      .then(function(d){ render(d.items || []); })
      .catch(function(){ /* a dropped suggestion request is not worth reporting */ });
  }

  input.addEventListener('input', function(){
    clearTimeout(timer);
    timer = setTimeout(ask, 120);
  });
  input.addEventListener('focus', function(){ if (items.length) box.hidden = false; });
  document.addEventListener('click', function(e){
    if (!form.contains(e.target)) close();
  });

  input.addEventListener('keydown', function(e){
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); select(Math.min(items.length - 1, cursor + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(Math.max(-1, cursor - 1)); }
    else if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); window.location.href = items[cursor].href; }
    else if (e.key === 'Escape') { close(); }
  });
})();
`;

/**
 * Searching inside a facet list.
 *
 * The technology facet went from 28 options to 120 when the vocabulary grew,
 * and a 120-item scroll is not a filter -- it is a haystack. The options are
 * already in the page, so this narrows what is visible rather than asking the
 * server again.
 *
 * A ticked option is never hidden. Filtering away a selection you have made,
 * and then submitting the form, would silently drop it.
 */
/**
 * The tracked-releases picker on /settings.
 *
 * Three hundred names is too many to scroll and too few to need a server round
 * trip, so the filter is client-side over chips that are already on the page --
 * which is exactly the thing REGISTRY_JS refuses to do for the registry, and for
 * the opposite reason: here the whole list IS on the page, so filtering it
 * client-side answers the same question the server would.
 *
 * The textarea remains what the form posts. These handlers only edit its text,
 * so the setting still works with scripting off and still accepts a slug the
 * picker has never heard of.
 */
export const TRACK_JS = `
(function(){
  function lines(t){
    var out = [], parts = t.value.split(String.fromCharCode(10));
    for (var i = 0; i < parts.length; i++) {
      var v = parts[i].trim();
      if (v) out.push(v);
    }
    return out;
  }
  window.NT = window.NT || {};
  window.NT.trackToggle = function(btn){
    var ctl = btn.closest('.ctl');
    var box = ctl && ctl.querySelector('textarea');
    if (!box) return;
    var slug = btn.getAttribute('data-slug');
    var have = lines(box), next = [], found = false;
    for (var i = 0; i < have.length; i++) {
      if (have[i] === slug) { found = true; continue; }
      next.push(have[i]);
    }
    if (!found) next.push(slug);
    next.sort();
    box.value = next.join(String.fromCharCode(10));
    btn.classList.toggle('on', !found);
  };
  window.NT.trackFilter = function(input){
    var q = input.value.trim().toLowerCase();
    var chips = input.parentElement.querySelectorAll('.pchip');
    for (var i = 0; i < chips.length; i++) {
      var c = chips[i];
      c.hidden = q !== '' && c.getAttribute('data-slug').indexOf(q) < 0
        && c.textContent.toLowerCase().indexOf(q) < 0;
    }
  };
})();
`;

export const REGISTRY_JS = `
(function(){
  // Live filtering for the registry search.
  //
  // Typing used to do nothing until you pressed Search, which on a 1,361-entry
  // list is the moment the box stops feeling like a search box. This debounces
  // the input, re-runs the SAME server query the form would have run, and swaps
  // the result region in place.
  //
  // Deliberately not filtering the rows already on the page: only 100 of them
  // are rendered, so hiding client-side rows would silently search one page and
  // present it as the whole registry -- a wrong answer delivered faster.

  var form = document.querySelector('form.regsearch[data-live]');
  if (!form || !window.fetch || !window.DOMParser || !window.history) return;

  var box = form.querySelector('input[name=sq]');
  var list = document.getElementById('reglist');
  if (!box || !list) return;

  var clear = form.querySelector('.rs-clear');
  var base = form.getAttribute('data-live');
  var timer = null;
  var live = null;          // in-flight request, aborted when superseded
  var seq = 0;              // guards against an early reply landing last
  var settled = box.value;  // what the list on screen currently reflects

  // Which value each control omits from the URL when it is untouched, so a
  // default-everything search stays a clean /tools rather than /tools?seen=any.
  var DEFAULTS = { seen: 'any', origin: 'any', sort: 'activity' };

  function url(){
    // Built from the form itself, so Coverage, Origin, Sort and any hidden
    // facet inputs travel with the search exactly as they would on submit.
    var out = new URLSearchParams();
    new URLSearchParams(new FormData(form)).forEach(function(v, k){
      // Keyed by control, not by value. Testing the value alone dropped a
      // search for the word "any" -- a real entry, and a real thing to type.
      if (v === '') return;
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k) && v === DEFAULTS[k]) return;
      out.append(k, v);
    });
    var q = out.toString();
    return q ? base + '?' + q : base;
  }

  function swap(from, id){
    var next = from.getElementById(id);
    var here = document.getElementById(id);
    if (next && here) here.replaceWith(next);
  }

  function run(){
    var term = box.value;
    if (term === settled) return;
    var target = url();
    var mine = ++seq;

    if (live) live.abort();
    live = typeof AbortController === 'function' ? new AbortController() : null;
    list.setAttribute('data-busy', '1');

    fetch(target, {
      headers: { 'x-requested-with': 'fetch' },
      signal: live ? live.signal : undefined
    })
      .then(function(r){ return r.ok ? r.text() : Promise.reject(r.status); })
      .then(function(html){
        if (mine !== seq) return;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        swap(doc, 'reglist');
        swap(doc, 'regcount');
        swap(doc, 'regpills');
        list = document.getElementById('reglist') || list;
        settled = term;
        // The address bar has to keep up, or reload and share both lie.
        history.replaceState(null, '', target);
        if (clear) clear.hidden = !term;
      })
      .catch(function(err){
        // An abort is this function superseding itself, not a failure.
        if (err && err.name === 'AbortError') return;
        if (mine === seq) form.submit();
      })
      .then(function(){
        if (mine === seq && list) list.removeAttribute('data-busy');
      });
  }

  box.addEventListener('input', function(){
    if (clear) clear.hidden = !box.value;
    clearTimeout(timer);
    // Long enough that a typed word is one query rather than five, short
    // enough that the list has moved by the time you stop to look at it.
    timer = setTimeout(run, 200);
  });

  // Enter should feel instant rather than reloading the page.
  form.addEventListener('submit', function(e){
    e.preventDefault();
    clearTimeout(timer);
    run();
  });

  // Clearing keeps you on the page instead of navigating back to an unfiltered
  // one -- same result, without losing the scroll position or the caret.
  if (clear) {
    clear.addEventListener('click', function(e){
      e.preventDefault();
      box.value = '';
      clear.hidden = true;
      box.focus();
      clearTimeout(timer);
      run();
    });
  }

  // Coverage, Origin and Sort submit the form on change; with live search on,
  // they can update in place too.
  var selects = form.querySelectorAll('select');
  for (var i = 0; i < selects.length; i++) {
    selects[i].removeAttribute('onchange');
    selects[i].addEventListener('change', function(){
      settled = null;
      clearTimeout(timer);
      run();
    });
  }
})();
`;

export const FACET_JS = `
(function(){
  document.addEventListener('input', function(e){
    var box = e.target;
    if (!box.classList || !box.classList.contains('fsearch')) return;
    var group = box.closest('.fgroup');
    if (!group) return;

    var term = box.value.trim().toLowerCase();
    var opts = group.querySelectorAll('.fopt');
    var shown = 0;

    for (var i = 0; i < opts.length; i++) {
      var opt = opts[i];
      var input = opt.querySelector('input');
      var hay = opt.getAttribute('data-term') || opt.textContent.toLowerCase();
      var match = !term || hay.indexOf(term) !== -1 || (input && input.checked);
      opt.style.display = match ? '' : 'none';
      if (match) shown++;
    }

    var none = group.querySelector('.fnone');
    if (none) none.hidden = shown > 0;
  });

  // Enter inside a facet search must not submit the form: it would apply a
  // half-typed filter and close the panel.
  document.addEventListener('keydown', function(e){
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('fsearch')) {
      e.preventDefault();
    }
  });

  // Clicking away closes it. A panel this tall covering the stories underneath
  // is exactly the thing you want gone the moment you look elsewhere, and
  // hunting back up the page for the summary to click twice is not a dismissal.
  document.addEventListener('click', function(e){
    var open = document.querySelectorAll('details.refine[open]');
    for (var i = 0; i < open.length; i++) {
      if (!open[i].contains(e.target)) open[i].removeAttribute('open');
    }
  });

  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    var open = document.querySelectorAll('details.refine[open]');
    for (var i = 0; i < open.length; i++) open[i].removeAttribute('open');
  });
})();
`;
