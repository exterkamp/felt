import type { Region } from '../gl/atlas.js';
import { lensDistance, project } from '../gl/lens.js';
import type { MeshBuffers, Renderer } from '../gl/renderer.js';
import { Board, BoardMesh, nextMeshSerial } from '../scene/board.js';
import {
  Quad, TuckBoxAtlas, TuckBoxSize, boxQuads, deckBlockSize, deckRise, flapQuads,
  quadVertices, tuckBoxAtlas, tuckBoxSize,
} from '../core/index.js';
import { TuckBoxArt, renderTuckBox } from '../art/tuck-box-art.js';

// The box a deck comes in, as a solid thing on the table.
//
// Everything else on a board is a card or a sprite, flat or bent, drawn in one
// instanced call. A box has a back and two sides you are meant to see, so it
// is a mesh: real vertices from `boxQuads` and `flapQuads`, a real projection
// and a rotation that turns it rather than skewing a picture of it.
//
// phaser-card-engine had to make it three meshes and add them in a careful
// order, because Phaser sorted faces within a mesh and never between them -
// the lid laid back had to pass behind the deck while the front panel passed
// in front of it. Here the three parts share a depth buffer, so they occlude
// each other the way solid things do and the order they are drawn in stops
// mattering.

const SHUT = 0;
const DEFAULT_FOV = 26;

export interface TuckBoxOptions {
  /** The card the box is cut to fit. Board units. */
  cardWidth?: number;
  cards?: number;
  /** Which deck's artwork is on it, and what that is printed over. */
  art: TuckBoxArt;
  /**
   * How wide the lens is, in degrees. A box is a small object seen close to:
   * at 45 the near corner runs away from the far one and it reads as a room.
   * 26 is about what a phone camera does to a thing on a table.
   */
  fov?: number;
  depth?: number;
}

type Part = 'body' | 'flap' | 'block';

function partQuads(part: Part, size: TuckBoxSize, open: number): Quad[] {
  if (part === 'body') return boxQuads(size);
  if (part === 'flap') return flapQuads(size, open);
  // The deck inside: a closed block with its own cut edge on every side but
  // the one showing the top card's back.
  return boxQuads(size, 'leaves', 'face', 'leaves');
}

interface PartMesh {
  part: Part;
  buffers?: MeshBuffers;
  positions: Float32Array;
  uvs: Float32Array;
  region: Region;
  atlas: TuckBoxAtlas;
  size: TuckBoxSize;
  dirty: boolean;
}

/** Whether this board can draw one. Every felt board can; kept for ports. */
export function supportsTuckBox(_board: Board): boolean {
  return true;
}

export class TuckBox implements BoardMesh {
  readonly drawKind = 'mesh' as const;
  readonly serial = nextMeshSerial();
  readonly size: TuckBoxSize;
  readonly block: TuckBoxSize;
  private readonly parts: PartMesh[];
  private readonly distance: number;
  private openAmount = SHUT;
  private _turn = 0;
  private _tilt = 0;
  private _visible = true;
  private _depth = 0;
  private deckShown = true;
  private destroyed = false;
  private readonly stepper: (time: number, delta: number) => void;
  private _spin = 0;

  constructor(private readonly board: Board, public x: number, public y: number,
    options: TuckBoxOptions) {
    const cardWidth = options.cardWidth ?? 60;
    const cards = options.cards ?? 52;
    this.size = tuckBoxSize(cardWidth, cards);
    this.block = deckBlockSize(cardWidth, cards);
    this.distance = lensDistance(options.fov ?? DEFAULT_FOV, board.height);
    this._depth = options.depth ?? 0;

    const boxRegion = renderTuckBox(board, this.size, { ...options.art, kind: 'box' });
    const deckRegion = renderTuckBox(board, this.block, { ...options.art, kind: 'deck' });
    const scale = options.art.scale ?? 6;
    const make = (part: Part, size: TuckBoxSize, region: Region): PartMesh => {
      const atlas = tuckBoxAtlas(size, scale);
      const { positions, uvs } = quadVertices(partQuads(part, size, SHUT), atlas);
      // The box's own UVs are 0-1 of its print; the print is one region of
      // the board's atlas, so they are mapped into it once, here.
      const mapped = new Float32Array(uvs.length);
      for (let i = 0; i < uvs.length; i += 2) {
        mapped[i] = region.u0 + uvs[i] * (region.u1 - region.u0);
        mapped[i + 1] = region.v0 + uvs[i + 1] * (region.v1 - region.v0);
      }
      return { part, positions: new Float32Array(positions), uvs: mapped, region, atlas, size, dirty: false };
    };
    this.parts = [
      make('flap', this.size, boxRegion),
      make('block', this.block, deckRegion),
      make('body', this.size, boxRegion),
    ];
    this.stepper = (_time, delta) => this.step(delta);
    board.addMesh(this);
    board.once('destroy', () => this.release());
  }

  /**
   * Radians a second it turns on the spot. Stepped from the board's own loop
   * while it is non-zero, so a spinning box keeps the board awake and a still
   * one lets it sleep.
   */
  get spin(): number { return this._spin; }
  set spin(v: number) {
    const was = this._spin;
    this._spin = v;
    if (!was && v) this.board.on('update', this.stepper);
    if (was && !v) this.board.off('update', this.stepper);
  }

  get depth(): number { return this._depth; }
  set depth(v: number) { this._depth = v; this.board.resort(); }
  get visible(): boolean { return this._visible; }
  set visible(v: boolean) { this._visible = v; this.board.touch(); }
  /** Radians about the vertical. */
  get turn(): number { return this._turn; }
  set turn(v: number) { this._turn = v; this.board.touch(); }
  get tilt(): number { return this._tilt; }
  set tilt(v: number) { this._tilt = v; this.board.touch(); }

  /** 0 shut, 1 laid back on a broken crease. */
  get open(): number {
    return this.openAmount;
  }

  set open(value: number) {
    const next = Math.max(0, Math.min(1, value));
    if (next === this.openAmount) return;
    this.openAmount = next;
    const flap = this.parts[0];
    flap.positions.set(quadVertices(flapQuads(this.size, next), flap.atlas).positions);
    flap.dirty = true;
    this.board.touch();
  }

  /** Turns the box on the spot by its `spin`. The board calls it every frame. */
  step(deltaMs: number): void {
    if (this.spin) this.turn = this._turn + this.spin * (deltaMs / 1000);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  /** Hides the block of cards, leaving an empty box. */
  showDeck(visible: boolean): void {
    this.deckShown = visible;
    this.board.touch();
  }

  /** How far the deck has risen out of the box, in model units. */
  private deckOffset(): number {
    // Straight up out of the box along its own axis, starting from lying on
    // its bottom, and stopping with a third of it still in - a deck that
    // clears the box entirely is a deck floating above a box.
    const seated = (this.size.height - this.block.height) / 2;
    const rise = deckRise(this.openAmount) * this.block.height * 0.68;
    return rise - seated;
  }

  /** The rotation, row-major: tipped, then turned, in model space. */
  private rotation(): number[] {
    const [ct, st] = [Math.cos(this._tilt), Math.sin(this._tilt)];
    const [cy, sy] = [Math.cos(this._turn), Math.sin(this._turn)];
    // Rx(tilt) * Ry(turn)
    return [
      cy, 0, sy,
      st * sy, ct, -st * cy,
      -ct * sy, st, ct * cy,
    ];
  }

  /**
   * Where the block of cards is on the board, in board units.
   *
   * What a game needs to put the real cards exactly where the block had got
   * to - so it is read off the block's own vertices through the same lens the
   * screen uses, rather than worked out a second way that could disagree.
   */
  deckCentre(): { x: number; y: number } {
    const block = this.parts[1];
    const r = this.rotation();
    const lift = this.deckOffset();
    let sx = 0;
    let sy = 0;
    const p = block.positions;
    const n = p.length / 3;
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = [p[i], p[i + 1] + lift, p[i + 2]];
      const mx = r[0] * x + r[1] * y + r[2] * z;
      const my = r[3] * x + r[4] * y + r[5] * z;
      const mz = r[6] * x + r[7] * y + r[8] * z;
      const at = project(this.x + mx, this.y - my, mz, this.x, this.y, this.distance);
      sx += at.x;
      sy += at.y;
    }
    return { x: sx / Math.max(1, n), y: sy / Math.max(1, n) };
  }

  drawMesh(renderer: Renderer): void {
    if (!this._visible || this.destroyed) return;
    renderer.clearDepth();
    const rotation = this.rotation();
    for (const part of this.parts) {
      if (part.part === 'block' && !this.deckShown) continue;
      // Made again after a lost context took the old ones with it.
      if (!part.buffers || part.buffers.generation !== renderer.generation) {
        part.buffers = renderer.createMesh(part.positions, part.uvs);
      }
      else if (part.dirty) renderer.updateMesh(part.buffers, part.positions);
      part.dirty = false;
      renderer.drawMesh({
        buffers: part.buffers,
        layer: part.region.page,
        rotation,
        offset: [0, part.part === 'block' ? this.deckOffset() : 0, 0],
        origin: [this.x, this.y, 0],
        centre: [this.x, this.y],
        distance: this.distance,
        // A box is solid, so the far side of every panel is a side nobody
        // can see. Culling them is what makes it a box rather than a
        // wireframe of one - and why the interior has panels of its own.
        cull: 'ccw',
      });
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.board.off('update', this.stepper);
    this.board.detach(this);
    this.release();
  }

  private release(): void {
    for (const part of this.parts) {
      if (part.buffers && !this.board.isDestroyed) this.board.renderer.destroyMesh(part.buffers);
      part.buffers = undefined;
      this.board.atlas.release(part.region);
    }
  }
}
