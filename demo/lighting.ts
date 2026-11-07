import './serve';
import {
  CardMaterial, CardSprite, MATERIALS, animatorOf, buildDeck, defineMaterial, defineScene, flipCard, paintFelt,
  seeded, shuffle, throwCard,
} from 'felt';
import { showCode } from './code';
import { button, expose, label, standalone } from './kit';

// Light on the board. Off unless a board asks for it; lit, a card tipped
// towards the lamp brightens and one tipped away darkens, its stock shows a
// highlight that slides as it moves, and its shadow is cast away from the
// light - further off and softer the higher the card is.

const W = 480;
const H = 640;
const HELD = { x: W / 2, y: 330 };
const DECK = { x: W - 64, y: H - 84 };
const ROW_Y = 128;

export const scene = defineScene({
  name: 'lighting',
  create(ctx) {
    showCode(ctx);

    // #region A lit board
    const board = ctx.board({
      parent: 'board', width: W, height: H, backgroundColor: '#13463a',
      // Where the lamp is (degrees round from the top edge, and up off the
      // table), how much light comes from everywhere, and the stock every
      // card is made of unless it says otherwise.
      light: { azimuth: -35, elevation: 50, ambient: 0.45, material: MATERIALS.linen },
    });
    const light = board.lighting;
    // #endregion
    const animator = animatorOf(board);

    // #region Materials are data
    // The four that come with the engine, and one of the game's own: a
    // pearl-coated stock, glossy with a faint colour in its highlight.
    const pearl = defineMaterial({ name: 'pearl', specular: 0.7, shininess: 300, sheen: 0.2, foil: 0.25 });
    const stocks: Record<string, CardMaterial> = { ...MATERIALS, pearl };
    // One card in each, up off the felt, so each casts its shadow.
    const shown = [MATERIALS.matte, MATERIALS.linen, MATERIALS.glossy, MATERIALS.foil];
    const row = shown.map((material, i) => {
      const card = new CardSprite(board, { id: `row-${i}`, suit: 'hearts', rank: (['A', 'K', 'Q', 'J'] as const)[i], faceUp: true },
        { material });
      card.setPosition(66 + i * 116, ROW_Y, 24);
      card.depth = 10;
      label(board, card.x, ROW_Y - 62, material.name.toUpperCase());
      return card;
    });
    // #endregion

    // #region Rocking: the sheen slides as the card tips
    // An offset on its own channel, so a flip composes with it.
    let rocking = true;
    function rock(card: CardSprite, phase: number): void {
      void animator.play(card, {
        channel: 'rock', duration: 3200,
        update: (t, offset) => {
          const a = 2 * Math.PI * (t + phase);
          offset.tilt = 0.55 * Math.sin(a);
          offset.turn = 0.4 * Math.sin(a * 2);
        },
        complete: () => { if (rocking) rock(card, phase); },
      });
    }
    row.forEach((card, i) => rock(card, i * 0.17));
    // #endregion

    // #region A card held up to the light
    // Lifted, it casts its shadow on the felt: the shape the tipped card
    // really throws, along the light's rays.
    const held = new CardSprite(board, { id: 'held', suit: 'spades', rank: 'A', faceUp: true });
    held.setPosition(HELD.x, HELD.y, 60);
    held.tilt = 0.35;
    held.depth = 20;
    // #endregion

    // The lamp, drawn on the felt at the edge it shines from.
    const lamp = paintFelt(board, { shape: 'ellipse', width: 14, stroke: 0 },
      { x: 0, y: 0, depth: -5, color: 'rgba(255, 209, 102, 0.85)' });
    const placeLamp = () => {
      const a = (light.azimuth * Math.PI) / 180;
      // Out to whichever edge of the board it is beyond.
      const dx = Math.sin(a);
      const dy = -Math.cos(a);
      const t = Math.min((W / 2 - 12) / Math.max(1e-6, Math.abs(dx)), (H / 2 - 12) / Math.max(1e-6, Math.abs(dy)));
      lamp.setPosition(W / 2 + dx * t, H / 2 + dy * t);
    };

    // A deck to toss and pick up from.
    let deck: CardSprite[] = shuffle(buildDeck(), seeded(7)).slice(0, 20).map((card, i) => {
      const sprite = new CardSprite(board, { ...card, faceUp: false });
      sprite.setPosition(DECK.x, DECK.y);
      sprite.depth = 100 + i;
      sprite.draggable = true;
      return sprite;
    });
    const loose = new Set<CardSprite>();
    let top = 200;

    // #region Tossing: high in the air, the shadow falls further and softer
    async function toss(): Promise<void> {
      const card = deck.pop();
      if (!card) return say('The deck is out.');
      loose.add(card);
      card.depth = ++top;
      card.setFaceUp(true);
      const at = { x: 60 + Math.random() * 260, y: 430 + Math.random() * 150 };
      await throwCard(board, card, at, { arc: 150, spins: 1, settleAngle: Math.round(Math.random() * 30 - 15) });
    }
    // #endregion

    // Picking a card up: the board lifts it, and its shadow goes with the light.
    let grip = { x: 0, y: 0 };
    let dragging: CardSprite | undefined;
    board.on('dragstart', (pointer, node) => {
      const card = node as CardSprite;
      if (deck.includes(card) && card !== deck[deck.length - 1]) { pointer.refuse?.(); return; }
      if (deck.includes(card)) { deck.pop(); loose.add(card); void flipCard(board, card, { faceUp: true, lift: 0 }); }
      animator.stop(card, 'move');
      grip = { x: pointer.x - card.x, y: pointer.y - card.y };
      card.depth = ++top;
      dragging = card;
    });
    board.on('drag', (pointer) => dragging?.setPosition(pointer.x - grip.x, pointer.y - grip.y));
    board.on('dragend', () => { dragging = undefined; });

    // #region Moving the light
    const slider = (id: string, apply: (v: number) => string) => {
      const input = ctx.$(`#${id}`) as HTMLInputElement;
      const show = () => { ctx.$(`#${id}-value`).textContent = apply(Number(input.value)); };
      ctx.listen(input, 'input', show);
      show();
      return input;
    };
    const azimuth = slider('azimuth', (v) => { light.azimuth = v; placeLamp(); return `${v}°`; });
    slider('elevation', (v) => { light.elevation = v; placeLamp(); return `${v}°`; });
    slider('ambient', (v) => { light.ambient = v; return v.toFixed(2); });
    slider('lift', (v) => { held.z = v; return `${v}`; });
    slider('tilt', (v) => { held.tilt = v; return v.toFixed(2); });
    slider('roll', (v) => { held.turn = v; return v.toFixed(2); });
    // The board's own stock: every card that does not name one.
    const select = ctx.$('#material') as HTMLSelectElement;
    for (const name of Object.keys(stocks)) select.add(new Option(name, name, false, name === light.material.name));
    ctx.listen(select, 'change', () => { light.material = stocks[select.value]; });
    // Round the board once, through the animator like any animation.
    function orbit(): Promise<void> {
      const from = light.azimuth;
      return animator.play(light, {
        channel: 'orbit', duration: 6000, policy: 'ignore',
        update: (t) => {
          light.azimuth = ((from + 360 * t + 180) % 360 + 360) % 360 - 180;
          azimuth.value = String(Math.round(light.azimuth));
          ctx.$('#azimuth-value').textContent = `${Math.round(light.azimuth)}°`;
          placeLamp();
        },
      });
    }
    // #endregion

    button(ctx, 'toss', () => void toss());
    button(ctx, 'flip', () => row.forEach((card, i) => void flipCard(board, card, { lift: 40, delay: i * 90 })));
    button(ctx, 'orbit', () => void orbit());
    button(ctx, 'rock', (el) => {
      rocking = !rocking;
      if (rocking) row.forEach((card, i) => rock(card, i * 0.17));
      else for (const card of row) animator.stop(card, 'rock');
      el.textContent = `Rocking: ${rocking ? 'on' : 'off'}`;
    });
    button(ctx, 'lit', (el) => {
      if (light.on) light.off(); else light.set();
      lamp.visible = light.on;
      el.textContent = `Light: ${light.on ? 'on' : 'off'}`;
      say();
    });

    function say(what = ''): void {
      ctx.$('#note').textContent = what || (light.on
        ? `Lit from ${Math.round(light.azimuth)}° at ${Math.round(light.elevation)}° up. Drag a card off the deck to lift it.`
        : 'Unlit: exactly what a board with no light draws.');
    }
    placeLamp();
    say();
    expose({
      board, light, row, held, stocks, toss, orbit,
      deck: () => deck, loose: () => [...loose],
      stopRocking: () => { rocking = false; for (const card of row) animator.stop(card, 'rock'); },
    });
  },
});

standalone(scene);
