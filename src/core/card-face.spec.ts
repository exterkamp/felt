import { describe, expect, it } from 'vitest';
import {
  BASE_CARD_WIDTH, DEFAULT_FACE_STYLE, FACE_STYLES, cardFaceMetrics, courtArtRect,
  pipLayout, pipPlaces,
} from './card-face.js';
import { CARD_HEIGHT, CARD_WIDTH, Rank } from './cards.js';

describe('the card face', () => {
  const base = cardFaceMetrics();

  it('is the card the rest of the package measures in', () => {
    expect(base.width).toBe(CARD_WIDTH);
    expect(base.height).toBeCloseTo(CARD_HEIGHT);
    expect(BASE_CARD_WIDTH).toBe(CARD_WIDTH);
  });

  it('puts the index in the top-left, with its suit beside it on one line', () => {
    expect(base.index.x).toBeLessThan(0);
    expect(base.index.y).toBeLessThan(0);
    // Same line: the suit is placed against the rank's right edge, so they
    // share a y and only the sprite knows the measured text width.
    expect(base.index.suitSize).toBeGreaterThan(0);
    expect(base.index.gap).toBeGreaterThanOrEqual(0);
  });

  it('puts the big suit below the middle, where the index is not', () => {
    expect(base.pip.y).toBeGreaterThan(0);
    expect(base.pip.size).toBeGreaterThan(base.index.suitSize);
  });

  // The number a fanned pile's step is chosen against. If this drifts, every
  // fan in every game built on this package quietly starts hiding indexes.
  it('says how much of a card has to show for its index to be read', () => {
    expect(base.peek).toBeCloseTo(29.4);
    expect(base.peek).toBeLessThan(base.height / 2);
  });
});

describe('at other sizes', () => {
  it('scales every measurement with the width', () => {
    const big = cardFaceMetrics(120);
    const base = cardFaceMetrics(60);
    expect(big.height).toBeCloseTo(base.height * 2);
    expect(big.peek).toBeCloseTo(base.peek * 2);
    expect(big.index.fontSize).toBeCloseTo(base.index.fontSize * 2);
    expect(big.pip.size).toBeCloseTo(base.pip.size * 2);
    expect(big.radius).toBeCloseTo(base.radius * 2);
  });

  it('keeps poker proportions at every size', () => {
    for (const width of [24, 36, 60, 90, 160, 240]) {
      const m = cardFaceMetrics(width);
      expect(m.width / m.height).toBeCloseTo(5 / 7);
    }
  });

  it('keeps the index inside the card at every size', () => {
    for (const width of [24, 60, 240]) {
      const m = cardFaceMetrics(width);
      expect(m.index.x).toBeGreaterThan(-m.width / 2);
      expect(m.index.y - m.index.fontSize / 2).toBeGreaterThan(-m.height / 2);
    }
  });
});

describe('a court portrait', () => {
  it('runs the full width of the card, flush with the bottom', () => {
    const m = cardFaceMetrics(60);
    const rect = courtArtRect(m, { width: 480, height: 403 });
    expect(rect.width).toBe(60);
    expect(rect.height).toBeCloseTo(60 * 403 / 480);
    // Bottom edge of the art on the bottom edge of the card.
    expect(rect.y + rect.height / 2).toBeCloseTo(m.height / 2);
  });

  it('takes its shape from the art rather than naming one', () => {
    const m = cardFaceMetrics(60);
    const tall = courtArtRect(m, { width: 100, height: 200 });
    expect(tall.height).toBeCloseTo(120);
  });
});

describe('the three faces', () => {
  it('is a layout for every style named and no more', () => {
    for (const face of FACE_STYLES) {
      expect(cardFaceMetrics(60, face).face).toBe(face);
    }
    expect(cardFaceMetrics(60).face).toBe(DEFAULT_FACE_STYLE);
  });

  // The mobile face gave up the second index to pay for everything else being
  // bigger. That is the trade, and it is the whole difference between the
  // three - so it is worth pinning down rather than leaving to the drawing.
  it('prints one corner on the mobile face and two on the printed ones', () => {
    expect(cardFaceMetrics(60, 'mobile').corners).toBe(1);
    expect(cardFaceMetrics(60, 'standard').corners).toBe(2);
    expect(cardFaceMetrics(60, 'jumbo').corners).toBe(2);
  });

  it('counts pips on the printed faces and draws one big suit on the mobile one', () => {
    expect(cardFaceMetrics(60, 'mobile').pips).toBeUndefined();
    expect(cardFaceMetrics(60, 'standard').pips).toBeDefined();
    expect(cardFaceMetrics(60, 'jumbo').pips).toBeDefined();
  });

  it('puts the suit under the rank where a card is fanned, and beside it otherwise', () => {
    expect(cardFaceMetrics(60, 'mobile').index.stacked).toBe(false);
    expect(cardFaceMetrics(60, 'standard').index.stacked).toBe(true);
  });

  // Jumbo is the standard card with the corners at roughly 1.6x, which is
  // about what the real decks do - and the pips give way to pay for it.
  it('sizes jumbo between the other two', () => {
    const mobile = cardFaceMetrics(60, 'mobile').index.fontSize;
    const standard = cardFaceMetrics(60, 'standard').index.fontSize;
    const jumbo = cardFaceMetrics(60, 'jumbo').index.fontSize;
    expect(jumbo).toBeGreaterThan(standard);
    expect(jumbo).toBeLessThan(mobile);
    expect(cardFaceMetrics(60, 'jumbo').pips!.size)
      .toBeLessThan(cardFaceMetrics(60, 'standard').pips!.size);
  });

  // What a fanned pile's step is chosen against. A narrow corner is the point
  // of the printed faces, and it is worth the smaller index only if it
  // actually buys a tighter fan.
  it('needs less of a card showing than the mobile face does', () => {
    const mobile = cardFaceMetrics(60, 'mobile').peek;
    for (const face of ['standard', 'jumbo'] as const) {
      expect(cardFaceMetrics(60, face).peek).toBeLessThan(mobile);
    }
  });

  // The suit under the rank has to hold its own against it, and the two faces
  // that stack one have to agree about how much: a corner that gets the
  // proportion right on one and not the other reads as a shrunken pip rather
  // than as a different layout.
  //
  // The mobile face is left out on purpose. Its suit is on the rank's own
  // line rather than under it, so the same ratio means a different picture -
  // beside a glyph, a pip as tall as the font box would overpower it.
  it('sizes the corner suit against the rank the same way on both stacked faces', () => {
    const stacked = FACE_STYLES.filter((face) => cardFaceMetrics(60, face).index.stacked);
    expect(stacked.length).toBe(2);
    const shares = stacked.map((face) => {
      const m = cardFaceMetrics(60, face);
      return m.index.suitSize / m.index.fontSize;
    });
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThan(0.05);
    // And bigger than the face that sets its suit beside the rank.
    const beside = cardFaceMetrics(60, 'mobile');
    expect(Math.min(...shares))
      .toBeGreaterThan(beside.index.suitSize / beside.index.fontSize);
  });

  // The suit is now the widest thing in the corner, not the rank, so the
  // column's own width follows it - and `peek`, which is measured to the
  // bottom of it, has to follow too.
  it('measures the peek to the bottom of the stacked suit', () => {
    for (const face of ['standard', 'jumbo'] as const) {
      const m = cardFaceMetrics(60, face);
      const suitBottom = m.index.suitY + m.index.suitSize / 2 + m.height / 2;
      expect(m.peek).toBeGreaterThan(suitBottom);
      // And not wastefully more - it is a fanned pile's step.
      expect(m.peek).toBeLessThan(suitBottom + m.width * 0.08);
    }
  });

  it('puts the suit on the rank\'s own line where it is not stacked', () => {
    const m = cardFaceMetrics(60, 'mobile');
    expect(m.index.suitY).toBe(m.index.y);
  });

  it('scales every face with the card', () => {
    for (const face of FACE_STYLES) {
      const one = cardFaceMetrics(60, face);
      const two = cardFaceMetrics(120, face);
      expect(two.index.fontSize).toBeCloseTo(one.index.fontSize * 2);
      expect(two.peek).toBeCloseTo(one.peek * 2);
      if (one.pips) expect(two.pips!.size).toBeCloseTo(one.pips.size * 2);
    }
  });
});

// These are the real arrangements and not a grid, and getting them wrong is
// the usual way a home-made deck gives itself away.
describe('where the pips go', () => {
  const count = (rank: Rank) => pipLayout(rank).length;

  it('puts down as many pips as the rank says', () => {
    const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    ranks.forEach((rank, i) => expect(count(rank)).toBe(i + 1));
  });

  it('gives a court and anything unknown none - they have a portrait', () => {
    for (const rank of ['J', 'Q', 'K'] as Rank[]) expect(count(rank)).toBe(0);
  });

  // The detail whose absence makes a drawn card look wrong without anyone
  // being able to say why: it is what makes the card the same either way up.
  it('prints the bottom half upside down and the top half the right way up', () => {
    for (const rank of ['2', '6', '7', '9', '10'] as Rank[]) {
      for (const pip of pipLayout(rank)) {
        expect(pip.flip).toBe(pip.y > 0.5);
      }
    }
  });

  it('is symmetric about both axes', () => {
    for (const rank of ['2', '4', '6', '8', '10'] as Rank[]) {
      const pips = pipLayout(rank);
      for (const pip of pips) {
        const mirrored = pips.some(
          (other) => Math.abs(other.x - (1 - pip.x)) < 1e-6
            && Math.abs(other.y - (1 - pip.y)) < 1e-6,
        );
        expect(mirrored, `${rank} at ${pip.x},${pip.y}`).toBe(true);
      }
    }
  });

  // A seven is a six with one more between the top pair, which is why a seven
  // and a six are told apart at a glance rather than counted.
  it('builds the seven out of the six', () => {
    const six = pipLayout('6');
    const seven = pipLayout('7');
    for (const pip of six) {
      expect(seven.some((p) => p.x === pip.x && p.y === pip.y)).toBe(true);
    }
    const extra = seven.filter((p) => !six.some((q) => q.x === p.x && q.y === p.y));
    expect(extra).toHaveLength(1);
    expect(extra[0].x).toBe(0.5);
    expect(extra[0].y).toBeLessThan(0.5);
  });

  // Four down each side with two slid in between them, not five and five.
  it('builds the ten out of two columns of four', () => {
    const ten = pipLayout('10');
    expect(ten.filter((p) => p.x === 0)).toHaveLength(4);
    expect(ten.filter((p) => p.x === 1)).toHaveLength(4);
    expect(ten.filter((p) => p.x === 0.5)).toHaveLength(2);
  });

  it('draws the ace bigger than the rest, as every printed deck does', () => {
    expect(pipLayout('A')[0].big).toBe(true);
    expect(pipLayout('9').every((p) => !p.big)).toBe(true);
  });
});

describe('the pips on a card', () => {
  it('has none at all on the face that draws one big suit', () => {
    expect(pipPlaces(cardFaceMetrics(60, 'mobile'), '7')).toHaveLength(0);
  });

  it('keeps every pip on the card', () => {
    for (const face of ['standard', 'jumbo'] as const) {
      const metrics = cardFaceMetrics(60, face);
      for (const rank of ['A', '5', '9', '10'] as Rank[]) {
        for (const pip of pipPlaces(metrics, rank)) {
          expect(Math.abs(pip.x) + pip.size / 2).toBeLessThan(metrics.width / 2);
          expect(Math.abs(pip.y) + pip.size / 2).toBeLessThan(metrics.height / 2);
        }
      }
    }
  });

  // Three columns have to fit between the two corners without touching.
  it('keeps the outer columns clear of the middle one', () => {
    for (const face of ['standard', 'jumbo'] as const) {
      const metrics = cardFaceMetrics(60, face);
      const ten = pipPlaces(metrics, '10');
      const left = Math.max(...ten.filter((p) => p.x < -1e-6).map((p) => p.x + p.size / 2));
      const middle = Math.min(...ten.filter((p) => Math.abs(p.x) < 1e-6)
        .map((p) => p.x - p.size / 2));
      expect(left, face).toBeLessThan(middle);
    }
  });
});

// A real court is double-ended and sits in a ruled panel with the corners
// beside it. The mobile face is the exception and says so: one figure, full
// bleed, because it has one index and the whole bottom of the card to give.
describe('where a court goes', () => {
  const art = { width: 298, height: 501 };

  it('bleeds one figure across the bottom on the mobile face', () => {
    const metrics = cardFaceMetrics(60, 'mobile');
    expect(metrics.court.cut).toBe('half');
    const rect = courtArtRect(metrics, { width: 298, height: 250 });
    expect(rect.width).toBe(metrics.width);
    expect(rect.y + rect.height / 2).toBeCloseTo(metrics.height / 2);
  });

  it('frames both figures in the middle on the printed faces', () => {
    for (const face of ['standard', 'jumbo'] as const) {
      const metrics = cardFaceMetrics(60, face);
      expect(metrics.court.cut).toBe('full');
      const rect = courtArtRect(metrics, art);
      expect(rect.x).toBe(0);
      expect(rect.y).toBe(0);
      expect(rect.width).toBeLessThan(metrics.width);
      expect(rect.height).toBeLessThan(metrics.height);
      // And it keeps the art's own shape rather than stretching it.
      expect(rect.width / rect.height).toBeCloseTo(art.width / art.height, 3);
    }
  });

  // The panel has to start inboard of the corner, or the rank is printed on
  // the frame. How wide that corner really is depends on the text the browser
  // lays out - the widest court rank is the Q, at about 0.75 of the font size
  // - so the real clearance is measured in the smoke against all three court
  // ranks. What is worth pinning here is that the panel leaves room for a
  // corner at all: one glyph and the suit under it, bounded generously by the
  // index's own font size.
  it('leaves the corners room beside the panel', () => {
    for (const face of ['standard', 'jumbo'] as const) {
      const metrics = cardFaceMetrics(60, face);
      const panelLeft = -courtArtRect(metrics, art).width / 2;
      // How far the column reaches: the suit is centred under the rank, so
      // it is half a rank plus half a suit. The rank's own width is the
      // browser's to decide, bounded generously at 0.9 of the font size -
      // the widest court rank measures 0.75.
      const reach = metrics.index.x
        + metrics.index.fontSize * 0.9 / 2 + metrics.index.suitSize / 2;
      expect(panelLeft, face).toBeGreaterThan(reach);
    }
  });

  // A wider corner needs a narrower panel, which is the trade jumbo makes
  // everywhere else on the card too.
  it('narrows the panel as the index grows', () => {
    expect(cardFaceMetrics(60, 'jumbo').court.panel)
      .toBeLessThan(cardFaceMetrics(60, 'standard').court.panel);
  });
});
