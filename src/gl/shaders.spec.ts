import { describe, expect, it } from 'vitest';
import * as shaders from './shaders.js';

// SwiftShader, which every headless test here runs on, accepts GLSL that real
// mobile GPUs refuse - and one shader that will not compile is a board that
// never comes up. These are the constructs that have bitten, checked in the
// source since no test here has the GPU that would reject them.
const sources = Object.entries(shaders).filter(([, v]) => typeof v === 'string' && v.includes('#version 300 es'));

describe('shaders, for strict GPU compilers', () => {
  it('finds the shaders', () => expect(sources.length).toBeGreaterThan(0));

  it.each(sources)('%s builds no array by constructor', (_, source) => {
    // Mali: "S0032: no default precision defined for variable 'vec2[4]'".
    expect(source as string).not.toMatch(/\b(float|u?int|bool|[biu]?vec[234]|mat[234])\s*\[\s*\d*\s*\]\s*\(/);
  });

  it.each(sources)('%s declares a default float precision', (_, source) => {
    expect(source as string).toMatch(/precision (highp|mediump) float;/);
  });
});
