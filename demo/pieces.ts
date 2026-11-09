import './serve';
import {
  CASINO_DICE, ChipStack, DISPLAY_FONT, PiecesState, createPieces, defineScene, paintFelt, seeded,
} from '@exterkamp/felt';
import { showCode } from './code';
import { button, expose, label, standalone } from './kit';

// Pieces that are not cards: chips, a dealer button and blinds, a pair of
// dice and a cribbage board, all drawn by the engine on the same board (and
// in the same draw call) as the cards would be.

const W = 480;
const H = 760;

interface Seat {
  id: string;
  name: string;
  bank: { x: number; y: number };
  bet: { x: number; y: number };
  button: { x: number; y: number };
  chips: number[];
}

const SEATS: Seat[] = [
  { id: 'north', name: 'North', bank: { x: 240, y: 186 }, bet: { x: 240, y: 252 }, button: { x: 300, y: 228 },
    chips: [100, 100, 25, 25, 25, 25, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1] },
  { id: 'east', name: 'East', bank: { x: 418, y: 380 }, bet: { x: 344, y: 350 }, button: { x: 378, y: 302 },
    chips: [500, 100, 100, 25, 25, 25, 25, 25, 25, 5, 5, 5] },
  { id: 'you', name: 'You', bank: { x: 196, y: 540 }, bet: { x: 240, y: 446 }, button: { x: 300, y: 486 },
    chips: [100, 100, 100, 100, 25, 25, 25, 25, 25, 25, 25, 25, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1, 1, 1] },
  // No fives at all: every bet West makes breaks a chip first.
  { id: 'west', name: 'West', bank: { x: 62, y: 380 }, bet: { x: 136, y: 350 }, button: { x: 102, y: 302 },
    chips: [100, 100, 25, 25, 25, 25] },
];
const POT = { x: 240, y: 344 };
const PEGS = { x: 240, y: 70 };
const DICE_REST = [{ x: 206, y: 660 }, { x: 266, y: 672 }];
const DICE_FROM = { x: 450, y: 720 };
const ANTE = 15;

export const scene = defineScene({
  name: 'pieces',
  create(ctx) {
    showCode(ctx);
    const board = ctx.board({ parent: 'board', width: W, height: H, backgroundColor: '#13463a' });
    const note = (text: string) => { ctx.$('#note').textContent = text; };

    // The felt: a betting circle per seat, the pot, the dice strip.
    for (const seat of SEATS) {
      paintFelt(board, { shape: 'ellipse', width: 52, stroke: 1.5 }, { ...seat.bet, color: 'rgba(207, 234, 208, 0.3)' });
      label(board, seat.bank.x, seat.bank.y + 30, seat.name.toUpperCase());
    }
    paintFelt(board, { shape: 'ellipse', width: 84, stroke: 2, dash: [5, 4] }, { ...POT, color: 'rgba(255, 209, 102, 0.45)' });
    label(board, POT.x, POT.y + 50, 'POT', '#d8b45a');
    paintFelt(board, { shape: 'rect', width: 300, height: 92, radius: 10, stroke: 1.5 }, { x: 236, y: 666, color: 'rgba(207, 234, 208, 0.22)' });
    paintFelt(board, { text: 'DICE', font: DISPLAY_FONT, size: 11, spacing: 0.3 }, { x: 236, y: 610, color: 'rgba(207, 234, 208, 0.45)' });

    // #region Stacks: a bank and a bet circle for each seat, and the pot
    const pieces = createPieces(board, { diameter: 34 });
    const banks = new Map<string, ChipStack>();
    const bets = new Map<string, ChipStack>();
    for (const seat of SEATS) {
      banks.set(seat.id, pieces.stack({ id: `bank-${seat.id}`, ...seat.bank, chips: seat.chips }));
      bets.set(seat.id, pieces.stack({ id: `bet-${seat.id}`, ...seat.bet }));
    }
    const pot = pieces.stack({ id: 'pot', ...POT, messy: 1 });
    // Chips by hand: pick one up and the ones on it come too; drop or flick
    // them on another stack, or on the felt for a stack of their own.
    // Flicked hard, a single chip is tossed instead: end over end off the
    // thumb, at the stack it was flicked towards.
    pieces.draggable({ toss: true });
    pieces.on('move', (move) => { if (move.by === 'drag' || move.by === 'flick') say(); });
    // #endregion

    // #region Betting: pay makes change, collect sweeps, the pot goes to the winner
    async function bet(): Promise<void> {
      if (pieces.busy) return;
      note(`Everyone puts in ${ANTE}. West has no fives: a 25 is broken first.`);
      await Promise.all(SEATS.map((seat, i) => ctx.wait(i * 90).then(() => {
        const bank = banks.get(seat.id)!;
        return bank.value >= ANTE ? pieces.pay(bank, bets.get(seat.id)!, ANTE) : undefined;
      })));
      say();
    }
    async function collect(): Promise<void> {
      if (pieces.busy) return;
      await pieces.collect([...bets.values()], pot);
      say();
    }
    async function win(): Promise<void> {
      if (pieces.busy || pot.empty) return;
      const winner = SEATS[(dealer + 1 + hands) % SEATS.length];
      note(`${winner.name} takes the pot of ${pot.value}.`);
      await pieces.move(pot, banks.get(winner.id)!, { stagger: 25 });
      hands++;
      say();
    }
    // #endregion

    // #region Tossing: a chip flipped off the thumb, end over end
    function toss(): void {
      const bank = banks.get('you')!;
      const chip = bank.chips.at(-1);
      if (!chip) return;
      void pieces.toss(chip, pot).then(say);
    }
    // #endregion

    // #region The dealer button and the blinds move round the seats
    let dealer = 0;
    let hands = 0;
    const at = (i: number) => SEATS[i % SEATS.length].button;
    const dealerButton = pieces.token({ id: 'dealer', label: 'D', ...at(dealer), height: 30 });
    const small = pieces.token({ id: 'sb', label: 'SB', color: '#2a63b8', ink: '#f4efe2', height: 24, ...at(dealer + 1) });
    const big = pieces.token({ id: 'bb', label: 'BB', color: '#c6232b', ink: '#f4efe2', height: 24, ...at(dealer + 2) });
    function nextHand(): void {
      dealer = (dealer + 1) % SEATS.length;
      void dealerButton.moveTo(at(dealer).x, at(dealer).y);
      void small.moveTo(at(dealer + 1).x, at(dealer + 1).y, { delay: 80 });
      void big.moveTo(at(dealer + 2).x, at(dealer + 2).y, { delay: 160 });
      note(`${SEATS[dealer].name} deals.`);
    }
    // #endregion

    // #region Dice: the result is the seed's, the tumble only shows it
    const dice = DICE_REST.map((rest, i) => pieces.die({ id: `die-${i + 1}`, ...rest, size: 30, style: CASINO_DICE, value: i + 3 }));
    let rolls = 0;
    async function roll(values?: number[]): Promise<number[]> {
      if (dice.some((d) => d.rolling)) return dice.map((d) => d.value);
      const seed = 1000 + rolls++;
      const scatter = seeded(seed);
      const to = DICE_REST.map((p) => ({ x: p.x + (scatter() - 0.5) * 50, y: p.y + (scatter() - 0.5) * 24 }));
      const result = pieces.roll(dice, { seed, values, from: DICE_FROM, to });
      // Known before they land: what the game would act on.
      note(`Rolling seed ${seed}: it will be ${dice.map((d) => d.value).join(' and ')}.`);
      const faces = await result;
      note(`${faces.join(' + ')} = ${faces[0] + faces[1]}${faces[0] + faces[1] === 7 ? ' - seven out!' : ''}`);
      return faces;
    }
    // #endregion

    // #region The cribbage board: the back peg leapfrogs the front one
    const crib = pieces.pegBoard({ id: 'crib', ...PEGS, colors: ['#d23a33', '#2f7fd1'] });
    const counts = seeded(7);
    let turn = 0;
    function peg(player = turn, points = Math.floor(counts() * 13)): Promise<unknown> {
      turn = (player + 1) % 2;
      const done = crib.peg(player, points);
      note(`${player ? 'Blue' : 'Red'} pegs ${points}: ${crib.score(0)} to ${crib.score(1)}.`);
      return done;
    }
    // #endregion

    // #region Saving: the pieces as plain data
    let saved: PiecesState | undefined;
    function save(): void {
      saved = pieces.state();
      ctx.$<HTMLButtonElement>('#restore').disabled = false;
      note(`Saved: ${JSON.stringify(saved).length} bytes of plain data.`);
    }
    function restore(): void {
      if (!saved) return;
      pieces.restore(saved);
      say();
    }
    // #endregion

    function say(): void {
      note(SEATS.map((s) => `${s.name} ${banks.get(s.id)!.value}`).join(' · ') + ` · pot ${pot.value}`);
    }

    button(ctx, 'bet', () => void bet());
    button(ctx, 'collect', () => void collect());
    button(ctx, 'win', () => void win());
    button(ctx, 'next', nextHand);
    button(ctx, 'toss', toss);
    button(ctx, 'roll', () => void roll());
    button(ctx, 'peg', () => void peg());
    button(ctx, 'colorup', () => { pieces.colorUp(banks.get('you')!); say(); });
    button(ctx, 'save', save);
    button(ctx, 'restore', restore);
    say();
    expose({
      board, pieces, banks, bets, pot, dice, crib, dealerButton, seats: SEATS,
      bet, collect, win, toss, nextHand, roll, peg, save, restore, ante: ANTE,
    });
  },
});

standalone(scene);
