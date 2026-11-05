# Where the art came from

This package carries artwork and typefaces that are not its own. Anything you
build with it carries them too, so here is what they are.

## The courts, and the backs

`assets/cards/court/{jack,queen,king}-{suit}.svg` are the **English pattern**
court cards by **Dmitry Fomin** (Дмитрий Фомин), released into the public
domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) via
Wikimedia Commons:
<https://commons.wikimedia.org/wiki/File:English_pattern_king_of_spades.svg>
and the eleven siblings named to match. They are the source of every court in
the package, unmodified apart from the color substitution described below.

They used to ship a second time as `assets/cards/art/<theme>/*.webp`, baked by
web-nert's `tools/render-face-art.py` — 84 files, one set per theme. Those are
gone. Each of the seven themes was the same twelve figures recolored, so a
deck is a palette rather than a second set of drawings, and the palettes are
now the only thing kept.

CC0 is a public domain dedication: no attribution is required, no licence
notice has to ship with a built game, and commercial use and modification are
both fine. This file exists because knowing where art came from is worth more
than the licence strictly demands.

`assets/cards/art/<theme>/back.webp` is generated line work - guilloche, the
lathe-turned pattern on a banknote - drawn in ink on transparency so that the
color behind it is the deck color setting. It is not opaque, and must not
become opaque: the fill showing through is the whole of what that setting
changes. See `BACK_COLORS` in `src/deck-theme.ts`.

## The suits

`assets/cards/suits/*.svg` are drawn for this deck rather than taken from a
typeface, and are white on transparency so one file can serve red, black and
any other color a card needs. In most typefaces the club and the spade are
near-identical blobs at card size; these are shaped to be told apart at a
glance instead.

`star.svg` is the odd one out: it is not a playing-card suit at all, and is
here because one of the two games uses it for cards its shop has modified. The
code knows nothing about it - a game that wants a fifth suit declares it with
`defineSuits` and points at this file itself.

## The fonts

Four files in `assets/fonts`, and they are **not** CC0 - they are third-party
and carry their own licences, which are in that directory beside them.

| File | Family | Designer | Licence |
| --- | --- | --- | --- |
| `cinzel-latin.woff2` | [Cinzel](https://github.com/NDISCOVER/Cinzel) | Natanael Gama | SIL OFL 1.1 |
| `jost-latin.woff2` | [Jost\*](https://github.com/indestructible-type/Jost) | Owen Earl | SIL OFL 1.1 |
| `archivo-latin.woff2` | [Archivo](https://github.com/Omnibus-Type/Archivo) | Omnibus-Type | SIL OFL 1.1 |
| `schoolbell-latin.woff2` | [Schoolbell](https://fonts.google.com/specimen/Schoolbell) | Font Diner, Inc. | Apache 2.0 |

All four are fine to bundle and redistribute, including commercially. The OFL
ones must not be sold on their own, which is not something a card game is at
risk of doing. All are the **latin subset**, and the three OFL ones are
variable, which is why there are so few files: one Cinzel covers 400–900, one
Jost 300–700 and one Archivo 500–700. 108kB for the set.
