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
layout(location = 8) in vec4 i_tint;    // tint rgb, extra lens, a shadow's lift, material slot

// The light (lighting.ts). Unlit, none of it is read.
uniform float u_lit;
uniform vec3 u_light;  // unit vector towards the light
uniform vec3 u_lamp;   // where the lamp is, for highlights
uniform vec2 u_reach;  // how far a shadow moves on the felt per unit of height
uniform vec4 u_shade;  // ambient, a flat card's shade, softness, shadow

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
out vec3 v_normal;
out vec3 v_view;
out vec3 v_toLamp;
flat out vec3 v_tangent;
// A card: its material slot in z. A lit cast shadow: how far one unit of the
// card across (xy) and down (zw) lands on the felt.
flat out vec4 v_cast;

// The card's rotation applied to a direction, as main() applies it to p.
vec3 orient(vec3 v, float ct, float st, float cy, float sy, float ca, float sa) {
  v = vec3(cy * v.x + sy * v.z, v.y, -sy * v.x + cy * v.z);
  v = vec3(v.x, ct * v.y - st * v.z, st * v.y + ct * v.z);
  return vec3(ca * v.x - sa * v.y, sa * v.x + ca * v.y, v.z);
}

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
  // Lit, a resting card's halo is pushed away from the light, and a low
  // light pushes it further than the margin was made for.
  float rest = 2.5 * width / 60.0;
  if (u_lit > 0.5 && !castShadow) {
    margin += max(0.0, length(u_reach) * (rest + lift) - (rest + lift * 0.45));
  }
  float ct = cos(i_pose.x), st = sin(i_pose.x);
  float cy = cos(i_pose.y), sy = sin(i_pose.y);
  float ca = cos(i_place.w), sa = sin(i_place.w);
  vec2 room = vec2(margin);
  v_cast = vec4(0.0, 0.0, i_tint.w, 0.0);
  if (u_lit > 0.5 && castShadow) {
    // A shadow pressed onto the felt is squashed along the light - nearly
    // to a line when the card is edge-on to it - so its room is worked out
    // on the felt and taken back to the card: as much felt either way
    // whichever way the card is turned.
    vec3 ax = orient(vec3(1.0, 0.0, 0.0), ct, st, cy, sy, ca, sa);
    vec3 ay = orient(vec3(0.0, 1.0, 0.0), ct, st, cy, sy, ca, sa);
    vec2 across = ax.xy + u_reach * ax.z;
    vec2 down = ay.xy + u_reach * ay.z;
    float su = max(length(across), 0.005);
    float sv = max(abs(across.x * down.y - across.y * down.x) / su, 0.005);
    float felt = (12.0 * width / 60.0 + 2.0) * (1.0 + lift * u_shade.z);
    room = vec2(felt / su, felt / sv);
    v_cast = vec4(across, down);
  }
  vec2 local = vec2((a_grid.x - 0.5) * (width + 2.0 * room.x),
                    (a_grid.y - 0.5) * (height + 2.0 * room.y));

  // The bow: a parabola down the length, deepest in the middle, flat where it
  // is gripped. Positive dips the middle away from the camera.
  float along = clamp(local.y / height + 0.5, 0.0, 1.0);
  vec3 p = vec3(local, -i_pose.z * height * 4.0 * along * (1.0 - along));

  // Ry(turn), then Rx(tilt), then Rz(angle) - the order lens.ts uses.
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  p = vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);
  p = vec3(ca * p.x - sa * p.y, sa * p.x + ca * p.y, p.z);

  vec3 world = i_place.xyz + p;
  if (u_lit > 0.5 && castShadow) {
    // Lit, a card in the air is drawn in its own pose and then pressed onto
    // the felt along the light's rays: its shadow is the shape it casts.
    // From a little above its own height, so it leaves the halo's place
    // without a jump.
    world.xy += u_reach * (world.z + rest);
    world.z = 0.0;
  }
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

  if (u_lit > 0.5) {
    // Lit: the halo falls away from the light, in the card's own frame (the
    // rotation undone: Rz, Rx, Ry transposed in turn)...
    vec3 r = vec3(u_reach, 0.0);
    r = vec3(ca * r.x + sa * r.y, -sa * r.x + ca * r.y, r.z);
    r = vec3(r.x, ct * r.y + st * r.z, -st * r.y + ct * r.z);
    v_down = vec2(cy * r.x - sy * r.z, r.y);
    // ...and the surface faces somewhere: up off the card, bent with its bow.
    float slope = 4.0 * i_pose.z * (1.0 - 2.0 * along);
    v_normal = orient(normalize(vec3(0.0, slope, 1.0)), ct, st, cy, sy, ca, sa);
    v_tangent = orient(vec3(1.0, 0.0, 0.0), ct, st, cy, sy, ca, sa);
    float seen = u_distance / (1.0 + max(0.0, i_tint.y));
    v_view = u_distance > 0.0 ? vec3(centre, seen) - world : vec3(0.0, 0.0, 1.0);
    v_toLamp = u_lamp - world;
  } else {
    v_normal = vec3(0.0, 0.0, 1.0);
    v_tangent = vec3(1.0, 0.0, 0.0);
    v_view = vec3(0.0, 0.0, 1.0);
    v_toLamp = vec3(0.0, 0.0, 1.0);
  }
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
in vec3 v_normal;
in vec3 v_view;
in vec3 v_toLamp;
flat in vec3 v_tangent;
flat in vec4 v_cast;

uniform float u_lit;
uniform vec3 u_light;
uniform vec3 u_lightColor;  // colour times intensity
uniform vec4 u_shade;       // ambient, a flat card's shade, softness, shadow
uniform vec4 u_materials[32];
uniform float u_ratio;      // pixels per board unit

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

// A card's pixel under the light: shaded by which way it faces, with its
// stock's highlight on top. lighting.ts has the same arithmetic in
// diffuseShade and specularAt. Premultiplied in, premultiplied out.
vec3 lightCard(vec4 card, bool facing) {
  int m = int(v_cast.z + 0.5) * 2;
  vec4 ma = u_materials[m];      // specular, shininess, metallic, sheen
  vec4 mb = u_materials[m + 1];  // grain, grain scale, foil, -
  vec3 n = normalize(v_normal) * (facing ? 1.0 : -1.0);
  vec3 t = normalize(v_tangent - n * dot(v_tangent, n));
  vec3 b = cross(n, t);
  vec3 smooth_ = n;
  // A plain weave: threads across and threads down, each passing over and
  // under the other, tipping the surface a little either way. Faded out
  // where a thread is thinner than a pixel, which would only shimmer.
  float weave = mb.x * clamp(1.5 - length(fwidth(v_local)) / mb.y * 1.5, 0.0, 1.0);
  if (weave > 0.0) {
    vec2 q = v_local * (6.2831853 / mb.y);
    float over = sin(q.x * 0.5) * sin(q.y * 0.5);
    vec2 g = vec2(sin(q.x) * (0.55 + 0.45 * over), sin(q.y) * (0.55 - 0.45 * over));
    n = normalize(n + weave * (g.x * t + g.y * b));
  }
  vec3 l = u_light;
  vec3 view = normalize(v_view);
  // The weave shows mostly in the highlight; the shading barely feels it.
  float ndl = dot(normalize(mix(smooth_, n, 0.3)), l);
  float shade = (u_shade.x + (1.0 - u_shade.x) * max(ndl, 0.0)) / u_shade.y;
  // The highlight is the lamp's own reflection, from where the lamp is: so
  // it is a spot that slides across a card as it tips, not a whole card
  // that lights up at once.
  vec3 lamp = normalize(v_toLamp);
  ndl = dot(n, lamp);
  vec3 h = normalize(lamp + view);
  float ndh = max(dot(n, h), 0.0);
  float glow = min(1.0, max(ndl, 0.0) * 4.0) * (ma.x * pow(ndh, ma.y) + ma.w * pow(ndh, 4.0));
  vec3 albedo = card.a > 0.0 ? card.rgb / card.a : vec3(0.0);
  vec3 tint = mix(vec3(1.0), albedo, ma.z);
  if (mb.z > 0.0) {
    float hue = dot(h, t) * 2.0 + dot(h, b) * 1.3 + (v_local.x + v_local.y) / v_size.y;
    vec3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (hue + vec3(0.0, 0.33, 0.67)));
    tint = mix(tint, tint * rainbow * 1.6, mb.z);
  }
  return (card.rgb * shade * (1.0 - 0.4 * ma.z) + tint * glow * card.a) * u_lightColor;
}

// How far a point of a cast shadow is from its outline, on the felt: the
// card's rectangle as the light lays it down, a parallelogram - a line, when
// the card is edge-on to the light. Its corners rounded by the card's own.
// One edge of the cast shadow's outline: the nearest distance to it so far,
// and whether a ray from the point crosses it (inside / outside). No local
// arrays: some GPUs' compilers reject an array constructor's precision.
void castEdge(vec2 p, vec2 a, vec2 b, inout float d, inout float s) {
  vec2 e = b - a;
  vec2 w = p - a;
  vec2 q = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-8), 0.0, 1.0);
  d = min(d, dot(q, q));
  bvec3 c = bvec3(p.y >= a.y, p.y < b.y, e.x * w.y > e.y * w.x);
  if (all(c) || all(not(c))) s = -s;
}

float castDistance(vec2 local, vec2 half_, float radius, vec2 across, vec2 down) {
  vec2 p = across * local.x + down * local.y;
  vec2 h = max(half_ - radius, 0.0);
  vec2 c0 = across * -h.x + down * -h.y;
  vec2 c1 = across * h.x + down * -h.y;
  vec2 c2 = across * h.x + down * h.y;
  vec2 c3 = across * -h.x + down * h.y;
  float d = dot(p - c0, p - c0);
  float s = 1.0;
  castEdge(p, c0, c1, d, s);
  castEdge(p, c1, c2, d, s);
  castEdge(p, c2, c3, d, s);
  castEdge(p, c3, c0, d, s);
  float su = length(across);
  float sv = abs(across.x * down.y - across.y * down.x) / max(su, 1e-4);
  return s * sqrt(d) - radius * min(su, sv);
}

float shadowAt(float d, float grow, float alpha, float blur) {
  return alpha * clamp(0.5 - (d - grow) / max(blur, 1e-4), 0.0, 1.0);
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
    if (u_lit > 0.5) card.rgb = min(lightCard(card, facing), vec3(card.a));
    card *= body;
  }

  // Under an opaque card nothing of the shadow shows, and that is most of
  // a card's pixels: three rounded boxes a pixel, skipped.
  float shadow = 0.0;
  if (v_layers.w > 0.0 && card.a < 0.999) {
    float k = size.x / 60.0;
    // A card lifted off the table throws its shadow further and softer.
    float lift = v_lift;
    vec2 drop = v_down * (2.5 * k + lift * 0.45);
    float spread = 1.0 + lift * 0.03;
    // Lit, a resting card's halo falls away from the light.
    if (u_lit > 0.5) {
      drop = v_down * (2.5 * k + lift);
      spread = 1.0 + lift * u_shade.z;
    }
    vec2 p = v_local - drop;
    // Held up, it reads darker against the felt than a card lying on it -
    // without it, on a dark cloth, a picked-up card's shadow all but vanishes.
    float fade = v_layers.w * (1.0 + 0.5 * min(1.0, lift / 20.0)) / (1.0 + lift * 0.006);
    if (u_lit > 0.5) fade *= u_shade.w;
    if (u_lit > 0.5 && castShadow) {
      // Lit and cast from the air: the vertex shader has already pressed it
      // onto the felt along the light, squashed however the card is turned.
      // The same layers, measured in felt rather than in the card's own
      // units - so a card edge-on to the light casts a soft line, not a
      // hard one.
      vec2 across = v_cast.xy;
      vec2 down = v_cast.zw;
      float felt = castDistance(v_local, half_, radius, across, down);
      float px = 1.0 / u_ratio;
      float b1 = shadowAt(felt, 3.8 * k * spread, 0.10, px + 1.6 * k * spread);
      float b2 = shadowAt(felt, 2.2 * k * spread, 0.13, px + 1.0 * k * spread);
      float b3 = shadowAt(felt, 1.0 * k * spread, 0.16, px + 0.6 * k * spread);
      float b4 = shadowAt(felt, 6.0 * k * spread, 0.2 * min(1.0, lift / 18.0), px + 4.5 * k * spread);
      shadow = (1.0 - (1.0 - b1) * (1.0 - b2) * (1.0 - b3) * (1.0 - b4)) * fade;
      float reach = (12.0 * k + 2.0) * spread;
      shadow *= clamp((reach - felt) / (reach * 0.25), 0.0, 1.0);
    } else {
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
  }

  float alpha = card.a + shadow * (1.0 - card.a);
  colour = vec4(card.rgb, alpha) * v_alpha;
  if (colour.a <= 0.002) discard;
}
`;
