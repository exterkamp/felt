// The two programs: every card and sprite in one instanced draw, and the
// odd solid object (a tuck box) as plain triangles with a depth buffer.
//
// Both share the projection, which is written out once in `PROJECT` and once
// in lens.ts. The two must agree - picking and `deckCentre` go through the
// TypeScript copy - so a change to one is a change to both.

/** Floats per instance. Eight vec4s. */
export const INSTANCE_FLOATS = 32;

/** Rows down a card's length. A bow needs them; a flat card does not care. */
export const CARD_ROWS = 14;

const PROJECT = /* glsl */ `
uniform vec2 u_board;      // board size in units
uniform float u_distance;  // camera to table; 0 means flat (orthographic)
uniform vec2 u_vanish;     // the board's own vanishing point
uniform float u_local;     // 1: each object is seen from straight above itself

vec4 projectWorld(vec3 world, vec2 centre) {
  float w = u_distance > 0.0 ? 1.0 - world.z / u_distance : 1.0;
  vec2 a = vec2(2.0 / u_board.x, -2.0 / u_board.y);
  vec2 b = vec2(-1.0, 1.0);
  // clip.xy / w is the ndc of centre + (world.xy - centre) / w, written so it
  // stays linear in the world point - which keeps textures perspective-correct.
  vec2 clip = (a * centre + b) * w + a * (world.xy - centre);
  return vec4(clip, -world.z / 4000.0, w);
}
`;

export const INSTANCE_VERTEX = /* glsl */ `#version 300 es
precision highp float;
${PROJECT}
layout(location = 0) in vec2 a_grid;
layout(location = 1) in vec4 i_place;   // x, y, z, angle (rad)
layout(location = 2) in vec4 i_pose;    // tilt, turn, bow, alpha
layout(location = 3) in vec4 i_size;    // width, height, radius, margin
layout(location = 4) in vec4 i_front;   // uv rect of the side facing the camera
layout(location = 5) in vec4 i_back;    // uv rect of the side facing away
layout(location = 6) in vec4 i_layers;  // front layer, back layer, kind, shadow
layout(location = 7) in vec4 i_edge;    // front edge rgb, back edge rgb, their widths
layout(location = 8) in vec4 i_tint;    // tint rgb, unused x3

out vec2 v_local;
flat out vec4 v_front;
flat out vec4 v_back;
flat out vec4 v_layers;
flat out vec4 v_size;
flat out vec4 v_edge;
flat out vec3 v_tint;
flat out float v_alpha;
flat out float v_lift;
flat out float v_margin;
flat out vec2 v_down;

vec3 rgb(float packed) {
  return vec3(floor(packed / 65536.0), mod(floor(packed / 256.0), 256.0), mod(packed, 256.0)) / 255.0;
}

void main() {
  float width = i_size.x;
  float height = i_size.y;
  // The shadow's room grows as the card lifts, because its shadow falls
  // further away and softer - clipped to the card's own margin it would end
  // in a hard edge half way across the felt.
  float lift = max(0.0, i_place.z);
  float margin = i_size.w * (1.0 + lift * 0.05) + lift * 0.3;
  vec2 local = vec2((a_grid.x - 0.5) * (width + 2.0 * margin),
                    (a_grid.y - 0.5) * (height + 2.0 * margin));

  // The bow: a parabola down the length, deepest in the middle, flat where it
  // is gripped. Positive dips the middle away from the camera.
  float along = clamp(local.y / height + 0.5, 0.0, 1.0);
  vec3 p = vec3(local, -i_pose.z * height * 4.0 * along * (1.0 - along));

  float ct = cos(i_pose.x), st = sin(i_pose.x);
  float cy = cos(i_pose.y), sy = sin(i_pose.y);
  float ca = cos(i_place.w), sa = sin(i_place.w);
  // Ry(turn), then Rx(tilt), then Rz(angle) - the order lens.ts uses.
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  p = vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);
  p = vec3(ca * p.x - sa * p.y, sa * p.x + ca * p.y, p.z);

  vec3 world = i_place.xyz + p;
  vec2 centre = mix(u_vanish, i_place.xy, u_local);
  gl_Position = projectWorld(world, centre);

  v_local = local;
  v_front = i_front;
  v_back = i_back;
  v_layers = i_layers;
  v_size = i_size;
  v_edge = i_edge;
  v_tint = rgb(i_tint.x);
  v_alpha = i_pose.w;
  v_lift = lift;
  v_margin = margin;
  // Which way is down the table, in the card's own frame: a shadow falls
  // towards the bottom of the board whichever way the card is turned.
  v_down = vec2(cy < 0.0 ? -sa : sa, ct < 0.0 ? -ca : ca);
}
`;

export const INSTANCE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_atlas;
uniform float u_frontFacing; // 1 if the GPU's front face is the camera-facing one

in vec2 v_local;
flat in vec4 v_front;
flat in vec4 v_back;
flat in vec4 v_layers;
flat in vec4 v_size;
flat in vec4 v_edge;
flat in vec3 v_tint;
flat in float v_alpha;
flat in float v_lift;
flat in float v_margin;
flat in vec2 v_down;

out vec4 colour;

vec3 rgb(float packed) {
  return vec3(floor(packed / 65536.0), mod(floor(packed / 256.0), 256.0), mod(packed, 256.0)) / 255.0;
}

float roundBox(vec2 p, vec2 half_, float r) {
  vec2 q = abs(p) - half_ + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// One soft rounded rectangle of shadow, the way the baked card bodies had
// three of them stacked.
float shadowLayer(vec2 p, vec2 half_, float r, float grow, float alpha, float aa) {
  float d = roundBox(p, half_ + grow, r + grow);
  return alpha * clamp(0.5 - d / max(aa, 1e-4), 0.0, 1.0);
}

void main() {
  bool facing = gl_FrontFacing == (u_frontFacing > 0.5);
  vec4 rect = facing ? v_front : v_back;
  float layer = facing ? v_layers.x : v_layers.y;
  vec2 size = v_size.xy;
  // Seen from behind, the picture is mirrored back so it reads the right way.
  float u = facing ? v_local.x / size.x + 0.5 : 0.5 - v_local.x / size.x;
  float v = v_local.y / size.y + 0.5;
  vec2 uv = mix(rect.xy, rect.zw, vec2(u, v));

  if (v_layers.z < 0.5) {
    // A sprite: the picture, tinted, nothing else.
    if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) discard;
    vec4 texel = texture(u_atlas, vec3(uv, layer));
    colour = vec4(texel.rgb * v_tint, texel.a) * v_alpha;
    if (colour.a <= 0.0) discard;
    return;
  }

  // A card: a rounded body cut out of the picture, a hairline round it, and
  // the shadow it casts on whatever is under it.
  vec2 half_ = size * 0.5;
  float radius = v_size.z;
  float d = roundBox(v_local, half_, radius);
  float aa = max(fwidth(d), 1e-4);
  float body = clamp(0.5 - d / aa, 0.0, 1.0);

  vec4 card = vec4(0.0);
  if (body > 0.0) {
    card = texture(u_atlas, vec3(clamp(uv, min(rect.xy, rect.zw), max(rect.xy, rect.zw)), layer));
    float edgeWidth = facing ? v_edge.z : v_edge.w;
    vec3 edgeColour = rgb(facing ? v_edge.x : v_edge.y);
    float edge = clamp((d + edgeWidth) / aa + 0.5, 0.0, 1.0) * step(0.001, edgeWidth);
    card = vec4(mix(card.rgb, edgeColour * card.a, edge), card.a);
    card *= body;
  }

  float shadow = 0.0;
  if (v_layers.w > 0.0) {
    float k = size.x / 60.0;
    // A card lifted off the table throws its shadow further and softer.
    float lift = v_lift;
    vec2 drop = v_down * (2.5 * k + lift * 0.25);
    vec2 p = v_local - drop;
    float spread = 1.0 + lift * 0.03;
    float fade = v_layers.w / (1.0 + lift * 0.015);
    float a1 = shadowLayer(p, half_, radius, 3.8 * k * spread, 0.10, aa + 1.6 * k * spread);
    float a2 = shadowLayer(p, half_, radius, 2.2 * k * spread, 0.13, aa + 1.0 * k * spread);
    float a3 = shadowLayer(p, half_, radius, 1.0 * k * spread, 0.16, aa + 0.6 * k * spread);
    shadow = (1.0 - (1.0 - a1) * (1.0 - a2) * (1.0 - a3)) * fade;
    // Faded out before the edge of the quad, so it never ends in a line.
    vec2 room = half_ + v_margin - abs(v_local);
    shadow *= clamp(min(room.x, room.y) / max(1.0, v_margin * 0.25), 0.0, 1.0);
  }

  float alpha = card.a + shadow * (1.0 - card.a);
  colour = vec4(card.rgb, alpha) * v_alpha;
  if (colour.a <= 0.002) discard;
}
`;

export const MESH_VERTEX = /* glsl */ `#version 300 es
precision highp float;
${PROJECT}
layout(location = 0) in vec3 a_position;  // model space: x right, y up, z towards you
layout(location = 1) in vec2 a_uv;
uniform mat3 u_rotation;
uniform vec3 u_offset;    // model-space offset, before the rotation
uniform vec3 u_origin;    // where the model's origin is on the board
uniform vec2 u_centre;    // its vanishing point
out vec2 v_uv;
void main() {
  vec3 m = u_rotation * (a_position + u_offset);
  // Model y is up; the board's y is down. Model z comes out as the board's -
  // towards the camera - which is what Phaser made of tuck-box.ts's numbers,
  // whatever its comments say, and the box was tuned by eye against that.
  vec3 world = u_origin + vec3(m.x, -m.y, m.z);
  gl_Position = projectWorld(world, u_centre);
  v_uv = a_uv;
}
`;

export const MESH_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_atlas;
uniform float u_layer;
uniform float u_alpha;
in vec2 v_uv;
out vec4 colour;
void main() {
  colour = texture(u_atlas, vec3(v_uv, u_layer)) * u_alpha;
  if (colour.a <= 0.002) discard;
}
`;
