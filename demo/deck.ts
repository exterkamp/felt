import './serve';
import {
  BACK_COLORS,
  BODY_FONT,
  COURT_PALETTES,
  Card,
  CourtPalette,
  DECK_STOCK,
  DECK_THEMES,
  DECK_THEME_LABELS,
  DISPLAY_FONT,
  DeckTheme,
  RANKS,
  Rank,
  SUITS,
  Suit,
  colorCss,
  colorOf,
  cssColor,
  defineStack,
  isCourtRank,
  stackPositions,
  Board, CardSprite, Node, orderStack, loadCardArt, renderCourt, suitTexture,
} from 'felt';
import { showCode } from './code';
import { button, expose, label, standalone } from './kit';
import { defineScene } from 'felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'deck',
  create(ctx) {
    showCode(ctx);
    // A deck editor.
    //
    // Every color this package lets a game set, in one place, over a deck you can
    // walk through a rank at a time. There are four separate color systems on
    // screen and the point of putting them together is that they are separate:
    //
    //   the stock      the fill behind the face, which the courts print on too
    //   the suit inks  what a pip is drawn in, per pair of suits
    //   the back       the fill the back's ink is printed over, and which design
    //   the court      a palette of its own, which the suit inks never touch,
    //                  and which keeps the stock and the figure's own whites
    //                  apart - skin and linen do not follow a dark card down
    //
    // Nothing here is a rule. `colorOf('hearts')` is `'red'` whatever the hearts
    // are printed in, and the readout under each card says so.
    const WIDTH = 480;
    const HEIGHT = 322;

    const COLUMN = 92;
    const CARD_W = 86;
    const ROW_Y = 172;
    const COURT_RASTER = 480;

    /** Two face-down under one face-up, so a column shows both sides at once. */
    const PILE_DEEP = 3;

    interface Editable {
      paper: number;
      redInk: number;
      blackInk: number;
      backColor: number;
      back: DeckTheme;
      court: CourtPalette;
    }

    // #region A whole deck theme, as values
    /**
     * One of the six, as every value on this page.
     *
     * A theme used to be a court palette and a back, and everything else on a
     * card was the same whichever you picked. It is a whole deck now - see
     * DECK_STOCK - so loading one here loads all of it rather than repainting
     * the portraits and leaving the card under them white.
     */
    function themeDeck(theme: DeckTheme): Editable {
      const stock = DECK_STOCK[theme];
      const court = COURT_PALETTES[theme];
      return {
        paper: stock.paper,
        redInk: stock.red,
        blackInk: stock.black,
        backColor: stock.back,
        back: theme,
        court: {
          ...court,
          paper: colorCss(stock.paper),
          highlight: court.highlight ?? '#fdfdfd',
        },
      };
    }
    // #endregion

    function defaults(): Editable {
      return themeDeck('press');
    }

    // Six whole decks, each one nothing but the values on this page.
    //
    // They are here to be read rather than admired: every one is the same eleven
    // numbers, and the interesting ones are interesting because of how the four
    // systems are set against each other. A dark stock needs its inks flipped
    // pale or the index vanishes. A dark stock also needs the court's `highlight`
    // left light, or the figures go down with the card - that one field is the
    // difference between Midnight and a black rectangle.
    interface Preset {
      name: string;
      note: string;
      deck: Editable;
    }

    const PRESETS: Preset[] = [
      {
        name: 'Press',
        note: 'the deck as it comes: four-colour offset on uncoated stock',
        deck: defaults(),
      },
      {
        name: 'Midnight',
        note: 'dark stock, inks flipped pale, and the court keeping a light face',
        deck: {
          paper: 0x12141c,
          redInk: 0xe0647a,
          blackInk: 0x9fb4d8,
          backColor: 0x1f3a5f,
          back: 'matrix',
          court: {
            ink: '#3c4a74', gold: '#d9b64a', red: '#b8465c', highlight: '#e9edf6',
          },
        },
      },
      {
        name: 'Halloween',
        note: 'pumpkin on aubergine, with a candlelit court',
        deck: {
          paper: 0x1a1014,
          redInk: 0xff7518,
          blackInk: 0xb894ff,
          backColor: 0x5e3a5c,
          back: 'neon',
          court: {
            ink: '#46275e', gold: '#ff9e2c', red: '#8f2fa8', highlight: '#f7e7c9',
          },
        },
      },
      {
        name: 'Forest',
        note: 'one hue doing all the work, held apart by lightness',
        deck: {
          paper: 0xf2f5ec,
          redInk: 0x2f8f5b,
          blackInk: 0x1c3a2a,
          backColor: 0x4f6b38,
          back: 'millionaire',
          court: {
            ink: '#1e5540', gold: '#9ccf7a', red: '#2f8f5b', highlight: '#fbfdf6',
          },
        },
      },
      {
        name: 'Parchment',
        note: 'aged: nothing saturated, the drawing in sepia',
        deck: {
          paper: 0xf3e7cd,
          redInk: 0xa8432f,
          blackInk: 0x4a3b2a,
          backColor: 0x6b4a2a,
          back: 'antique',
          court: {
            ink: '#6b4a32', gold: '#c9a55e', red: '#a8543f', highlight: '#fbf4e4',
          },
        },
      },
      {
        name: 'Neon',
        note: 'the other end of it: two inks that have never been near a press',
        deck: {
          paper: 0x0d0b14,
          redInk: 0xff4fd8,
          blackInk: 0x45f0ff,
          backColor: 0x2a5866,
          back: 'classic',
          court: {
            ink: '#312057', gold: '#f5e663', red: '#ff3d9a', highlight: '#efe9ff',
          },
        },
      },
    ];

    class DeckEditor {
      /** Everything this page put on the board, so a rebuild can take it off. */
      private root: Node[] = [];
      private deck: Editable = defaults();
      private rank = 0;
      private cards: CardSprite[] = [];

      constructor(readonly board: Board) {
        // Every back design, because picking one is half of what this page is.
        void loadCardArt(board, { themes: DECK_THEMES });
        this.wire();
        this.build();
      }

      // --- the board ----------------------------------------------------------

      // #region Rebuilding every card
      /**
       * Every card, from scratch.
       *
       * Paper and the inks are painted into the atlas rather than set on a live
       * sprite, so changing one is a rebuild. Twenty sprites is cheap, and the
       * faces for a combination already seen are still in the atlas until room
       * is needed - going back to a color you have tried before costs nothing.
       */
      private build(): void {
        for (const node of this.root.splice(0)) node.destroy();
        this.cards = [];

        const rank = RANKS[this.rank] as Rank;
        // The courts are rendered, not loaded. Only the four on screen, not all
        // twelve, and not awaited - a card drawn before its portrait lands shows
        // its pip and takes the portrait when it arrives.
        if (isCourtRank(rank)) {
          for (const suit of SUITS) {
            void renderCourt(this.board, rank, suit, this.court(), COURT_RASTER);
          }
        }

        this.column(0, undefined);
        SUITS.forEach((suit, i) => this.column(i + 1, { suit, rank }));
        this.caption(rank);
      }
      // #endregion

      /**
       * One pile. The first column is the deck, face down; the rest are a suit
       * each with its top card turned over.
       */
      private column(index: number, face: { suit: Suit; rank: Rank } | undefined): void {
        const x = 56 + index * COLUMN;
        const stack = defineStack({ id: `pile-${index}`, x, y: ROW_Y, fan: 'down', step: 5 });
        const places = stackPositions(stack, PILE_DEEP);
        const sprites: CardSprite[] = [];

        places.forEach((place, depth) => {
          const top = depth === places.length - 1;
          const card: Card = top && face
            ? { rank: face.rank, suit: face.suit, id: `${face.suit}-${face.rank}`, faceUp: true }
            : { rank: 'A', suit: 'spades', id: `under-${index}-${depth}`, faceUp: false };
          // #region A card with its own stock, inks, back and court
          const sprite = new CardSprite(this.board, card, {
            width: CARD_W,
            paper: this.deck.paper,
            ink: this.ink(),
            backColor: this.deck.backColor,
            theme: this.deck.back,
            courtPalette: this.court(),
            courtWidth: COURT_RASTER,
          });
          // #endregion
          sprite.setPosition(place.x, place.y);
          this.root.push(sprite);
          sprites.push(sprite);
          this.cards.push(sprite);
        });

        orderStack(sprites, stack);

        if (face) {
          const loose = colorOf(face.suit);
          this.label(x, ROW_Y + 88, face.suit, '#cfead0');
          this.label(x, ROW_Y + 101, `counts as ${loose}`, '#7f9f88');
        } else {
          this.label(x, ROW_Y + 88, 'the deck', '#cfead0');
          this.label(x, ROW_Y + 101, DECK_THEME_LABELS[this.deck.back].toLowerCase(), '#7f9f88');
        }
      }

      private caption(rank: Rank): void {
        this.root.push(label(this.board, 240, 44, rank === '10' ? 'Ten' : rank, '#fdfdfd', 22, DISPLAY_FONT, '700'));
        this.label(240, 70,
          isCourtRank(rank) ? 'a court: its colors come from the palette, not the suit'
            : 'a pip, drawn in the suit’s own ink', '#7f9f88');
      }

      /** The line under the board, which says what you are looking at. */
      private say(text: string): void {
        const note = document.getElementById('note');
        if (note) note.textContent = text;
      }

      private label(x: number, y: number, text: string, color: string): void {
        this.root.push(label(this.board, x, y, text, color, 10, BODY_FONT));
      }

      // --- what the cards are made of ----------------------------------------

      /** The court palette, printed on the card's own stock. */
      private court(): CourtPalette {
        return { ...this.deck.court, paper: colorCss(this.deck.paper) };
      }

      // #region What each suit is printed in
      /** What each suit is printed in. Not what any of them counts as. */
      private ink(): Record<string, number> {
        return {
          hearts: this.deck.redInk, diamonds: this.deck.redInk,
          spades: this.deck.blackInk, clubs: this.deck.blackInk,
        };
      }
      // #endregion

      // --- controls -----------------------------------------------------------

      private step(by: number): void {
        this.rank = (this.rank + by + RANKS.length) % RANKS.length;
        this.build();
        this.report();
      }

      private wire(): void {
        const on = (id: string, event: string, run: (el: HTMLInputElement) => void) => {
          const el = document.getElementById(id) as HTMLInputElement | null;
          el?.addEventListener(event, () => run(el));
          return el;
        };

        // Colors, on `change` rather than `input`: a colour wheel fires a hundred
        // of those and each one is twenty cards and maybe four portraits.
        on('paper', 'change', (el) => this.set({ paper: cssColor(el.value) }));
        on('redink', 'change', (el) => this.set({ redInk: cssColor(el.value) }));
        on('blackink', 'change', (el) => this.set({ blackInk: cssColor(el.value) }));
        on('backcolor', 'change', (el) => this.set({ backColor: cssColor(el.value) }));
        for (const role of ['ink', 'gold', 'red', 'highlight'] as const) {
          on(`court-${role}`, 'change', (el) =>
            this.set({ court: { ...this.deck.court, [role]: el.value } }));
        }

        const backs = document.getElementById('backdesign') as HTMLSelectElement | null;
        if (backs) {
          for (const theme of DECK_THEMES) {
            backs.append(new Option(DECK_THEME_LABELS[theme], theme));
          }
          backs.value = this.deck.back;
          backs.addEventListener('change', () => this.set({ back: backs.value as DeckTheme }));
        }

        const preset = document.getElementById('courtpreset') as HTMLSelectElement | null;
        if (preset) {
          for (const theme of DECK_THEMES) {
            preset.append(new Option(DECK_THEME_LABELS[theme], theme));
          }
          preset.value = 'press';
          preset.addEventListener('change', () => {
            if (!preset.value) return;
            this.set(themeDeck(preset.value as DeckTheme));
          });
        }

        const shelf = document.getElementById('presets');
        if (shelf) {
          for (const preset of PRESETS) {
            const button = document.createElement('button');
            button.textContent = preset.name;
            button.dataset['deck'] = preset.name;
            button.title = preset.note;
            button.addEventListener('click', () => {
              this.deck = { ...preset.deck, court: { ...preset.deck.court } };
              this.showControls();
              this.build();
              this.report();
              this.say(`${preset.name} — ${preset.note}.`);
            });
            shelf.append(button);
          }
        }

        button(ctx, 'prev', () => this.step(-1));
        button(ctx, 'next', () => this.step(1));
        button(ctx, 'reset', () => {
          this.deck = defaults();
          this.showControls();
          this.build();
          this.report();
        });
        button(ctx, 'surprise', () => this.surprise());
        document.getElementById('deuter')?.addEventListener('click', (event) => {
          const board = document.getElementById('board');
          const isOn = board?.classList.toggle('deuter') ?? false;
          (event.currentTarget as HTMLElement).classList.toggle('on', isOn);
        });

        this.showControls();
        this.report();
      }

      private set(change: Partial<Editable>): void {
        this.deck = { ...this.deck, ...change };
        this.showControls();
        this.build();
        this.report();
      }

      private surprise(): void {
        const base = Math.floor(Math.random() * 360);
        // A dark deck one time in four, because it is the case that shows the
        // court's highlight doing its job and the case a light-only button would
        // never produce.
        const dark = Math.random() < 0.25;
        const stockLight = dark ? 8 + Math.random() * 8 : 88 + Math.random() * 10;
        this.deck = {
          paper: cssColor(hsl(base, dark ? 22 : 30, stockLight)),
          // The inks have to read against whatever stock was just chosen, which
          // means flipping them for a dark one rather than hoping.
          redInk: cssColor(hsl(base, 62, dark ? 64 : 42)),
          blackInk: cssColor(hsl((base + 190) % 360, 45, dark ? 78 : 24)),
          backColor: BACK_COLORS[Math.floor(Math.random() * BACK_COLORS.length)],
          back: DECK_THEMES[Math.floor(Math.random() * DECK_THEMES.length)],
          // Ink dark, field light, garment between - the three have to differ in
          // lightness and not only in hue, or two of them merge into one shape at
          // the size a card is played at.
          court: {
            ink: hsl((base + 210) % 360, 52, 28),
            gold: hsl((base + 60) % 360, 62, 66),
            red: hsl((base + 320) % 360, 56, 46),
            // The figure's own whites stay pale whatever the stock does. The
            // court's line work and black are drawn against this, not against
            // the card.
            highlight: hsl(base, 18, 94),
          },
        };
        this.showControls();
        this.build();
        this.report();
      }

      /** Which of the six this is, if it is one of them. */
      private named(): string | undefined {
        return PRESETS.find((preset) => {
          const a = preset.deck;
          const b = this.deck;
          return a.paper === b.paper && a.redInk === b.redInk && a.blackInk === b.blackInk
            && a.backColor === b.backColor && a.back === b.back
            && a.court.ink === b.court.ink && a.court.gold === b.court.gold
            && a.court.red === b.court.red && a.court.highlight === b.court.highlight;
        })?.name;
      }

      private showControls(): void {
        const active = this.named();
        for (const button of document.querySelectorAll<HTMLElement>('#presets button')) {
          button.classList.toggle('on', button.dataset['deck'] === active);
        }

        const put = (id: string, value: string) => {
          const el = document.getElementById(id) as HTMLInputElement | null;
          if (el) el.value = value;
          const hex = document.getElementById(`${id}-hex`);
          if (hex) hex.textContent = value;
        };
        put('paper', colorCss(this.deck.paper));
        put('redink', colorCss(this.deck.redInk));
        put('blackink', colorCss(this.deck.blackInk));
        put('backcolor', colorCss(this.deck.backColor));
        put('court-ink', this.deck.court.ink);
        put('court-gold', this.deck.court.gold);
        put('court-red', this.deck.court.red);
        put('court-highlight', this.deck.court.highlight ?? '#fdfdfd');
        const backs = document.getElementById('backdesign') as HTMLSelectElement | null;
        if (backs) backs.value = this.deck.back;
        const preset = document.getElementById('courtpreset') as HTMLSelectElement | null;
        if (preset) {
          const match = DECK_THEMES.find((theme) => {
            const p = COURT_PALETTES[theme];
            return p.ink === this.deck.court.ink && p.gold === this.deck.court.gold
              && p.red === this.deck.court.red
              && (this.deck.court.highlight ?? '#fdfdfd') === '#fdfdfd';
          });
          preset.value = match ?? '';
        }
      }

      /** The deck as the style object that would produce it. */
      private report(): void {
        const out = document.getElementById('style');
        if (!out) return;
        const ink = this.ink();
        out.textContent = `{
      paper: ${colorCss(this.deck.paper).replace('#', '0x')},
      backColor: ${colorCss(this.deck.backColor).replace('#', '0x')},
      theme: '${this.deck.back}',
      ink: {
        hearts: ${colorCss(ink.hearts).replace('#', '0x')}, diamonds: ${colorCss(ink.diamonds).replace('#', '0x')},
        spades: ${colorCss(ink.spades).replace('#', '0x')}, clubs: ${colorCss(ink.clubs).replace('#', '0x')},
      },
      courtPalette: {
        ink: '${this.deck.court.ink}', gold: '${this.deck.court.gold}',
        red: '${this.deck.court.red}', paper: '${colorCss(this.deck.paper)}',
        highlight: '${this.deck.court.highlight ?? '#fdfdfd'}',
      },
    }`;
      }
    }

    /** Hex, because an <input type=color> will not take anything else. */
    function hsl(h: number, s: number, l: number): string {
      const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(255 * v).toString(16).padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    }

    const board = ctx.board({
      parent: 'board',
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: '#13463a',
    });
    const editor = new DeckEditor(board);

    // What a rule says about each suit, for the smoke checks. None of it moves
    // when the inks do, and that is the thing worth holding: an editor that let
    // you recolor a deck into changing its own rules would be a bug wearing a
    // feature's clothes.
    // The lone-pip helper, for the smoke checks - a game draws empty places with
    // it and this page has none.
    expose({
      board, editor, suitTexture: (suit: string, color: number) => suitTexture(board, suit, color),
      rules: Object.fromEntries(SUITS.map((suit) => [suit, colorOf(suit)])),
    });
  },
});

standalone(scene);
