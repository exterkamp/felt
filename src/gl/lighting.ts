// Light on the board, and what the cards are made of.
//
// Off by default: a board nobody lit draws exactly what it always drew, to
// the pixel, and pays one uniform for it. Lit, three things change and all
// three come out of one light:
//
// - **Shading.** A card turned towards the light brightens and one turned
//   away darkens. Normalised so that a card lying flat on the felt is lit
//   exactly as it was painted - only what tips changes - which keeps a lit
//   board's resting faces crisp and their colours the deck's own.
// - **Sheen.** The card stock has a material: a highlight of some size and
//   strength, a broad satin glow, a woven grain in the stock and, for foil,
//   a highlight that runs through the colours. As a card tilts, rolls or is
//   flipped the highlight slides across it, because it is where the light's
//   reflection meets the camera.
// - **Shadows** fall away from the light. A card lying down throws the
//   short soft halo it always had, pushed away from the light; a card in the
//   air is projected onto the felt along the light's rays - so its shadow is
//   the shape the tipped card really casts, further off the higher it is and
//   softer with it.
//
// The arithmetic lives here and again in the fragment shader (shaders.ts),
// the way the lens does: this copy is what the specs test, and what a game
// can ask ("where does this card's shadow land?") without a GPU.

export type Vec3 = [number, number, number];

/**
 * What a card's stock is like under a light. Plain data: a game defines its
 * own with `defineMaterial`, and four come with the engine (`MATERIALS`).
 */
export interface CardMaterial {
  readonly name: string;
  /** Peak brightness of the highlight, 0 for none. Around 0-1. */
  readonly specular: number;
  /** How tight the highlight is: a Blinn-Phong exponent, 1-2048. Higher is glossier. */
  readonly shininess: number;
  /** 0-1: how much the highlight takes the card's own colour, as metal does. */
  readonly metallic: number;
  /** A broad satin glow round the highlight, 0-1. */
  readonly sheen: number;
  /** How deep the stock's weave or emboss is, 0-1. 0 is smooth. */
  readonly grain: number;
  /** The weave's period, in board units. */
  readonly grainScale: number;
  /** 0-1: the highlight runs through the colours as the card turns - foil. */
  readonly foil: number;
}

const MATERIAL_DEFAULTS: Omit<CardMaterial, 'name'> = {
  specular: 0.2, shininess: 24, metallic: 0, sheen: 0, grain: 0, grainScale: 1.6, foil: 0,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A material, with anything not given taken from plain card stock and every
 * number held to what the shader can use.
 */
export function defineMaterial(spec: Partial<CardMaterial> & { name: string }): CardMaterial {
  const m = { ...MATERIAL_DEFAULTS, ...spec };
  return Object.freeze({
    name: m.name,
    specular: clamp(m.specular, 0, 4),
    shininess: clamp(m.shininess, 1, 2048),
    metallic: clamp(m.metallic, 0, 1),
    sheen: clamp(m.sheen, 0, 2),
    grain: clamp(m.grain, 0, 1),
    grainScale: clamp(m.grainScale, 0.25, 64),
    foil: clamp(m.foil, 0, 1),
  });
}

/** The materials that come with the engine. */
export const MATERIALS = Object.freeze({
  /** Uncoated paper: barely a highlight, wide and dull. */
  matte: defineMaterial({ name: 'matte', specular: 0.06, shininess: 8, sheen: 0.04 }),
  /** Linen-finish casino stock: a soft highlight broken up by the weave. */
  linen: defineMaterial({ name: 'linen', specular: 0.3, shininess: 80, sheen: 0.08, grain: 0.4, grainScale: 2.4 }),
  /** Plastic-coated: a small bright highlight that slides across it. */
  glossy: defineMaterial({ name: 'glossy', specular: 0.9, shininess: 700, sheen: 0.1 }),
  /** Foil: a metal highlight in the card's own colour, through the rainbow. */
  foil: defineMaterial({ name: 'foil', specular: 1.1, shininess: 160, metallic: 0.7, sheen: 0.12, foil: 0.8 }),
});

/** How a board is lit. Everything is optional; see `DEFAULT_LIGHT`. */
export interface LightOptions {
  /**
   * Where the light is round the board, in degrees clockwise from the top
   * edge: 0 is a light beyond the top of the board (shadows fall down it),
   * 90 one off to the right.
   */
  azimuth?: number;
  /** How high it stands, in degrees above the table. 90 is straight overhead. */
  elevation?: number;
  /** The light's colour, 0xrrggbb. */
  color?: number;
  /** 1 is a card lying flat drawn exactly as painted. */
  intensity?: number;
  /**
   * 0-1: how much of the light comes from everywhere rather than from the
   * lamp. Higher is flatter; 1 is no shading by tilt at all.
   */
  ambient?: number;
  /** How much softer a shadow grows per unit the card is lifted. */
  softness?: number;
  /** How dark the shadows are, times each card's own. */
  shadow?: number;
  /**
   * How far the lamp is from the middle of the board, in board heights. Its
   * highlight is a reflection of a lamp this close, so it is a spot that
   * slides across a card rather than the whole card flaring at once. The
   * shading and the shadows take it as far off as the sun. Default 1.2.
   */
  distance?: number;
  /** The material of every card that does not name its own. */
  material?: CardMaterial;
}

export type Light = Required<LightOptions>;

/** The light a board gets when lit without saying how. */
export const DEFAULT_LIGHT: Light = Object.freeze({
  azimuth: -35,
  elevation: 50,
  color: 0xffffff,
  intensity: 1,
  ambient: 0.45,
  softness: 0.03,
  shadow: 1,
  distance: 1.2,
  material: MATERIALS.linen,
});

/** The lowest the light can stand: below it a shadow would run off the board. */
export const MIN_ELEVATION = 12;

/**
 * The unit vector from the table towards a light at this azimuth and
 * elevation, in board space: x right, y down the board, z up off the table.
 */
export function lightDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (clamp(elevationDeg, MIN_ELEVATION, 90) * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * How much brighter a surface facing `normal` is than one lying flat, under
 * a light from `light` with this much ambient. 1 for a card on the felt;
 * above for one tipped towards the light, below for one tipped away.
 */
export function diffuseShade(normal: Vec3, light: Vec3, ambient: number): number {
  const flat = ambient + (1 - ambient) * Math.max(light[2], 0);
  return (ambient + (1 - ambient) * Math.max(dot(normal, light), 0)) / Math.max(flat, 1e-4);
}

/**
 * The highlight a material shows at a point facing `normal`, seen from
 * `view` (towards the camera), under `light`: the main lobe plus the broad
 * satin one. Before colour, grain and foil. The shader's arithmetic.
 */
export function specularAt(normal: Vec3, light: Vec3, view: Vec3, material: CardMaterial): number {
  const ndl = dot(normal, light);
  if (ndl <= 0) return 0;
  const h = normalize([light[0] + view[0], light[1] + view[1], light[2] + view[2]]);
  const ndh = Math.max(dot(normal, h), 0);
  const lit = Math.min(1, ndl * 4);
  return lit * (material.specular * ndh ** material.shininess + material.sheen * ndh ** SHEEN_POWER);
}

/** The satin lobe's exponent: wide. */
export const SHEEN_POWER = 4;

/**
 * The longest a shadow is allowed to fall per unit of height. A light near
 * the horizon would otherwise throw a card's shadow off the board.
 */
export const MAX_SHADOW_REACH = 3;

/**
 * How far a shadow moves across the felt for each unit its card is above
 * it: the light's direction flattened onto the table and turned away from
 * it, capped at `MAX_SHADOW_REACH`.
 */
export function shadowReach(light: Vec3): { x: number; y: number } {
  const z = Math.max(light[2], 1e-3);
  let x = -light[0] / z;
  let y = -light[1] / z;
  const l = Math.hypot(x, y);
  if (l > MAX_SHADOW_REACH) { x *= MAX_SHADOW_REACH / l; y *= MAX_SHADOW_REACH / l; }
  return { x, y };
}

/**
 * The height a card lying on the felt casts its shadow from: the thickness
 * the halo has always suggested, 2.5 units for a 60-unit card. A card in the
 * air adds its own height to it, so its shadow leaves the halo's place
 * without a jump.
 */
export const restingShadowHeight = (cardWidth: number): number => 2.5 * (cardWidth / 60);

/**
 * Where on the felt the shadow of a point at `height` above it lands,
 * relative to the point: along the light's rays.
 */
export function shadowOffset(height: number, light: Vec3): { x: number; y: number } {
  const r = shadowReach(light);
  return { x: r.x * height, y: r.y * height };
}

/** Where a point in the air casts onto the felt along the light: z = 0. */
export function projectOntoTable(point: Vec3, light: Vec3): { x: number; y: number } {
  const o = shadowOffset(point[2], light);
  return { x: point[0] + o.x, y: point[1] + o.y };
}

/**
 * How much bigger and blurrier a shadow is at this height: 1 on the felt,
 * growing by `softness` a unit. Both its spread and its blur scale by it.
 */
export function shadowSpread(height: number, softness: number): number {
  return 1 + Math.max(0, height) * softness;
}

/**
 * The light on a board. The board has one, off until lit; set it and every
 * card on the board is drawn under it from the next frame.
 *
 * Its numbers are plain properties, so they can be tweened (`azimuth`,
 * `elevation`, `intensity`, `ambient`) and each change draws a frame.
 */
export class Lighting {
  private _on = false;
  private light: { -readonly [K in keyof Light]: Light[K] } = { ...DEFAULT_LIGHT };
  private readonly slots = new Map<CardMaterial, number>();
  private readonly list: CardMaterial[] = [];
  private warned = false;
  /** Bumped on every change; anything caching what the light is asks it. */
  version = 0;
  /** The material table as the shader reads it: two vec4s a slot. */
  readonly materialData = new Float32Array(MATERIAL_SLOTS * 8);

  constructor(private readonly changed: () => void = () => {}) {
    this.writeSlot(0, this.light.material);
  }

  /** Whether the board is lit. */
  get on(): boolean { return this._on; }

  /**
   * Lights the board, with these settings on top of the current ones -
   * `set({})` lights it as it last was, or with `DEFAULT_LIGHT`.
   */
  set(options: LightOptions = {}): this {
    this._on = true;
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) (this.light as Record<string, unknown>)[key] = value;
    }
    if (options.material) this.writeSlot(0, options.material);
    return this.touch();
  }

  /** Back to unlit: the board draws as if there were no light at all. */
  off(): this {
    if (!this._on) return this;
    this._on = false;
    return this.touch();
  }

  /** The light as it is now, every field filled in. */
  get settings(): Light {
    return { ...this.light };
  }

  get azimuth(): number { return this.light.azimuth; }
  set azimuth(v: number) { if (v !== this.light.azimuth) { this.light.azimuth = v; this.touch(); } }
  get elevation(): number { return this.light.elevation; }
  set elevation(v: number) { if (v !== this.light.elevation) { this.light.elevation = v; this.touch(); } }
  get intensity(): number { return this.light.intensity; }
  set intensity(v: number) { if (v !== this.light.intensity) { this.light.intensity = v; this.touch(); } }
  get ambient(): number { return this.light.ambient; }
  set ambient(v: number) { if (v !== this.light.ambient) { this.light.ambient = v; this.touch(); } }
  get softness(): number { return this.light.softness; }
  set softness(v: number) { if (v !== this.light.softness) { this.light.softness = v; this.touch(); } }
  get color(): number { return this.light.color; }
  set color(v: number) { if (v !== this.light.color) { this.light.color = v; this.touch(); } }
  /** The board's material: every card that does not name its own. */
  get material(): CardMaterial { return this.light.material; }
  set material(m: CardMaterial) {
    if (m === this.light.material) return;
    this.light.material = m;
    this.writeSlot(0, m);
    this.touch();
  }

  /** The unit vector towards the light. */
  get direction(): Vec3 {
    return lightDirection(this.light.azimuth, this.light.elevation);
  }

  /**
   * The slot a material has in the shader's table, giving it one the first
   * time it is asked. 0 is the board's own material; a card with none of its
   * own is drawn in slot 0 too. Past `MATERIAL_SLOTS - 1` distinct materials
   * the rest fall back to the board's, with one warning.
   */
  slot(material: CardMaterial | undefined): number {
    if (!material || material === this.light.material) return 0;
    const known = this.slots.get(material);
    if (known !== undefined) return known;
    if (this.list.length >= MATERIAL_SLOTS - 1) {
      if (!this.warned) console.warn(`felt: more than ${MATERIAL_SLOTS - 1} card materials on one board`);
      this.warned = true;
      return 0;
    }
    this.list.push(material);
    const at = this.list.length;
    this.slots.set(material, at);
    this.writeSlot(at, material);
    return at;
  }

  /**
   * What the shader is handed, packed, for a board this size. Valid until
   * the next change.
   */
  uniforms(boardWidth = 0, boardHeight = 0): LightingUniforms {
    const l = this.light;
    const dir = lightDirection(l.azimuth, l.elevation);
    const lamp = lampPosition(dir, boardWidth, boardHeight, l.distance);
    const reach = shadowReach(dir);
    const u = this.packed;
    u.on = this._on;
    u.direction[0] = dir[0]; u.direction[1] = dir[1]; u.direction[2] = dir[2];
    u.lamp[0] = lamp[0]; u.lamp[1] = lamp[1]; u.lamp[2] = lamp[2];
    u.color[0] = (((l.color >> 16) & 255) / 255) * l.intensity;
    u.color[1] = (((l.color >> 8) & 255) / 255) * l.intensity;
    u.color[2] = ((l.color & 255) / 255) * l.intensity;
    const ambient = clamp(l.ambient, 0, 1);
    u.shade[0] = ambient;
    u.shade[1] = ambient + (1 - ambient) * Math.max(dir[2], 0);
    u.shade[2] = Math.max(0, l.softness);
    u.shade[3] = Math.max(0, l.shadow);
    u.reach[0] = reach.x;
    u.reach[1] = reach.y;
    u.materials = this.materialData;
    return u;
  }

  private readonly packed: LightingUniforms = {
    on: false, direction: new Float32Array(3), lamp: new Float32Array(3), color: new Float32Array(3),
    shade: new Float32Array(4), reach: new Float32Array(2), materials: this.materialData,
  };

  private writeSlot(at: number, m: CardMaterial): void {
    this.materialData.set(packMaterial(m), at * 8);
  }

  private touch(): this {
    this.version++;
    this.changed();
    return this;
  }
}

/**
 * Where the lamp stands over a board this size: `distance` board heights
 * from its middle, towards the light. 0 or less puts it as far as the sun.
 */
export function lampPosition(direction: Vec3, boardWidth: number, boardHeight: number, distance: number): Vec3 {
  const far = distance > 0 ? distance * boardHeight : 1e6;
  return [boardWidth / 2 + direction[0] * far, boardHeight / 2 + direction[1] * far, direction[2] * far];
}

/** Distinct materials one board can draw at once, its own included. */
export const MATERIAL_SLOTS = 16;

/** A material as the shader's two vec4s. */
export function packMaterial(m: CardMaterial): Float32Array {
  return new Float32Array([m.specular, m.shininess, m.metallic, m.sheen, m.grain, m.grainScale, m.foil, 0]);
}

/** The light, as uniforms. */
export interface LightingUniforms {
  on: boolean;
  /** Unit vector towards the light. */
  direction: Float32Array;
  /** Where the lamp is, in board units, for highlights. */
  lamp: Float32Array;
  /** Colour times intensity. */
  color: Float32Array;
  /** ambient, a flat card's shade (what everything is divided by), softness, shadow. */
  shade: Float32Array;
  /** Shadow movement per unit of height, on the felt. */
  reach: Float32Array;
  materials: Float32Array;
}
