import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DECK_THEMES } from './deck-theme.js';
import {
  COURT_BACKGROUND_SEEDS,
  COURT_PALETTES,
  COURT_RANKS,
  COURT_SOURCE,
  COURT_PAPER,
  COURT_SOURCE_INKS,
  courtArtHeight,
  courtHighlight,
  courtPaper,
  courtSeeds,
  courtCropRect,
  courtSourcePath,
  courtSourceSize,
  courtWipeRects,
  isCourtRank,
  prepareCourt,
  recolorCourt,
  snapCourtInk,
  withCourtViewBox,
} from './court.js';

const ART = join(import.meta.dirname, '..', '..', 'assets', 'cards', 'court');
const press = COURT_PALETTES.press;

describe('the five inks', () => {
  it('snaps each source color to itself', () => {
    for (const [role, hex] of Object.entries(COURT_SOURCE_INKS)) {
      expect(snapCourtInk(hex)).toBe(role);
    }
  });

  // The 19 strays are the whole reason snapping exists rather than a lookup.
  it('folds the Inkscape rounding strays in', () => {
    expect(snapCourtInk('#5456aa')).toBe('ink');
    expect(snapCourtInk('#000100')).toBe('black');
    expect(snapCourtInk('#ffff58')).toBe('gold');
    expect(snapCourtInk('#ff5655')).toBe('red');
    expect(snapCourtInk('#fffdff')).toBe('paper');
  });

  it('reads three-digit hex', () => {
    expect(snapCourtInk('#000')).toBe('black');
    expect(snapCourtInk('#fff')).toBe('paper');
  });
});

describe('recoloring', () => {
  const svg = '<path fill="#5555aa" stroke="#ff5555"/><path style="fill:#ffff55"/>';

  it('moves the three roles a theme owns', () => {
    const out = recolorCourt(svg, press);
    expect(out).toContain(press.ink);
    expect(out).toContain(press.red);
    expect(out).toContain(press.gold);
  });

  it('leaves black where it is, whatever else moves', () => {
    const out = recolorCourt('<path fill="#000000"/><path fill="#000000"/>', press);
    expect(out).toBe('<path fill="#000000"/><path fill="#000000"/>');
  });

  // A color named anywhere but a fill or a stroke is not part of the drawing.
  it('touches nothing outside a fill or a stroke', () => {
    const meta = '<dc:title>#5555aa</dc:title><path fill="#5555aa"/>';
    const out = recolorCourt(meta, press);
    expect(out).toContain('<dc:title>#5555aa</dc:title>');
    expect(out).toContain(`fill="${press.ink}"`);
  });

  it('carries the strays across with the color they belong to', () => {
    expect(recolorCourt('<path fill="#5456aa"/>', press)).toBe(`<path fill="${press.ink}"/>`);
  });
});

describe('paper', () => {
  // Normalised to the stock rather than left as the source drew it. The
  // source paints its background #ffffff and the card underneath is #fdfdfd,
  // a difference nobody can see and one the wipe did not share - it always
  // painted COURT_PAPER. Now all three agree.
  it('defaults to the stock the card is drawn on', () => {
    expect(courtPaper(press)).toBe(COURT_PAPER);
    expect(courtHighlight(press)).toBe(COURT_PAPER);
    expect(recolorCourt('<path fill="#ffffff"/>', press))
      .toBe(`<path fill="${COURT_PAPER}"/>`);
  });

  // Setting the stock does not rewrite the drawing's whites - it is the
  // background alone, and the background is decided on the canvas. What the
  // palette carries here is the target the flood aims at.
  it('moves when a palette gives it a stock', () => {
    const cream = { ...press, paper: '#f4ecd8' };
    expect(courtPaper(cream)).toBe('#f4ecd8');
    expect(recolorCourt('<path fill="#ffffff"/>', cream))
      .toBe(`<path fill="${COURT_PAPER}"/>`);
  });

  // Every white becomes the highlight here, the card background included.
  // Telling the background from a face needs to know what each one *touches*
  // - the background reaches the edge of the card and a face does not - and
  // that is a fact about pixels, so it happens on the canvas instead. See
  // partBackground in phaser/court-art.ts.
  it('sends every white to the highlight, background and all', () => {
    const dark = { ...press, paper: '#101014', highlight: '#f0d9bd' };
    const out = recolorCourt(
      '<rect fill="#ffffff"/><path fill="#ffffff"/><path fill="#ffffff"/>', dark,
    );
    expect(out).toBe(
      '<rect fill="#f0d9bd"/><path fill="#f0d9bd"/><path fill="#f0d9bd"/>',
    );
  });

  it('defaults the highlight to the stock, so one color covers both', () => {
    const dark = { ...press, paper: '#101014' };
    expect(courtHighlight(dark)).toBe(COURT_PAPER);
    expect(recolorCourt('<rect fill="#ffffff"/>', dark))
      .toBe(`<rect fill="${COURT_PAPER}"/>`);
  });

  // The strays snap like every other role, or 42% of the art moves and the
  // few hundred antialiased near-whites stay behind as a pale fringe.
  // The strays snap like every other role, or a few hundred antialiased
  // near-whites stay behind as a pale fringe when the rest of the drawing
  // moves.
  it('carries the near-white strays with it', () => {
    const skin = { ...press, highlight: '#f0d9bd' };
    expect(recolorCourt('<path fill="#fffdff"/>', skin)).toBe('<path fill="#f0d9bd"/>');
    expect(recolorCourt('<path fill="#ffffff"/>', skin)).toBe('<path fill="#f0d9bd"/>');
  });

  it('leaves black alone, which is the mass the line work sits on', () => {
    const cream = { ...press, paper: '#f4ecd8' };
    expect(recolorCourt('<path fill="#000000"/>', cream)).toBe('<path fill="#000000"/>');
  });
});

describe('the viewBox the source is missing', () => {
  it('adds one sized to the source', () => {
    expect(withCourtViewBox('<svg width="360" height="540">'))
      .toContain(`viewBox="0 0 ${COURT_SOURCE.width} ${COURT_SOURCE.height}"`);
  });

  it('leaves a file that already has one alone', () => {
    const had = '<svg viewBox="0 0 1 1">';
    expect(withCourtViewBox(had)).toBe(had);
  });
});

describe('the window taken out of the source', () => {
  // The number that ties this port to the art it replaces: the baked WebP
  // courts are 480x403, and they were cut with these same fractions. A change
  // here that moves this has moved the crop.
  it('matches the baked art exactly at 480 wide', () => {
    expect(courtArtHeight(480)).toBe(403);
  });

  // Not exactly double: the ratio is 0.8406, so 480 rounds 403.5 down and
  // 960 rounds 806.9 up. Worth pinning, because a height that is out by one
  // is a row of paper along the bottom edge of a card meant to bleed.
  it('scales', () => {
    expect(courtArtHeight(240)).toBe(202);
    expect(courtArtHeight(960)).toBe(807);
  });

  it('renders the source big enough that the crop lands at full size', () => {
    const source = courtSourceSize(480);
    const crop = courtCropRect(source);
    expect(crop.width).toBe(480);
  });

  it('stops at the seam, because the bottom half is the same figure upside down', () => {
    const source = courtSourceSize(480);
    const crop = courtCropRect(source);
    expect(crop.y + crop.height).toBeLessThanOrEqual(Math.round(source.height / 2) + 1);
  });

  // The crop starts above the border rule so the crowns survive, which only
  // works if the wipe that removes the rule reaches further down than the
  // crop starts.
  it('wipes the border rule the crop reaches above', () => {
    const source = courtSourceSize(480);
    const [rule] = courtWipeRects(source);
    const crop = courtCropRect(source);
    expect(crop.y).toBeLessThan(rule.height);
  });

  it('wipes the source index inside the cropped window', () => {
    const source = courtSourceSize(480);
    const [, index] = courtWipeRects(source);
    const crop = courtCropRect(source);
    expect(index.x).toBeGreaterThanOrEqual(0);
    expect(index.y + index.height).toBeLessThan(crop.y + crop.height);
  });
});

describe('the background seeds', () => {
  // Two hand-placed points, which is two more than anybody wants. They are
  // only defensible while they name real cards and sit inside the picture -
  // a seed that misses lands on the figure and takes a face.
  it('names cards that exist', () => {
    for (const key of Object.keys(COURT_BACKGROUND_SEEDS)) {
      const [rank, suit] = key.split('-');
      expect(isCourtRank(rank), key).toBe(true);
      expect(['spades', 'hearts', 'diamonds', 'clubs'], key).toContain(suit);
    }
  });

  it('sits inside the art, away from its edges', () => {
    for (const [key, seeds] of Object.entries(COURT_BACKGROUND_SEEDS)) {
      for (const seed of seeds) {
        expect(seed.x, key).toBeGreaterThan(0.02);
        expect(seed.x, key).toBeLessThan(0.98);
        expect(seed.y, key).toBeGreaterThan(0.02);
        expect(seed.y, key).toBeLessThan(0.98);
      }
    }
  });

  it('gives nothing for a card that needs nothing', () => {
    expect(courtSeeds('K', 'spades')).toEqual([]);
    expect(courtSeeds('Q', 'hearts')).toEqual([]);
  });

  it('gives the recorded seeds for the two that do', () => {
    expect(courtSeeds('J', 'clubs')).toHaveLength(1);
    expect(courtSeeds('K', 'hearts')).toHaveLength(1);
  });
});

describe('the palettes', () => {
  it('covers every theme', () => {
    for (const theme of DECK_THEMES) {
      expect(COURT_PALETTES[theme], theme).toBeDefined();
    }
  });

  // The two gaps the bake script prints for a human to judge. Not judged here
  // - what reads badly at 60px is a matter of taste - but a palette whose ink
  // has crossed black or paper is a typo rather than a taste, and that is
  // what this catches.
  const luma = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it('lets a dark deck keep a light face', () => {
    for (const theme of DECK_THEMES) {
      const palette = COURT_PALETTES[theme];
      if (luma(palette.paper ?? '#ffffff') < 80) {
        expect(palette.highlight, theme).toBeDefined();
        expect(luma(palette.highlight!), theme).toBeGreaterThan(luma(palette.paper!));
      }
    }
  });

  it('keeps every ink between black and paper, with room either side', () => {
    for (const theme of DECK_THEMES) {
      const ink = luma(COURT_PALETTES[theme].ink);
      expect(ink, `${theme} ink vs black`).toBeGreaterThan(20);
      expect(ink, `${theme} ink vs paper`).toBeLessThan(200);
    }
  });
});

describe('the source files on disk', () => {
  const files = readdirSync(ART).filter((f: string) => f.endsWith('.svg'));

  it('has all twelve', () => {
    expect(files).toHaveLength(12);
    for (const rank of COURT_RANKS) {
      for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
        const path = courtSourcePath(rank, suit).replace('/cards/court/', '');
        expect(files, `${rank}${suit}`).toContain(path);
      }
    }
  });

  // The claim the whole palette rests on. If a file ever arrives drawn in a
  // sixth color, recoloring it silently does the wrong thing to part of the
  // drawing - so the assumption is checked against the art rather than
  // trusted.
  it('is drawn in five colors and nothing else', () => {
    const roles = new Set<string>();
    const distinct = new Set<string>();
    for (const file of files) {
      const svg = readFileSync(join(ART, file), 'utf8');
      for (const hex of svg.match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
        distinct.add(hex.toLowerCase());
        roles.add(snapCourtInk(hex));
      }
    }
    expect([...roles].sort()).toEqual(['black', 'gold', 'ink', 'paper', 'red']);
    // Five core plus the rounding strays, and nowhere near a sixth color.
    expect(distinct.size).toBeLessThanOrEqual(32);
  });

  it('has no viewBox of its own, which is why one gets added', () => {
    const svg = readFileSync(join(ART, 'king-spades.svg'), 'utf8');
    expect(svg).not.toContain('viewBox');
    expect(withCourtViewBox(svg)).toContain('viewBox');
  });

  it('comes out recolored, scalable and still valid', () => {
    const svg = readFileSync(join(ART, 'queen-hearts.svg'), 'utf8');
    const out = prepareCourt(svg, COURT_PALETTES.antique);
    expect(out).toContain('viewBox');
    expect(out).toContain(COURT_PALETTES.antique.ink);
    expect(out).not.toMatch(/fill="#5555aa"/);
    expect(out.startsWith('<?xml')).toBe(true);
  });
});

describe('the baked art', () => {
  const ART_DIR = join(import.meta.dirname, '..', '..', 'assets', 'cards', 'art');

  // The courts were 84 WebP files and 4.1MB of the package. They are rendered
  // now, and the only thing that would quietly bring them back is somebody
  // re-running the bake into this directory - at which point the package
  // ships both and nothing says which one a card is using.
  it('keeps backs only, because a back has no SVG to be rendered from', () => {
    for (const theme of DECK_THEMES) {
      const files = readdirSync(join(ART_DIR, theme));
      expect(files, theme).toEqual(['back.webp']);
    }
  });
});

describe('court ranks', () => {
  it('knows which ranks have a portrait', () => {
    expect(isCourtRank('K')).toBe(true);
    expect(isCourtRank('10')).toBe(false);
    expect(isCourtRank('A')).toBe(false);
  });
});

describe('the background every source opens with', () => {
  const files = readdirSync(ART).filter((f: string) => f.endsWith('.svg'));

  // recolorCourt tells the stock from the drawing by taking the first white
  // it meets, which is only right because all twelve open by painting a
  // full-card rounded rectangle. Eleven do it with a <rect> and the jack of
  // clubs with a <path> of the same shape - so the rule is "first", not "a
  // rect", and this is the check that the rule still holds.
  it('is the first thing painted, and it is white', () => {
    for (const file of files) {
      const svg = readFileSync(join(ART, file), 'utf8');
      const paint = /(?:fill|stroke)\s*[:=]\s*"?(#[0-9a-fA-F]{3,6})\b/.exec(svg);
      const drawable = /<(rect|path)\b/.exec(svg);
      expect(paint, file).not.toBeNull();
      expect(snapCourtInk(paint![1]), file).toBe('paper');
      expect(paint!.index, file).toBeGreaterThan(drawable!.index);
    }
  });

  it('is painted, which is what the flood needs it to be', () => {
    // If the background were left unpainted the flood would have nothing to
    // start from and the whole card would come back the highlight.
    const dark = { ...COURT_PALETTES.press, paper: '#101014', highlight: '#f0d9bd' };
    const out = recolorCourt(readFileSync(join(ART, 'king-spades.svg'), 'utf8'), dark);
    expect(out).not.toContain('#101014');
    expect(out.split('#f0d9bd').length - 1).toBeGreaterThan(5);
  });
});

// A real card is double-ended: one figure and the same figure upside down,
// meeting at the seam. The half crop is this package's own - one figure at
// twice the size for a face that has one index and the whole bottom of the
// card to give it - and everything below is about the other one.
describe('how much of the source a card takes', () => {
  const source = { width: 720, height: 1080 };

  it('stops at the seam for one figure and at the far margin for both', () => {
    const half = courtCropRect(source, 'half');
    const full = courtCropRect(source, 'full');
    expect(half.x).toBe(full.x);
    expect(half.width).toBe(full.width);
    expect(full.height).toBeGreaterThan(half.height * 1.85);
  });

  // The half crop keeps the page's blank margin above the figure - on the
  // mobile face that is card under the index and belongs there. In a ruled
  // panel the same strip is a gap between the picture and its frame, so the
  // full crop opens at the wipe instead, which is where the figure starts.
  it('leaves the blank margin out of the framed cut', () => {
    const half = courtCropRect(source, 'half');
    const full = courtCropRect(source, 'full');
    expect(half.y).toBeLessThan(COURT_SOURCE.ruleWipe * source.height);
    expect(full.y).toBeGreaterThanOrEqual(
      Math.round(COURT_SOURCE.ruleWipe * source.height));
    expect(full.y + full.height).toBeLessThanOrEqual(
      Math.round((1 - COURT_SOURCE.ruleWipe) * source.height));
  });

  it('cuts the full window symmetrically about the seam', () => {
    const full = courtCropRect(source, 'full');
    const top = full.y;
    const bottom = source.height - (full.y + full.height);
    expect(bottom).toBeCloseTo(top, 0);
  });

  it('defaults to the half, so nothing that was drawing courts changes', () => {
    expect(courtCropRect(source)).toEqual(courtCropRect(source, 'half'));
    expect(courtWipeRects(source)).toEqual(courtWipeRects(source, 'half'));
    expect(courtArtHeight(60)).toBe(courtArtHeight(60, 'half'));
  });

  // The source's second rule and second index are the first two turned half a
  // turn, which is why neither needed measuring again.
  it('paints out the far end\'s rule and index as well', () => {
    const half = courtWipeRects(source, 'half');
    const full = courtWipeRects(source, 'full');
    expect(half).toHaveLength(2);
    expect(full).toHaveLength(4);
    // Within a pixel: x and width are rounded independently, so a mirrored
    // rectangle can land a pixel off its twin. On a 720px page that is a
    // rounding artefact and not a misplaced wipe.
    full.slice(2).forEach((rect, i) => {
      const twin = half[i];
      expect(Math.abs(rect.width - twin.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(rect.height - twin.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(source.width - (rect.x + rect.width) - twin.x))
        .toBeLessThanOrEqual(1);
      expect(Math.abs(source.height - (rect.y + rect.height) - twin.y))
        .toBeLessThanOrEqual(1);
    });
  });

  it('is twice as tall for both figures as for one', () => {
    expect(courtArtHeight(100, 'full')).toBeGreaterThan(courtArtHeight(100, 'half') * 1.9);
  });

  // The whole point of the full cut: it has to come out the shape of a
  // printed court panel, or it cannot be laid into one.
  it('comes out at the proportions of a real court panel', () => {
    const aspect = 100 / courtArtHeight(100, 'full');
    expect(aspect).toBeGreaterThan(0.56);
    expect(aspect).toBeLessThan(0.64);
  });
});

// Recorded against the half crop, which is the top half of the full one - and
// a double-ended card has every walled-off patch twice, once each way up.
// Seeding only the first leaves the second the wrong colour on a dark deck.
describe('the background seeds on a double-ended card', () => {
  it('moves the y into the other window and adds the twin half a turn away', () => {
    const half = courtSeeds('K', 'hearts');
    const full = courtSeeds('K', 'hearts', 'full');
    expect(half).toHaveLength(1);
    expect(full).toHaveLength(2);
    expect(full[0].x).toBeCloseTo(half[0].x);
    expect(full[1].x).toBeCloseTo(1 - half[0].x);
    // Same place on the page, read against a window that starts lower and
    // runs further. Worked out here the long way round, on purpose: a factor
    // would have been right while the two windows shared a top edge and gone
    // quietly wrong when they stopped.
    const { top, seam, ruleWipe } = COURT_SOURCE;
    const onPage = top + half[0].y * (seam - top);
    const expected = (onPage - ruleWipe) / (1 - 2 * ruleWipe);
    expect(full[0].y).toBeCloseTo(expected, 5);
    expect(full[1].y).toBeCloseTo(1 - expected, 5);
  });

  it('leaves a half-cut seed exactly where it was recorded', () => {
    expect(courtSeeds('J', 'clubs', 'half')).toEqual(courtSeeds('J', 'clubs'));
  });

  it('still has nothing to say about the ten cards that need no seed', () => {
    expect(courtSeeds('Q', 'spades', 'full')).toHaveLength(0);
  });

  it('keeps every seed inside the art it is a fraction of', () => {
    for (const [name, seeds] of Object.entries(COURT_BACKGROUND_SEEDS)) {
      const [rank, suit] = name.split('-');
      void seeds;
      for (const seed of courtSeeds(rank, suit, 'full')) {
        expect(seed.x).toBeGreaterThan(0);
        expect(seed.x).toBeLessThan(1);
        expect(seed.y).toBeGreaterThan(0);
        expect(seed.y).toBeLessThan(1);
      }
    }
  });
});
