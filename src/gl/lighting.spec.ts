import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LIGHT, Lighting, MATERIALS, MATERIAL_SLOTS, MAX_SHADOW_REACH, defineMaterial, diffuseShade,
  lightDirection, packMaterial, projectOntoTable, restingShadowHeight, shadowOffset, shadowReach,
  shadowSpread, specularAt, Vec3,
} from './lighting.js';
import { apply3, cardRotation } from './lens.js';

const UP: Vec3 = [0, 0, 1];
const length = (v: Vec3) => Math.hypot(...v);
/** A card's face normal, posed the way the shader poses it. */
const normalOf = (angleDeg: number, tilt: number, turn: number) =>
  apply3(cardRotation((angleDeg * Math.PI) / 180, tilt, turn), UP);

describe('the light', () => {
  it('points at the azimuth and elevation asked for', () => {
    const top = lightDirection(0, 45);
    expect(length(top)).toBeCloseTo(1);
    expect(top[0]).toBeCloseTo(0);
    expect(top[1]).toBeLessThan(0);           // beyond the top edge: up the board is -y
    expect(top[2]).toBeCloseTo(Math.SQRT1_2);
    const right = lightDirection(90, 30);
    expect(right[0]).toBeGreaterThan(0);
    expect(right[1]).toBeCloseTo(0);
    expect(right[2]).toBeCloseTo(0.5);
    const overhead = lightDirection(123, 90);
    expect(overhead[2]).toBeCloseTo(1);
  });

  it('never lies on the horizon, where a shadow would run off the board', () => {
    expect(lightDirection(0, 0)[2]).toBeGreaterThan(0.2);
    expect(lightDirection(0, -40)[2]).toBeGreaterThan(0.2);
  });
});

describe('shading by tilt', () => {
  const light = lightDirection(0, 40);

  it('leaves a card lying flat exactly as painted', () => {
    expect(diffuseShade(UP, light, 0.45)).toBeCloseTo(1, 10);
    expect(diffuseShade(normalOf(37, 0, 0), light, 0.2)).toBeCloseTo(1, 10);
  });

  it('brightens a card turned towards the light and darkens one turned away', () => {
    // tilt > 0 tips the top edge away from the camera: the face then looks
    // up the board, towards a light beyond the top edge.
    const towards = diffuseShade(normalOf(0, 0.6, 0), light, 0.3);
    const away = diffuseShade(normalOf(0, -0.6, 0), light, 0.3);
    expect(towards).toBeGreaterThan(1.1);
    expect(away).toBeLessThan(0.8);
  });

  it('is flatter the more ambient there is, and gone at ambient 1', () => {
    const tipped = normalOf(0, -0.6, 0);
    expect(diffuseShade(tipped, light, 0.8)).toBeGreaterThan(diffuseShade(tipped, light, 0.2));
    expect(diffuseShade(tipped, light, 1)).toBeCloseTo(1);
  });

  it('never goes below the ambient for a face turned right away', () => {
    expect(diffuseShade([0, 0, -1], light, 0.4)).toBeCloseTo(0.4 / (0.4 + 0.6 * light[2]));
  });
});

describe('materials', () => {
  it('fills in plain stock and clamps every number to what the shader can use', () => {
    const m = defineMaterial({ name: 'odd', shininess: 9999, metallic: -1, grain: 3 });
    expect(m.shininess).toBe(2048);
    expect(m.metallic).toBe(0);
    expect(m.grain).toBe(1);
    expect(m.specular).toBeGreaterThan(0);
    expect(Object.isFrozen(m)).toBe(true);
  });

  it('packs into the two vec4s the shader reads', () => {
    expect([...packMaterial(MATERIALS.foil)]).toEqual([
      MATERIALS.foil.specular, MATERIALS.foil.shininess, MATERIALS.foil.metallic, MATERIALS.foil.sheen,
      MATERIALS.foil.grain, MATERIALS.foil.grainScale, MATERIALS.foil.foil, 0,
    ].map((v) => Math.fround(v)));
  });

  it('puts the highlight where the reflection meets the camera', () => {
    const light = lightDirection(0, 40);
    const view: Vec3 = [0, 0, 1];
    // The card tipped to halfway between the light and the camera mirrors one
    // into the other.
    const half = Math.atan2(-light[1], light[2] + 1);
    const mirror = specularAt(normalOf(0, half, 0), light, view, MATERIALS.glossy);
    const flat = specularAt(UP, light, view, MATERIALS.glossy);
    expect(mirror).toBeCloseTo(MATERIALS.glossy.specular + MATERIALS.glossy.sheen, 5);
    expect(flat).toBeLessThan(mirror * 0.2);
  });

  it('gives glossy a tighter, brighter highlight than matte', () => {
    const light = lightDirection(0, 40);
    const view: Vec3 = [0, 0, 1];
    const half = Math.atan2(-light[1], light[2] + 1);
    const at = (tilt: number, m = MATERIALS.glossy) => specularAt(normalOf(0, tilt, 0), light, view, m);
    expect(at(half)).toBeGreaterThan(at(half, MATERIALS.matte) * 4);
    // Ten degrees off the mirror, glossy has lost most of it and matte hardly any.
    const off = half + 0.18;
    expect(at(off) / at(half)).toBeLessThan(0.5);
    expect(at(off, MATERIALS.matte) / at(half, MATERIALS.matte)).toBeGreaterThan(0.8);
  });

  it('shows nothing on a face turned away from the light', () => {
    expect(specularAt([0, 0, -1], lightDirection(0, 40), [0, 0, 1], MATERIALS.foil)).toBe(0);
  });
});

describe('cast shadows', () => {
  it('fall away from the light', () => {
    const fromTopLeft = shadowOffset(10, lightDirection(-45, 45));
    expect(fromTopLeft.x).toBeGreaterThan(0);
    expect(fromTopLeft.y).toBeGreaterThan(0);
    const fromRight = shadowOffset(10, lightDirection(90, 45));
    expect(fromRight.x).toBeCloseTo(-10);
    expect(fromRight.y).toBeCloseTo(0);
  });

  it('fall further the higher the card, and the lower the light', () => {
    const light = lightDirection(0, 45);
    expect(shadowOffset(40, light).y).toBeCloseTo(40);
    expect(shadowOffset(80, light).y).toBeCloseTo(80);
    expect(shadowOffset(40, lightDirection(0, 25)).y).toBeGreaterThan(80);
    expect(shadowOffset(40, lightDirection(0, 90)).y).toBeCloseTo(0);
  });

  it('are held to MAX_SHADOW_REACH a unit of height', () => {
    const r = shadowReach(lightDirection(30, 1));
    expect(Math.hypot(r.x, r.y)).toBeLessThanOrEqual(MAX_SHADOW_REACH + 1e-9);
  });

  it('press a point in the air onto the felt along the light', () => {
    const light = lightDirection(0, 45);
    const at = projectOntoTable([100, 200, 30], light);
    expect(at.x).toBeCloseTo(100);
    expect(at.y).toBeCloseTo(230);
    // On the felt already: where it is.
    expect(projectOntoTable([5, 6, 0], light)).toEqual({ x: 5, y: 6 });
  });

  it('cast a tipped card as the shape it is: longest facing the light, shortest edge-on to it', () => {
    // A card 84 tall, its centre at 40 up, tipped about its width. Its top and
    // bottom edges' shadows are as far apart as the shadow is long.
    const light = lightDirection(0, 50);
    const span = (tilt: number) => {
      const r = cardRotation(0, tilt, 0);
      const top = apply3(r, [0, -42, 0]);
      const bottom = apply3(r, [0, 42, 0]);
      const a = projectOntoTable([top[0], top[1], 40 + top[2]], light);
      const b = projectOntoTable([bottom[0], bottom[1], 40 + bottom[2]], light);
      return b.y - a.y;
    };
    expect(span(0)).toBeCloseTo(84);
    // Tipped so its face looks straight at the light, it casts its longest;
    // tipped the other way, towards edge-on to the rays, it shrinks.
    expect(span(0.6)).toBeGreaterThan(84);
    expect(span(-0.7)).toBeLessThan(30);
  });

  it('grow softer with height, and rest at the halo they always had', () => {
    expect(shadowSpread(0, 0.03)).toBe(1);
    expect(shadowSpread(100, 0.03)).toBeCloseTo(4);
    expect(shadowSpread(100, 0.06)).toBeGreaterThan(shadowSpread(100, 0.03));
    expect(restingShadowHeight(60)).toBe(2.5);
    // At the default-ish 45 degrees a resting card's halo sits where the
    // unlit one did: 2.5 units down the board for a 60-unit card.
    expect(shadowOffset(restingShadowHeight(60), lightDirection(0, 45)).y).toBeCloseTo(2.5);
  });
});

describe('Lighting, the board\'s light', () => {
  it('is off until set, and set says so and draws', () => {
    const changed = vi.fn();
    const l = new Lighting(changed);
    expect(l.on).toBe(false);
    l.set({ elevation: 30 });
    expect(l.on).toBe(true);
    expect(l.settings.elevation).toBe(30);
    expect(l.settings.azimuth).toBe(DEFAULT_LIGHT.azimuth);
    expect(changed).toHaveBeenCalledTimes(1);
    l.azimuth = 90;
    expect(changed).toHaveBeenCalledTimes(2);
    l.azimuth = 90;
    expect(changed).toHaveBeenCalledTimes(2);
    l.off();
    expect(l.on).toBe(false);
  });

  it('hands the shader the light, the flat shade and the shadow reach', () => {
    const l = new Lighting().set({ azimuth: 90, elevation: 45, ambient: 0.5, color: 0xff8000, intensity: 2 });
    const u = l.uniforms();
    expect(u.on).toBe(true);
    expect(u.direction[0]).toBeCloseTo(Math.SQRT1_2);
    expect(u.reach[0]).toBeCloseTo(-1);
    expect(u.shade[1]).toBeCloseTo(0.5 + 0.5 * Math.SQRT1_2);
    expect([...u.color].map((c) => +c.toFixed(3))).toEqual([2, +(2 * 128 / 255).toFixed(3), 0]);
  });

  it('gives each material one slot, the board\'s own at 0', () => {
    const l = new Lighting().set({ material: MATERIALS.matte });
    expect(l.slot(undefined)).toBe(0);
    expect(l.slot(MATERIALS.matte)).toBe(0);
    const glossy = l.slot(MATERIALS.glossy);
    expect(glossy).toBe(1);
    expect(l.slot(MATERIALS.glossy)).toBe(1);
    expect(l.slot(MATERIALS.foil)).toBe(2);
    expect(l.materialData[8]).toBeCloseTo(MATERIALS.glossy.specular);
    expect(l.materialData[0]).toBeCloseTo(MATERIALS.matte.specular);
    // The board's material changed: slot 0 is rewritten.
    l.material = MATERIALS.foil;
    expect(l.materialData[2]).toBeCloseTo(MATERIALS.foil.metallic);
  });

  it('falls back to the board\'s material past the table\'s size, and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const l = new Lighting().set({});
    for (let i = 0; i < MATERIAL_SLOTS - 1; i++) expect(l.slot(defineMaterial({ name: `m${i}` }))).toBe(i + 1);
    expect(l.slot(defineMaterial({ name: 'one too many' }))).toBe(0);
    expect(l.slot(defineMaterial({ name: 'and another' }))).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
