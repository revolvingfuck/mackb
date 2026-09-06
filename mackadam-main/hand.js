import * as THREE from 'three';

// =====================================================================
// A wet marble hand standing in the middle of the sea, partially
// submerged, with the swell breaking against it.
//
// The geometry is hand-pose.bin — the bind pose of hand.glb, skinned and
// baked flat by tools/bake-hand.py. That trades a 10 MB skinned mesh whose
// weight is three textures this material never uses for a 46 KB buffer of
// positions, normals and indices, and it means no GLTFLoader (none is
// vendored in this project) and no skinning to plumb through the shader.
//
// Nothing here defines a light or an environment map. sea.js already has a
// full analytic sky in its COMMON chunk, so the marble reflects skyColor()
// and keys off uKeyDir exactly like the water does. The hand therefore
// agrees with the sky at sunrise, noon and midnight, dims under cloud and
// dissolves into the same fog bank, without a single extra uniform to keep
// in step.
//
// The other half of that sharing runs the opposite way: because COMMON
// carries the wave field itself, the marble can ask where the water surface
// is at any point on its own skin. That is what puts the waterline, the wet
// zone, the runnels and the foam collar exactly on the swell instead of at
// a fixed height.
//
// ---------------------------------------------------------------------
// Model: "Hand animation test"
// Author: mason_roman's helloneighborfangamingmodelworks
//         https://sketchfab.com/hello15fan
// Source: https://sketchfab.com/3d-models/hand-animation-test-8980c1c3168e49e7871d78295de948d1
// Licence: CC-BY-4.0 — http://creativecommons.org/licenses/by/4.0/
//          Attribution is required wherever this ships.
// =====================================================================

const POSE_URL = 'hand-pose.bin';

// --------------------------------------------------------------- tuning
// hand-pose.bin is normalised to exactly 1.0 unit tall, centred on the y
// axis in x and z, with its base at y = 0 — so every real dimension of the
// statue is decided here rather than in the bake.
export const HAND = {
  dist:      115,   // world units in front of the camera, along its own axis
  height:     80,   // total height of the statue, base to fingertip
  submerge: 0.42,   // fraction of that height below the mean waterline
  yaw:      0.26,   // radians off square, for a less flat, more sculptural read

  // The statue holds the centre of the frame, behind the brand mark. It is
  // parked on the camera's forward axis every frame rather than pinned to a
  // world point, because the camera drifts on a 40-unit circle while its aim
  // yaws about +/-22 degrees (sea.js) — independently — and a world-fixed
  // statue swings up to ~37 degrees off the view axis, which walks it across
  // the frame and straight out of a portrait viewport.
  //
  // Its HEIGHT is never touched by any of that: the base stays where it is in
  // world space, so the statue is rooted to the sea floor and only the water
  // moves against it.

  spray:    2600,   // spray particle count (fine mist + coarse droplets, mixed)
  mistFrac:  0.74,  // fraction that are fine mist rather than coarse spray
  vein:      8.0,   // marble vein frequency, in model widths
  waterline: 0.0,   // manual nudge if the collar sits off the depth silhouette
  splash:    5.0,   // how far above the waterline stays wet, at dead calm
  splashWind: 11.0, // ...and how much further per unit of wind
  spec:     0.075,  // specular gain
  foam:      1.0,   // foam collar strength
  sprayGain: 1.0    // spray brightness
};

// =====================================================================
// GLSL shared by the marble and the spray
//
// Both stages need to know the sea, and COMMON already carries it — but
// COMMON's seaSurface() also builds a normal and a roughness estimate that
// a fragment of stone has no use for. seaField() is the same six swell
// octaves with the same a/k/direction sequence, returning only what is
// wanted here: the height, the Jacobian fold that says the crest has
// broken, and the vertical velocity that says it is still surging.
// =====================================================================
const WAVE_GLSL = `
void seaField(vec2 p, float t, out float height, out float fold, out float vel){
  height = 0.0; vel = 0.0;
  float jxx = 0.0, jzz = 0.0, jxz = 0.0;
  float q = steepPerOctave();
  float a = SWELL_A0 * uWave, k = SWELL_K0;

  for (int i = 0; i < SWELL_OCTAVES; i++){
    float fi = float(i);
    vec2 dir = waveDir(fi, 1.0);
    float w = sqrt(GRAV * k);
    float th = dot(p, dir) * k + t * w + wavePhase(fi);
    float s = sin(th), c = cos(th);

    height += a * s;
    vel    += a * w * c;                 // d(height)/dt: the surge up the stone

    jxx += q * dir.x * dir.x * s;
    jzz += q * dir.y * dir.y * s;
    jxz -= q * dir.x * dir.y * s;

    a *= SWELL_AF; k *= SWELL_KG;
  }

  // ...plus the baked simulation the water itself is displaced by, or the
  // marble's waterline would sit on the analytic swell alone and the collar
  // would float a metre off the surface the sea is actually drawing.
  height += oceanHeight(p);

  fold = 1.0 - ((1.0 - jxx) * (1.0 - jzz) - jxz * jxz);
}

// Gerstner drags the surface sideways as well as up, by q/k per octave —
// tens of metres at full wind. So the water standing at world position X was
// parameterised somewhere else, and evaluating the wave at X directly would
// put the waterline most of a metre off where the ocean's own depth buffer
// drew it. Invert the displacement by fixed-point iteration instead: the
// Jacobian stays below 1 everywhere the wave has not broken, which is
// exactly the condition for this to converge, and two steps are plenty.
vec2 seaParam(vec2 X, float t){
  vec2 p = X;
  for (int i = 0; i < 2; i++){
    float damp = 1.0 / (1.0 + length(p - cameraPosition.xz) * 0.0006);
    p = X - seaDisplace(p, t, damp).xz;
  }
  return p;
}
`;

// =====================================================================
// the marble
// =====================================================================
const MARBLE_VERT = `
attribute float aAO;        // baked ambient occlusion, 0 buried .. 1 open
attribute float aThick;     // baked thickness, 0 paper-thin .. 1 solid

varying vec3  vWorld;
varying vec3  vObj;
varying vec3  vN;
varying float vAO;
varying float vThick;

void main(){
  vObj   = position;                      // object space: the veining rides the stone
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN     = normalize(mat3(modelMatrix) * normal);
  vAO    = aAO;
  vThick = aThick;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const MARBLE_FRAG = `
uniform float uVein;
uniform float uWaterline;
uniform float uSplash;
uniform float uSplashWind;
uniform float uSpec;
uniform float uFoam;

varying vec3  vWorld;
varying vec3  vObj;
varying vec3  vN;
varying float vAO;
varying float vThick;

// COMMON's hash31 is tuned for the star field, which samples a lattice
// hundreds of cells from the origin; the marble sits within a couple of
// units of it, where that hash degenerates. This one is well behaved there.
float h31(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i + vec3(0,0,0)), h31(i + vec3(1,0,0)), f.x),
                 mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x),
                 mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){
    v += a * vnoise3(p);
    p = p * 2.03 + vec3(1.7, 3.1, 2.3);
    a *= 0.5;
  }
  return v;
}

// ------------------------------------------------------------------ BRDF
// Cook-Torrance, the standard pieces. Trowbridge-Reitz for the distribution,
// height-correlated Smith for the visibility term — without the correlation
// the grazing angles along the silhouette blow out — and Schlick for Fresnel.
float distGGX(float NdH, float a){
  float a2 = a * a;
  float d  = NdH * NdH * (a2 - 1.0) + 1.0;
  return a2 / (PI_ * d * d);
}
float visSmithGGX(float NdV, float NdL, float a){
  float a2 = a * a;
  float gv = NdL * sqrt(NdV * NdV * (1.0 - a2) + a2);
  float gl = NdV * sqrt(NdL * NdL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}
vec3 fresnelSchlick(vec3 f0, float u){
  return f0 + (vec3(1.0) - f0) * pow(clamp(1.0 - u, 0.0, 1.0), 5.0);
}
// Karis's analytic fit to the split-sum environment BRDF, so the ambient
// specular obeys the same energy budget as the direct lobe without needing
// the precomputed LUT there is nowhere to put in this pipeline.
vec3 envBRDF(vec3 f0, float rough, float NdV){
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572,  0.022);
  const vec4 c1 = vec4( 1.0,  0.0425,  1.040, -0.040);
  vec4 r = rough * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NdV)) * r.x + r.y;
  vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
  return f0 * AB.x + AB.y;
}

void main(){
  vec3  toCam = cameraPosition - vWorld;
  float dist  = length(toCam);
  vec3  V     = toCam / max(dist, 1e-4);
  vec3  N     = normalize(vN);

  // ---------------------------------------------------------- the stone
  // Veining is evaluated in OBJECT space, so the pattern is locked to the
  // marble and does not swim when the camera moves. It also means the model's
  // UVs are never touched — just as well, since this GLB carries nine junk
  // TEXCOORD sets from its FBX export and none of them are trustworthy.
  // TWO vein systems, which is what actually reads as marble: a few broad dark
  // seams wandering right through the block, and a finer capillary network
  // branching off them. A single set of veins at one scale reads as camouflage
  // — the give-away is that every marking is the same width.
  //
  // The domain warp is what makes them wander and fork instead of running in
  // parallel bands, so it is applied heavily to the major seams and only
  // lightly to the capillaries.
  vec3  q     = vObj * uVein;
  float warp  = fbm3(q * 1.7 + 11.3);
  float v     = fbm3(q * 0.85 + vec3(warp) * 1.25);
  float vd    = abs(v - 0.5);
  // The big cracks split into two nested bands: the whole channel (major, kept
  // below for relief/polish), and a narrower core inside it that carries the
  // gold. What's left between the two — channel but not core — is the dark
  // rim that frames the leaf, which is the actual give-away of a gilded seam
  // rather than a flat gold line painted over grey stone.
  float major = 1.0 - smoothstep(0.006, 0.072, vd);
  float gold  = 1.0 - smoothstep(0.006, 0.026, vd);
  float rim   = clamp(major - gold, 0.0, 1.0);
  float w2    = fbm3(q * 3.3 + vec3(warp) * 0.55 + 5.9);
  float minor = 1.0 - smoothstep(0.008, 0.078, abs(w2 - 0.5));
  float grain = fbm3(q * 15.0 + 3.7);

  // Calacatta gold: a white-to-grey ground with soft clouding, fine ordinary
  // grey capillaries in the background, and a few broad fractures gilded —
  // charcoal rim, gold leaf core. Only the MAJOR cracks carry gold; the
  // minor network stays plain grey marble, which is what keeps the eye
  // reading a handful of real gold seams instead of a gold cobweb.
  vec3 stone = pal(vec3(0.955, 0.955, 0.948));
  stone = mix(stone, pal(vec3(0.560, 0.575, 0.600)), minor * 0.42);
  stone = mix(stone, pal(vec3(0.780, 0.790, 0.800)), smoothstep(0.56, 0.90, v) * 0.28);
  stone = mix(stone, pal(vec3(0.150, 0.145, 0.140)), rim);
  stone = mix(stone, pal(vec3(0.830, 0.660, 0.320)), gold);
  stone *= 0.95 + 0.10 * grain;

  // Relief from the same field. The veins sit slightly proud and the grain is
  // crystalline, and perturbing the normal with them does real work here: it
  // breaks up the flat shading across a 2,248-triangle mesh that would
  // otherwise read as facets.
  float relief = major * 0.50 + minor * 0.25 + grain * 0.25;
  vec3  dpdx = dFdx(vWorld), dpdy = dFdy(vWorld);
  vec3  gradient = dFdx(relief) * cross(N, dpdy) - dFdy(relief) * cross(N, dpdx);
  N = normalize(N - gradient * 0.06 / max(length(cross(dpdx, dpdy)), 1e-6));

  // ------------------------------------------------------------- water
  vec2  param = seaParam(vWorld.xz, uTime);
  float wh, fold, vel;
  seaField(param, uTime, wh, fold, vel);
  wh += seaRunUp(param, uTime);      // the same heap the sea's vertex stage adds

  float above  = vWorld.y - (wh + uWaterline);
  float splash = uSplash + uSplashWind * uWave;

  float wet = 1.0 - smoothstep(0.0, splash, above);
  // runnels: the sheet of water still draining off the stone after a wave has
  // dropped away, so the wet zone has streaks in it rather than a clean edge
  float run = vnoise(vec2(vObj.x * 26.0 + vObj.z * 22.0, vObj.y * 7.0 - uTime * 1.1));
  wet = max(wet, smoothstep(splash * 2.4, 0.0, above) * smoothstep(0.42, 0.86, run) * 0.75);
  wet = clamp(max(wet, 0.16), 0.0, 1.0);      // sea air keeps all of it damp

  // ---------------------------------------------------------- lighting
  float keyUp = smoothstep(-0.06, 0.10, uKeyDir.y);

  // ------------------------------------------------------- the surface
  // Marble is IOR 1.486, so F0 = ((n-1)/(n+1))^2 = 0.0378. Wetting the stone
  // does NOT raise that much — a water film is IOR 1.333 over 1.486, which is
  // nearly index-matched. What actually reads as wet is the roughness
  // collapsing by an order of magnitude, and that is where the change goes.
  // The gold is a real metal in the BRDF, not a tinted dielectric — gold's own
  // reflectance at normal incidence, from Hoffman's measured tables, and it is
  // what makes the leaf actually glint instead of just reading as a yellow
  // stripe. A flat metal surface would still look too clean for foil, so its
  // roughness is driven by its own much finer noise: many tiny facets at very
  // different polish, so only some catch the light at any one view angle —
  // that flicker, not the colour, is what sells hammered leaf over paint.
  vec3  F0     = mix(vec3(0.0378), vec3(1.000, 0.766, 0.336), gold);
  float fleck  = fbm3(q * 46.0 + 91.7);
  float polish = 0.52 - 0.16 * major - 0.10 * minor;   // seams take a duller cut
  polish = mix(polish, mix(0.03, 0.60, fleck), gold);
  float rough  = mix(polish, 0.055, wet * (1.0 - gold));  // the film beads on
                                                           // metal rather than wetting it

  // Specular antialiasing. The vein relief above is high-frequency geometry
  // in a normal, and a tight lobe over a normal that swings within one pixel
  // sparkles under any camera motion. Widening the lobe by the screen-space
  // variance of N is the standard fix and costs two derivatives.
  vec3  dNx = dFdx(N), dNy = dFdy(N);
  float varN = 0.5 * (dot(dNx, dNx) + dot(dNy, dNy));
  rough = sqrt(clamp(rough * rough + min(varN * 2.0, 0.25), 0.0, 1.0));
  float a = max(rough * rough, 2e-3);

  // A water film fills the pores, so wet stone is darker and higher contrast.
  vec3 albedo = mix(stone, stone * stone * 1.35, wet * 0.80);

  float NdV = clamp(dot(N, V), 1e-4, 1.0);
  float NdL = max(dot(N, uKeyDir), 0.0);
  vec3  H   = normalize(uKeyDir + V);
  float NdH = max(dot(N, H), 0.0);
  float VdH = max(dot(V, H), 0.0);

  // Radiance of whichever body is up. Everything below is a real BRDF times
  // this, so the two are separable and the material stays physical while the
  // exposure stays art-directed.
  vec3 keyRad = uKeyTint * mix(0.25, 4.40, uDay)
              * mix(1.0, 0.22, uOvercast) * keyUp;

  // --------------------------------------------------- direct: GGX + Smith
  vec3  F   = fresnelSchlick(F0, VdH);
  float D   = distGGX(NdH, a);
  float Vis = visSmithGGX(NdV, NdL, a);
  vec3  spec = F * D * Vis * NdL;
  spec = min(spec, vec3(80.0));                 // firefly clamp on the wet film

  // Energy conservation: what the interface reflects never reaches the body —
  // and for the gold leaf that is EVERYTHING it reflects. A real metal has no
  // diffuse term at all (there is no body beneath the surface for light to
  // scatter out of), so kD is killed outright over the gold rather than just
  // reduced by Fresnel the way the dielectric stone is.
  vec3 kD = (vec3(1.0) - F) * (1.0 - gold);
  vec3 diffuse = albedo * (1.0 / PI_) * NdL;

  vec3 col = (kD * diffuse + spec * uSpec * 13.0) * keyRad;

  // ---------------------------------------------- subsurface, from the bake
  // The signature of marble, and the one thing that separates it from painted
  // plaster. vThick is real geometry: rays cast INTO the stone at bake time to
  // find the far wall, so the fingertips and the web of the thumb are thin
  // because they are actually thin, not because a rim term is faking it.
  //
  // The extinction is wavelength-dependent — red gets furthest through calcite —
  // which is why lit marble edges go warm while the body stays cool. None of
  // this reaches the gold: a metal has no far wall for light to come through.
  vec3  sigma = vec3(1.55, 3.30, 5.10);
  vec3  trans = exp(-sigma * (vThick * 2.4 + 0.06)) * (1.0 - gold);
  float back  = pow(clamp(dot(V, -normalize(uKeyDir + N * 0.35)), 0.0, 1.0), 3.0);
  col += albedo * trans * keyRad * back * 1.45;
  // ...and a wrap term, so the terminator rolls off the way a scattering solid
  // does instead of stopping dead at the cosine.
  float wrap = max(0.0, (dot(N, uKeyDir) + 0.55) / 1.55) - NdL;
  col += albedo * trans * keyRad * max(wrap, 0.0) * 0.60;

  // ------------------------------------------------------------ ambient
  // Sky irradiance from the same analytic dome the water reflects, sampled
  // around the normal, with the sea bouncing light back up from below.
  vec3 irr    = skyColor(normalize(N + vec3(0.0, 0.7, 0.0)));
  vec3 bounce = mix(pal(uDeepCol) * uWaterGain, fogTint(), 0.45);
  vec3 amb    = mix(bounce, irr, N.y * 0.5 + 0.5);

  // The baked AO is what grounds the fingers. Without it the gaps between them
  // take as much skylight as the knuckles and the hand reads as a flat cutout.
  col += kD * albedo * amb * vAO;

  // -------------------------------------------------------- reflection
  // The same three moves the water makes, so the marble and the sea mirror one
  // sky: fold rays coming off below the horizon into the haze rather than
  // inventing sky that is not there.
  vec3 R = reflect(-V, N);
  vec3 skyRefl = skyColor(vec3(R.x, max(R.y, 0.0), R.z)) + starField(R) * 0.35;
  vec3 seaRefl = mix(pal(uDeepCol) * uWaterGain, fogTint(), 0.45);
  vec3 refl = mix(seaRefl, skyRefl, smoothstep(-0.10, 0.05, R.y));
  // A rough surface gathers a cone, not a ray, so blur the mirror toward the
  // ambient as roughness rises. Dry marble is rough enough that it barely
  // mirrors at all — and letting it wash the veining out is exactly what made
  // the statue stop reading as stone.
  refl = mix(refl, amb, clamp(rough * 1.6, 0.0, 0.9));

  // Split-sum environment BRDF (Karis), and Lagarde's specular occlusion so
  // the crevices do not pick up sky they cannot see.
  vec3  envF    = envBRDF(F0, rough, NdV);
  float specOcc = clamp(pow(NdV + vAO, exp2(-16.0 * rough - 1.0)) - 1.0 + vAO, 0.0, 1.0);
  col += refl * envF * specOcc;

  // ------------------------------------------------------------- foam
  // The sea is opaque, so anything below the surface is already hidden by the
  // depth buffer — this band only has to carry the contact itself, and does
  // not need to shade a submerged hand nobody can see.
  if (above < 0.0){
    float depth = -above;
    col *= exp(-depth * vec3(0.085, 0.030, 0.024));           // red goes first
    col  = mix(col, pal(uDeepCol) * amb * uWaterGain, 1.0 - exp(-depth * 0.55));
    float caus = vnoise(param * 0.55 + uTime * 0.7) * vnoise(param * 0.9 - uTime * 0.5);
    col += uKeyTint * pow(caus, 2.5) * 1.6 * exp(-depth * 0.8) * uDay * keyUp;
  }

  // The collar rides the swell's own vertical velocity, so it climbs the wrist
  // on the up-stroke, and flares where the Gerstner Jacobian says the crest
  // here has actually folded over. That is the whole "crashing" read.
  float surge = max(vel, 0.0) * (0.55 + 0.90 * uWave);
  float band  = 1.0 - smoothstep(0.0, 2.2 * (0.6 + 0.9 * uWave), abs(above - surge * 0.5));
  float churn = vnoise(param * 1.3 + vec2(0.0, uTime * 2.2))
              * vnoise(param * 2.9 - uTime * 1.5);
  float collar = band * smoothstep(0.20, 0.62, churn);
  collar = max(collar, band * smoothstep(0.55, 1.15, fold) * 0.90);
  collar *= smoothstep(-3.0, 0.5, above);

  vec3 foamCol = mix(pal(vec3(0.300, 0.340, 0.400)), pal(vec3(0.86, 0.90, 0.95)), uDay);
  col = mix(col, foamCol, clamp(collar * uFoam, 0.0, 1.0));

  // -------------------------------------------------------------- fog
  // Same curve and the same drifting bank as the water, keyed off world xz, so
  // the statue sits in the air the sea sits in rather than in front of it.
  float mist = vnoise(vWorld.xz * 0.0016 + vec2(uTime * 0.013, uTime * 0.008));
  float dens = mix(0.00030, 0.00115, uFog) * (0.70 + 0.60 * mist);
  float fog  = 1.0 - exp(-pow(dist * dens, 1.65));
  col = mix(col, fogTint(), clamp(fog, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}`;

// =====================================================================
// the spray
//
// One draw call, TWO populations sharing one buffer: a continuous "kind" per
// particle (0 = fine mist, 1 = coarse spray) rather than a hard split, so the
// two blend into each other instead of reading as two separate effects.
// Real spray off a wave hitting rock is both at once — a scatter of flung
// droplets with a haze of mist hanging around and behind them — and a single
// population can only ever be a compromise between the two.
//
// Every particle's whole trajectory is still derived in the vertex shader
// from its seed, its kind and uTime, so nothing is simulated on the CPU and
// nothing is uploaded per frame.
//
// The launch is gated on the swell's upward velocity and fold AT THE MOMENT
// THE PARTICLE LEFT — not now — which is what makes bursts arrive with the
// waves instead of raining continuously. uOceanOn's baked churn breaks that
// gate up spatially so a burst fires as uneven pockets around the ring rather
// than one clean pulse — a real wave never lets go all at once.
// =====================================================================
const SPRAY_VERT = `
attribute float aSeed;                 // uObsPos / uObsR come from COMMON
attribute float aKind;                 // 0 fine mist .. 1 coarse spray

varying float vLife;
varying float vBright;
varying float vKind;

// Curl-style turbulence: three offset noise taps, differenced. Not a real
// curl of a real field, but it is divergence-free ENOUGH at this scale to
// drift particles apart instead of collapsing them onto each other, and it
// is what keeps a droplet's path from reading as one dead-straight arc.
vec2 curl(vec2 p, float t){
  float e = 0.6;
  float n1 = vnoise(p + vec2(0.0, t * 0.6));
  float n2 = vnoise(p + vec2(e,   t * 0.6));
  float n3 = vnoise(p + vec2(0.0, t * 0.6 + e));
  return vec2(n3 - n1, n1 - n2) / e;
}

void main(){
  vec2  base = uObsPos.xz + position.xz * uObsR;

  // Mist fires far more often and burns out quicker than coarse spray, so the
  // air around an impact reads as a haze rather than a metronome of identical
  // drops all peaking together.
  float rate = mix(0.95, 0.32, aKind) + 0.40 * hash21(vec2(aSeed, 3.7));
  float life = fract(uTime * rate + aSeed * 7.13);
  float T    = 1.0 / rate;
  float t    = life * T;

  float h, fold, vel;
  seaField(base, uTime - t, h, fold, vel);
  h += seaRunUp(base, uTime - t);      // launched off the heaped-up surface

  // The baked simulation's own high-frequency churn, sampled AT LAUNCH TIME,
  // breaks the gate into uneven pockets instead of a smooth ring pulsing all
  // at once — this is the direct tie between the new fine-scale water detail
  // and where the spray actually comes from.
  float chaos = 1.0;
  if (uOceanOn > 0.5)
    chaos = 0.5 + 0.9 * abs(oceanHeight(base) / max(uOceanAmp, 1e-3));

  float burst = smoothstep(0.15, 1.60, vel)
              * (0.35 + 0.85 * smoothstep(0.30, 1.05, fold)) * chaos;
  vBright = burst * smoothstep(0.0, 0.14, life) * pow(1.0 - life, mix(0.55, 1.7, aKind));

  if (vBright < 0.003){                       // nothing thrown up here yet
    gl_Position  = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  // Coarse spray is thrown hard and falls like a real ballistic droplet; fine
  // mist barely clears the collar, falls slower than it rose, and drifts.
  float v0 = (2.0 + 15.0 * uWave) * mix(0.30, 1.0, aKind)
           * (0.45 + 0.85 * hash21(vec2(aSeed, 9.1))) * burst;
  vec2  out2 = normalize(position.xz + 1e-4);

  vec2  wind = vec2(cos(WIND_BEARING), sin(WIND_BEARING)) * uWave * mix(2.4, 0.35, aKind);
  vec2  turb = curl(base * 0.05 + out2 * t * 1.6, uTime - t) * mix(3.4, 0.5, aKind);
  float fallMul = mix(0.5, 1.0, aKind);       // mist hangs; spray drops like a rock

  vec3  wp = vec3(base.x + out2.x * v0 * 0.30 * t + wind.x * t * t + turb.x * t,
                  h + v0 * t - 0.5 * GRAV * fallMul * t * t,
                  base.y + out2.y * v0 * 0.30 * t + wind.y * t * t + turb.y * t);

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;

  // uPixelScale is world units per pixel per unit of distance, so this is a
  // droplet of a fixed WORLD size resolving to the right number of pixels.
  // Mist is genuinely fine — a fraction of a coarse droplet's diameter.
  float wsize = mix(0.05, 0.85, pow(aKind, 1.4)) * (0.55 + 0.9 * hash21(vec2(aSeed, 1.3)));
  gl_PointSize = clamp(wsize / (max(-mv.z, 1.0) * uPixelScale), 1.0, 46.0);

  vLife = life;
  vKind = aKind;
}`;

const SPRAY_FRAG = `
uniform float uSprayGain;
varying float vLife;
varying float vBright;
varying float vKind;

void main(){
  vec2  c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  float edge = mix(0.25, 0.21, vKind);        // mist is a softer, wider disc
  if (d > edge) discard;

  float alpha = smoothstep(edge, 0.0, d);
  // a droplet has a brighter wet core; mist is diffuse all the way through
  float core  = smoothstep(0.09, 0.0, d) * vKind;
  vec3  tint  = mix(pal(vec3(0.55, 0.63, 0.78)), vec3(1.0), uDay);
  vec3  col   = tint * uKeyTint * vBright * (0.60 + core * 1.5);

  // lands in the HDR target with everything else, so the existing bloom chain
  // picks the brightest droplets up for free
  gl_FragColor = vec4(col * uSprayGain * 1.6, alpha * mix(0.5, 1.0, vKind));
}`;

// =====================================================================
// loading
// =====================================================================
async function loadPose(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  const head = new DataView(buf);

  const magic = String.fromCharCode(head.getUint8(0), head.getUint8(1),
                                    head.getUint8(2), head.getUint8(3));
  if (magic !== 'HND2') throw new Error('bad magic "' + magic + '" — re-run tools/bake-hand.py');

  const verts = head.getUint32(4, true);
  const idx = head.getUint32(8, true);
  const flags = head.getUint32(12, true);
  const baked = (flags & 1) !== 0;      // AO + thickness present

  // 16-byte header, then positions, normals, [ao, thickness], indices. Every
  // offset stays naturally aligned, so these are typed-array views straight
  // onto the response with no copy.
  let o = 16;
  const position = new Float32Array(buf, o, verts * 3); o += verts * 12;
  const normal = new Float32Array(buf, o, verts * 3); o += verts * 12;

  let ao, thick;
  if (baked) {
    ao = new Float32Array(buf, o, verts); o += verts * 4;
    thick = new Float32Array(buf, o, verts); o += verts * 4;
  } else {
    // A bake run with --no-occlusion still has to light: fully open, and thick
    // enough that the subsurface term contributes nothing rather than glowing.
    ao = new Float32Array(verts).fill(1);
    thick = new Float32Array(verts).fill(1);
  }
  const index = new Uint16Array(buf, o, idx);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  geo.setAttribute('aThick', new THREE.BufferAttribute(thick, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

// The footprint where stone actually meets water, which is what the sea's foam
// ring and contact darkening want — not the half-width of the whole statue,
// which the splayed fingers make nearly twice as wide.
function radiusAt(geo, y, band) {
  const p = geo.attributes.position.array;
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i + 1] - y) > band) continue;
    const d = p[i] * p[i] + p[i + 2] * p[i + 2];
    if (d > r2) r2 = d;
  }
  return Math.sqrt(r2);
}

// =====================================================================
export function createMarbleHand({ common, uniforms, scene, camera }) {
  const _fwd = new THREE.Vector3();
  const local = {
    uVein: { value: HAND.vein },
    uWaterline: { value: HAND.waterline },
    uSplash: { value: HAND.splash },
    uSplashWind: { value: HAND.splashWind },
    uSpec: { value: HAND.spec },
    uFoam: { value: HAND.foam },
    uSprayGain: { value: HAND.sprayGain }
  };

  const api = {
    ready: false,
    failed: false,       // preloader.js waits on ready OR failed, not forever
    pos: new THREE.Vector3(0, 0, -HAND.dist),
    radius: 0,
    mesh: null,
    spray: null,
    uniforms: local,
    HAND,
    update
  };

  const GLSL = common + WAVE_GLSL;

  loadPose(POSE_URL).then(geo => {
    // ------------------------------------------------------------ statue
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...local },
      vertexShader: MARBLE_VERT,
      fragmentShader: GLSL + MARBLE_FRAG
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(HAND.height);
    scene.add(mesh);

    api.mesh = mesh;
    // in normalised model units, so it survives a change of HAND.height
    api.footprint = radiusAt(geo, HAND.submerge, 0.06);
    place();

    // ------------------------------------------------------------- spray
    // Two populations sharing one buffer, distinguished only by aKind: mist
    // hugs the contact ring tightly (it barely gets thrown), coarse spray
    // launches from a wider band further from the hand, which is where a
    // wave actually breaks hardest against it.
    const n = HAND.spray;
    const ring = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const kind = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const mist = Math.random() < HAND.mistFrac;
      const a = Math.random() * Math.PI * 2;
      const r = mist ? 0.78 + Math.random() * 0.45      // tight to the contact
                     : 0.95 + Math.random() * 0.85;      // out where it breaks
      ring[i * 3] = Math.cos(a) * r;
      ring[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
      kind[i] = mist ? Math.random() * 0.30 : 0.70 + Math.random() * 0.30;
    }

    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(ring, 3));
    sgeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    sgeo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));

    const spray = new THREE.Points(sgeo, new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...local },
      vertexShader: GLSL + SPRAY_VERT,
      fragmentShader: GLSL + SPRAY_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,      // spray behind the statue is occluded by it
      depthWrite: false
    }));
    spray.frustumCulled = false;   // every position is computed in the shader
    scene.add(spray);
    api.spray = spray;

    // Hand the sea its obstacle, which switches on the run-up, the collision
    // foam ring and the contact darkening in sea.js.
    uniforms.uObsOn.value = 1;
    api.ready = true;
  }).catch(err => {
    // The sea is the page's backdrop and must never depend on this. Same
    // contract as the weather fetch at the foot of sea.js: fail, say so once,
    // and leave the scene running exactly as it was.
    console.warn('[hand] ' + POSE_URL + ' unavailable, sea running without it:', err.message);
    api.failed = true;
  });

  // Park the statue dead centre of the frame, at a fixed distance along the
  // camera's own forward axis, turned to face back down it.
  //
  // Only the AZIMUTH is taken from the camera. The base height is a constant in
  // world space, so the statue never rises or falls: it is rooted to the sea
  // floor, and everything that moves against it — the waterline climbing the
  // wrist, the foam collar, the spray — is the water, not the stone.
  function place() {
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, -1);
    _fwd.normalize();

    api.pos.set(camera.position.x + _fwd.x * HAND.dist,
                -HAND.height * HAND.submerge,
                camera.position.z + _fwd.z * HAND.dist);
    api.radius = Math.max(api.footprint * HAND.height, 1.0);

    api.mesh.position.copy(api.pos);
    api.mesh.scale.setScalar(HAND.height);
    // the model faces +z, so turn that back along the view axis toward the lens
    api.mesh.rotation.y = Math.atan2(-_fwd.x, -_fwd.z) + HAND.yaw;

    uniforms.uObsPos.value.set(api.pos.x, 0, api.pos.z);
    uniforms.uObsR.value = api.radius;
  }

  function update() {
    if (!api.ready) return;
    place();

    // Everything animated lives in the shaders off uTime; this only carries
    // live edits to window.__hand through, so the statue can be tuned from the
    // console without a reload.
    local.uVein.value = HAND.vein;
    local.uWaterline.value = HAND.waterline;
    local.uSplash.value = HAND.splash;
    local.uSplashWind.value = HAND.splashWind;
    local.uSpec.value = HAND.spec;
    local.uFoam.value = HAND.foam;
    local.uSprayGain.value = HAND.sprayGain;
  }

  return api;
}
