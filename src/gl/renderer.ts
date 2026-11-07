import { Atlas } from './atlas.js';
import {
  CARD_ROWS, INSTANCE_FLOATS, INSTANCE_FRAGMENT, INSTANCE_VERTEX,
} from './shaders.js';

// The renderer: one texture, one instanced draw.
//
// The board hands it a list already sorted back to front. Every card and
// sprite in it writes 32 floats into one buffer and the whole list is drawn
// with a single drawElementsInstanced - a deck, a table of four hands and a
// discard pile is one call.

export interface InstanceItem {
  readonly drawKind: 'instance';
  /** Writes this item's 32 floats at `offset`. Returns false to be skipped. */
  /** Instances written: true or 1 for one, 0 or false for none, 2 for a card and its shadow. */
  writeInstance(out: Float32Array, offset: number): boolean | number;
}

export type DrawItem = InstanceItem;

export interface FrameCamera {
  width: number;
  height: number;
  /** Camera distance in board units; Infinity is a flat, orthographic board. */
  distance: number;
  vanishX: number;
  vanishY: number;
  local: boolean;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`felt shader: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`felt program: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]): Uniforms {
  return Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));
}

const PROJECTION_UNIFORMS = ['u_board', 'u_distance', 'u_vanish', 'u_local', 'u_atlas'];


export class Renderer {
  readonly gl: WebGL2RenderingContext;
  // Everything below is the GPU's, and a lost context takes all of it with
  // it - so it is made in `setup`, which a restored context runs again.
  private cardProgram!: WebGLProgram;
  private cardUniforms!: Uniforms;
  private cardVao!: WebGLVertexArrayObject;
  /**
   * Instance buffers, used in turn. Re-specifying one buffer every frame
   * (bufferData) makes the driver wait whenever the GPU is still reading the
   * last frame's copy - measured as 10 ms a frame stalled at four thousand
   * cards. Three, each kept at its size and filled with bufferSubData, means
   * the one being written is never the one being drawn from.
   */
  private instanceBuffers: WebGLBuffer[] = [];
  private instanceCapacity: number[] = [];
  private instanceTurn = 0;
  private get instanceBuffer(): WebGLBuffer {
    return this.instanceBuffers[this.instanceTurn];
  }
  private indexCount = 0;
  /** Byte offset of the flat card's six indices, after the bowed grid's. */
  private quadOffset = 0;
  /** Draws in the last frame that could use the flat quad. */
  flatDraws = 0;
  /** Bumped every time the GPU's objects are made again. */
  generation = 0;
  private instances = new Float32Array(INSTANCE_FLOATS * 256);
  private texture: WebGLTexture | null = null;
  private textureLayers = 0;
  /** Draw calls in the last frame, for anyone measuring. */
  drawCalls = 0;
  instanceCount = 0;
  /** Pictures uploaded, and how many pixels that was, since the start. */
  uploads = 0;
  uploadedPixels = 0;
  readonly maxTextureLayers: number;

  constructor(readonly canvas: HTMLCanvasElement, readonly atlas: Atlas,
    options: { transparent?: boolean; generation?: number } = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: options.transparent ?? false,
      antialias: true,
      // Cards are drawn in order, never depth-tested: no depth buffer to keep.
      depth: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('felt: this browser has no WebGL2');
    this.gl = gl;
    this.maxTextureLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    // A renderer made to replace a dead one counts on from it.
    this.generation = options.generation ?? 0;
    this.setup();
    atlas.sink = (page, x, y, w, h, pixels) => this.upload(page, x, y, w, h, pixels);
  }

  /** Whether the GPU has taken the context away. Nothing draws until it returns. */
  get lost(): boolean {
    return this.gl.isContextLost();
  }

  /**
   * Makes every GPU object again, after the context came back. The texture
   * comes back empty; the board then has the atlas repaint every picture in
   * it, which is the only place those pixels can come from.
   */
  restore(): void {
    this.texture = null;
    this.textureLayers = 0;
    this.setup();
  }

  private setup(): void {
    const gl = this.gl;
    this.generation++;
    this.cardProgram = link(gl, INSTANCE_VERTEX, INSTANCE_FRAGMENT);
    this.cardUniforms = uniforms(gl, this.cardProgram, [...PROJECTION_UNIFORMS, 'u_frontFacing']);

    // The card: two columns and CARD_ROWS rows of quads, unit square.
    const grid: number[] = [];
    for (let r = 0; r <= CARD_ROWS; r++) grid.push(0, r / CARD_ROWS, 1, r / CARD_ROWS);
    const index: number[] = [];
    for (let r = 0; r < CARD_ROWS; r++) {
      const a = r * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.indexCount = index.length;
    // And the same card as one quad - its first row's top corners and its
    // last row's bottom ones - for any draw in which no card is bowed.
    const last = CARD_ROWS * 2;
    this.quadOffset = index.length * 2;
    index.push(0, 1, last, 1, last + 1, last);

    this.cardVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.cardVao);
    const gridBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(grid), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(index), gl.STATIC_DRAW);
    this.instanceBuffers = [gl.createBuffer()!, gl.createBuffer()!, gl.createBuffer()!];
    this.instanceCapacity = [0, 0, 0];
    this.instanceTurn = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    for (let i = 1; i <= 8; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribDivisor(i, 1);
    }
    this.pointInstances(0);
    gl.bindVertexArray(null);
  }

  /** Points the eight instance attributes at the run starting at `first`. */
  private pointInstances(first: number): void {
    const gl = this.gl;
    const stride = INSTANCE_FLOATS * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    for (let i = 1; i <= 8; i++) {
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, stride, first * stride + (i - 1) * 16);
    }
  }

  /**
   * Makes sure the texture has a layer for every atlas page.
   *
   * Grown a layer or two at a time, and the old layers are copied across on
   * the GPU - the pixels exist nowhere else, which is the point: nothing on
   * the CPU side holds a 16MB page per layer, and nothing is ever re-uploaded
   * whole. Not by doubling: every layer is 16MB of video memory, and ten
   * pages doubled to twenty was a 320MB texture a real GPU could refuse -
   * and a refused texture is a board with no cards on it at all.
   */
  private ensureLayers(pages: number): void {
    const gl = this.gl;
    if (this.texture && pages <= this.textureLayers) return;
    const size = this.atlas.size;
    gl.activeTexture(gl.TEXTURE0);
    // A spare layer if it can be had, else exactly what is needed.
    let next: WebGLTexture | null = null;
    let layers = 0;
    for (const want of [Math.max(2, pages + 1), pages]) {
      layers = Math.min(this.maxTextureLayers, want);
      while (gl.getError() !== gl.NO_ERROR) { /* clear anything earlier, so the check is this one's */ }
      next = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, next);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size, size, layers);
      if (gl.getError() === gl.NO_ERROR) break;
      gl.deleteTexture(next);
      next = null;
    }
    if (!next) {
      // Refused outright: keep the texture there is, so what is on the table
      // stays drawn, and say so once.
      if (!this.refused) console.warn(`felt: the GPU refused a ${pages}-layer atlas texture`);
      this.refused = true;
      if (this.texture) gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      return;
    }
    let copied = true;
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.texture) {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      for (let layer = 0; layer < Math.min(this.textureLayers, layers); layer++) {
        gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.texture, 0, layer);
        gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, 0, 0, size, size);
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(this.texture);
      // A driver that refused the copy would leave every card blank. The
      // atlas can paint everything again, so ask it to rather than trust it.
      copied = gl.getError() === gl.NO_ERROR;
    }
    // A new texture needs no clearing: WebGL hands it over zeroed.
    this.texture = next;
    this.textureLayers = layers;
    if (!copied) this.atlas.repaintAll();
  }

  /** Whether the GPU has refused a texture as big as the atlas asked for. */
  refused = false;


  /** The atlas's sink: one freshly painted picture, uploaded now. */
  private upload(page: number, x: number, y: number, width: number, height: number,
    pixels: Uint8Array): void {
    const gl = this.gl;
    // Painted while the context is gone: lost with it, and repainted with
    // everything else when it comes back.
    if (gl.isContextLost()) return;
    this.ensureLayers(Math.max(page + 1, this.atlas.pages.length));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    // Already premultiplied by the atlas.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, page, width, height, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    this.uploads++;
    this.uploadedPixels += width * height;
  }

  private setProjection(u: Uniforms, camera: FrameCamera, distance = camera.distance): void {
    const gl = this.gl;
    gl.uniform2f(u['u_board'], camera.width, camera.height);
    gl.uniform1f(u['u_distance'], Number.isFinite(distance) ? distance : 0);
    gl.uniform2f(u['u_vanish'], camera.vanishX, camera.vanishY);
    gl.uniform1f(u['u_local'], camera.local ? 1 : 0);
    gl.uniform1i(u['u_atlas'], 0);
  }

  /** Draws one frame: everything in `items`, back to front. */
  frame(items: readonly DrawItem[], camera: FrameCamera, background: [number, number, number, number]): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    this.ensureLayers(this.atlas.pages.length);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(background[0] * background[3], background[1] * background[3],
      background[2] * background[3], background[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);

    // Every instance, into one buffer.
    // Room for every item and a shadow for each, so no write can overrun.
    if (this.instances.length < items.length * 2 * INSTANCE_FLOATS) {
      this.instances = new Float32Array(Math.max(items.length * 2, this.instances.length / INSTANCE_FLOATS * 2)
        * INSTANCE_FLOATS);
    }
    let count = 0;
    let bowed = false;
    const instances = this.instances;
    for (const item of items) {
      const wrote = Number(item.writeInstance(instances, count * INSTANCE_FLOATS));
      for (let k = 0; k < wrote; k++) {
        // A bow is the only thing the grid's rows are for.
        if (instances[count * INSTANCE_FLOATS + 6] !== 0) bowed = true;
        count++;
      }
    }
    this.instanceCount = count;
    this.drawCalls = 0;
    this.flatDraws = 0;

    this.instanceTurn = (this.instanceTurn + 1) % this.instanceBuffers.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const used = Math.max(1, count) * INSTANCE_FLOATS;
    if (this.instanceCapacity[this.instanceTurn] < used) {
      // Grown to the whole CPU-side array, so it is not grown again soon.
      gl.bufferData(gl.ARRAY_BUFFER, this.instances.byteLength, gl.DYNAMIC_DRAW);
      this.instanceCapacity[this.instanceTurn] = this.instances.length;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instances, 0, used);

    if (count) {
      gl.useProgram(this.cardProgram);
      this.setProjection(this.cardUniforms, camera);
      // The grid is wound clockwise on screen, so that is the side facing
      // the camera; the shader shows the back on the other.
      gl.frontFace(gl.CW);
      gl.uniform1f(this.cardUniforms['u_frontFacing'], 1);
      gl.bindVertexArray(this.cardVao);
      this.pointInstances(0);
      if (bowed) {
        gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, count);
      } else {
        gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, this.quadOffset, count);
        this.flatDraws++;
      }
      this.drawCalls++;
    }
    gl.bindVertexArray(null);
    gl.frontFace(gl.CCW);
  }

  destroy(): void {
    const gl = this.gl;
    // A lost context has nothing left to free, and says so by erroring.
    if (gl.isContextLost()) return;
    if (this.texture) gl.deleteTexture(this.texture);
    for (const buffer of this.instanceBuffers) gl.deleteBuffer(buffer);
    gl.deleteVertexArray(this.cardVao);
    gl.deleteProgram(this.cardProgram);
  }
}
