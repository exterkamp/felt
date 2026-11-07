// The bench, measuring felt. Not a demo (no tile, no scene): a page that runs
// itself and reports. Its twin is demo/bench.ts on phaser-card-engine's
// `bench` branch; bench-core.ts is the same file in both, and the cards here
// are made, laid out and moved exactly as there.
import { run, type Adapter } from './bench-core';
import './serve';
import { CardSprite, buildDeck, cardsReady, createBoard } from '@exterkamp/felt';

const W = 560;
const H = 700;
const board = createBoard({ parent: 'board', width: W, height: H, backgroundColor: '#13463a' });
const deck = buildDeck();
const cards: { sprite: CardSprite; phase: number; speed: number; cx: number; cy: number; r: number }[] = [];

function make(n: number): void {
  while (cards.length > n) cards.pop()!.sprite.destroy();
  while (cards.length < n) {
    const i = cards.length;
    const sprite = new CardSprite(board, { ...deck[i % deck.length], faceUp: i % 3 !== 0 }, { width: 44 });
    sprite.depth = i;
    const c = { sprite, phase: (i * 2.399) % (Math.PI * 2), speed: 0.4 + ((i * 7) % 13) / 13,
      cx: 40 + ((i * 37) % (W - 80)), cy: 40 + ((i * 53) % (H - 80)), r: 10 + (i % 30) };
    cards.push(c);
    place(c, 0);
  }
}

function place(c: (typeof cards)[number], t: number): void {
  const a = c.phase + t * c.speed;
  c.sprite.x = c.cx + Math.cos(a) * c.r;
  c.sprite.y = c.cy + Math.sin(a) * c.r;
  c.sprite.angle = (a * 30) % 360;
}

const adapter: Adapter = {
  name: 'felt',
  async start() {
    make(52);
    await cardsReady(board);
  },
  async setCount(n) {
    make(n);
    await cardsReady(board);
  },
  move(t) {
    for (const c of cards) place(c, t);
  },
};

void run(adapter, document.getElementById('out')!);
