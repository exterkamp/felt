import { Atlas } from './atlas.js';
import {
  CARD_ROWS, INSTANCE_FLOATS, INSTANCE_FRAGMENT, INSTANCE_VERTEX, MESH_FRAGMENT, MESH_VERTEX,
} from './shaders.js';

// The renderer: one texture, one instanced draw, and the meshes in between.
//
// The board hands it a list already sorted back to front. Every card and
// sprite in it writes 32 floats into one buffer and the run is drawn with a
// single drawElementsInstanced - a deck, a table of four hands and a
// discard pile is one call. A mesh (a tuck box) splits the run where it sits
// in the order, is drawn with the depth buffer it needs, and the run carries
// on above it.

export interface InstanceItem {
  readonly drawKind: 'instance';
  /** Writes this item's 32 floats at `offset`. Returns false to be skipped. */
  writeInstance(out: Float32Array, offset: number): boolean;
}

export interface MeshItem {
  readonly drawKind: 'mesh';
  drawMesh(renderer: Renderer): void;
}

export type DrawItem = InstanceItem | MeshItem;

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

export interface MeshBuffers {
  /** The renderer generation it was made in; stale after a lost context. */
  generation: number;
  vao: WebGLVertexArrayObject;
  position: WebGLBuffer;
  uv: WebGLBuffer;
  count: number;
}

export interface MeshDraw {
  buffers: MeshBuffers;
  layer: number;
  /** Row-major 3x3 rotation, applied in model space. */
  rotation: readonly number[];
  offset: readonly [number, number, number];
  origin: readonly [number, number, number];
  centre: readonly [number, number];
  /** This mesh's own lens; undefined uses the board's. */
  distance?: number;
  alpha?: number;
  /** Which winding faces the camera, or 'none' to draw both sides. */
  cull?: 'cw' | 'ccw' | 'none';
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  // Everything below is the GPU's, and a lost context takes all of it with
  // it - so it is made in `setup`, which a restored context runs again.
  private cardProgram!: WebGLProgram;
  private meshProgram!: WebGLProgram;
  private cardUniforms!: Uniforms;
  private meshUniforms!: Uniforms;
  private cardVao!: WebGLVertexArrayObject;
  private instanceBuffer!: WebGLBuffer;
  private indexCount = 0;
  /**
   * Bumped every time the GPU's objects are made again. Anything holding a
   * buffer of its own - a tuck box's meshes - compares against it.
   */
  generation = 0;
  private instances = new Float32Array(INSTANCE_FLOATS * 256);
  private texture: WebGLTexture | null = null;
  private textureLayers = 0;
  private camera?: FrameCamera;
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
      depth: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('felt: this browser has no WebGL2');
    this.gl = gl;
    this.maxTextureLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    // A renderer made to replace a dead one counts on from it, so meshes
    // made by the old one know to make themselves again.
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
    this.meshProgram = link(gl, MESH_VERTEX, MESH_FRAGMENT);
    this.cardUniforms = uniforms(gl, this.cardProgram, [...PROJECTION_UNIFORMS, 'u_frontFacing']);
    this.meshUniforms = uniforms(gl, this.meshProgram,
      [...PROJECTION_UNIFORMS, 'u_rotation', 'u_offset', 'u_origin', 'u_centre', 'u_layer', 'u_alpha']);

    // The card: two columns and CARD_ROWS rows of quads, unit square.
    const grid: number[] = [];
    for (let r = 0; r <= CARD_ROWS; r++) grid.push(0, r / CARD_ROWS, 1, r / CARD_ROWS);
    const index: number[] = [];
    for (let r = 0; r < CARD_ROWS; r++) {
      const a = r * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.indexCount = index.length;

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
    this.instanceBuffer = gl.createBuffer()!;
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

  /** A mesh's vertex buffers. Positions are model-space xyz, uvs atlas 0-1. */
  createMesh(positions: Float32Array, uvs: Float32Array): MeshBuffers {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const position = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const uv = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uv);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { generation: this.generation, vao, position, uv, count: positions.length / 3 };
  }

  updateMesh(buffers: MeshBuffers, positions: Float32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
  }

  destroyMesh(buffers: MeshBuffers): void {
    const gl = this.gl;
    gl.deleteBuffer(buffers.position);
    gl.deleteBuffer(buffers.uv);
    gl.deleteVertexArray(buffers.vao);
  }

  /**
   * Makes sure the texture has a layer for every atlas page.
   *
   * Grown by doubling, and the old layers are copied across on the GPU - the
   * pixels exist nowhere else, which is the point: nothing on the CPU side
   * holds a 16MB page per layer, and nothing is ever re-uploaded whole.
   */
  private ensureLayers(pages: number): void {
    const gl = this.gl;
    if (this.texture && pages <= this.textureLayers) return;
    const size = this.atlas.size;
    const layers = Math.min(this.maxTextureLayers, Math.max(4, pages * 2, this.textureLayers * 2));
    const next = gl.createTexture()!;
    let copied = true;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, next);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size, size, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.texture) {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      for (let layer = 0; layer < this.textureLayers; layer++) {
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
    this.camera = camera;
    this.ensureLayers(this.atlas.pages.length);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(background[0] * background[3], background[1] * background[3],
      background[2] * background[3], background[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // Every instance first, into one buffer, noting where the meshes cut it.
    if (this.instances.length < items.length * INSTANCE_FLOATS) {
      this.instances = new Float32Array(Math.max(items.length, this.instances.length / INSTANCE_FLOATS * 2)
        * INSTANCE_FLOATS);
    }
    const runs: ({ first: number; count: number } | MeshItem)[] = [];
    let count = 0;
    let runStart = 0;
    for (const item of items) {
      if (item.drawKind === 'mesh') {
        if (count > runStart) runs.push({ first: runStart, count: count - runStart });
        runs.push(item);
        runStart = count;
        continue;
      }
      if (item.writeInstance(this.instances, count * INSTANCE_FLOATS)) count++;
    }
    if (count > runStart) runs.push({ first: runStart, count: count - runStart });
    this.instanceCount = count;
    this.drawCalls = 0;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instances.subarray(0, Math.max(1, count) * INSTANCE_FLOATS),
      gl.STREAM_DRAW);

    for (const run of runs) {
      if ('drawKind' in run) {
        run.drawMesh(this);
        continue;
      }
      gl.useProgram(this.cardProgram);
      this.setProjection(this.cardUniforms, camera);
      // The grid is wound clockwise on screen, so that is the side facing
      // the camera; the shader shows the back on the other.
      gl.frontFace(gl.CW);
      gl.uniform1f(this.cardUniforms['u_frontFacing'], 1);
      gl.bindVertexArray(this.cardVao);
      this.pointInstances(run.first);
      gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, run.count);
      this.drawCalls++;
    }
    gl.bindVertexArray(null);
    gl.frontFace(gl.CCW);
  }

  /** Draws a mesh, with depth, in the middle of a frame. */
  drawMesh(mesh: MeshDraw): void {
    const gl = this.gl;
    const camera = this.camera;
    if (!camera) return;
    gl.useProgram(this.meshProgram);
    const u = this.meshUniforms;
    this.setProjection(u, camera, mesh.distance ?? camera.distance);
    gl.uniformMatrix3fv(u['u_rotation'], true, mesh.rotation as number[]);
    gl.uniform3f(u['u_offset'], ...mesh.offset);
    gl.uniform3f(u['u_origin'], ...mesh.origin);
    gl.uniform2f(u['u_centre'], ...mesh.centre);
    gl.uniform1f(u['u_layer'], mesh.layer);
    gl.uniform1f(u['u_alpha'], mesh.alpha ?? 1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    if (mesh.cull && mesh.cull !== 'none') {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(mesh.cull === 'cw' ? gl.CW : gl.CCW);
    } else {
      gl.disable(gl.CULL_FACE);
    }
    gl.bindVertexArray(mesh.buffers.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.buffers.count);
    this.drawCalls++;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  /** Clears the depth buffer, so one solid object does not hide behind another's. */
  clearDepth(): void {
    this.gl.clear(this.gl.DEPTH_BUFFER_BIT);
  }

  destroy(): void {
    const gl = this.gl;
    // A lost context has nothing left to free, and says so by erroring.
    if (gl.isContextLost()) return;
    if (this.texture) gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteVertexArray(this.cardVao);
    gl.deleteProgram(this.cardProgram);
    gl.deleteProgram(this.meshProgram);
  }
}
