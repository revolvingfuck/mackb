// sea-simple.js — WebGL Gerstner backdrop for #sea-container
//
// An alternative to sea.js, kept side by side so the two can be compared
// directly. Switch between them by changing one line in index.html:
//
//     <script type="module" src="sea.js"></script>         <- the full sea
//     <script type="module" src="sea-simple.js"></script>  <- this one
//
// Only ever load ONE of them. Both create their own WebGLRenderer and append a
// canvas to #sea-container, so running both gives two stacked canvases and two
// render loops competing for the GPU.
//
// This version is self-contained: no live weather, no solar clock, no HDR
// chain, no marble hand. Four Gerstner waves on a fixed 420-unit plane, a
// two-stop sky dome, and three.js's own ACES tone mapping on the way out.
//
// Two things to know if this is the one that gets kept — both marked NOTE
// below, and both are one-line changes:
//   1. the foam term puts foam on the flats rather than on breaking crests
//   2. the distance fade measures from the world origin, not from the camera
// They are left exactly as written so the comparison is of the real thing.

import * as THREE from "three";

const mount = document.getElementById("sea-container");
if (!mount) {
  console.warn("sea.js: #sea-container missing");
} else {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(mount.clientWidth || innerWidth, mount.clientHeight || innerHeight);
  renderer.setClearColor(0x02060c, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x02060c, 0.012);

  const camera = new THREE.PerspectiveCamera(
    42,
    (mount.clientWidth || innerWidth) / (mount.clientHeight || innerHeight),
    0.1,
    2000
  );
  camera.position.set(0, 8.5, 22);
  camera.lookAt(0, 1.2, 0);

  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.35, 0.15, 0.9).normalize() },
    uDeep: { value: new THREE.Color(0x031018) },
    uShallow: { value: new THREE.Color(0x0a3a48) },
    uHorizon: { value: new THREE.Color(0x142033) },
    uSky: { value: new THREE.Color(0x6ea0c8) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vN;

      vec3 gerstner(vec3 p, vec2 dir, float steep, float lambda, float speedMul) {
        float k = 6.28318530718 / lambda;
        float c = sqrt(9.8 / k) * speedMul;
        vec2 d = normalize(dir);
        float f = k * (dot(d, p.xz) - c * uTime);
        float a = steep / k;
        return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
      }

      void accumulate(inout vec3 p, inout vec3 t, inout vec3 b, vec2 dir, float steep, float lambda, float speedMul) {
        float k = 6.28318530718 / lambda;
        float c = sqrt(9.8 / k) * speedMul;
        vec2 d = normalize(dir);
        float f = k * (dot(d, p.xz) - c * uTime);
        float a = steep / k;
        float s = sin(f);
        float co = cos(f);
        p += vec3(d.x * a * co, a * s, d.y * a * co);
        // analytic tangent frame pieces
        t += vec3(-d.x * d.x * steep * s, d.x * steep * co, -d.x * d.y * steep * s);
        b += vec3(-d.x * d.y * steep * s, d.y * steep * co, -d.y * d.y * steep * s);
      }

      void main() {
        vec3 p = position;
        vec3 T = vec3(1.0, 0.0, 0.0);
        vec3 B = vec3(0.0, 0.0, 1.0);
        accumulate(p, T, B, vec2(1.0, 0.35), 0.32, 28.0, 1.00);
        accumulate(p, T, B, vec2(-0.4, 1.0), 0.22, 14.0, 1.15);
        accumulate(p, T, B, vec2(0.7, -0.7), 0.16, 7.5, 1.25);
        accumulate(p, T, B, vec2(-0.2, 0.95), 0.10, 3.6, 1.40);
        T = normalize(T);
        B = normalize(B);
        vN = normalize(cross(B, T));
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uDeep, uShallow, uHorizon, uSky;
      varying vec3 vWorld;
      varying vec3 vN;

      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.2);
        float ndl = max(dot(N, uSunDir), 0.0);
        float spec = pow(max(dot(reflect(-uSunDir, N), V), 0.0), 72.0);

        // NOTE: this lights the flats. N.y is largest where the surface faces
        // straight up — troughs and calm water — and smallest on the steep
        // faces where whitecaps actually break. Inverting it, or driving it
        // from the Gerstner Jacobian the way sea.js does, puts the foam on the
        // crests instead.
        float foam = smoothstep(0.78, 0.96, N.y);

        vec3 water = mix(uDeep, uShallow, clamp(N.y * 0.7 + 0.15, 0.0, 1.0));
        vec3 col = mix(water, uHorizon, fres);
        col += uSky * spec * 0.65;
        col += vec3(0.75, 0.85, 0.95) * foam * 0.35;
        col += ndl * 0.05;

        // NOTE: distance from the world ORIGIN, not from the camera, so the
        // haze sits as a fixed pool on the water rather than receding with
        // depth — most visible when the camera moves. length(cameraPosition -
        // vWorld) is the fix.
        float fade = exp(-0.0045 * length(vWorld.xz));
        col = mix(uDeep, col, fade);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const geo = new THREE.PlaneGeometry(420, 420, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0;
  scene.add(mesh);

  // cheap sky dome so the horizon isn't a void
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x0b1220) },
      uBot: { value: new THREE.Color(0x1a2838) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 uTop, uBot; void main(){ float h = normalize(vP).y * 0.5 + 0.5; gl_FragColor = vec4(mix(uBot, uTop, h), 1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(800, 24, 16), skyMat));

  const clock = new THREE.Clock();
  let running = true;

  const onResize = () => {
    const w = mount.clientWidth || innerWidth;
    const h = mount.clientHeight || innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  addEventListener("resize", onResize);

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const tick = () => {
    if (!running) return;
    requestAnimationFrame(tick);
    if (!reduce.matches) uniforms.uTime.value = clock.getElapsedTime();
    renderer.render(scene, camera);
  };
  tick();

  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) tick();
  });
}
