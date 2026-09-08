import * as THREE from 'three';
import { createMarbleHand } from './hand.js';

// =====================================================================
// The page's backdrop: a sky dome and a displaced ocean, seen from a
// camera that sits low and rides the swell.
//
// The sun and moon sit opposite each other on one wheel, and that wheel
// is driven by the visitor's actual local time against their actual
// local sunrise and sunset — so the sky matches the hour they are
// looking at it, and keeps matching it for the whole visit.
//
// Conditions come from the weather where they are: wind drives the sea
// state, cloud the overcast lid, visibility the fog, and humidity the
// atmospheric turbidity.
//
// Renders into #sea-container at z-index 0 — behind the site's own scene
// in #three-container, whose renderer is alpha:true and clears to
// transparent, so it composites straight over this.
//
// Debug hooks, all of which skip the network so they are reproducible:
//   ?hour=13            pin the solar hour
//   ?wind=1&cloud=0.2   pin conditions (0..1)
//   ?fog=0.9
//   ?stats=1            frame-time readout
// =====================================================================

// --------------------------------------------------------------- quality
// Every knob that trades frame time for fidelity lives here, so dialling
// the scene back for weaker hardware is a one-place edit.
const QUALITY = {
  pixelRatio:     1.5,    // cap on devicePixelRatio
  gridCols:       300,    // projected grid, in screen space
  gridRows:       200,
  msaaSamples:    2,      // MSAA on the HDR target
  bloomScale:     0.5,    // bloom chain resolution, as a fraction of full
  bloomPasses:    3,      // Kawase iterations; each one widens the halo
  bloomStrength:  0.45,
  bloomThreshold: 1.00,   // linear; only real highlights, not the whole sky
  skyGain:        0.30,   // Preetham returns HDR radiance; bring it into range
  exposure:       1.05,
  maxDist:        11000   // how far the water plane is traced
};

// ------------------------------------------------------------ debug hooks
const PARAMS = new URLSearchParams(location.search);
const qnum = k => { const v = parseFloat(PARAMS.get(k)); return Number.isFinite(v) ? v : undefined; };
const FORCE = { hour: qnum('hour'), wind: qnum('wind'), cloud: qnum('cloud'), fog: qnum('fog') };
const PINNED = Object.values(FORCE).some(v => v !== undefined);
const SHOW_STATS = PARAMS.has('stats');

// ------------------------------------------------------------- the swell
// The wave field's constants, in one place. The GLSL below interpolates them
// into its #defines and the camera samples the same series on the CPU in
// frame(), so the deck rides the water the shader is actually drawing rather
// than a sine wave that merely resembles it. At these amplitudes that matters:
// a fixed deck height would put crests over the lens.
const WAVE = {
  bearing:    0.373,   // wind direction, radians
  amp:        3.60,    // base swell amplitude, before uWave
  k:          0.0135,  // base wavenumber
  ampFalloff: 0.42,    // amplitude drops faster than k rises, so long swell leads
  kGrowth:    2.03,
  octaves:    6
};
// total amplitude if every octave crested at once — the geometric sum
WAVE.sum = WAVE.amp * (1 - Math.pow(WAVE.ampFalloff, WAVE.octaves)) / (1 - WAVE.ampFalloff);

// GLSL has no implicit int->float, so every interpolated number needs a point
const g = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));

const clamp01 = v => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const lerp = (a, b, u) => a + (b - a) * u;

// Live conditions. These are TARGETS — the scene eases toward them, so the
// weather arriving a second or two after load settles in rather than snapping.
// Every one has a usable default: if the network is slow, blocked, offline, or
// the visitor is behind a filter, the sea still runs, it just runs on these.
const COND = { wind: 0.55, cloud: 0.35, fog: 0.30, turbidity: 3.4 };

if (FORCE.wind  !== undefined) COND.wind  = clamp01(FORCE.wind);
if (FORCE.cloud !== undefined) COND.cloud = clamp01(FORCE.cloud);
if (FORCE.fog   !== undefined) COND.fog   = clamp01(FORCE.fog);

const live = { ...COND };

// Where the sun crosses the horizon, in the viewer's local hours. Replaced by
// the real solar times for their coordinates once the forecast lands; the
// applied values below ease toward these so the correction glides in.
const SOLAR = { sunrise: 6, sunset: 18, offset: -new Date().getTimezoneOffset() / 60 };
const solar = { ...SOLAR };

// ---------------------------------------------------------------- renderer
const container = document.getElementById('sea-container');

// antialias:false is deliberate — everything reaching this framebuffer is a
// fullscreen quad with no geometric edges to smooth. The scene's real
// antialiasing is MSAA on the HDR target below.
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false;
container.appendChild(renderer.domElement);

// Note: a raw ShaderMaterial never receives three's tonemapping_fragment or
// colorspace_fragment chunks, so nothing here is tone mapped or encoded on the
// way out. The composite pass at the end of this file does both, once, which
// is why every shader below works in linear light.

// ---------------------------------------------------------------- uniforms
// Shared by every pass, so the water, the sky and the flare all agree on
// where the light is and what time of day it is.
const uTime        = { value: 0 };
// Pace of the water. uTime is the wave clock, not the wall clock: every swell,
// crest and fog bank is phased off it, so scaling it here slows the whole
// surface uniformly without touching the sun, which runs off the visitor's
// real clock in sunAngle(). 1.0 is real time; lower is calmer.
const WAVE_SPEED   = 0.72;
// Overall scale on the sun/moon glint highlight (col += ... * uKeyGain below).
// Turn down if the light reflecting off the water reads as too intense.
const GLINT_GAIN   = 0.55;
const uSunDir      = { value: new THREE.Vector3(0, 0, -1) };
const uDay         = { value: 0 };                              // 0 night .. 1 day
const uAtmos       = { value: 0 };                              // scattering vs night palette
const uGolden      = { value: 0 };                              // 1 at the horizon
const uKeyDir      = { value: new THREE.Vector3(0, 0, -1) };    // whichever body is up
const uKeyTint     = { value: new THREE.Vector3(0.80, 0.87, 1.0) };
const uKeyGain     = { value: 46 };
const uFog         = { value: 0.4 };                            // 0 clear .. 1 thick
const uWave        = { value: 1.0 };                            // swell amplitude, from wind
const uOvercast    = { value: 0.35 };                           // 0 open sky .. 1 solid lid
const uTurbidity   = { value: 3.4 };                            // haze in the air column
const uPixelScale  = { value: 0.002 };                          // world units per pixel, per unit distance
const uMaxDist     = { value: QUALITY.maxDist };
const uSkyGain     = { value: QUALITY.skyGain };   // scales Preetham radiance into range
const uInvViewProj = { value: new THREE.Matrix4() };
const uHorizonY    = { value: 0.2 };                            // horizon, in NDC y

// The water's own colour, as opposed to everything it reflects. Authored as
// display values like the rest of the palette — the shader lifts them through
// pal() — with a day and a night entry each, crossfaded on uDay so the sea
// still reads at every hour instead of being tuned for noon and going muddy
// at midnight.
//
// These are the knobs to reach for when the sea looks wrong. window.__sea.WATER
// is live: edit it in the console and the change lands on the next frame.
const WATER = {
  deep:    { day: [0.020, 0.105, 0.170], night: [0.020, 0.060, 0.110] },
  shallow: { day: [0.180, 0.560, 0.440], night: [0.075, 0.215, 0.240] },
  foam:    { day: [0.950, 0.960, 0.970], night: [0.560, 0.610, 0.700] },
  gain: 2.4
};
// ------------------------------------------------------------ the churn
// A baked slice of a real ocean simulation (tools/bake-ocean.py), uploaded as
// a 3D texture of x by z by time and sampled in both the vertex and fragment
// stages. Trilinear filtering interpolates between frames for free.
//
// It is layered ON the analytic swell rather than replacing it. The simulation
// patch is 152 units across while the dominant Gerstner octave is a 465-unit
// wavelength, so on its own it would tile three times inside one swell and
// carry no long rollers at all. Summed sines cannot produce a breaking crest;
// a simulation cannot produce an open horizon. Together they do both.
const OCEAN_URL = 'ocean-cache.bin';
const OCEAN_LOOP = 10.417;                 // seconds, from the source animation

// A 1x1x1 placeholder so the sampler is always bound and the shader compiles
// and runs identically whether or not the cache ever arrives.
const oceanFallback = new THREE.Data3DTexture(new Float32Array(1), 1, 1, 1);
oceanFallback.format = THREE.RedFormat;
oceanFallback.type = THREE.FloatType;
oceanFallback.needsUpdate = true;

const uOcean      = { value: oceanFallback };
const uOceanAmp   = { value: 0 };          // world units of displacement
const uOceanTile  = { value: 152.5 };      // world units per repeat
const uOceanPhase = { value: 0 };          // 0..1 through the loop
const uOceanOn    = { value: 0 };          // 0 until the cache lands
const uOceanGain     = { value: 0.5 };     // live tuning handle — amplitude scale (flatter < 1)
const uOceanTileGain = { value: 1.6 };     // live tuning handle — repeat spacing scale (wider > 1)
let   uOceanBase     = 0;                  // amplitude as baked
let   uOceanTileBase = 152.5;              // repeat spacing as baked

const uDeepCol    = { value: new THREE.Vector3() };
const uShallowCol = { value: new THREE.Vector3() };
const uFoamCol    = { value: new THREE.Vector3() };
const uWaterGain  = { value: WATER.gain };

// crossfade one WATER entry into its uniform
const mixWater = (u, e, d) => u.value.set(lerp(e.night[0], e.day[0], d),
                                          lerp(e.night[1], e.day[1], d),
                                          lerp(e.night[2], e.day[2], d));

// The marble hand, as far as the water is concerned: somewhere to pile against,
// break on, and darken under. hand.js fills these in once hand-pose.bin lands
// and flips uObsOn; until then — and forever, if it never loads — every term
// they drive multiplies out to nothing and the sea runs exactly as it did.
const uObsPos      = { value: new THREE.Vector3() };            // world, at the waterline
const uObsR        = { value: 1 };                              // its footprint there
const uObsOn       = { value: 0 };

const SKY_UNIFORMS = { uTime, uSunDir, uDay, uAtmos, uGolden, uKeyDir, uKeyTint,
                       uKeyGain, uFog, uWave, uOvercast, uTurbidity, uPixelScale,
                       uMaxDist, uSkyGain };
const SEA_UNIFORMS = { ...SKY_UNIFORMS, uInvViewProj, uHorizonY, uObsPos, uObsR, uObsOn,
                       uDeepCol, uShallowCol, uFoamCol, uWaterGain,
                       uOcean, uOceanAmp, uOceanTile, uOceanPhase, uOceanOn };

// =====================================================================
// SHARED GLSL — wave field, hashes, and the sky the water reflects
// =====================================================================
const COMMON = `
uniform float uTime;
uniform vec3  uSunDir;
uniform float uDay;
uniform float uAtmos;
uniform float uGolden;
uniform vec3  uKeyDir;
uniform vec3  uKeyTint;
uniform float uKeyGain;
uniform float uFog;
uniform float uWave;
uniform float uOvercast;
uniform float uTurbidity;
uniform float uPixelScale;
uniform float uMaxDist;
uniform float uSkyGain;
uniform vec3  uObsPos;
uniform float uObsR;
uniform float uObsOn;
uniform vec3  uDeepCol;
uniform vec3  uShallowCol;
uniform vec3  uFoamCol;
uniform float uWaterGain;
uniform sampler3D uOcean;
uniform float uOceanAmp;
uniform float uOceanTile;
uniform float uOceanPhase;
uniform float uOceanOn;

// The palette in this file was authored against a pipeline that wrote values
// straight to the framebuffer with no encoding, so the numbers read as display
// values. Now that the composite encodes properly, lift them into linear light
// first and let the tone mapper bring them back.
//
// This round-trips midtones closely but NOT darks: the ACES toe multiplies
// small values by about 0.21, so anything authored near black lands on black.
// The night end of the palette is therefore authored for this pipeline rather
// than carried over — which is why those numbers look far too light to read as
// night until you follow them through the tone curve.
vec3 pal(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }

// What the distance dissolves into. Tracks the cycle, so fog is blue-grey at
// night, pale at noon, and burns orange at either end of the day.
vec3 fogTint(){
  vec3 c = mix(pal(vec3(0.200, 0.240, 0.310)), pal(vec3(0.620, 0.700, 0.800)), uDay);
  return mix(c, pal(vec3(0.880, 0.560, 0.340)), uGolden * 0.60);
}

float hash21(vec2 p){
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float hash31(vec3 p){
  p = fract(p * vec3(127.1, 311.7, 74.7));
  p += dot(p, p + 41.17);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x),
             mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), f.x), f.y);
}

// =====================================================================
// the swell — Gerstner (trochoidal) waves
//
// Sharp crests, broad troughs, and horizontal particle motion, which is
// the shape difference between "sine hills" and open ocean. Phase speed
// comes from the deep-water dispersion relation w = sqrt(g k), so the
// octaves travel at physically consistent relative speeds.
//
// Each octave carries a fixed share of the total steepness, which keeps
// Q*k*A per wave bounded and makes the fold term below well behaved.
// =====================================================================
#define SWELL_OCTAVES ${WAVE.octaves}
#define CHOP_OCTAVES  4
#define GRAV 9.81

// The swell series, interpolated from the WAVE block above so that the shader,
// the marble's waterline in hand.js and the camera's own height sampler all
// walk one set of numbers.
#define SWELL_A0 ${g(WAVE.amp)}
#define SWELL_K0 ${g(WAVE.k)}
#define SWELL_AF ${g(WAVE.ampFalloff)}
#define SWELL_KG ${g(WAVE.kGrowth)}

// Wind bearing. Every wave train is referred to this, because a real sea is
// one system driven by one wind, not a pile of unrelated sine trains.
#define WIND_BEARING ${g(WAVE.bearing)}

// Directional spread. Long swell runs almost straight downwind; shorter waves
// fan out further either side of it. Fanning every octave by a fixed large
// angle — which is what a plain rotation does — reads as crosshatch, not sea.
// The widening with frequency is the shape a cos-2s spreading function has:
// the dominant swell holds the wind line within a few degrees while the short
// waves run out to fifty either side of it.
vec2 waveDir(float fi, float spread){
  float ang = WIND_BEARING + (0.16 + 0.15 * fi) * sin(fi * 2.399 + 0.7) * spread;
  return vec2(cos(ang), sin(ang));
}

// A scattered phase per octave. Without one every octave crests together at the
// origin and stays in step with the others forever, and the sum reads as a
// single repeating shape sliding past rather than as a sea. A real spectrum has
// random phase, and this is the cheapest honest stand-in for it.
//
// Deliberately NOT a fract(sin(x)*43758.5453) hash: the camera evaluates this
// same series on the CPU to find its own deck height, and that hash lands on
// different values in the shader's 32-bit floats than in JavaScript's 64-bit
// ones. Golden angle plus a quadratic term scatters the phases just as well and
// gives bit-comparable answers on both sides.
float wavePhase(float fi){ return fi * 2.39996323 + fi * fi * 0.76543; }

// The simulation's churn, tiled across the sea and running on its own clock.
//
// three compiles every non-raw ShaderMaterial as "#version 300 es" with
// attribute/varying/texture2D compatibility defines, which is why sampler3D and
// texture() are available here even though everything else in this file reads
// like GLSL ES 1.00.
float oceanHeight(vec2 p){
  if (uOceanOn < 0.5) return 0.0;
  return texture(uOcean, vec3(p / uOceanTile, uOceanPhase)).r * uOceanAmp;
}

// Central differences for the slope the sim contributes. Four extra fetches,
// but analytic derivatives do not exist for a baked field and finite
// differencing a texture is what the hardware filtering is for.
vec2 oceanGrad(vec2 p, float e){
  if (uOceanOn < 0.5) return vec2(0.0);
  return vec2(oceanHeight(p + vec2(e, 0.0)) - oceanHeight(p - vec2(e, 0.0)),
              oceanHeight(p + vec2(0.0, e)) - oceanHeight(p - vec2(0.0, e))) / (2.0 * e);
}

float steepPerOctave(){ return (0.50 + 0.62 * uWave) / float(SWELL_OCTAVES); }

float fbm2(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){
    v += a * vnoise(p);
    p = p * 2.02 + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return v;
}

// Vertex-stage displacement only: the cheap half, without normals or foam.
vec3 seaDisplace(vec2 p, float t, float damp){
  vec3 disp = vec3(0.0);
  float q = steepPerOctave();
  float a = SWELL_A0 * uWave, k = SWELL_K0;
  for (int i = 0; i < SWELL_OCTAVES; i++){
    float fi = float(i);
    vec2 dir = waveDir(fi, 1.0);
    float th = dot(p, dir) * k + t * sqrt(GRAV * k) + wavePhase(fi);
    disp.xz += dir * (q * cos(th) / k) * damp;
    disp.y  += a * sin(th);
    // amplitude falls faster than frequency rises, so steepness DROPS with
    // frequency: long swell dominates and the short waves ride on it
    a *= SWELL_AF; k *= SWELL_KG;
  }
  disp.y += oceanHeight(p);
  return disp;
}

// Fragment-stage surface: height, the analytic normal (Gerstner has closed-form
// partials, so no finite differencing), the Jacobian fold term that says where
// the crest has actually broken, and the roughness standing in for every octave
// too small to resolve at this pixel.
//
// The foot argument is the world-space width of a pixel here. Octaves finer
// than that are dropped from the normal and folded into rough instead, which stops
// the specular crawling without flattening the water into plastic.
void seaSurface(vec2 p, float t, float damp, float foot,
                out float height, out vec3 nrm, out float fold, out float rough)
{
  height = 0.0; rough = 0.0;
  float nx = 0.0, nz = 0.0, ny = 0.0;
  float jxx = 0.0, jzz = 0.0, jxz = 0.0;

  float q = steepPerOctave();
  float a = SWELL_A0 * uWave, k = SWELL_K0;

  for (int i = 0; i < SWELL_OCTAVES; i++){
    float fi = float(i);
    vec2 dir = waveDir(fi, 1.0);
    float th = dot(p, dir) * k + t * sqrt(GRAV * k) + wavePhase(fi);
    float s = sin(th), c = cos(th);
    float wa = k * a;
    float res = exp(-pow(foot * k * 0.5, 2.0));   // 1 resolvable .. 0 sub-pixel

    height += a * s;

    nx += dir.x * wa * c * res;
    nz += dir.y * wa * c * res;
    ny += q * s * res;

    jxx += q * dir.x * dir.x * s;
    jzz += q * dir.y * dir.y * s;
    jxz -= q * dir.x * dir.y * s;

    rough += wa * wa * (1.0 - res) * 0.5;

    a *= SWELL_AF; k *= SWELL_KG;
  }

  // Fine chop: normal-only detail, far too small to put through the grid.
  // It runs with the wind too, only fanned wider — chop crossing the swell at
  // right angles is the other half of what made the surface read as plaid.
  float a2 = 0.055 * (0.45 + 0.85 * uWave), k2 = 0.62;
  for (int i = 0; i < CHOP_OCTAVES; i++){
    float fi = float(i);
    vec2 d2 = waveDir(fi + 1.5, 1.35);
    float th = dot(p, d2) * k2 + t * sqrt(GRAV * k2) + wavePhase(fi + 1.5);
    float wa = k2 * a2;
    float res = exp(-pow(foot * k2 * 0.5, 2.0));
    nx += d2.x * wa * cos(th) * res * damp;
    nz += d2.y * wa * cos(th) * res * damp;
    rough += wa * wa * (1.0 - res) * 0.5;
    a2 *= 0.45; k2 *= 2.11;
  }

  // The simulation's churn, on top of the analytic swell. It carries the
  // breaking shapes a sum of sines cannot make — but it is also the finest
  // detail on the surface, so it fades out with the pixel footprint like every
  // other octave here, and what fades goes into the roughness rather than
  // simply vanishing.
  float ofade = exp(-pow(foot * 0.30, 2.0));
  if (uOceanOn > 0.5){
    height += oceanHeight(p) * ofade;
    vec2 og = oceanGrad(p, max(foot, uOceanTile / 256.0)) * ofade;
    nx += og.x;
    nz += og.y;
    rough += 0.0022 * (1.0 - ofade);
  }

  nrm = normalize(vec3(-nx, 1.0 - ny, -nz));

  // Jacobian of the horizontal displacement. Below 1 the surface is
  // compressing; below 0 it has folded over itself, which is a whitecap.
  float J = (1.0 - jxx) * (1.0 - jzz) - jxz * jxz;
  fold = 1.0 - J;
}

// The fold term on its own. The Jacobian needs one sine per octave and nothing
// else — no amplitude, no cosine, no normal — which makes it cheap enough to
// call several times a fragment. The whitecap memory below does exactly that.
float seaFold(vec2 p, float t){
  float jxx = 0.0, jzz = 0.0, jxz = 0.0;
  float q = steepPerOctave();
  float k = SWELL_K0;
  for (int i = 0; i < SWELL_OCTAVES; i++){
    float fi = float(i);
    vec2 dir = waveDir(fi, 1.0);
    float s = sin(dot(p, dir) * k + t * sqrt(GRAV * k) + wavePhase(fi));
    jxx += q * dir.x * dir.x * s;
    jzz += q * dir.y * dir.y * s;
    jxz -= q * dir.x * dir.y * s;
    k *= SWELL_KG;
  }
  return 1.0 - ((1.0 - jxx) * (1.0 - jzz) - jxz * jxz);
}

// Water piling up against the statue: a gaussian collar just outside its
// footprint, pulsing so it reads as run-up and drawback rather than a fixed
// bulge, and scaled by the wind like every other amplitude here.
//
// It lives in COMMON because BOTH sides have to agree on it — the sea lifts its
// surface by this, and the marble adds the same term to the waterline it draws
// its foam collar on. Evaluated in wave-parameter space, like everything that
// feeds the displacement, so the two land on the same number.
float seaRunUp(vec2 p, float t){
  float d = length(p - uObsPos.xz);
  float g = exp(-pow(max(d - uObsR, 0.0) / max(uObsR * 0.9, 1e-3), 2.0));
  return uObsOn * g * (1.2 + 2.6 * uWave) * (0.55 + 0.45 * sin(t * 1.7 - d * 0.35));
}

// =====================================================================
// the sky — Preetham analytic scattering
//
// Rayleigh and Mie terms evaluated per view ray, which gives a true blue
// zenith, horizon reddening that falls out of the maths rather than a
// hand-picked tint, and a sun aureole that widens with turbidity. Because
// the water reflects through this same function, sky and sea stay in
// agreement for free.
//
// Returns a display-referred colour, in the same range the rest of this
// palette is authored in; callers lift it with pal().
// =====================================================================
const vec3  TOTAL_RAYLEIGH  = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3  MIE_CONST       = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
const float RAYLEIGH_ZENITH = 8.4E3;
const float MIE_ZENITH      = 1.25E3;
const float MIE_G           = 0.80;
const float CUTOFF_ANGLE    = 1.6110731556870734;
const float STEEPNESS       = 1.5;
const float SUN_E           = 1000.0;
const float PI_             = 3.141592653589793;

float sunIntensity(float zenithCos){
  return SUN_E * max(0.0, 1.0 - exp(-((CUTOFF_ANGLE - acos(clamp(zenithCos, -1.0, 1.0))) / STEEPNESS)));
}
float rayleighPhase(float c){ return (3.0 / (16.0 * PI_)) * (1.0 + c * c); }
float hgPhase(float c, float g){
  float g2 = g * g;
  return (1.0 / (4.0 * PI_)) * ((1.0 - g2) / pow(max(1.0 - 2.0 * g * c + g2, 1e-4), 1.5));
}

vec3 atmosphere(vec3 d, vec3 sunDir){
  float sunfade = 1.0 - clamp(1.0 - exp(sunDir.y), 0.0, 1.0);
  vec3  betaR = TOTAL_RAYLEIGH * (2.0 - (1.0 - sunfade));
  vec3  betaM = 0.434 * (0.2 * uTurbidity * 10E-18) * MIE_CONST * 0.005;
  float sunE  = sunIntensity(sunDir.y);

  float zen = acos(max(0.0, d.y));
  float inv = 1.0 / (cos(zen) + 0.15 * pow(max(93.885 - degrees(zen), 1e-3), -1.253));
  vec3  Fex = exp(-(betaR * RAYLEIGH_ZENITH * inv + betaM * MIE_ZENITH * inv));

  float cosT = dot(d, sunDir);
  vec3  sum  = max(betaR + betaM, vec3(1e-9));
  vec3  beta = betaR * rayleighPhase(cosT * 0.5 + 0.5) + betaM * hgPhase(cosT, MIE_G);

  vec3 Lin = pow(sunE * (beta / sum) * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0),
             pow(max(sunE * (beta / sum) * Fex, vec3(0.0)), vec3(0.5)),
             clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));

  vec3 tex = (Lin + vec3(0.1) * Fex) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  return pow(max(tex, 0.0), vec3(1.0 / (1.2 + 1.2 * sunfade)));
}

vec3 skyColor(vec3 d){
  vec3 moonDir = -uSunDir;
  float up = smoothstep(-0.09, 0.55, d.y);

  // Preetham degenerates once the sun is well below the horizon, so it is
  // cross-faded against the authored night palette rather than run all night.
  // The night palette is authored in display values and needs pal(); the
  // scattering model already returns radiance and only needs its own gain.
  vec3 night = mix(pal(vec3(0.220, 0.260, 0.340)),
                   pal(vec3(0.140, 0.170, 0.260)), pow(up, 0.75));
  vec3 col = mix(night, atmosphere(d, uSunDir) * uSkyGain, uAtmos);

  // under cloud the bodies are veiled rather than simply dimmer — the wide
  // scatter survives the longest, the hard disc goes first
  float clear = 1.0 - uOvercast;
  float disc  = pow(clear, 2.5);

  // the sun — reddens as it sits down on the horizon
  float sunUp  = smoothstep(-0.16, 0.02, uSunDir.y);
  float ms     = max(dot(d, uSunDir), 0.0);
  vec3 sunTint = pal(mix(vec3(1.00, 0.50, 0.20), vec3(1.00, 0.96, 0.90),
                         smoothstep(0.0, 0.30, uSunDir.y)));
  col += sunTint * pow(ms,   6.0) * 0.045 * sunUp * mix(1.0, 0.55, uOvercast);
  col += sunTint * pow(ms,  70.0) * 0.220 * sunUp * clear;
  col += sunTint * pow(ms, 900.0) * 1.400 * sunUp * clear;
  col += vec3(1.0) * smoothstep(0.99965, 0.99990, ms) * 24.0 * sunUp * disc;

  // the moon, opposite it on the same wheel
  float moonUp  = smoothstep(-0.16, 0.02, moonDir.y);
  float mm      = max(dot(d, moonDir), 0.0);
  vec3 moonTint = pal(vec3(0.74, 0.82, 1.00));
  col += moonTint * pow(mm,   6.0) * 0.020 * moonUp * mix(1.0, 0.55, uOvercast);
  col += moonTint * pow(mm,  70.0) * 0.090 * moonUp * clear;
  col += moonTint * pow(mm, 900.0) * 0.700 * moonUp * clear;
  col += vec3(1.0) * smoothstep(0.99955, 0.99985, mm) * 10.0 * moonUp * disc;

  // --- cloud deck ---
  // A flat layer, sampled by projecting the view ray onto a plane overhead,
  // so the clouds foreshorten toward the horizon the way a real deck does
  // rather than sitting pasted flat on the dome. Coverage comes straight from
  // the live cloud_cover reading, so an overcast day is genuinely overcast.
  if (d.y > 0.010) {
    // The max() caps how far the projection stretches toward the horizon.
    // Uncapped, the noise goes sub-pixel down there and boils — and because
    // the water reflects through this same function, that boil shows up as
    // speckle on the sea as well as in the sky.
    vec2 cuv = d.xz / max(d.y, 0.120) * 0.55 + vec2(uTime * 0.0032, uTime * 0.0017);
    float f = fbm2(cuv);

    float cov = mix(0.04, 0.95, uOvercast);
    float a = smoothstep(1.0 - cov - 0.20, 1.0 - cov + 0.18, f);
    a *= smoothstep(0.020, 0.22, d.y);              // sink into the horizon haze

    // depth through the cloud: thin edges stay bright, thick middles carry a
    // grey underside, and whichever body is up rims the side facing it
    float depth  = smoothstep(0.30, 0.85, f);
    float sunAmt = pow(ms, 4.0) * sunUp + pow(mm, 4.0) * moonUp * 0.25;
    vec3  top    = mix(pal(vec3(0.93, 0.95, 0.98)), pal(vec3(1.00, 0.98, 0.94)), sunAmt);
    vec3  core   = mix(pal(vec3(0.22, 0.24, 0.30)), pal(vec3(0.60, 0.64, 0.72)), uDay);
    col = mix(col, mix(top, core, depth * 0.55) * mix(0.30, 1.0, uDay), a);
  }
  return col;
}

vec3 starField(vec3 d){
  if (d.y < 0.015) return vec3(0.0);
  vec3 sd = d * 340.0;
  vec3 cell = floor(sd);
  float h = hash31(cell);
  if (h < 0.9875) return vec3(0.0);
  vec3 jit = vec3(hash31(cell + 1.7), hash31(cell + 4.3), hash31(cell + 9.1)) * 0.7 + 0.15;
  float dist = length(fract(sd) - jit);
  float star = smoothstep(0.16, 0.0, dist);
  float tw = 0.55 + 0.45 * sin(uTime * (1.4 + h * 6.0) + h * 62.0);
  vec3 tint = mix(vec3(0.72, 0.80, 1.0), vec3(1.0, 0.88, 0.74), hash31(cell + 21.0));
  // washed out by daylight, and hidden altogether under cloud
  return tint * star * tw * smoothstep(0.015, 0.22, d.y)
       * (0.35 + (h - 0.9875) * 60.0) * 2.2 * (1.0 - uDay) * (1.0 - uOvercast);
}
`;

// =====================================================================
// the sea
// =====================================================================
const seaScene = new THREE.Scene();
const seaCam = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.5, 13000);

// --- sky dome ---
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(6000, 48, 32),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: SKY_UNIFORMS,
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: COMMON + `
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = skyColor(d) + starField(d);
        // haze piled up along the horizon, so sky and sea meet in the same
        // bank instead of butting against a hard line
        float haze = exp(-max(d.y, 0.0) * mix(9.0, 3.2, uFog));
        col = mix(col, fogTint(), haze * mix(0.35, 0.85, uFog));
        gl_FragColor = vec4(col, 1.0);
      }`
  })
);
sky.renderOrder = -10;
seaScene.add(sky);

// --- ocean ---
// A projected grid: the geometry is a plain grid in clip space, and each
// vertex is ray-cast onto the water plane in the shader. Vertex density is
// therefore uniform *on screen* rather than in world space, so the horizon
// carries real wave silhouette instead of running out of triangles and
// flattening into a straight line.
const seaGeo = new THREE.PlaneGeometry(2, 2, QUALITY.gridCols, QUALITY.gridRows);

const sea = new THREE.Mesh(seaGeo, new THREE.ShaderMaterial({
  uniforms: SEA_UNIFORMS,
  vertexShader: COMMON + `
    uniform mat4 uInvViewProj;
    uniform float uHorizonY;
    varying vec3 vWorld;
    varying vec2 vParam;

    void main(){
      // The position attribute spans [-1,1] from the 2x2 plane. Widen x a little so the
      // grid still covers the frame when the camera rolls, and when the
      // Gerstner displacement drags the edge vertices inward.
      //
      // In y the grid is remapped to run from just above the horizon down
      // past the bottom of the frame, rather than over the whole of clip
      // space. Rows above the horizon would never meet the water plane, so
      // spanning the full frame would spend a third of the grid on nothing.
      // The margins are wide because the Gerstner displacement drags the edge
      // vertices sideways by metres near the camera, which in screen terms is
      // enough to haul the grid boundary inside the frame and leave a wedge of
      // missing water in the bottom corners. Overshooting the frame costs a
      // little density; not overshooting it costs the corners.
      float ty = position.y * 0.5 + 0.5;                  // 0 bottom .. 1 top
      float top = clamp(uHorizonY + 0.06, -1.0, 1.30);    // margin covers the roll
      vec2 ndc = vec2(position.x * 1.45, mix(-1.75, top, ty));

      vec4 far4 = uInvViewProj * vec4(ndc, 1.0, 1.0);
      vec3 o = cameraPosition;
      vec3 dir = normalize(far4.xyz / far4.w - o);

      // Intersect the mean water plane. Rays at or above the horizon never
      // meet it, so they are pushed out to uMaxDist along the same azimuth,
      // which lands them exactly on the horizon line.
      float t = (dir.y < -1e-4) ? (-o.y / dir.y) : uMaxDist;
      t = clamp(t, 0.0, uMaxDist);
      vec2 p = o.xz + dir.xz * t;

      // Horizontal displacement damped with distance: near the horizon a
      // whole wavelength of sideways motion falls inside one pixel, and
      // shimmers if it is left in.
      float damp = 1.0 / (1.0 + length(p - o.xz) * 0.0006);

      // ...and damped to nothing at the grid boundary. The lateral part of a
      // Gerstner wave sums to tens of metres at full wind, while the bottom
      // corners of the frame sit only metres from the camera, so no fixed
      // margin is wide enough — the boundary ring would still get dragged
      // inside the frame and expose the edge of the mesh. Pinning that ring to
      // where the ray actually hit closes the hole for good. The fade band
      // lies outside the visible frame, so nothing on screen loses its motion.
      float edge = min(smoothstep(1.0, 0.74, abs(position.x)),
                       smoothstep(1.0, 0.60, abs(position.y)));
      damp *= edge;

      vec3 disp = seaDisplace(p, uTime, damp);
      vec3 wp = vec3(p.x + disp.x, disp.y, p.y + disp.z);

      // and heaped up where it runs into the statue
      wp.y += seaRunUp(p, uTime);

      vParam = p;            // undisplaced parameter, for evaluating the wave
      vWorld = wp;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`,
  fragmentShader: COMMON + `
    varying vec3 vWorld;
    varying vec2 vParam;

    void main(){
      vec3 toCam = cameraPosition - vWorld;
      float dist = length(toCam);
      vec3 V = toCam / max(dist, 1e-4);

      float damp = 1.0 / (1.0 + dist * 0.0006);

      // World-space width of one pixel here, stretched by how grazing the
      // view is. This is what decides which wave octaves are resolvable.
      float foot = dist * uPixelScale / max(abs(V.y), 0.04);

      float h, fold, rough;
      vec3 N;
      seaSurface(vParam, uTime, damp, foot, h, N, fold, rough);

      // Reflection. Rays that come off below the horizon see the far haze,
      // not the sky — folding them back up would invent a sky that is not
      // there and kill the compression along the horizon.
      vec3 R = reflect(-V, N);
      vec3 skyRefl = skyColor(vec3(R.x, max(R.y, 0.0), R.z)) + starField(R) * 0.35;
      vec3 refl = mix(fogTint(), skyRefl, smoothstep(-0.05, 0.03, R.y));
      // the chop too fine to resolve scatters the reflection rather than
      // leaving it a perfect mirror
      refl = mix(refl, fogTint(), clamp(rough * 5.0, 0.0, 0.80));

      // Upwelling: skylight that went into the water, scattered, and came back
      // out. Without it, water seen steeply from above goes black — Fresnel
      // hands it almost no reflection at that angle, and that is exactly the
      // near field along the bottom of the frame.
      vec3 ambient = mix(pal(vec3(0.150, 0.190, 0.280)), pal(vec3(0.46, 0.63, 0.86)), uDay);
      // Body colour: what the water IS, before anything it reflects.
      //
      // The axis is how much water the eye is looking through. A trough is a
      // long path down the column and goes dark and blue; the back of a crest
      // is a thin lit sheet, which is where open ocean turns that bottle green.
      // Wave height carries far more of that than view angle does, so it leads
      // and N.y only trims it. A single flat body colour for the whole surface
      // is a big part of why still water renders read as plastic.
      //
      // uDeepCol and uShallowCol are real uniforms rather than constants buried
      // here: they are the two numbers worth reaching for when the sea looks
      // wrong, and window.__sea.WATER retunes them live.
      float lift = clamp(h / max(SWELL_A0 * uWave * 1.35, 1e-3), -1.0, 1.0);
      float sheet = clamp(lift * 0.5 + 0.5, 0.0, 1.0) * (0.55 + 0.45 * N.y);
      vec3 body = mix(pal(uDeepCol), pal(uShallowCol), sheet) * ambient * uWaterGain;

      float NdV = max(dot(N, V), 0.0);
      float fres = 0.020 + 0.980 * pow(1.0 - NdV, 5.0);
      vec3 col = mix(body, refl, fres);

      // Subsurface scattering: light coming through the back of a crest.
      // Strongest looking toward a low sun, and only where the water stands
      // proud of the mean surface — a trough has no thin edge to glow.
      float lowKey  = 1.0 - smoothstep(0.02, 0.38, uKeyDir.y);
      float through = pow(max(dot(V, -uKeyDir), 0.0), 3.0);
      float thin    = smoothstep(0.0, 2.4, h);
      col += pal(vec3(0.13, 0.46, 0.38)) * uKeyTint * through * thin * lowKey * 1.10;

      // Sun glitter, as a real microfacet lobe rather than a Blinn cone with a
      // path painted on by hand. GGX earns its keep here: its long tails are
      // exactly what lays the glitter track down the water toward the light, so
      // the track falls out of the distribution instead of being multiplied in
      // by a dot product that has to be aimed. The roughness driving it is the
      // slope variance of every octave too small to resolve at this pixel, so
      // near water stays crisp and far water stops crawling on its own.
      vec3  H   = normalize(uKeyDir + V);
      float NdH = max(dot(N, H), 0.0);
      float NdL = max(dot(N, uKeyDir), 0.0);
      float ax  = clamp(rough * 6.0 + 0.0026, 0.0026, 0.35);
      float a2  = ax * ax;
      float dd  = NdH * NdH * (a2 - 1.0) + 1.0;
      float D   = a2 / (PI_ * dd * dd);
      // Smith, height-correlated. Without the masking term the lobe blows out
      // along the horizon, where NdV runs to zero and D does not.
      float gv = NdL * sqrt(NdV * NdV * (1.0 - a2) + a2);
      float gl = NdV * sqrt(NdL * NdL * (1.0 - a2) + a2);
      float Vis = 0.5 / max(gv + gl, 1e-5);
      col += uKeyTint * D * Vis * NdL * fres * uKeyGain * 0.022;

      // Whitecaps where the wave has actually folded over, which the Gerstner
      // Jacobian tells us directly. The noise only breaks the result up so it
      // does not read as a clean band along every crest.
      float broken = vnoise(vParam * 0.055 + uTime * 0.09)
                   * vnoise(vParam * 0.21 - uTime * 0.14);

      // Whitecap memory. A crest that breaks leaves foam behind it that lingers
      // and dissipates over several seconds, and that trailing wake is the
      // clearest signature of a rough sea — foam taken from the instantaneous
      // fold can never show it, because it appears and vanishes with the crest
      // and the water ends up looking like it is flickering rather than breaking.
      //
      // Asking for the fold at THIS point at earlier times is asking "did a
      // crest break here recently?". Holding p fixed while the wave train runs
      // backwards keeps the answer in the right place with nothing advected.
      // Thresholds set against the actual distribution of the fold term, not by
      // eye: at the old 0.60 only about 6% of the surface ever crossed it at
      // default wind and 1.5% in a calm, so the sea had effectively no
      // whitecaps at all. 0.34 puts breaking crests on roughly a fifth of it,
      // which is what a wind-blown sea actually looks like.
      float fresh = smoothstep(0.34, 0.86, fold);
      float aged  = max(smoothstep(0.40, 0.94, seaFold(vParam, uTime - 1.30)) * 0.70,
                        smoothstep(0.46, 1.02, seaFold(vParam, uTime - 2.80)) * 0.38);

      // Older foam has spread and gone to lace, so it breaks up on a finer,
      // slower-drifting noise than the crest that laid it down.
      float lace = vnoise(vParam * 0.34 + uTime * 0.05)
                 * vnoise(vParam * 0.95 - uTime * 0.08);

      // Both gates are a PRODUCT of two noises, so they sit around 0.25 and are
      // skewed hard toward zero — the old windows were cutting the foam they
      // were only meant to break up, and the aged layer almost entirely.
      float foam = max(fresh * smoothstep(0.05, 0.42, broken),
                       aged  * smoothstep(0.06, 0.40, lace));
      foam *= 1.0 / (1.0 + dist * 0.0022);

      // Water breaking on the statue. A churning ring just outside its
      // footprint, thrown harder where the swell arriving here has already
      // folded — so the ring pulses with the waves rather than boiling steadily.
      float dObs = length(vParam - uObsPos.xz);
      float ring = smoothstep(uObsR * 2.4, uObsR * 1.0, dObs)
                 * smoothstep(uObsR * 0.5, uObsR * 0.95, dObs);
      float churn = vnoise(vParam * 0.45 - uTime * 0.7)
                  * vnoise(vParam * 1.1 + uTime * 0.5);
      foam = max(foam, uObsOn * ring * smoothstep(0.22, 0.66, churn)
                     * (0.55 + 0.45 * clamp(fold, 0.0, 1.0)));

      // Foam is a mat of bubbles, not white paint: near-lambertian, so it takes
      // the key and the sky and shows the shape of the crest it is sitting on.
      // Flat white foam is the thing that most reliably gives a rendered sea
      // away, because it stays equally bright on the lit and shaded faces.
      vec3 foamCol = pal(uFoamCol);
      foamCol *= ambient * 1.25 + uKeyTint * max(dot(N, uKeyDir), 0.0)
                                * mix(0.15, 1.05, uDay) * (1.0 - uOvercast * 0.6);
      col = mix(col, foamCol, clamp(foam, 0.0, 1.0));

      // Contact shadow. There is no shadow pass in this scene, and without
      // something darkening the water it stands in the statue reads as pasted
      // on top of the sea rather than standing in it.
      col *= 1.0 - uObsOn * 0.45 * smoothstep(uObsR * 1.8, uObsR * 0.55, dObs);

      // Fog. Doubles as the fade that hides the far edge of the traced plane,
      // but it is patchy and drifting rather than a flat curve, so banks of it
      // move across the water instead of sitting there like a gradient.
      float mist = vnoise(vParam * 0.0016 + vec2(uTime * 0.013, uTime * 0.008));
      float dens = mix(0.00030, 0.00115, uFog) * (0.70 + 0.60 * mist);
      float fog = 1.0 - exp(-pow(dist * dens, 1.65));
      // guarantee the trace limit is closed over even on the clearest day
      fog = max(fog, smoothstep(0.72, 0.99, dist / uMaxDist));
      col = mix(col, fogTint(), clamp(fog, 0.0, 1.0));

      gl_FragColor = vec4(col, 1.0);
    }`
}));
sea.frustumCulled = false;   // the grid lives in clip space; its bounds mean nothing
seaScene.add(sea);

// --- the statue ---
// A wet marble hand standing in the swell. It borrows this file's COMMON chunk,
// so it reflects the same sky, keys off the same light and reads the same wave
// field the water does — see hand.js. The geometry arrives over the network, so
// nothing here is guaranteed; uObsOn stays 0 and the sea is untouched until it
// lands, and stays that way if it never does.
const hand = createMarbleHand({ common: COMMON, uniforms: SEA_UNIFORMS,
                                scene: seaScene, camera: seaCam });

// =====================================================================
// lens flare — a fullscreen additive pass driven by the sun's screen position
// =====================================================================
const flareScene = new THREE.Scene();
const flareCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uFlareSun = { value: new THREE.Vector2() };   // NDC
const uFlareInt = { value: 0 };
const uAspect   = { value: window.innerWidth / window.innerHeight };

const flare = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: { uFlareSun, uFlareInt, uAspect, uTime },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying vec2 vP;
      void main(){
        vP = position.xy;               // the 2x2 quad already spans clip space
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: `
      uniform vec2  uFlareSun;
      uniform float uFlareInt;
      uniform float uAspect;
      uniform float uTime;
      varying vec2 vP;

      void main(){
        if (uFlareInt <= 0.001) { gl_FragColor = vec4(0.0); return; }

        // work in aspect-corrected space so nothing is oval
        vec2 p = vec2(vP.x * uAspect, vP.y);
        vec2 s = vec2(uFlareSun.x * uAspect, uFlareSun.y);

        vec3 col = vec3(0.0);

        // the bloom sitting on the sun itself
        float d = length(p - s);
        col += vec3(1.00, 0.90, 0.72) * exp(-d * d * 11.0) * 0.60;
        col += vec3(1.00, 0.97, 0.90) * exp(-d * d * 220.0) * 0.90;

        // anamorphic streak, wide and thin
        float streak = exp(-pow((p.y - s.y) * 46.0, 2.0))
                     * exp(-pow((p.x - s.x) * 0.60, 2.0));
        col += vec3(0.42, 0.60, 1.00) * streak * 0.45;

        // ghosts marching along the line from the sun through screen centre
        vec2 dir = -s;
        for (int i = 1; i <= 6; i++){
          float fi = float(i);
          vec2 gp = s + dir * (fi * 0.36);
          float gd = length(p - gp);
          float size = 0.045 + 0.030 * mod(fi, 3.0);
          float g = smoothstep(size, 0.0, gd);
          g *= 0.55 + 0.45 * smoothstep(size * 0.50, size * 0.85, gd);   // ring, not blob
          vec3 tint = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + fi * 1.7);
          col += tint * g * 0.16;
        }

        // faint iris ring further out
        float rd = length(p - s * -0.65);
        col += vec3(0.60, 0.80, 1.00) * smoothstep(0.34, 0.29, rd)
                                      * smoothstep(0.24, 0.29, rd) * 0.10;

        // this pass lands in the linear HDR target with everything else
        gl_FragColor = vec4(pow(col * uFlareInt, vec3(2.2)), 1.0);
      }`
  })
);
flare.frustumCulled = false;
flareScene.add(flare);

// =====================================================================
// post chain — HDR target, bloom, then one tone map on the way out
//
// The scene is rendered into a half-float target so highlights keep their
// real values, bloomed while still linear, and only then tone mapped and
// encoded. Doing it the other way round blooms already-compressed values
// and the glitter comes out looking flat.
// =====================================================================
const rtScene = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  depthBuffer: true,
  samples: QUALITY.msaaSamples   // the canvas has no AA of its own; this is it
});
const rtBloomA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
const rtBloomB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

const FS_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const uBrightSrc = { value: null };
const brightMat = new THREE.ShaderMaterial({
  uniforms: { tSrc: uBrightSrc, uThreshold: { value: QUALITY.bloomThreshold } },
  vertexShader: FS_VERT,
  fragmentShader: `
    uniform sampler2D tSrc;
    uniform float uThreshold;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tSrc, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(c * (max(l - uThreshold, 0.0) / max(l, 1e-4)), 1.0);
    }`
});

const uBlurSrc = { value: null };
const uBlurTexel = { value: new THREE.Vector2() };
const uBlurOffset = { value: 1 };
const blurMat = new THREE.ShaderMaterial({
  uniforms: { tSrc: uBlurSrc, uTexel: uBlurTexel, uOffset: uBlurOffset },
  vertexShader: FS_VERT,
  // Kawase: four bilinear taps per pass, with the offset growing each
  // iteration. A handful of these approximate a very wide Gaussian for a
  // fraction of the cost of running one directly.
  fragmentShader: `
    uniform sampler2D tSrc;
    uniform vec2 uTexel;
    uniform float uOffset;
    varying vec2 vUv;
    void main(){
      vec2 o = uTexel * uOffset;
      vec3 c = texture2D(tSrc, vUv + vec2( o.x,  o.y)).rgb
             + texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb
             + texture2D(tSrc, vUv + vec2( o.x, -o.y)).rgb
             + texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb;
      gl_FragColor = vec4(c * 0.25, 1.0);
    }`
});

const uCompScene = { value: null };
const uCompBloom = { value: null };
const compositeMat = new THREE.ShaderMaterial({
  uniforms: {
    tScene: uCompScene, tBloom: uCompBloom,
    uBloom: { value: QUALITY.bloomStrength },
    uExposure: { value: QUALITY.exposure }
  },
  vertexShader: FS_VERT,
  fragmentShader: `
    uniform sampler2D tScene;
    uniform sampler2D tBloom;
    uniform float uBloom;
    uniform float uExposure;
    varying vec2 vUv;

    // ACES filmic, Narkowicz's fit
    vec3 aces(vec3 x){
      return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }
    vec3 linearToSRGB(vec3 c){
      return mix(c * 12.92,
                 1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055,
                 step(vec3(0.0031308), c));
    }
    void main(){
      vec3 col = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
      gl_FragColor = vec4(linearToSRGB(aces(col * uExposure)), 1.0);
    }`
});

const fsScene = new THREE.Scene();
const fsMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), brightMat);
fsMesh.frustumCulled = false;
fsScene.add(fsMesh);

function blit(material, target) {
  fsMesh.material = material;
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(fsScene, flareCam);
}

function sizeTargets() {
  const dpr = renderer.getPixelRatio();
  const w = Math.max(1, Math.floor(window.innerWidth * dpr));
  const h = Math.max(1, Math.floor(window.innerHeight * dpr));
  rtScene.setSize(w, h);
  const bw = Math.max(1, Math.floor(w * QUALITY.bloomScale));
  const bh = Math.max(1, Math.floor(h * QUALITY.bloomScale));
  rtBloomA.setSize(bw, bh);
  rtBloomB.setSize(bw, bh);
  uBlurTexel.value.set(1 / bw, 1 / bh);
  // world units per pixel, per unit of distance — the sea shader's footprint
  uPixelScale.value = 2 * Math.tan(THREE.MathUtils.degToRad(seaCam.fov) / 2) / h;
}
sizeTargets();

// =====================================================================
// animation
// =====================================================================
const _sunWorld = new THREE.Vector3();
const _sunView  = new THREE.Vector3();
const _invVP    = new THREE.Matrix4();
const _fwd      = new THREE.Vector3();
const _horizon  = new THREE.Vector3();
let last = performance.now();

// The visitor's local hour, from their true UTC offset rather than the
// device's timezone setting — a laptop still on the wrong zone gets the sky
// where its owner actually is.
function localHours() {
  if (FORCE.hour !== undefined) return FORCE.hour;
  return (Date.now() / 3600000 + solar.offset) % 24;
}

// Map real time onto the wheel. uSunDir is (cos a, sin a, ...), so a = 0 is
// sunrise, PI/2 noon, PI sunset, 3PI/2 midnight — and day and night get their
// own halves, which is what lets an asymmetric day work at all.
function sunAngle() {
  const h = localHours();
  let sr = solar.sunrise, ss = solar.sunset, len = ss - sr;
  if (!(len > 0.1 && len < 23.9)) { sr = 6; ss = 18; len = 12; }   // polar, or bad data
  if (h >= sr && h <= ss) return Math.PI * (h - sr) / len;
  const since = h > ss ? h - ss : h + 24 - ss;
  return Math.PI + Math.PI * (since / (24 - len));
}

// Pull the baked simulation in. Like the weather and the statue, this is
// allowed to fail and leave the scene running: uOceanOn stays 0, every term it
// drives multiplies out, and the sea is exactly the analytic one it was before.
(async function loadOcean() {
  try {
    const res = await fetch(OCEAN_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    const head = new DataView(buf);

    const magic = String.fromCharCode(head.getUint8(0), head.getUint8(1),
                                      head.getUint8(2), head.getUint8(3));
    if (magic !== 'OCN1') throw new Error('bad magic "' + magic + '"');

    const grid = head.getUint32(4, true);
    const frames = head.getUint32(8, true);
    const tile = head.getFloat32(16, true);
    const amp = head.getFloat32(20, true);

    // int16 on the wire, float in the texture: RedFormat + FloatType is the
    // combination that gets linear filtering in all three axes, and the
    // interpolation across the time axis is what makes 144 frames enough.
    const q = new Int16Array(buf, 24, grid * grid * frames);
    const data = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) data[i] = q[i] / 32767;

    const tex = new THREE.Data3DTexture(data, grid, grid, frames);
    tex.format = THREE.RedFormat;
    tex.type = THREE.FloatType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;      // the loop closes on itself
    tex.needsUpdate = true;

    uOcean.value = tex;
    uOceanTileBase = tile;
    uOceanTile.value = tile * uOceanTileGain.value;
    uOceanBase = amp;
    uOceanAmp.value = amp * uOceanGain.value;
    uOceanOn.value = 1;
    console.log('[sea] ocean cache: %dx%d x %d frames, tile %.1f, amp %.2f',
                grid, grid, frames, tile, amp);
  } catch (e) {
    console.warn('[sea] ' + OCEAN_URL + ' unavailable, running on the analytic '
                 + 'swell alone:', e.message);
  }
})();

// The swell height at a world point, on the CPU. This is seaDisplace()'s
// vertical term walked in JavaScript — same octaves, same constants out of the
// WAVE block, same dispersion — so the camera rides the surface the shader is
// drawing rather than an approximation of it.
function swellAt(x, z, t) {
  let h = 0, a = WAVE.amp * uWave.value, k = WAVE.k;
  for (let i = 0; i < WAVE.octaves; i++) {
    // waveDir() and wavePhase(), transcribed. If either changes above, it has
    // to change here too, or the camera starts riding a different sea than the
    // one on screen — and the first symptom is a crest through the lens.
    const ang = WAVE.bearing + (0.16 + 0.15 * i) * Math.sin(i * 2.399 + 0.7);
    const ph = i * 2.39996323 + i * i * 0.76543;
    const th = (x * Math.cos(ang) + z * Math.sin(ang)) * k + t * Math.sqrt(9.81 * k) + ph;
    h += a * Math.sin(th);
    a *= WAVE.ampFalloff;
    k *= WAVE.kGrowth;
  }
  return h;
}

let statsEl = null, statsAcc = 0, statsFrames = 0;
if (SHOW_STATS) {
  statsEl = document.createElement('div');
  statsEl.style.cssText = 'position:fixed;top:8px;left:8px;z-index:9999;font:12px monospace;' +
                          'color:#0f0;background:rgba(0,0,0,.6);padding:4px 7px;pointer-events:none';
  document.body.appendChild(statsEl);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  uTime.value += dt * WAVE_SPEED;   // waves and fog banks, not the sun
  const st = uTime.value;

  // ease toward whatever the weather turned out to be, so a late response
  // settles in over a few seconds instead of snapping. The solar correction
  // rides the same easing, so the sun glides to its true position.
  const k2 = 1 - Math.exp(-dt * 0.6);
  live.wind      += (COND.wind      - live.wind)      * k2;
  live.cloud     += (COND.cloud     - live.cloud)     * k2;
  live.fog       += (COND.fog       - live.fog)       * k2;
  live.turbidity += (COND.turbidity - live.turbidity) * k2;
  solar.sunrise  += (SOLAR.sunrise  - solar.sunrise)  * k2;
  solar.sunset   += (SOLAR.sunset   - solar.sunset)   * k2;
  solar.offset   += (SOLAR.offset   - solar.offset)   * k2;

  // --- the wheel, on the visitor's own clock ---
  const a = sunAngle();
  uSunDir.value.set(Math.cos(a) * 0.55, Math.sin(a), -0.83).normalize();
  const elev = uSunDir.value.y;

  uWave.value      = 0.65 + live.wind * 1.45;
  uOvercast.value  = live.cloud;
  uTurbidity.value = live.turbidity;

  uDay.value    = smoothstep(-0.12, 0.20, elev);
  uGolden.value = Math.exp(-Math.pow(elev / 0.17, 2));
  // scattering is fully on a little before the sun clears the horizon, so
  // sunrise and sunset are coloured by the model rather than by a hand tint
  uAtmos.value  = smoothstep(-0.18, -0.02, elev);

  // The simulation runs on its own loop rather than the wave clock, so the
  // churn keeps a real-world pace even when WAVE_SPEED slows the swell.
  uOceanPhase.value = (st / OCEAN_LOOP) % 1;
  uOceanAmp.value = uOceanBase * uOceanGain.value;
  uOceanTile.value = uOceanTileBase * uOceanTileGain.value;

  // the water's own palette, crossfaded on the day/night blend
  mixWater(uDeepCol,    WATER.deep,    uDay.value);
  mixWater(uShallowCol, WATER.shallow, uDay.value);
  mixWater(uFoamCol,    WATER.foam,    uDay.value);
  uWaterGain.value = WATER.gain;

  // the key light is whichever body is above the horizon. k crosses 0.5 at the
  // swap; dipping the gain there hides the handover.
  const k = smoothstep(-0.06, 0.06, elev);
  if (k > 0.5) uKeyDir.value.copy(uSunDir.value);
  else         uKeyDir.value.copy(uSunDir.value).negate();
  uKeyTint.value.set(lerp(0.80, 1.00, k), lerp(0.87, 0.93, k), lerp(1.00, 0.80, k));
  uKeyGain.value = lerp(46, 95, k) * (0.20 + 0.80 * Math.abs(k * 2 - 1)) * GLINT_GAIN;

  // fog sits at whatever the real visibility says, then banks roll through on
  // their own slow, non-repeating rhythm and thicken at either end of the day
  const bank = 0.5 + 0.5 * Math.sin(st * 0.021) * Math.cos(st * 0.0091);
  uFog.value = clamp01(live.fog + 0.22 * bank + uGolden.value * 0.12);

  // --- camera: sits low, breathes with the swell, yaws very slowly ---
  const eyeX = Math.sin(st * 0.021) * 40;
  const eyeZ = Math.cos(st * 0.017) * 40;

  // Freeboard scales with the swell so crests can never reach the lens — at
  // these amplitudes a fixed deck height would put the camera underwater, and
  // since the water is opaque that means a screen full of green.
  //
  // The bob itself stays small on purpose. The statue is rooted to the sea
  // floor and has to read that way, and a deck heaving through the full height
  // of the swell would have it swimming up and down the frame instead.
  const deck = 8.4 + 0.62 * WAVE.sum * uWave.value
             + swellAt(eyeX, eyeZ, st) * 0.18;
  seaCam.position.set(eyeX, deck, eyeZ);
  seaCam.rotation.set(0, 0, 0);
  seaCam.lookAt(eyeX + Math.sin(st * 0.028) * 120, deck - 3.2 + Math.sin(st * 0.44) * 0.9, eyeZ - 300);
  seaCam.rotation.z = Math.sin(st * 0.23) * 0.014;   // slight roll, as if on a deck
  sky.position.copy(seaCam.position);
  seaCam.updateMatrixWorld();

  // the projected grid rebuilds itself from these every frame, so it tracks
  // the camera's pitch and roll rather than being baked once
  _invVP.multiplyMatrices(seaCam.projectionMatrix, seaCam.matrixWorldInverse).invert();
  uInvViewProj.value.copy(_invVP);

  // Where the horizon falls this frame, so the grid can spend all of its rows
  // on water. The vanishing line of the plane is the projection of a purely
  // horizontal direction at effectively infinite distance.
  _fwd.set(0, 0, -1).applyQuaternion(seaCam.quaternion);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, -1);
  _fwd.normalize();
  _horizon.copy(seaCam.position).addScaledVector(_fwd, 1e6).project(seaCam);
  uHorizonY.value = Number.isFinite(_horizon.y) ? _horizon.y : 0.2;

  hand.update();

  // --- flare: only while the sun is up, in front, and near the frame ---
  _sunWorld.copy(uSunDir.value).multiplyScalar(5000).add(seaCam.position);
  _sunView.copy(_sunWorld).applyMatrix4(seaCam.matrixWorldInverse);
  if (_sunView.z < 0) {                                  // in front of the camera
    const ndc = _sunWorld.clone().project(seaCam);
    uFlareSun.value.set(ndc.x, ndc.y);
    const edge = 1 - smoothstep(1.0, 1.9, Math.max(Math.abs(ndc.x), Math.abs(ndc.y)));
    // waves swallow it at the horizon, so fade in above the waterline; fog
    // diffuses the ghosts long before it kills the bloom, and cloud puts the
    // sun behind a lid where there is nothing to flare off at all
    uFlareInt.value = smoothstep(-0.01, 0.10, elev) * edge * 0.85
                    * (1.0 - uFog.value * 0.55)
                    * (1.0 - live.cloud * 0.92);
  } else {
    uFlareInt.value = 0;
  }

  // --- scene into the HDR target, flare included so it blooms too ---
  renderer.setRenderTarget(rtScene);
  renderer.clear();
  renderer.render(seaScene, seaCam);
  renderer.render(flareScene, flareCam);

  // --- bloom: bright pass, then widening Kawase iterations ---
  uBrightSrc.value = rtScene.texture;
  blit(brightMat, rtBloomA);

  let src = rtBloomA, dst = rtBloomB;
  for (let i = 0; i < QUALITY.bloomPasses; i++) {
    uBlurSrc.value = src.texture;
    uBlurOffset.value = i + 1.5;
    blit(blurMat, dst);
    const swap = src; src = dst; dst = swap;
  }

  // --- one tone map and one encode, on the way to the screen ---
  uCompScene.value = rtScene.texture;
  uCompBloom.value = src.texture;
  blit(compositeMat, null);

  if (statsEl) {
    statsAcc += dt; statsFrames++;
    if (statsAcc >= 0.5) {
      const ms = (statsAcc / statsFrames) * 1000;
      statsEl.textContent = `${(1000 / ms).toFixed(0)} fps  ${ms.toFixed(1)} ms`;
      statsAcc = 0; statsFrames = 0;
    }
  }
}

// ---------------------------------------------------------------- plumbing
window.addEventListener('resize', () => {
  seaCam.aspect = window.innerWidth / window.innerHeight;
  seaCam.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  uAspect.value = window.innerWidth / window.innerHeight;
  sizeTargets();
});

// =====================================================================
// live conditions
//
// The clock is free and instant, so it runs from the first frame. The
// weather is a network round trip, so the scene starts on the defaults above
// and eases over once the answer lands — nothing here blocks a frame, and
// every step is allowed to fail silently and leave the sea running.
// =====================================================================
const REFRESH_MS = 10 * 60 * 1000;
let geo = null;          // cached coordinates: the IP lookup runs once a load
let lastFetch = 0;

async function getJSON(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Coarse position from the IP, so there is no permission prompt on arrival.
// Two providers, because the keyless tiers rate-limit and go down.
async function locate() {
  if (geo) return geo;
  const providers = [
    ['https://ipwho.is/',      j => (j.success !== false) && [j.latitude, j.longitude]],
    ['https://ipapi.co/json/', j => !j.error && [j.latitude, j.longitude]]
  ];
  for (const [url, pick] of providers) {
    try {
      const got = pick(await getJSON(url, 3500));
      if (got && Number.isFinite(got[0]) && Number.isFinite(got[1])) {
        geo = { lat: got[0], lon: got[1] };
        return geo;
      }
    } catch (e) { /* try the next one */ }
  }
  return null;
}

const hoursOf = s => {
  const m = /T(\d\d):(\d\d)/.exec(String(s));
  return m ? (+m[1] + (+m[2]) / 60) : undefined;
};

async function refreshConditions() {
  if (PINNED) return;                       // a debug run: keep it reproducible
  try {
    const at = await locate();
    if (!at) return;                        // no position: the defaults stand

    // timezone=auto puts current time, sunrise and sunset in the location's
    // own local frame, so the clock and the solar times agree with each other
    const q = `latitude=${at.lat.toFixed(3)}&longitude=${at.lon.toFixed(3)}` +
              `&timezone=auto&daily=sunrise,sunset` +
              `&current=wind_speed_10m,cloud_cover,visibility,weather_code,relative_humidity_2m`;
    const res = await getJSON('https://api.open-meteo.com/v1/forecast?' + q, 4500);
    const w = res && res.current;
    if (!w) return;
    lastFetch = Date.now();

    if (Number.isFinite(res.utc_offset_seconds))
      SOLAR.offset = res.utc_offset_seconds / 3600;

    const sr = hoursOf(res.daily && res.daily.sunrise && res.daily.sunrise[0]);
    const ss = hoursOf(res.daily && res.daily.sunset  && res.daily.sunset[0]);
    if (sr !== undefined && ss !== undefined && ss > sr) {
      SOLAR.sunrise = sr;
      SOLAR.sunset  = ss;
    }

    // WMO codes: 45/48 are fog, 51-67 drizzle and rain, 80-82 showers, 95+ storm
    const code  = w.weather_code | 0;
    const foggy = code === 45 || code === 48;
    const wet   = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;

    if (Number.isFinite(w.wind_speed_10m))            // km/h; ~55 is a gale
      COND.wind = clamp01(w.wind_speed_10m / 55);
    if (Number.isFinite(w.cloud_cover))
      COND.cloud = clamp01(w.cloud_cover / 100);
    if (Number.isFinite(w.visibility))                // metres; 20km+ reads as clear
      COND.fog = clamp01(1 - w.visibility / 20000);

    if (foggy) COND.fog = Math.max(COND.fog, 0.78);
    if (wet) {
      COND.fog   = Math.max(COND.fog, 0.45);
      COND.cloud = Math.max(COND.cloud, 0.85);
      COND.wind  = Math.max(COND.wind, 0.55);
    }

    // Turbidity is how much the air itself scatters: humid, hazy, low-visibility
    // air whitens the sky and swells the aureole around the sun. 2 is an alpine
    // day, 10 is heavy industrial haze.
    const rh = Number.isFinite(w.relative_humidity_2m) ? w.relative_humidity_2m / 100 : 0.6;
    COND.turbidity = 1.8 + COND.fog * 6.5 + rh * 2.2 + COND.cloud * 0.8;
  } catch (e) { /* the defaults stand */ }
}

refreshConditions();
setInterval(refreshConditions, REFRESH_MS);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  last = performance.now();                 // don't bill the hidden time to dt
  if (Date.now() - lastFetch > REFRESH_MS) refreshConditions();
});

// a small handle for tuning from the console without a rebuild
// Bump this whenever the look changes, so `__sea.version` in the console says
// straight away whether the browser is running the current file or a cached one.
const VERSION = 'ocean-sim-1';

window.__sea = { VERSION, QUALITY, WAVE, WATER, COND, SOLAR, live, solar,
                 ocean: uOceanGain, oceanTile: uOceanTileGain, uniforms: SEA_UNIFORMS };
window.__hand = hand;                       // __hand.HAND.spec = 0.2, and so on

requestAnimationFrame(frame);
