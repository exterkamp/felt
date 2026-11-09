// The program: every card and sprite in one instanced draw.
//
// The projection is written out once in `PROJECT` and once in lens.ts. The
// two must agree - picking goes through the TypeScript copy - so a change to
// one is a change to both.

/** Floats per instance. Eight vec4s. */
export const INSTANCE_FLOATS = 32;

/** Rows down a card's length. A bow needs them; a flat card does not care. */
export const CARD_ROWS = 14;

const PROJECT = /* glsl */ `
uniform vec2 u_board;      // board size in units
uniform float u_distance;  // camera to table; 0 means flat (orthographic)
uniform vec2 u_vanish;     // the board's own vanishing point
uniform float u_local;     // 1: each object is seen from straight above itself

vec4 projectAt(vec3 world, vec2 centre, float distance) {
  float w = distance > 0.0 ? 1.0 - world.z / distance : 1.0;
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
layout(location = 8) in vec4 i_tint;    // tint rgb, extra lens, a shadow's lift, shine

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
flat out vec3 v_normal;  // the front's normal, on the board
// The same in the card's own frame - how it is tipped and rolled - and, in w,
// how much it shines. One vector rather than two: varyings are few on a phone.
flat out vec4 v_lean;

vec3 rgb(float packed) {
  return vec3(floor(packed / 65536.0), mod(floor(packed / 256.0), 256.0), mod(packed, 256.0)) / 255.0;
}

void main() {
  float width = i_size.x;
  float height = i_size.y;
  // The shadow's room grows as the card lifts, because its shadow falls
  // further away and softer - clipped to the card's own margin it would end
  // in a hard edge half way across the felt.
  // A cast shadow lies on the felt (z 0) and is told how high its card is.
  bool castShadow = i_layers.z > 1.5;
  float lift = castShadow ? i_tint.z : max(0.0, i_place.z);
  float margin = i_size.w * (1.0 + lift * 0.05) + lift * 0.8;
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
  // A held card can be seen through a stronger lens than the board's, so
  // its tipping reads as depth: the camera brought closer for it alone.
  gl_Position = projectAt(world, centre, u_distance / (1.0 + max(0.0, i_tint.y)));

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
  // (0, 0, 1) through the same turn and tilt, then the same angle.
  vec3 lean = vec3(sy, -st * cy, ct * cy);
  v_normal = vec3(ca * lean.x - sa * lean.y, sa * lean.x + ca * lean.y, lean.z);
  v_lean = vec4(lean, castShadow ? 0.0 : i_tint.w);
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
flat in vec3 v_normal;
flat in vec4 v_lean;

out vec4 colour;

// Light over the top-left of the table, the way the shadows already fall.
const vec3 LIGHT = vec3(-0.36, -0.48, 0.8);

// A card's face with gloss on it, premultiplied in and out. Three parts: the
// face dims a little as it tips away from the light, a broad sheen comes up
// as it tips towards it, and a streak of glare lies across the diagonal
// wherever the card's lean puts it - so as a held card swivels the glare
// slides over it and off the edge, the way light runs across a laminated card
// turned in the hand. On white paper the streak only shows against the
// dimming, which is why there is dimming at all.
vec4 shineOn(vec4 card, vec2 local, vec2 size, bool facing) {
  float shine = v_lean.w;
  if (!(shine > 0.0)) return card;
  vec3 n = facing ? v_normal : -v_normal;
  vec3 lean = facing ? v_lean.xyz : -v_lean.xyz;
  vec3 light = normalize(LIGHT);
  vec3 h = normalize(light + vec3(0.0, 0.0, 1.0));
  // pow is undefined for a base below zero, and at zero on some GPUs: a
  // phone answers NaN where SwiftShader answers a number, and a NaN here is
  // a card washed out to solid white. Squares are written as squares.
  float sheen = pow(clamp(dot(n, h), 1e-4, 1.0), 30.0);
  vec2 q = local / size;                       // -0.5 to 0.5 across the face
  float along = (q.x + q.y) * 0.7071;          // up the diagonal
  float centre = 0.12 - (lean.x + lean.y) * 1.8;
  float wide = (along - centre) / 0.11;
  float narrow = (along - centre - 0.21) / 0.035;
  float streak = exp(-wide * wide);
  float thin = exp(-narrow * narrow);
  float lambert = max(dot(n, light), 0.0);
  float shade = 1.0 - shine * (0.06 + 0.16 * (1.0 - lambert)) * (1.0 - max(streak, thin));
  vec3 glare = vec3(0.25 * sheen + 0.45 * streak + 0.3 * thin) * shine * card.a;
  return vec4(min(card.rgb * shade + glare, vec3(card.a)), card.a);
}

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
  bool castShadow = v_layers.z > 1.5;
  if (body > 0.0 && !castShadow) {
    card = texture(u_atlas, vec3(clamp(uv, min(rect.xy, rect.zw), max(rect.xy, rect.zw)), layer));
    float edgeWidth = facing ? v_edge.z : v_edge.w;
    vec3 edgeColour = rgb(facing ? v_edge.x : v_edge.y);
    float edge = clamp((d + edgeWidth) / aa + 0.5, 0.0, 1.0) * step(0.001, edgeWidth);
    card = vec4(mix(card.rgb, edgeColour * card.a, edge), card.a);
    card *= body;
    if (v_lean.w > 0.0) card = shineOn(card, v_local, size, facing);
  }

  // Under an opaque card nothing of the shadow shows, and that is most of
  // a card's pixels: three rounded boxes a pixel, skipped.
  float shadow = 0.0;
  if (v_layers.w > 0.0 && card.a < 0.999) {
    float k = size.x / 60.0;
    // A card lifted off the table throws its shadow further and softer.
    float lift = v_lift;
    vec2 drop = v_down * (2.5 * k + lift * 0.45);
    vec2 p = v_local - drop;
    float spread = 1.0 + lift * 0.03;
    // Held up, it reads darker against the felt than a card lying on it -
    // without it, on a dark cloth, a picked-up card's shadow all but vanishes.
    float fade = v_layers.w * (1.0 + 0.5 * min(1.0, lift / 20.0)) / (1.0 + lift * 0.006);
    float a1 = shadowLayer(p, half_, radius, 3.8 * k * spread, 0.10, aa + 1.6 * k * spread);
    float a2 = shadowLayer(p, half_, radius, 2.2 * k * spread, 0.13, aa + 1.0 * k * spread);
    float a3 = shadowLayer(p, half_, radius, 1.0 * k * spread, 0.16, aa + 0.6 * k * spread);
    // A card in the air - picked up, mid-throw - also casts a wide, soft
    // penumbra, which is most of what says "above the table". Nothing at
    // rest: a card lying on the felt looks as it always has.
    float a4 = lift > 0.0
      ? shadowLayer(p, half_, radius, 6.0 * k * spread, 0.2 * min(1.0, lift / 18.0), aa + 4.5 * k * spread)
      : 0.0;
    shadow = (1.0 - (1.0 - a1) * (1.0 - a2) * (1.0 - a3) * (1.0 - a4)) * fade;
    // Faded out before the edge of the quad, so it never ends in a line.
    vec2 room = half_ + v_margin - abs(v_local);
    shadow *= clamp(min(room.x, room.y) / max(1.0, v_margin * 0.25), 0.0, 1.0);
  }

  float alpha = card.a + shadow * (1.0 - card.a);
  colour = vec4(card.rgb, alpha) * v_alpha;
  if (colour.a <= 0.002) discard;
}
`;
