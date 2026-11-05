# Court card artwork

The twelve `{jack,queen,king}-{suit}.svg` files in this directory are not
ours. They are the **English pattern** court cards by **Dmitry Fomin**
(Дмитрий Фомин), released into the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) via Wikimedia
Commons.

Source, one file per card:
<https://commons.wikimedia.org/wiki/File:English_pattern_king_of_spades.svg>
and the eleven siblings named to match.

CC0 is a public domain dedication: no attribution is required, no licence
notice has to ship with the built game, and commercial use and modification
are both fine. This file exists because knowing where art came from is
worth more than the licence strictly demands — and because the next person
to wonder whether these can stay should be able to answer it without
guessing.

## Why these and not ours

web-nert's `tools/generate-face-art.py` used to draw these twelve figures
procedurally. It got the ingredients right — the blue-violet line work, the
parallel-stroke hair ending in scroll curls, the specific cast — and still
did not look like a court card, because it drew a bust: one figure, upright,
in the bottom of the card. A court card is double-ended, fills the card
corner to corner, and carries a different face on all twelve. The remaining
distance was per-figure drawing, not parameters, and is not work a generator
was going to close.

That generator is gone, in web-nert's history at commit `e0ee62a`. It is
worth knowing about before anyone tries it again, which is easy to do: the
figures look composable and they are not.

## How they are used here

These are 360x540 and double-ended, where a card is 5:7 and single-ended. So
only the top half is taken, cropped to where the figure actually reaches, with
the source's own index and border rule painted out — see `src/court.ts`, where
every one of those numbers is a measured constant with the reason beside it.

`renderCourts` recolours and rasterises them in the browser. That is the only
route now: `assets/cards/art/<theme>/` held the same twelve baked ahead of time
by web-nert's `tools/render-face-art.py`, and those 84 files were removed once
this worked. The bake additionally applied a press — ink spread and plate
misregistration — which the runtime path does not reproduce.
