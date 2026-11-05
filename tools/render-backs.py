#!/usr/bin/env python3
"""Draws the card backs this package ships.

One file per deck, at assets/cards/art/<theme>/back.webp, and nothing else:
the twelve courts are rendered from their SVG sources at runtime - see
src/phaser/court-art.ts - so a back is the only picture of a card left in
this repo.

The drawing is lifted from web-nert's tools/render-face-art.py, which is
where these backs were baked before the two games shared a package. The
court half of that script has no job here and did not come with it.

A back is ink on transparency, with nothing opaque behind it. The colour
under it is the player's, not the deck's - in Nertz that is how you tell
whose row you are looking at, and here it is simply the colour of your
deck. So a green ink for a green deck would be a back that vanishes on a
green card: what varies per deck is the geometry - field, pitch, medallion,
border - which is legible over any of them, and the ink only ever shifts
its tint a little without leaving light.

Run from the repo root, with Pillow installed:

    python3 tools/render-backs.py            # every deck
    python3 tools/render-backs.py matrix     # one of them
"""

import math
import os
import random
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT_DIR = 'assets/cards/art'

# The back is drawn at the full card size rather than as a panel: it covers
# the whole card, margin included.
#
# 6x the 60x84 the card displays at. The back is one flat ink and a repeat,
# so there is no fine colour detail for more resolution to preserve - and
# unlike a court, every face-down card in a game is showing this one
# texture, so it is the single asset most worth keeping small.
BACK_W, BACK_H = 60 * 6, 84 * 6

# What each deck's back is made of.
#
# `field` is the all-over texture, `medallion` the shape in the middle, and
# `border` the band inside the rule. The medallion is what tells one back
# from another at card size - a field reads as texture long before it reads
# as a pattern, but an outline that big always resolves.
#
# `ink` is the one colour, and every one of them is light. It has to be: it
# is printed over whatever back colour the player picked, and the darkest of
# those is near-black. A deck may lean its ink warm or cool by a few values
# and that is the whole of the licence here.
BACKS = {
    'classic': {'field': 'rosette', 'medallion': 'circle', 'medallion_r': 0.185,
                'border': 'double', 'step': 0.155, 'units': (0.58, 0.30),
                'lobes': (9, 6), 'ink': (250, 246, 236)},
    'press': {'field': 'diaper', 'medallion': 'lozenge', 'medallion_r': 0.115,
              'border': 'palmette', 'step': 0.046, 'units': (0.60, 0.32),
              'lobes': (7, 5), 'ink': (250, 244, 232)},
    'antique': {'field': 'scales', 'medallion': 'oval', 'medallion_r': 0.175,
                'border': 'scallop', 'step': 0.260, 'units': (0.54, 0.26),
                'lobes': (8, 5), 'ink': (248, 240, 224)},
    'millionaire': {'field': 'diaper', 'medallion': 'circle', 'medallion_r': 0.150,
                    'border': 'chain', 'step': 0.034, 'units': (0.52, 0.26),
                    'lobes': (15, 9), 'corners': True, 'ink': (238, 250, 240)},

    # The two new ones.
    #
    # Matrix is the only back here with no curve anywhere in it. `grid` is a
    # straight diagonal crosshatch at two pitches, which is the closest this
    # set of fields gets to a screen full of rain, and the square medallion
    # and single rule keep it looking cut rather than engraved. Every other
    # back in the pack is lathe work; this one should look like it came off
    # a plotter.
    'matrix': {'field': 'grid', 'medallion': 'square', 'medallion_r': 0.150,
               'border': 'single', 'step': 0.085, 'units': (0.62, 0.34),
               'lobes': (6, 4), 'ink': (226, 255, 232)},

    # And neon is the only one built from straight rays out of the middle.
    # A sunburst is the one field here with an orientation, which every
    # other back is at pains not to have - it works because it is radial:
    # turn the card and it is the same card. The chain border and the
    # corner rosettes are there to make it read as lit rather than as
    # merely bright.
    'neon': {'field': 'rays', 'medallion': 'circle', 'medallion_r': 0.170,
             'border': 'chain', 'step': 0.120, 'units': (0.56, 0.30),
             'lobes': (11, 7), 'corners': True, 'ink': (252, 236, 255)},

    # The six that are palettes over the same courts. Like every other back
    # here they differ in geometry rather than in ink, so each deck at a table
    # is told apart by something other than its colour. Combinations not yet
    # taken: no two of these share a field, a medallion and a border.
    'midnight': {'field': 'rosette', 'medallion': 'quatrefoil', 'medallion_r': 0.170,
                 'border': 'scallop', 'step': 0.120, 'units': (0.56, 0.28),
                 'lobes': (8, 5), 'ink': (232, 238, 250)},
    'casino': {'field': 'diaper', 'medallion': 'square', 'medallion_r': 0.140,
               'border': 'chain', 'step': 0.060, 'units': (0.58, 0.30),
               'lobes': (9, 6), 'corners': True, 'ink': (252, 240, 205)},
    'arctic': {'field': 'rays', 'medallion': 'lozenge', 'medallion_r': 0.130,
               'border': 'double', 'step': 0.140, 'units': (0.56, 0.30),
               'lobes': (7, 5), 'ink': (232, 248, 252)},
    'delft': {'field': 'plaid', 'medallion': 'quatrefoil', 'medallion_r': 0.160,
              'border': 'palmette', 'step': 0.090, 'units': (0.58, 0.30),
              'lobes': (7, 5), 'ink': (240, 244, 252)},
    'blush': {'field': 'scales', 'medallion': 'oval', 'medallion_r': 0.165,
              'border': 'double', 'step': 0.200, 'units': (0.54, 0.28),
              'lobes': (8, 5), 'ink': (252, 238, 238)},
    'newsprint': {'field': 'grid', 'medallion': 'circle', 'medallion_r': 0.140,
                  'border': 'single', 'step': 0.110, 'units': (0.60, 0.32),
                  'lobes': (6, 4), 'ink': (244, 244, 244)},
}


def grain(size, seed, amount=5.0, blur=0.6):
    """A tile of fine noise, as a greyscale image centred on mid-grey.

    Seeded per card so the twelve don't share one grain pattern - a
    repeated texture across a fanned pile is very visible - but fixed, so
    re-running the tool doesn't churn the files.
    """
    w, h = size
    rnd = random.Random(seed)
    img = Image.new('L', size)
    img.putdata([max(0, min(255, int(128 + rnd.gauss(0, amount))))
                 for _ in range(w * h)])
    return img.filter(ImageFilter.GaussianBlur(blur))


def mottle(size, seed):
    """The slow unevenness across a sheet of stock, as opposed to grain.

    Made by drawing a handful of soft blobs at low resolution and letting
    the upscale do the smoothing - cheaper than a real turbulence and
    indistinguishable at this size.
    """
    rnd = random.Random(seed + 977)
    small = 12
    img = Image.new('L', (small, small), 128)
    px = img.load()
    for _ in range(26):
        x, y = rnd.randrange(small), rnd.randrange(small)
        px[x, y] = max(0, min(255, int(128 + rnd.gauss(0, 9))))
    return img.resize(size, Image.BICUBIC).filter(
        ImageFilter.GaussianBlur(max(size) / 26.0))


def guilloche(draw, cx, cy, r_out, r_in, lobes, turns, width, phase=0.0,
              fill=255):
    """One rosette of the lathe-work every classic back is built from.

    A pen on a rod, on a wheel, on another wheel: the radius swings between
    r_in and r_out `lobes` times per lap while the figure is walked round
    `turns` times. It is the pattern on a banknote, and it is generated
    rather than drawn because there is no authoring a few thousand of these
    points by hand.

    Drawn into a coverage mask rather than straight onto the image: PIL's
    line drawing overwrites the pixels it touches, alpha included, so a
    few hundred semi-transparent strokes crossing each other would punch
    holes in one another instead of building up. Weighting whole masks and
    taking the lighter of them composites them properly.
    """
    pts = []
    steps = int(360 * turns)
    for i in range(steps + 1):
        a = (i / 360.0) * 2 * math.pi
        swing = math.sin(a * lobes + phase)
        rr = r_in + (r_out - r_in) * (0.5 + 0.5 * swing)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    draw.line(pts, fill=fill, width=width, joint='curve')


def lattice(size, step_frac, unit_frac, lobes, phase, width):
    """An all-over field of rosettes, as a coverage mask.

    Offset every other row so the repeat reads as a woven lattice rather
    than as a grid, and run a row and a column past each edge so the
    pattern is already going when it reaches the border.
    """
    w, h = size
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    step = w * step_frac
    unit = step * unit_frac
    for row in range(int(h / step) + 3):
        for col in range(int(w / step) + 3):
            cx = (col - 1) * step + (step / 2 if row % 2 else 0)
            cy = (row - 1) * step
            guilloche(draw, cx, cy, unit, unit * 0.22, lobes, 1, width,
                      phase=phase)
    return mask


def rays(size, n, width, r_in, r_out):
    """A sunburst: straight spokes from the middle, stopping short of it."""
    w, h = size
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    cx, cy = w / 2.0, h / 2.0
    reach = math.hypot(w, h) / 2.0
    for i in range(n):
        a = 2 * math.pi * i / n
        draw.line([(cx + r_in * reach * math.cos(a), cy + r_in * reach * math.sin(a)),
                   (cx + r_out * reach * math.cos(a), cy + r_out * reach * math.sin(a))],
                  fill=255, width=width)
    return mask


def scales(size, pitch_frac, width):
    """Overlapping arcs in offset rows - fish-scale, the other all-over
    pattern that survives being shrunk."""
    w, h = size
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    pitch = w * pitch_frac
    row = 0
    y = -pitch
    while y < h + pitch:
        off = pitch / 2 if row % 2 else 0
        x = -pitch + off
        while x < w + pitch:
            draw.arc([x, y, x + pitch, y + pitch * 1.4], 180, 360,
                     fill=255, width=width)
            x += pitch
        y += pitch * 0.62
        row += 1
    return mask


def grid_field(size, pitch_frac, width):
    """A diagonal crosshatch of straight lines - no curves anywhere, for the
    one back that is meant to look engineered rather than engraved."""
    w, h = size
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    pitch = w * pitch_frac
    span = w + h
    x = -span
    while x < span:
        draw.line([(x, 0), (x + h, h)], fill=255, width=width)
        draw.line([(x, h), (x + h, 0)], fill=255, width=width)
        x += pitch
    return mask


def diaper(size, pitch_frac, width):
    """A fine diagonal crosshatch - the classic "cambric" field.

    The single most common field on a real back, and much finer than a
    rosette lattice: on the decks this is copied from, the diamonds are
    about a millimetre across. At that frequency it stops being a pattern
    and becomes a tint, which is exactly what a back wants - somewhere for
    the eye to find no purchase at all.
    """
    w, h = size
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    pitch = w * pitch_frac
    span = w + h
    x = -span
    while x < span:
        draw.line([(x, 0), (x + h, h)], fill=255, width=width)
        draw.line([(x, h), (x + h, 0)], fill=255, width=width)
        x += pitch
    return mask


def plaid(size, pitch_frac, width):
    """Tartan: a sett of bands run both ways, with the crossings darker.

    Two things make this read as cloth rather than as graph paper, and the
    first attempt at it had neither.

    The bands run parallel to the card's edges, not diagonally. A tartan's
    identity is the rhythm of its sett - wide, narrow, narrow, wide - and on
    the diagonal that rhythm is read at an angle against a rectangular card
    and simply stops being legible. Square to the edges it is obvious.

    And the two directions are summed rather than maxed, so where a band
    crosses a band the ink doubles. That is what happens in woven cloth, it
    is the only place the pattern has any weight, and without it the whole
    thing is a flat grid.
    """
    w, h = size
    pitch = w * pitch_frac
    # One repeat of the sett: position within the repeat, and band weight.
    sett = ((0.00, 3.4), (0.26, 1.0), (0.39, 1.0), (0.63, 2.0), (0.87, 1.0))

    def bands(vertical):
        mask = Image.new('L', size, 0)
        draw = ImageDraw.Draw(mask)
        limit = (w if vertical else h) + pitch
        base = -pitch
        while base < limit:
            for off, weight in sett:
                wd = max(1.0, width * weight)
                c = base + off * pitch
                if vertical:
                    draw.rectangle([c - wd / 2, 0, c + wd / 2, h], fill=255)
                else:
                    draw.rectangle([0, c - wd / 2, w, c + wd / 2], fill=255)
            base += pitch
        return mask

    return ImageChops.add(bands(True).point(lambda v: int(v * 0.58)),
                          bands(False).point(lambda v: int(v * 0.58)))


def border_band(draw, rect, style, ss, w):
    """The ornamented band just inside the field's rule.

    On a real back this carries as much of the identity as the middle does -
    the fleur row around a cambric back is what you recognise it by, long
    before the little lozenge in the centre. A plain rule was underselling
    it badly.
    """
    x0, y0, x1, y1 = rect
    if style == 'palmette':
        # A row of small fans, facing inward, all the way round.
        step = w * 0.058
        r = step * 0.38
        for x in _walk(x0 + step / 2, x1, step):
            draw.arc([x - r, y0 - r, x + r, y0 + r], 0, 180, fill=240, width=ss)
            draw.arc([x - r, y1 - r, x + r, y1 + r], 180, 360, fill=240, width=ss)
        for y in _walk(y0 + step / 2, y1, step):
            draw.arc([x0 - r, y - r, x0 + r, y + r], 270, 90, fill=240, width=ss)
            draw.arc([x1 - r, y - r, x1 + r, y + r], 90, 270, fill=240, width=ss)
    elif style == 'chain':
        # Interlocking loops - the rope border off the blue arabesque back.
        step = w * 0.052
        r = step * 0.62
        for x in _walk(x0, x1 + step, step):
            for y in (y0, y1):
                draw.ellipse([x - r, y - r * 0.62, x + r, y + r * 0.62],
                             outline=235, width=ss)
        for y in _walk(y0, y1 + step, step):
            for x in (x0, x1):
                draw.ellipse([x - r * 0.62, y - r, x + r * 0.62, y + r],
                             outline=235, width=ss)


def _walk(start, stop, step):
    v = start
    while v < stop:
        yield v
        v += step


def medallion_mask(size, shape, cx, cy, r):
    """The silhouette of the centre. Its shape is most of what tells one
    back from another at card size - the field behind it reads as texture
    long before it reads as a pattern, but an outline this big always
    resolves."""
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    if shape == 'circle':
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    elif shape == 'oval':
        draw.ellipse([cx - r * 0.76, cy - r * 1.22,
                      cx + r * 0.76, cy + r * 1.22], fill=255)
    elif shape == 'lozenge':
        draw.polygon([(cx, cy - r * 1.3), (cx + r * 0.86, cy),
                      (cx, cy + r * 1.3), (cx - r * 0.86, cy)], fill=255)
    elif shape == 'square':
        draw.rounded_rectangle([cx - r * 0.82, cy - r * 0.82,
                                cx + r * 0.82, cy + r * 0.82],
                               radius=r * 0.18, fill=255)
    elif shape == 'quatrefoil':
        k, lobe = r * 0.5, r * 0.6
        for dx, dy in ((0, -k), (k, 0), (0, k), (-k, 0)):
            draw.ellipse([cx + dx - lobe, cy + dy - lobe,
                          cx + dx + lobe, cy + dy + lobe], fill=255)
    return mask


def build_field(size, spec, ss):
    """The all-over texture, per the palette's chosen kind."""
    kind = spec['field']
    if kind == 'rays':
        coarse = rays(size, spec['lobes'][0] * 6, max(1, int(ss * 1.4)),
                      0.18, 1.0)
        fine = rays(size, spec['lobes'][1] * 6, max(1, int(ss)), 0.30, 1.0)
        return ImageChops.lighter(coarse.point(lambda v: int(v * 0.62)),
                                  fine.point(lambda v: int(v * 0.38)))
    if kind == 'scales':
        coarse = scales(size, spec['step'], max(1, int(ss * 1.5)))
        fine = scales(size, spec['step'] * 0.5, max(1, int(ss)))
        return ImageChops.lighter(coarse.point(lambda v: int(v * 0.74)),
                                  fine.point(lambda v: int(v * 0.34)))
    if kind == 'diaper':
        coarse = diaper(size, spec['step'], max(1, int(ss * 1.2)))
        fine = diaper(size, spec['step'] * 0.5, max(1, int(ss)))
        return ImageChops.lighter(coarse.point(lambda v: int(v * 0.78)),
                                  fine.point(lambda v: int(v * 0.30)))
    if kind == 'plaid':
        return plaid(size, spec['step'], max(1, int(ss))).point(
            lambda v: int(v * 0.72))
    if kind == 'grid':
        coarse = grid_field(size, spec['step'], max(1, int(ss * 1.4)))
        fine = grid_field(size, spec['step'] / 3.0, max(1, int(ss)))
        return ImageChops.lighter(coarse.point(lambda v: int(v * 0.70)),
                                  fine.point(lambda v: int(v * 0.30)))
    coarse = lattice(size, spec['step'], spec['units'][0], spec['lobes'][0],
                     0.0, max(1, int(ss * 1.5)))
    fine = lattice(size, spec['step'], spec['units'][1], spec['lobes'][1],
                   math.pi / 5, max(1, int(ss * 1.1)))
    return ImageChops.lighter(coarse.point(lambda v: int(v * 0.74)),
                              fine.point(lambda v: int(v * 0.46)))


def build_back(spec):
    """An ornate back in the spirit of the classic ones.

    Deliberately not a copy of any deck\'s - the well-known backs are live
    trademarks - but built the way they are, and for the same reasons:

      * An all-over pattern with no large plain areas and no orientation,
        so a card is unreadable face-down however it is turned.
      * A white margin with no ink running off it. Cards are guillotined in
        stacks and the cut wanders; a pattern that bled to the edge would
        show the wander as a fat border on one side and none on the other.
      * Two superimposed repeats at different scales, which is what stops
        a back reading as wallpaper.
    """
    ss = 2
    size = (BACK_W * ss, BACK_H * ss)
    w, h = size

    margin = int(w * 0.075)
    field = [margin, margin, w - margin, h - margin]
    radius = int(w * 0.06)

    # Two repeats at different scales, weighted against each other: the
    # coarse one carries the pattern, the finer one fills the gaps it leaves
    # between rosettes. Two is the floor for not reading as wallpaper.
    #
    # The step is deliberately small. Rosettes big enough to read
    # individually at card size make the back look printed from a stencil;
    # at this pitch no single one resolves and the field reads as worked ink.
    #
    # There is no third, finer repeat, though it is the obvious next move.
    # At this step a third would have a sub-pixel radius on a 60px card - it
    # cannot be seen at any size the game draws, and it is not free: it is
    # fine detail over the whole card, which is the most expensive thing
    # there is to encode. It cost 50kB to render nothing.
    pattern = build_field(size, spec, ss)

    # Clipped so the field stops dead at the border instead of sliding under
    # it into the margin.
    #
    # Where there is an ornamented band, the field is clipped inside *that*
    # rather than to the rule, which is the structural point the real backs
    # make and the one this missed first time round: on a cambric back the
    # fleur row sits on clear card between two rules, with the diaper
    # starting inside it. Run the field underneath the band and the band
    # stops reading at all - it did, and it looked like a blank border.
    inner = list(field)
    if spec['border'] in ('palmette', 'chain'):
        gap = ss * 17
        inner = [field[0] + gap, field[1] + gap, field[2] - gap, field[3] - gap]
    clip = Image.new('L', size, 0)
    ImageDraw.Draw(clip).rounded_rectangle(
        inner, radius=max(1, radius - (inner[0] - field[0])), fill=255)
    pattern = ImageChops.multiply(pattern, clip)

    # The rules: a heavy one at the field's edge and a hairline inside it,
    # which is what fences the pattern off from the margin and reads, at
    # card size, as the border of a printed back.
    rules = Image.new('L', size, 0)
    rdraw = ImageDraw.Draw(rules)
    rdraw.rounded_rectangle(field, radius=radius, outline=235, width=ss * 3)
    inset = ss * 7
    if spec['border'] == 'double':
        rdraw.rounded_rectangle(
            [field[0] + inset, field[1] + inset,
             field[2] - inset, field[3] - inset],
            radius=max(1, radius - inset), outline=150, width=max(1, ss))
    elif spec['border'] in ('palmette', 'chain'):
        band = ss * 9
        border_band(rdraw,
                    [field[0] + band, field[1] + band,
                     field[2] - band, field[3] - band],
                    spec['border'], max(1, int(ss * 1.6)), w)
        rdraw.rounded_rectangle(
            [field[0] + ss * 17, field[1] + ss * 17,
             field[2] - ss * 17, field[3] - ss * 17],
            radius=max(1, radius - ss * 17), outline=200, width=max(1, ss * 2))
    elif spec['border'] == 'scallop':
        # A row of beads inside the rule instead of a second rule.
        bead = ss * 2.2
        gap = w * 0.055
        x = field[0] + inset + gap / 2
        while x < field[2] - inset:
            for y in (field[1] + inset, field[3] - inset):
                rdraw.ellipse([x - bead, y - bead, x + bead, y + bead], fill=170)
            x += gap
        y = field[1] + inset + gap / 2
        while y < field[3] - inset:
            for x2 in (field[0] + inset, field[2] - inset):
                rdraw.ellipse([x2 - bead, y - bead, x2 + bead, y + bead], fill=170)
            y += gap

    # Corner ornaments, on the backs that call for them. A banknote puts a
    # rosette in each corner and a card back that wants to look like money
    # needs them more than it needs a busier middle.
    if spec.get('corners'):
        cr = w * 0.085
        for ox, oy in ((0.20, 0.145), (0.80, 0.145), (0.20, 0.855), (0.80, 0.855)):
            guilloche(rdraw, w * ox, h * oy, cr, cr * 0.34, 8, 1,
                      max(1, int(ss)), fill=190)

    field_ink = ImageChops.lighter(pattern, rules)

    # A medallion over the middle of the lattice. Classic backs almost all
    # have one, and it gives the eye somewhere to land on a card that is
    # otherwise deliberately uniform.
    #
    # Printed in reverse: solid ink with the lathe work knocked out of it,
    # rather than drawn on top. On a back this dense, more lines in the
    # middle would just read as a slightly busier patch - it's the switch
    # from light-on-colour to colour-on-light that makes the centre resolve
    # as a separate thing at card size.
    cx, cy = w / 2.0, h / 2.0
    shape = spec['medallion']
    if shape is None:
        ink = field_ink
        return _finish_back(ink, size, spec)

    r = w * spec['medallion_r']
    med = medallion_mask(size, shape, cx, cy, r)

    medallion = Image.new('L', size, 205)
    mdraw = ImageDraw.Draw(medallion)
    for k, (ro, ri, lobes, wid) in enumerate((
            (0.90, 0.62, 16, 1.1), (0.66, 0.40, 12, 1.0), (0.40, 0.16, 8, 1.0))):
        guilloche(mdraw, cx, cy, r * ro, r * ri, lobes, 1,
                  max(1, int(ss * wid)), phase=k * 0.7, fill=0)
    # Outline follows the medallion's own silhouette, not a circle.
    edge = medallion_mask(size, shape, cx, cy, r)
    inner = medallion_mask(size, shape, cx, cy, r - ss * 2.0)
    medallion = Image.composite(
        Image.new('L', size, 0), medallion,
        ImageChops.subtract(edge, inner))

    # Composited through the disc rather than maxed with the field: taking
    # the lighter of the two would let the lattice underneath show through
    # every line knocked out of the medallion and fill it straight back in.
    ink = Image.composite(medallion, field_ink, med)
    return _finish_back(ink, size, spec)


def _finish_back(ink, size, spec):
    """The press pass and the tint, shared by every back.

    Split out because a back with no medallion returns before the
    compositing step and still has to go through this.
    """

    # The back goes through the press as ink density rather than as colour,
    # which is press() the other way up and worth the separate path twice
    # over.
    #
    # Physically it is the honest model: this is one flat ink on a coloured
    # card, so an uneven lay of it varies how much shows through, not what
    # shade it is. press() varies the colour instead, which is right for the
    # courts - four inks, each landing slightly differently.
    #
    # It is also the difference between a 170kB back and a 60kB one. All the
    # detail here lives in the alpha channel; the colour underneath is one
    # value across the whole card. Perturbing that colour hands the encoder
    # full-frame noise to store - including over the margin, where the card
    # is transparent and none of it will ever be seen.
    # Soft light rather than multiply, for the same reason press() uses it:
    # it is neutral against mid-grey, so a texture centred there lightens
    # and darkens the ink instead of uniformly thinning it. Multiplying by a
    # mid-grey field would halve the density of the whole back.
    for layer in (grain(size, 4242, amount=6.0), mottle(size, 4242)):
        ink = ImageChops.soft_light(ink, layer)
    ink = ink.filter(ImageFilter.GaussianBlur(max(size) / 900.0))

    tint = spec['ink']
    img = Image.merge('RGBA', (Image.new('L', size, tint[0]),
                               Image.new('L', size, tint[1]),
                               Image.new('L', size, tint[2]),
                               ink))
    return img.resize((BACK_W, BACK_H), Image.LANCZOS)

# --- driver --------------------------------------------------------------

def main():
    wanted = sys.argv[1:] or list(BACKS)
    for name in wanted:
        if name not in BACKS:
            raise SystemExit('unknown deck: %s (have %s)'
                             % (name, ', '.join(BACKS)))
    total = 0
    for name in wanted:
        out_dir = os.path.join(OUT_DIR, name)
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, 'back.webp')
        build_back(BACKS[name]).save(out, 'WEBP', quality=92, method=6)
        size = os.path.getsize(out)
        total += size
        print('  %-12s %4.0fkB' % (name, size / 1024))
    print('  %-12s %4.0fkB total' % ('', total / 1024))


if __name__ == '__main__':
    main()
