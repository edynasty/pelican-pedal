import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* renderer / scene                                                    */
/* ------------------------------------------------------------------ */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
} catch (err) {
  const fb = $('#fallback');
  if (fb) fb.hidden = false;
  throw err;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', '鹈鹕骑着青绿色自行车沿落日海岸木栈道前行的 3D 场景');
$('#app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd97b48, 30, 130);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(9.5, 4.8, 9.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.35, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 2.8;
controls.maxDistance = 18;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minPolarAngle = 0.12;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.22;
controls.enablePan = false;

// image based lighting for the chrome bits
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.18;
pmrem.dispose();

/* ------------------------------------------------------------------ */
/* sky                                                                 */
/* ------------------------------------------------------------------ */
const sunDir = V(-0.8, 0.2, -0.56).normalize();

const skyUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uSunDir: { value: sunDir.clone() },
  uZenith: { value: new THREE.Color(0x15254d) },
  uHorizon: { value: new THREE.Color(0xd85f2f) },
  uSunColor: { value: new THREE.Color(0xffc47e) },
  uNightZenith: { value: new THREE.Color(0x03060f) },
  uNightHorizon: { value: new THREE.Color(0x0a1630) },
  uNightSun: { value: new THREE.Color(0xa8c6ff) },
};

const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: skyUniforms,
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uNight;
    uniform vec3 uSunDir;
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uSunColor;
    uniform vec3 uNightZenith;
    uniform vec3 uNightHorizon;
    uniform vec3 uNightSun;
    varying vec3 vDir;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * vnoise(p);
        p *= 2.03;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec3 d = normalize(vDir);
      float h = clamp(d.y, -0.2, 1.0);

      vec3 daySky = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
      vec3 nightSky = mix(uNightHorizon, uNightZenith, pow(max(h, 0.0), 0.55));
      vec3 col = mix(daySky, nightSky, uNight);

      float sd = max(dot(d, normalize(uSunDir)), 0.0);
      vec3 sunCol = mix(uSunColor, uNightSun, uNight);
      float disk = smoothstep(0.9995, 0.9999, sd);
      float glow = pow(sd, 220.0) * 0.55 + pow(sd, 48.0) * 0.05;
      col += sunCol * (disk * 1.7 + glow);

      if (d.y > 0.01) {
        vec2 uv = d.xz / (d.y + 0.16) * 0.6;
        uv += vec2(uTime * 0.004, uTime * 0.0012);
        float c = fbm(uv * 1.35);
        c = smoothstep(0.6, 0.82, c) * smoothstep(0.03, 0.3, d.y);
        vec3 cloudDay = vec3(0.85, 0.46, 0.3);
        vec3 cloudNight = vec3(0.07, 0.10, 0.17);
        col = mix(col, mix(cloudDay, cloudNight, uNight), c * 0.6);
      }

      if (uNight > 0.01 && d.y > 0.02) {
        vec2 sp = d.xz / (d.y + 0.35) * 240.0;
        vec2 cell = floor(sp);
        float rnd = hash21(cell);
        vec2 f = fract(sp) - 0.5;
        float star = (1.0 - smoothstep(0.0, 0.07, length(f))) * step(0.9962, rnd);
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + rnd * 40.0);
        col += vec3(0.75, 0.85, 1.0) * star * tw * uNight * smoothstep(0.0, 0.25, d.y) * 1.8;
      }

      col += mix(vec3(0.55, 0.18, 0.07), vec3(0.03, 0.06, 0.14), uNight)
             * pow(1.0 - max(d.y, 0.0), 9.0) * 0.3;

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});

const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 48, 32), skyMat);
sky.frustumCulled = false;
scene.add(sky);

/* ------------------------------------------------------------------ */
/* ocean                                                               */
/* ------------------------------------------------------------------ */
const oceanUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uSunDir: { value: sunDir.clone() },
  uSunColor: { value: new THREE.Color(0xffc287) },
  uDeep: { value: new THREE.Color(0x041e2a) },
  uShallow: { value: new THREE.Color(0x14606b) },
  uFogColor: { value: new THREE.Color(0xd97b48) },
  uFogNear: { value: 32 },
  uFogFar: { value: 135 },
};

const oceanGeo = new THREE.PlaneGeometry(420, 420, 170, 170);
oceanGeo.rotateX(-Math.PI / 2);

const oceanMat = new THREE.ShaderMaterial({
  uniforms: oceanUniforms,
  vertexShader: /* glsl */ `
    uniform float uTime;
    varying vec3 vWorld;
    varying vec3 vNormalW;
    varying float vWave;

    float wave(vec3 p, float t) {
      float h = 0.0;
      h += sin(p.x * 0.35 + t * 0.9) * 0.10;
      h += sin(p.z * 0.45 - t * 1.1) * 0.08;
      h += sin((p.x + p.z) * 0.7 + t * 1.7) * 0.04;
      h += sin((p.x - p.z) * 1.3 - t * 2.1) * 0.02;
      return h;
    }

    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      float t = uTime;
      float h = wave(wp.xyz, t);
      vWave = h;
      wp.y += h;
      vWorld = wp.xyz;

      float dhx = 0.35 * 0.10 * cos(wp.x * 0.35 + t * 0.9)
                + 0.70 * 0.04 * cos((wp.x + wp.z) * 0.7 + t * 1.7)
                + 1.30 * 0.02 * cos((wp.x - wp.z) * 1.3 - t * 2.1);
      float dhz = 0.45 * 0.08 * cos(wp.z * 0.45 - t * 1.1)
                + 0.70 * 0.04 * cos((wp.x + wp.z) * 0.7 + t * 1.7)
                - 1.30 * 0.02 * cos((wp.x - wp.z) * 1.3 - t * 2.1);
      vNormalW = normalize(vec3(-dhx, 1.0, -dhz));

      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uNight;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uDeep;
    uniform vec3 uShallow;
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    varying vec3 vWorld;
    varying vec3 vNormalW;
    varying float vWave;

    void main() {
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 N = normalize(vNormalW);
      float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

      vec3 base = mix(uDeep, uShallow, smoothstep(-0.10, 0.12, vWave) * 0.8 + 0.2);
      base *= mix(1.0, 0.32, uNight);
      vec3 col = base;
      col = mix(col, mix(vec3(0.10, 0.16, 0.20), vec3(0.01, 0.02, 0.05), uNight), fres * 0.5);

      vec3 L = normalize(uSunDir);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 190.0);
      col += mix(uSunColor, vec3(0.62, 0.72, 1.0), uNight) * spec * 2.6;

      float foam = smoothstep(0.105, 0.16, vWave)
                 * (0.5 + 0.5 * sin(vWorld.x * 3.0 + vWorld.z * 2.0 + uTime * 2.0));
      col += vec3(0.9, 0.95, 1.0) * foam * 0.10 * (1.0 - uNight * 0.6);

      float dist = length(cameraPosition - vWorld);
      col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});

const ocean = new THREE.Mesh(oceanGeo, oceanMat);
ocean.position.set(0, -0.34, 0);
scene.add(ocean);

/* ------------------------------------------------------------------ */
/* sand + shoreline                                                    */
/* ------------------------------------------------------------------ */
const sandGeo = new THREE.PlaneGeometry(94, 230, 70, 70);
sandGeo.rotateX(-Math.PI / 2);
{
  const pos = sandGeo.attributes.position;
  const colors = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = Math.sin(x * 0.35) * Math.cos(z * 0.2) * 0.045 + Math.sin(x * 1.7 + z * 0.6) * 0.015;
    pos.setY(i, h);
    const n = 0.5 + 0.5 * Math.sin(x * 2.1 + z * 1.3);
    c.setHSL(0.08, 0.46, 0.43 + 0.045 * n, THREE.SRGBColorSpace);
    colors.push(c.r, c.g, c.b);
  }
  sandGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  sandGeo.computeVertexNormals();
}
const sand = new THREE.Mesh(
  sandGeo,
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
);
sand.position.set(40.5, -0.22, 0);
sand.receiveShadow = true;
scene.add(sand);

const wetSand = new THREE.Mesh(
  new THREE.PlaneGeometry(3.4, 230),
  new THREE.MeshStandardMaterial({ color: 0x9c7a54, roughness: 0.55, metalness: 0.05 })
);
wetSand.rotation.x = -Math.PI / 2;
wetSand.position.set(-4.6, -0.212, 0);
scene.add(wetSand);

const foamMats = [];
for (let i = 0; i < 3; i++) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xdfe9e8,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(0.45 + i * 0.18, 230), mat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(-6.1 - i * 0.34, -0.206, 0);
  scene.add(foam);
  foamMats.push(mat);
}

/* ------------------------------------------------------------------ */
/* boardwalk                                                           */
/* ------------------------------------------------------------------ */
const PLANK_COUNT = 240;
const PLANK_SPACING = 0.335;
const PLANK_LEN = PLANK_COUNT * PLANK_SPACING;
const plankGeo = new THREE.BoxGeometry(4.5, 0.12, 0.285);
const plankMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.02 });
const planks = new THREE.InstancedMesh(plankGeo, plankMat, PLANK_COUNT);
planks.receiveShadow = true;
planks.castShadow = false;
const plankDummy = new THREE.Object3D();
const plankTilt = [];
{
  const c = new THREE.Color();
  for (let i = 0; i < PLANK_COUNT; i++) {
    c.setHSL(0.07, 0.4 + Math.random() * 0.12, 0.2 + Math.random() * 0.08, THREE.SRGBColorSpace);
    planks.setColorAt(i, c);
    plankTilt.push((Math.random() - 0.5) * 0.012);
  }
}
planks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(planks);

// side curbs
const curbMat = new THREE.MeshStandardMaterial({ color: 0x543823, roughness: 0.92 });
for (const x of [-2.3, 2.3]) {
  const curb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 230), curbMat);
  curb.position.set(x, 0.03, 0);
  curb.receiveShadow = true;
  scene.add(curb);
}

// pilings under the boardwalk
const POST_COUNT = 44;
const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 1.0, 7);
const postMat = new THREE.MeshStandardMaterial({ color: 0x4f3727, roughness: 1 });
const posts = new THREE.InstancedMesh(postGeo, postMat, POST_COUNT * 2);
posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(posts);

/* ------------------------------------------------------------------ */
/* lamps                                                               */
/* ------------------------------------------------------------------ */
const glowTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,230,180,1)');
  grad.addColorStop(0.28, 'rgba(255,190,110,.55)');
  grad.addColorStop(1, 'rgba(255,150,70,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const lampBulbMat = new THREE.MeshStandardMaterial({
  color: 0x2a2015,
  emissive: 0xffb35e,
  emissiveIntensity: 0.25,
  roughness: 0.35,
});
const lamps = [];
const LAMP_SPACING = 11.5;
const LAMP_COUNT = 7;
const LAMP_LEN = LAMP_SPACING * LAMP_COUNT;

for (let i = 0; i < LAMP_COUNT; i++) {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x22332f, metalness: 0.6, roughness: 0.45 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.16, 10), poleMat);
  base.position.y = 0.08;
  g.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 2.55, 8), poleMat);
  pole.position.y = 1.35;
  pole.castShadow = true;
  g.add(pole);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), poleMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(-0.24, 2.62, 0);
  g.add(arm);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.18, 10, 1, true), poleMat);
  shade.position.set(-0.48, 2.56, 0);
  g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), lampBulbMat);
  bulb.position.set(-0.48, 2.47, 0);
  g.add(bulb);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffc07a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  sprite.scale.set(1.05, 1.05, 1);
  sprite.position.copy(bulb.position);
  g.add(sprite);

  const light = new THREE.PointLight(0xffb264, 0, 8, 2);
  light.position.copy(bulb.position);
  g.add(light);

  g.position.set(-2.5, -0.1, 0);
  scene.add(g);
  lamps.push({ group: g, light, sprite });
}

/* ------------------------------------------------------------------ */
/* palm trees                                                          */
/* ------------------------------------------------------------------ */
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6d4b32, roughness: 0.95 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b43, roughness: 0.85, side: THREE.DoubleSide });
const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x3c7d4b, roughness: 0.85, side: THREE.DoubleSide });

function makePalm() {
  const g = new THREE.Group();
  let x = 0;
  let y = 0;
  for (let i = 0; i < 8; i++) {
    const r0 = 0.13 - i * 0.008;
    const r1 = 0.12 - i * 0.008;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 0.62, 7), trunkMat);
    seg.position.set(x, y + 0.31, 0);
    seg.rotation.z = -i * 0.035;
    seg.castShadow = true;
    g.add(seg);
    x += 0.035 * i;
    y += 0.6;
  }
  const top = new THREE.Group();
  top.position.set(x, y + 0.08, 0);
  g.add(top);
  const frondCount = 9;
  for (let i = 0; i < frondCount; i++) {
    const holder = new THREE.Group();
    holder.rotation.y = (i / frondCount) * Math.PI * 2 + rand(-0.12, 0.12);
    const frond = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 2.1, 4, 1, true),
      i % 2 ? leafMat : leafMat2
    );
    frond.geometry.translate(0, 1.05, 0);
    frond.rotation.z = -1.62 - rand(0, 0.28);
    frond.rotation.x = rand(-0.12, 0.12);
    frond.scale.z = 0.28;
    frond.castShadow = true;
    holder.add(frond);
    top.add(holder);
  }
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a3d25, roughness: 0.9 })
    );
    nut.position.set(Math.cos(i * 2.1) * 0.14, -0.08, Math.sin(i * 2.1) * 0.14);
    top.add(nut);
  }
  g.scale.setScalar(rand(0.85, 1.2));
  return g;
}

// beach rocks + grass tufts
{
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6d5a46, roughness: 1, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.14, 0.4), 0), rockMat);
    rock.position.set(rand(4.6, 12), -0.2, rand(-34, 34));
    rock.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    rock.scale.y = rand(0.5, 0.8);
    rock.castShadow = true;
    scene.add(rock);
  }
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x5f6f3a, roughness: 1, side: THREE.DoubleSide });
  for (let i = 0; i < 16; i++) {
    const tuft = new THREE.Group();
    for (let j = 0; j < 5; j++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.02, rand(0.25, 0.45), 3), grassMat);
      blade.position.set(rand(-0.12, 0.12), 0.18, rand(-0.12, 0.12));
      blade.rotation.z = rand(-0.35, 0.35);
      blade.rotation.x = rand(-0.2, 0.2);
      tuft.add(blade);
    }
    tuft.position.set(rand(4.7, 10.5), -0.2, rand(-34, 34));
    scene.add(tuft);
  }
}

const palms = [];
const PALM_SPACING = 13.5;
const PALM_COUNT = 7;
const PALM_LEN = PALM_SPACING * PALM_COUNT;
for (let i = 0; i < PALM_COUNT; i++) {
  const p = makePalm();
  p.position.set(rand(5.6, 9.2), -0.22, 0);
  p.rotation.y = rand(0, Math.PI * 2);
  scene.add(p);
  palms.push(p);
}

/* ------------------------------------------------------------------ */
/* distant islands                                                     */
/* ------------------------------------------------------------------ */
const islandMat = new THREE.MeshStandardMaterial({ color: 0x24384d, roughness: 1 });
for (let i = 0; i < 5; i++) {
  const isle = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10), islandMat);
  isle.scale.set(rand(12, 26), rand(1.6, 3.2), rand(6, 14));
  isle.position.set(rand(-105, -45), -1.2, rand(-60, 40));
  scene.add(isle);
}

/* lighthouse on the far island */
const lighthouse = new THREE.Group();
const lhIsland = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), islandMat);
lhIsland.scale.set(24, 3.4, 13);
lhIsland.position.set(-58, -1.2, -18);
scene.add(lhIsland);

const towerMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.7 });
const bandMat = new THREE.MeshStandardMaterial({ color: 0xc23d32, roughness: 0.6 });
const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.48, 4.6, 10), towerMat);
tower.position.y = 2.3;
lighthouse.add(tower);
for (const y of [1.4, 3.1]) {
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.43, 0.5, 10), bandMat);
  band.position.y = y;
  lighthouse.add(band);
}
const gallery = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 12), bandMat);
gallery.position.y = 4.62;
lighthouse.add(gallery);
const lanternRoom = new THREE.Mesh(
  new THREE.CylinderGeometry(0.3, 0.3, 0.42, 10),
  new THREE.MeshStandardMaterial({ color: 0x2a2b2e, emissive: 0xffd9a0, emissiveIntensity: 0.2, roughness: 0.3 })
);
lanternRoom.position.y = 4.9;
lighthouse.add(lanternRoom);
const roof = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.42, 10), bandMat);
roof.position.y = 5.32;
lighthouse.add(roof);

const beamPivot = new THREE.Group();
beamPivot.position.y = 4.9;
lighthouse.add(beamPivot);
const beamMat = new THREE.ShaderMaterial({
  uniforms: { uOpacity: { value: 0 } },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    varying float vFade;
    void main() {
      vFade = clamp(-position.y / 22.0, 0.0, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uOpacity;
    varying float vFade;
    void main() {
      float a = pow(1.0 - vFade, 1.8) * uOpacity;
      gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * a, a);
    }
  `,
});
for (const s of [-1, 1]) {
  const beamGeo = new THREE.ConeGeometry(1.5, 22, 18, 1, true);
  beamGeo.translate(0, -11, 0);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.rotation.z = Math.PI / 2;
  if (s < 0) beam.rotation.y = Math.PI;
  beamPivot.add(beam);
}
lighthouse.position.set(-58, 1.6, -18);
lighthouse.scale.setScalar(1.1);
scene.add(lighthouse);

/* ------------------------------------------------------------------ */
/* seagulls                                                            */
/* ------------------------------------------------------------------ */
const gullMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.7 });
const gulls = [];
for (let i = 0; i < 7; i++) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.22, 3, 6), gullMat);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const wings = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.012, 0.12), gullMat);
    wing.geometry.translate(s * 0.275, 0, 0);
    wing.position.x = s * 0.05;
    g.add(wing);
    wings.push(wing);
  }
  g.scale.setScalar(0.78);
  g.userData = {
    wings,
    radius: rand(12, 34),
    speed: rand(0.06, 0.14) * (Math.random() > 0.5 ? 1 : -1),
    phase: rand(0, Math.PI * 2),
    y: rand(6.5, 13),
    flap: rand(7, 11),
  };
  scene.add(g);
  gulls.push(g);
}

/* ------------------------------------------------------------------ */
/* dust motes                                                          */
/* ------------------------------------------------------------------ */
const DUST_COUNT = 380;
const dustPos = new Float32Array(DUST_COUNT * 3);
const dustVel = new Float32Array(DUST_COUNT * 3);
for (let i = 0; i < DUST_COUNT; i++) {
  dustPos[i * 3] = rand(-9, 9);
  dustPos[i * 3 + 1] = rand(0.1, 3.2);
  dustPos[i * 3 + 2] = rand(-10, 10);
  dustVel[i * 3] = rand(-0.03, 0.03);
  dustVel[i * 3 + 1] = rand(0.01, 0.06);
  dustVel[i * 3 + 2] = rand(-0.02, 0.02);
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({
  color: 0xffcf9a,
  size: 0.028,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  sizeAttenuation: true,
});
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);

/* ------------------------------------------------------------------ */
/* materials                                                           */
/* ------------------------------------------------------------------ */
const MAT = {
  frame: new THREE.MeshStandardMaterial({ color: 0x2b8f86, metalness: 0.55, roughness: 0.3 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdfe6ea, metalness: 1, roughness: 0.16 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.95, roughness: 0.24 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.96, metalness: 0 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xc9d0d4, metalness: 0.9, roughness: 0.25 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x6b3f2a, roughness: 0.8 }),
  wicker: new THREE.MeshStandardMaterial({ color: 0x9a6b3c, roughness: 0.95 }),
  feather: new THREE.MeshStandardMaterial({ color: 0xefe4cf, roughness: 0.82, metalness: 0 }),
  featherShade: new THREE.MeshStandardMaterial({ color: 0xded2bb, roughness: 0.85 }),
  beak: new THREE.MeshStandardMaterial({ color: 0xffb13c, roughness: 0.42, metalness: 0.02 }),
  pouch: new THREE.MeshStandardMaterial({ color: 0xf08a22, roughness: 0.55 }),
  leg: new THREE.MeshStandardMaterial({ color: 0xe8a24b, roughness: 0.7 }),
  helmet: new THREE.MeshStandardMaterial({ color: 0xe0513c, roughness: 0.35, metalness: 0.08 }),
  scarf: new THREE.MeshStandardMaterial({ color: 0xe4573d, roughness: 0.85 }),
  eye: new THREE.MeshStandardMaterial({ color: 0x141110, roughness: 0.3 }),
  fish: new THREE.MeshStandardMaterial({ color: 0xa9c4d2, metalness: 0.7, roughness: 0.28 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x24211e, roughness: 0.7 }),
};

/* ------------------------------------------------------------------ */
/* bike                                                                */
/* ------------------------------------------------------------------ */
const bike = new THREE.Group();
bike.position.y = 0.07;
scene.add(bike);

function tubeBetween(a, b, r, mat, radial = 10) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, radial), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// frame points (bike local, forward = +Z)
const BB = V(0, 0.46, -0.05);
const REAR = V(0, 0.52, -0.72);
const FRONT = V(0, 0.52, 0.72);
const SEAT = V(0, 1.18, -0.3);
const HEAD_TOP = V(0, 1.12, 0.48);
const HEAD_BOT = V(0, 0.86, 0.56);

bike.add(tubeBetween(REAR, SEAT, 0.024, MAT.frame));
bike.add(tubeBetween(REAR, BB, 0.024, MAT.frame));
bike.add(tubeBetween(BB, SEAT, 0.028, MAT.frame));
bike.add(tubeBetween(BB, HEAD_BOT, 0.028, MAT.frame));
bike.add(tubeBetween(SEAT, HEAD_TOP, 0.024, MAT.frame));
bike.add(tubeBetween(HEAD_TOP, HEAD_BOT, 0.03, MAT.frame));
for (const x of [-0.055, 0.055]) {
  bike.add(tubeBetween(V(x, HEAD_BOT.y - 0.02, HEAD_BOT.z), V(x, FRONT.y, FRONT.z), 0.018, MAT.chrome));
}
// seat post + saddle
bike.add(tubeBetween(SEAT, V(0, 1.27, -0.31), 0.018, MAT.chrome));
const saddle = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), MAT.leather);
saddle.scale.set(0.15, 0.055, 0.27);
saddle.position.set(0, 1.28, -0.31);
saddle.castShadow = true;
bike.add(saddle);
// saddle nose
const saddleNose = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), MAT.leather);
saddleNose.scale.set(0.075, 0.04, 0.16);
saddleNose.position.set(0, 1.285, -0.12);
bike.add(saddleNose);

// stem + handlebar
bike.add(tubeBetween(HEAD_TOP, V(0, 1.29, 0.53), 0.022, MAT.chrome));
bike.add(tubeBetween(V(-0.34, 1.3, 0.53), V(0.34, 1.3, 0.53), 0.02, MAT.chrome));
for (const s of [-1, 1]) {
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 10), MAT.leather);
  grip.rotation.z = Math.PI / 2;
  grip.position.set(s * 0.33, 1.3, 0.53);
  bike.add(grip);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.13), MAT.chrome);
  lever.position.set(s * 0.27, 1.27, 0.56);
  lever.rotation.x = -0.25;
  bike.add(lever);
}

// headlight
const headlampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.1, 14), MAT.chrome);
headlampBody.rotation.x = Math.PI / 2;
headlampBody.position.set(0, 1.17, 0.63);
bike.add(headlampBody);
const lens = new THREE.Mesh(
  new THREE.CircleGeometry(0.045, 16),
  new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffd9a0, emissiveIntensity: 0.4 })
);
lens.position.set(0, 1.17, 0.682);
bike.add(lens);
const headlight = new THREE.SpotLight(0xffd9a0, 0, 18, 0.62, 0.7, 1.5);
headlight.position.set(0, 1.17, 0.66);
headlight.target.position.set(0, 0.5, 6);
bike.add(headlight);
bike.add(headlight.target);

// bell
const bellGroup = new THREE.Group();
const bell = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), MAT.brass);
bell.rotation.x = Math.PI;
bell.position.y = 0.045;
bellGroup.add(bell);
const bellStem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.045, 8), MAT.chrome);
bellGroup.add(bellStem);
const bellLever = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6), MAT.chrome);
bellLever.rotation.z = 1.2;
bellLever.position.set(-0.04, 0.045, 0);
bellGroup.add(bellLever);
bellGroup.position.set(0.2, 1.335, 0.56);
bellGroup.rotation.y = 0.3;
bike.add(bellGroup);

// wheels
function makeWheel(radius) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.042, 10, 56), MAT.tire);
  tire.rotation.y = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.045, 0.014, 8, 56), MAT.rim);
  rim.rotation.y = Math.PI / 2;
  g.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.13, 12), MAT.chrome);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const end = V(0, Math.cos(a) * (radius - 0.055), Math.sin(a) * (radius - 0.055));
    const spoke = tubeBetween(V(0, 0, 0), end, 0.0055, MAT.rim, 5);
    spoke.castShadow = false;
    g.add(spoke);
  }
  return g;
}
const frontWheel = makeWheel(0.52);
frontWheel.position.copy(FRONT);
bike.add(frontWheel);
const rearWheel = makeWheel(0.52);
rearWheel.position.copy(REAR);
bike.add(rearWheel);

// crank + chainring + pedals
const crank = new THREE.Group();
crank.position.copy(BB);
bike.add(crank);
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.012, 8, 40), MAT.chrome);
ring.rotation.y = Math.PI / 2;
ring.position.x = 0.12;
crank.add(ring);
for (let i = 0; i < 5; i++) {
  const a = (i / 5) * Math.PI * 2;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.14, 0.018), MAT.chrome);
  arm.position.set(0.12, Math.cos(a) * 0.075, Math.sin(a) * 0.075);
  arm.rotation.x = -a;
  crank.add(arm);
}
const crankArms = [];
for (const s of [-1, 1]) {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.18, 0.05), MAT.chrome);
  arm.geometry.translate(0, 0.09, 0);
  arm.position.x = s * 0.2;
  crank.add(arm);
  crankArms.push(arm);
}
const pedals = [];
for (const s of [-1, 1]) {
  const p = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.14), MAT.dark);
  board.castShadow = true;
  p.add(board);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), MAT.chrome);
  axle.rotation.z = Math.PI / 2;
  axle.position.x = s * -0.04;
  p.add(axle);
  bike.add(p);
  pedals.push(p);
}

// rear cog + chain
const cog = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.01, 8, 24), MAT.chrome);
cog.rotation.y = Math.PI / 2;
cog.position.set(0.12, REAR.y, REAR.z);
bike.add(cog);
{
  const pts = [];
  const x = 0.12;
  const r1 = 0.158;
  const r2 = 0.072;
  pts.push(V(x, BB.y + r1, BB.z));
  pts.push(V(x, REAR.y + r2, REAR.z));
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI / 2 + (i / 14) * Math.PI;
    pts.push(V(x, REAR.y + Math.cos(a) * r2, REAR.z + Math.sin(a) * r2));
  }
  pts.push(V(x, BB.y - r1, BB.z));
  for (let i = 0; i <= 22; i++) {
    const a = -Math.PI / 2 + (i / 22) * Math.PI;
    pts.push(V(x, BB.y + Math.cos(a) * r1, BB.z + Math.sin(a) * r1));
  }
  const chainGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const chain = new THREE.LineLoop(chainGeo, new THREE.LineBasicMaterial({ color: 0x2b2a28 }));
  bike.add(chain);
}

// basket + fish
const basket = new THREE.Group();
const basketW = 0.42;
const basketH = 0.26;
const basketD = 0.3;
const bottom = new THREE.Mesh(new THREE.BoxGeometry(basketW, 0.02, basketD), MAT.wicker);
bottom.position.y = -basketH / 2;
bottom.castShadow = true;
basket.add(bottom);
for (const x of [-basketW / 2, basketW / 2]) {
  for (const z of [-basketD / 2, basketD / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.022, basketH, 0.022), MAT.wicker);
    post.position.set(x, 0, z);
    basket.add(post);
  }
}
for (const y of [-basketH / 2 + 0.045, 0, basketH / 2 - 0.03]) {
  for (const z of [-basketD / 2, basketD / 2]) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(basketW, 0.02, 0.018), MAT.wicker);
    slat.position.set(0, y, z);
    basket.add(slat);
  }
  for (const x of [-basketW / 2, basketW / 2]) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.02, basketD), MAT.wicker);
    slat.position.set(x, y, 0);
    basket.add(slat);
  }
}
const rim = new THREE.Mesh(new THREE.BoxGeometry(basketW + 0.03, 0.028, basketD + 0.03), MAT.wicker);
rim.position.y = basketH / 2;
basket.add(rim);
basket.position.set(0, 1.04, 0.88);
bike.add(basket);
for (let i = 0; i < 2; i++) {
  const fish = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.24, 3, 10), MAT.fish);
  body.rotation.z = Math.PI / 2;
  fish.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.13, 4), MAT.fish);
  tail.rotation.z = -Math.PI / 2;
  tail.scale.z = 0.4;
  tail.position.x = -0.17;
  fish.add(tail);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.09, 3), MAT.fish);
  fin.position.set(0.0, 0.055, 0);
  fin.rotation.z = 0.45;
  fin.scale.z = 0.5;
  fish.add(fin);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), MAT.dark);
  eye.position.set(0.12, 0.022, 0.035);
  fish.add(eye);
  fish.position.set(rand(-0.07, 0.07), 0.2, rand(-0.05, 0.05));
  fish.rotation.set(rand(-0.3, 0.3), rand(-0.5, 0.5), 0.75 + rand(-0.1, 0.1));
  basket.add(fish);
}

/* ------------------------------------------------------------------ */
/* pelican                                                             */
/* ------------------------------------------------------------------ */
const rider = new THREE.Group();
rider.position.set(0, 1.1, -0.3);
bike.add(rider);
const RIDER_BASE_Y = rider.position.y;

// body
const body = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), MAT.feather);
body.scale.set(0.285, 0.31, 0.44);
body.position.set(0, 0.19, 0);
body.castShadow = true;
rider.add(body);
const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), MAT.feather);
chest.scale.set(0.25, 0.26, 0.25);
chest.position.set(0, 0.13, 0.23);
chest.castShadow = true;
rider.add(chest);

// neck
const neckCurve = new THREE.CatmullRomCurve3([
  V(0, 0.42, 0.2),
  V(0, 0.57, 0.25),
  V(0, 0.71, 0.3),
  V(0, 0.83, 0.34),
]);
const neck = new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 24, 0.094, 10, false), MAT.feather);
neck.castShadow = true;
rider.add(neck);

// head group
const headGroup = new THREE.Group();
headGroup.position.set(0, 0.88, 0.37);
rider.add(headGroup);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.168, 24, 18), MAT.feather);
head.scale.set(0.95, 1, 1.1);
head.castShadow = true;
headGroup.add(head);

// beak
const beak = new THREE.Group();
beak.position.set(0, -0.01, 0.075);
headGroup.add(beak);
const upperBeak = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.038, 0.66, 10), MAT.beak);
upperBeak.rotation.x = Math.PI / 2 + 0.07;
upperBeak.position.set(0, -0.005, 0.35);
upperBeak.castShadow = true;
beak.add(upperBeak);
const beakTip = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), MAT.beak);
beakTip.position.set(0, -0.018, 0.685);
beak.add(beakTip);
const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 6), MAT.dark);
nostril.position.set(0.026, 0.014, 0.18);
beak.add(nostril);
const beakSeam = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.56, 6), MAT.dark);
beakSeam.rotation.x = Math.PI / 2 + 0.06;
beakSeam.position.set(0, -0.036, 0.34);
beak.add(beakSeam);
const beakHook = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 6), MAT.beak);
beakHook.rotation.x = Math.PI;
beakHook.position.set(0, -0.036, 0.685);
beak.add(beakHook);

const jaw = new THREE.Group();
jaw.position.set(0, -0.035, 0.05);
beak.add(jaw);
const lowerBeak = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.027, 0.6, 8), MAT.beak);
lowerBeak.rotation.x = Math.PI / 2 + 0.06;
lowerBeak.position.set(0, -0.026, 0.32);
jaw.add(lowerBeak);
const pouchGeo = new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
{
  const pp = pouchGeo.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const z = pp.getZ(i);
    const taper = 1 - 0.38 * Math.max(0, z);
    pp.setX(i, pp.getX(i) * taper);
    pp.setY(i, pp.getY(i) * (0.86 + 0.14 * taper));
  }
  pouchGeo.computeVertexNormals();
}
const pouch = new THREE.Mesh(pouchGeo, MAT.pouch);
pouch.scale.set(0.105, 0.135, 0.33);
pouch.position.set(0, -0.045, 0.32);
jaw.add(pouch);

// eyes + eyelids
const lids = [];
for (const s of [-1, 1]) {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), MAT.featherShade);
  eye.position.set(s * 0.095, 0.018, 0.1);
  headGroup.add(eye);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), MAT.eye);
  pupil.position.set(s * 0.098, 0.02, 0.142);
  headGroup.add(pupil);
  const glint = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  glint.position.set(s * 0.092, 0.031, 0.162);
  headGroup.add(glint);
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.054, 12, 10), MAT.feather);
  lid.position.copy(eye.position);
  lid.scale.set(1.03, 0.03, 1.03);
  headGroup.add(lid);
  lids.push(lid);
}

// helmet
const helmet = new THREE.Mesh(
  new THREE.SphereGeometry(0.192, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.53),
  MAT.helmet
);
helmet.position.set(0, 0.072, 0);
helmet.scale.set(1, 0.92, 1.04);
helmet.castShadow = true;
headGroup.add(helmet);
const visor = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.018, 0.1), MAT.helmet);
visor.position.set(0, 0.058, 0.176);
visor.rotation.x = -0.2;
headGroup.add(visor);
const helmetStripe = new THREE.Mesh(
  new THREE.TorusGeometry(0.188, 0.011, 6, 24, Math.PI),
  new THREE.MeshStandardMaterial({ color: 0xf6ead2, roughness: 0.5 })
);
helmetStripe.rotation.x = Math.PI / 2;
helmetStripe.position.set(0, 0.092, 0);
headGroup.add(helmetStripe);

// scarf ring + trailing segments
const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.032, 8, 20), MAT.scarf);
scarfRing.rotation.x = Math.PI / 2;
scarfRing.position.set(0, 0.61, 0.26);
rider.add(scarfRing);
const SCARF_N = 16;
const scarfPos = new Float32Array((SCARF_N + 1) * 6);
const scarfIndex = [];
for (let i = 0; i < SCARF_N; i++) {
  const a = i * 2;
  scarfIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
}
const scarfGeo = new THREE.BufferGeometry();
scarfGeo.setAttribute('position', new THREE.BufferAttribute(scarfPos, 3));
scarfGeo.setIndex(scarfIndex);
const scarfRibbon = new THREE.Mesh(
  scarfGeo,
  new THREE.MeshStandardMaterial({ color: 0xe4573d, roughness: 0.85, side: THREE.DoubleSide })
);
scarfRibbon.castShadow = true;
rider.add(scarfRibbon);

// wings
function makeWing(side) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    V(side * 0.315, 0.3, 0.06),
    V(side * 0.42, 0.28, 0.35),
    V(side * 0.37, 0.21, 0.6),
    V(side * 0.34, 0.2, 0.78),
  ]);
  const wing = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.062, 8, false), MAT.feather);
  wing.castShadow = true;
  g.add(wing);
  for (let i = 0; i < 3; i++) {
    const feather = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 5), MAT.featherShade);
    feather.position.set(side * (0.29 + i * 0.032), 0.31 - i * 0.04, -0.14 - i * 0.03);
    feather.rotation.x = Math.PI / 2 + 0.25;
    feather.rotation.z = side * (0.1 + i * 0.12);
    g.add(feather);
  }
  for (let i = 0; i < 4; i++) {
    const tt = 0.24 + i * 0.17;
    const p = curve.getPoint(tt);
    const feather = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.32, 4), MAT.featherShade);
    feather.position.copy(p).add(V(0, -0.025, -0.03));
    feather.rotation.x = -Math.PI / 2 - 0.18;
    feather.rotation.z = side * 0.12;
    feather.scale.set(1, 0.9, 0.32);
    g.add(feather);
  }
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), MAT.feather);
  hand.position.set(side * 0.34, 0.2, 0.79);
  g.add(hand);
  return g;
}
rider.add(makeWing(-1));
rider.add(makeWing(1));

// tail
for (let i = 0; i < 3; i++) {
  const feather = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 5), MAT.featherShade);
  feather.position.set((i - 1) * 0.085, 0.2 - i * 0.015, -0.46);
  feather.rotation.x = -Math.PI / 2 - 0.15;
  feather.rotation.z = (i - 1) * 0.2;
  feather.castShadow = true;
  rider.add(feather);
}

// legs (two-bone IK, in bike space)
const THIGH = 0.45;
const SHIN = 0.52;
const legs = [];
function makeLimb(radius, mat) {
  const geo = new THREE.CylinderGeometry(radius, radius * 0.82, 1, 10);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}
function setLimb(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 0.0001);
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
  mesh.scale.set(1, len, 1);
}
function solveKnee(hip, ankle, l1, l2, side) {
  const d = hip.distanceTo(ankle);
  const dir = new THREE.Vector3().subVectors(ankle, hip).normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const base = hip.clone().addScaledVector(dir, a);
  const pole = V(side * 0.12, 0.05, 1).normalize();
  pole.addScaledVector(dir, -pole.dot(dir)).normalize();
  return base.addScaledVector(pole, h);
}
for (const s of [-1, 1]) {
  const thigh = makeLimb(0.052, MAT.leg);
  const shin = makeLimb(0.04, MAT.leg);
  const foot = new THREE.Group();
  const sole = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), MAT.leg);
  sole.scale.set(0.085, 0.028, 0.14);
  sole.position.z = 0.045;
  foot.add(sole);
  for (let i = 0; i < 3; i++) {
    const toe = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.12, 5), MAT.leg);
    toe.rotation.x = Math.PI / 2;
    toe.position.set((i - 1) * 0.045, -0.005, 0.16);
    foot.add(toe);
  }
  bike.add(thigh, shin, foot);
  legs.push({ side: s, thigh, shin, foot, hip: V(s * 0.15, 0.12, 0.2) });
}

// make every bike mesh cast shadows
bike.traverse((o) => {
  if (o.isMesh) {
    o.castShadow = true;
    o.receiveShadow = true;
  }
});

/* ------------------------------------------------------------------ */
/* lights                                                              */
/* ------------------------------------------------------------------ */
const sunLight = new THREE.DirectionalLight(0xffa568, 2.0);
sunLight.position.copy(sunDir).multiplyScalar(34);
sunLight.target.position.set(0, 1, 0);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -6.5;
sunLight.shadow.camera.right = 6.5;
sunLight.shadow.camera.top = 6.5;
sunLight.shadow.camera.bottom = -6.5;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 80;
sunLight.shadow.bias = -0.0005;
sunLight.shadow.normalBias = 0.02;
scene.add(sunLight, sunLight.target);

const hemi = new THREE.HemisphereLight(0x9fc2ff, 0x8a5a3a, 0.3);
scene.add(hemi);

const fill = new THREE.DirectionalLight(0x86a8ff, 0.2);
fill.position.set(6, 4, 7);
scene.add(fill);

/* ------------------------------------------------------------------ */
/* post processing                                                     */
/* ------------------------------------------------------------------ */
const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.22,
  0.4,
  0.9
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------ */
/* audio                                                               */
/* ------------------------------------------------------------------ */
class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this.enabled = true;
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);

    // ocean rumble
    {
      const ctx = this.ctx;
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 520;
      lp.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.value = 0.17;
      src.connect(lp).connect(g).connect(this.master);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lg = ctx.createGain();
      lg.gain.value = 170;
      lfo.connect(lg).connect(lp.frequency);
      lfo.start();
      src.start();
    }
    // wind
    {
      const ctx = this.ctx;
      const len = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1150;
      bp.Q.value = 0.55;
      const g = ctx.createGain();
      g.gain.value = 0.012;
      src.connect(bp).connect(g).connect(this.master);
      src.start();
    }
    this.ready = true;
  }
  setEnabled(on) {
    this.enabled = on;
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(on ? 0.55 : 0, t + 0.4);
  }
  honk() {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    g.connect(this.master);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(118, t + 0.42);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(380, t + 0.42);
    o.connect(f).connect(g);
    o.start(t);
    o.stop(t + 0.5);
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(330, t);
    o2.frequency.exponentialRampToValueAtTime(230, t + 0.3);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.07, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o2.connect(g2).connect(this.master);
    o2.start(t);
    o2.stop(t + 0.32);
  }
  bell() {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [freq, amp, dur] of [
      [2093, 0.14, 1.1],
      [2637, 0.1, 0.8],
      [4186, 0.04, 0.5],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
  gull() {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.16;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(1450 + i * 90, t);
      o.frequency.exponentialRampToValueAtTime(820 + i * 40, t + 0.19);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.055, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.22);
    }
  }
}
const sound = new Sound();

/* ------------------------------------------------------------------ */
/* state + ui                                                          */
/* ------------------------------------------------------------------ */
const state = {
  started: false,
  speed: 1,
  targetSpeed: 1,
  night: 0,
  targetNight: 0,
  distance: 0,
  pedalAngle: 0,
  honk: 0,
  blinkT: 3,
  blinkPhase: 0,
  shot: false,
  muted: false,
  nextGull: 6,
  autoRotateWanted: true,
  autoRotateAt: 0,
};

const nightBtn = $('#night');
const soundBtn = $('#sound');
const speedInput = $('#speed');
const speedOut = $('#speedOut');
const toastEl = $('#toast');

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
}

function honk() {
  state.honk = 1;
  sound.honk();
  toast('嘎——');
}

function toggleNight() {
  state.targetNight = state.targetNight > 0.5 ? 0 : 1;
  nightBtn.textContent = state.targetNight > 0.5 ? '黄昏' : '星夜';
  nightBtn.classList.toggle('on', state.targetNight > 0.5);
  nightBtn.setAttribute('aria-pressed', String(state.targetNight > 0.5));
  toast(state.targetNight > 0.5 ? '入夜了' : '回到黄昏');
}

const PRESETS = [
  { name: '英雄机位', pos: V(4.2, 2.2, 4.9) },
  { name: '侧面', pos: V(7.4, 2.1, 0.8) },
  { name: '正面', pos: V(0.9, 2.2, 7.6) },
  { name: '低角度', pos: V(4.4, 1.0, 4.6) },
  { name: '追尾', pos: V(0.4, 2.8, -6.6) },
];
let presetIndex = 0;
let camTween = null;
function flyTo(pos, dur = 1.25) {
  camTween = {
    from: camera.position.clone(),
    to: pos.clone(),
    fromTarget: controls.target.clone(),
    toTarget: V(0, 1.35, 0),
    t: 0,
    dur,
  };
  controls.autoRotate = false;
}
function cycleView() {
  presetIndex = (presetIndex + 1) % PRESETS.length;
  flyTo(PRESETS[presetIndex].pos);
  toast(`视角 · ${PRESETS[presetIndex].name}`);
}

function screenshot() {
  state.shot = true;
  const flash = $('#flash');
  flash.classList.add('on');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => flash.classList.remove('on'));
  });
}

function toggleSound() {
  state.muted = !state.muted;
  sound.setEnabled(!state.muted);
  soundBtn.textContent = state.muted ? '静音' : '声音';
  soundBtn.classList.toggle('on', !state.muted);
  soundBtn.setAttribute('aria-pressed', String(!state.muted));
  if (!state.muted) toast('声音已开启');
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => toast('浏览器不支持全屏'));
  } else {
    document.exitFullscreen?.();
  }
}

$('#start').addEventListener('click', () => {
  if (state.started) return;
  state.started = true;
  sound.init();
  sound.setEnabled(true);
  $('#intro').classList.add('gone');
  setTimeout(() => {
    const intro = $('#intro');
    if (intro) intro.style.display = 'none';
  }, 900);
  flyTo(PRESETS[0].pos, 2.4);
  state.autoRotateAt = elapsed + 9;
  sound.bell();
  setTimeout(() => sound.bell(), 220);
});

nightBtn.addEventListener('click', toggleNight);
soundBtn.addEventListener('click', toggleSound);
$('#honk').addEventListener('click', honk);
$('#shot').addEventListener('click', screenshot);
$('#view').addEventListener('click', cycleView);
$('#full').addEventListener('click', toggleFullscreen);

speedInput.addEventListener('input', () => {
  state.targetSpeed = parseFloat(speedInput.value);
  speedOut.textContent = `${state.targetSpeed.toFixed(1)}×`;
});

// pause auto-rotate on interaction, resume later
controls.addEventListener('start', () => {
  camTween = null;
  controls.autoRotate = false;
  state.autoRotateAt = Infinity;
});
controls.addEventListener('end', () => {
  state.autoRotateAt = elapsed + 6;
});

// click the bell or the pelican
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downPos = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY, t: performance.now() };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downPos || !state.started) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  const quick = performance.now() - downPos.t < 450;
  downPos = null;
  if (moved > 8 || !quick) return;
  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const bellHit = raycaster.intersectObject(bellGroup, true).length > 0;
  if (bellHit) {
    sound.bell();
    toast('叮铃——');
    return;
  }
  if (raycaster.intersectObject(headGroup, true).length > 0) honk();
});

// keyboard
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') {
    e.preventDefault();
    honk();
  } else if (k >= '1' && k <= '5') {
    presetIndex = parseInt(k, 10) - 1;
    flyTo(PRESETS[presetIndex].pos);
    toast(`视角 · ${PRESETS[presetIndex].name}`);
  } else if (k === 'n') toggleNight();
  else if (k === 'm') toggleSound();
  else if (k === 's') screenshot();
  else if (k === 'f') toggleFullscreen();
  else if (k === 'h') document.documentElement.classList.toggle('ui-hidden');
  else if (k === 'arrowright' || k === 'arrowup') {
    state.targetSpeed = clamp(state.targetSpeed + 0.1, 0, 2);
    speedInput.value = state.targetSpeed;
    speedOut.textContent = `${state.targetSpeed.toFixed(1)}×`;
  } else if (k === 'arrowleft' || k === 'arrowdown') {
    state.targetSpeed = clamp(state.targetSpeed - 0.1, 0, 2);
    speedInput.value = state.targetSpeed;
    speedOut.textContent = `${state.targetSpeed.toFixed(1)}×`;
  }
});

/* ------------------------------------------------------------------ */
/* resize                                                              */
/* ------------------------------------------------------------------ */
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
}
window.addEventListener('resize', onResize);

/* ------------------------------------------------------------------ */
/* animation                                                           */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
let elapsed = 0;

const sunWarm = new THREE.Color(0xffa568);
const sunCool = new THREE.Color(0x8fb4ff);
const fogWarm = new THREE.Color(0xd97b48);
const fogCool = new THREE.Color(0x070d1c);
const hemiSkyWarm = new THREE.Color(0x9fc2ff);
const hemiSkyCool = new THREE.Color(0x243a66);
const hemiGroundWarm = new THREE.Color(0x8a5a3a);
const hemiGroundCool = new THREE.Color(0x10151f);
const tmpColor = new THREE.Color();
const tmpVec = new THREE.Vector3();

const dummy = new THREE.Object3D();

function updateWorld(dt) {
  const d = state.distance;

  // planks
  for (let i = 0; i < PLANK_COUNT; i++) {
    let z = ((i * PLANK_SPACING - d) % PLANK_LEN + PLANK_LEN) % PLANK_LEN - PLANK_LEN / 2;
    dummy.position.set(0, 0.01, z);
    dummy.rotation.set(plankTilt[i], 0, 0);
    dummy.updateMatrix();
    planks.setMatrixAt(i, dummy.matrix);
  }
  planks.instanceMatrix.needsUpdate = true;

  // pilings
  const postSpacing = PLANK_LEN / POST_COUNT;
  let pi = 0;
  for (let i = 0; i < POST_COUNT; i++) {
    const z = ((i * postSpacing - d) % PLANK_LEN + PLANK_LEN) % PLANK_LEN - PLANK_LEN / 2;
    for (const x of [-2.0, 2.0]) {
      dummy.position.set(x, -0.32, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      posts.setMatrixAt(pi++, dummy.matrix);
    }
  }
  posts.instanceMatrix.needsUpdate = true;

  // lamps
  for (let i = 0; i < LAMP_COUNT; i++) {
    const z = ((i * LAMP_SPACING - d - 2.8) % LAMP_LEN + LAMP_LEN) % LAMP_LEN - LAMP_LEN / 2;
    lamps[i].group.position.z = z;
  }

  // palms
  for (let i = 0; i < PALM_COUNT; i++) {
    const z = ((i * PALM_SPACING - d * 0.92) % PALM_LEN + PALM_LEN) % PALM_LEN - PALM_LEN / 2;
    palms[i].position.z = z;
  }

  // foam
  foamMats.forEach((m, i) => {
    m.opacity = (0.1 + 0.09 * Math.sin(elapsed * 1.3 + i * 1.7)) * (1 - state.night * 0.55);
  });
}

function updateRider(dt, t) {
  const a = state.pedalAngle;

  rider.position.y = RIDER_BASE_Y + Math.sin(a * 2) * 0.012;
  rider.rotation.z = Math.sin(a) * 0.016;
  rider.rotation.x = 0.015 + Math.sin(a * 2 + 0.5) * 0.006;

  headGroup.rotation.x = -0.02 + Math.sin(a * 2 + 0.8) * 0.012 + Math.sin(t * 0.5) * 0.01;
  headGroup.rotation.y = Math.sin(t * 0.33) * 0.05;

  // blink
  state.blinkT -= dt;
  if (state.blinkT <= 0) {
    state.blinkT = rand(2.6, 6.5);
    state.blinkPhase = 0.0001;
  }
  let lid = 0.03;
  if (state.blinkPhase > 0) {
    state.blinkPhase += dt * 7.5;
    if (state.blinkPhase >= 1) state.blinkPhase = 0;
    else lid = 0.03 + Math.sin(state.blinkPhase * Math.PI) * 1.0;
  }
  for (const l of lids) l.scale.y = lid;

  // honk
  if (state.honk > 0) state.honk = Math.max(0, state.honk - dt * 1.9);
  const pulse = Math.sin((1 - state.honk) * Math.PI) * (state.honk > 0 ? 1 : 0);
  jaw.rotation.x = pulse * 0.55;
  headGroup.rotation.x -= pulse * 0.12;
  pouch.scale.set(0.105, 0.135 + Math.sin(t * 7) * 0.007 + pulse * 0.03, 0.33);

  // scarf ribbon
  for (let i = 0; i <= SCARF_N; i++) {
    const p = i / SCARF_N;
    const z = 0.2 - i * 0.062;
    const y = 0.66 - i * 0.006 + Math.sin(t * 5.2 - i * 0.55) * 0.02 * i * 0.42;
    const x = Math.sin(t * 3.4 - i * 0.6) * 0.024 * i * 0.5;
    const half = 0.078 * (1 - p * 0.35);
    const tw = 0.7 + Math.sin(t * 2.2 - i * 0.5) * 0.7;
    const wx = Math.cos(tw) * half;
    const wy = Math.sin(tw) * half;
    const o = i * 6;
    scarfPos[o] = x - wx;
    scarfPos[o + 1] = y - wy;
    scarfPos[o + 2] = z;
    scarfPos[o + 3] = x + wx;
    scarfPos[o + 4] = y + wy;
    scarfPos[o + 5] = z;
  }
  scarfGeo.attributes.position.needsUpdate = true;
  scarfGeo.computeVertexNormals();

  // legs
  for (const leg of legs) {
    const angle = a + (leg.side < 0 ? Math.PI : 0);
    const pedalPos = V(
      leg.side * 0.21,
      BB.y + Math.cos(angle) * 0.17,
      BB.z + Math.sin(angle) * 0.17
    );
    const hip = leg.hip.clone().applyQuaternion(rider.quaternion).add(rider.position);
    const knee = solveKnee(hip, pedalPos, THIGH, SHIN, leg.side);
    setLimb(leg.thigh, hip, knee);
    setLimb(leg.shin, knee, pedalPos);
    leg.foot.position.copy(pedalPos);
    leg.foot.position.y += 0.02;
    leg.foot.rotation.x = Math.sin(a * 2) * 0.04;
  }

  // pedals + crank
  crank.rotation.x = a;
  crankArms[0].rotation.x = 0;
  crankArms[1].rotation.x = Math.PI;
  const pedalAngles = [a, a + Math.PI];
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const ang = pedalAngles[i];
    pedals[i].position.set(
      s * 0.21,
      BB.y + Math.cos(ang) * 0.17,
      BB.z + Math.sin(ang) * 0.17
    );
    pedals[i].rotation.x = 0;
  }
}

function updateGulls(t) {
  for (const g of gulls) {
    const u = g.userData;
    const ang = u.phase + t * u.speed;
    g.position.set(Math.cos(ang) * u.radius, u.y + Math.sin(t * 0.6 + u.phase) * 0.5, Math.sin(ang) * u.radius);
    g.rotation.y = -ang + (u.speed > 0 ? Math.PI : 0);
    const flap = Math.sin(t * u.flap + u.phase) * 0.55;
    u.wings[0].rotation.z = flap;
    u.wings[1].rotation.z = -flap;
  }
}

function updateDust(dt) {
  const pos = dustGeo.attributes.position.array;
  for (let i = 0; i < DUST_COUNT; i++) {
    const j = i * 3;
    pos[j] += dustVel[j] * dt;
    pos[j + 1] += dustVel[j + 1] * dt;
    pos[j + 2] += dustVel[j + 2] * dt;
    if (pos[j + 1] > 3.3) {
      pos[j] = rand(-9, 9);
      pos[j + 1] = 0.1;
      pos[j + 2] = rand(-10, 10);
    }
    if (pos[j] > 9) pos[j] = -9;
    if (pos[j] < -9) pos[j] = 9;
    if (pos[j + 2] > 10) pos[j + 2] = -10;
    if (pos[j + 2] < -10) pos[j + 2] = 10;
  }
  dustGeo.attributes.position.needsUpdate = true;
  dustMat.color.lerpColors(new THREE.Color(0xffcf9a), new THREE.Color(0x9fe8c0), state.night);
  dustMat.opacity = lerp(0.36, 0.26, state.night);
}

function updateCamera(dt) {
  if (camTween) {
    camTween.t += dt / camTween.dur;
    const t = clamp(camTween.t, 0, 1);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    camera.position.lerpVectors(camTween.from, camTween.to, e);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
    if (t >= 1) {
      camTween = null;
      if (state.autoRotateWanted && elapsed > state.autoRotateAt) controls.autoRotate = true;
    }
  }
  if (!camTween && state.autoRotateWanted && !controls.autoRotate && elapsed > state.autoRotateAt) {
    controls.autoRotate = true;
  }
  controls.update();
}

function updateLighting(dt) {
  const n = state.night;

  tmpColor.copy(sunWarm).lerp(sunCool, n);
  sunLight.color.copy(tmpColor);
  sunLight.intensity = lerp(2.0, 0.75, n);
  sunLight.position.copy(sunDir).multiplyScalar(lerp(34, 26, n));

  tmpColor.copy(hemiSkyWarm).lerp(hemiSkyCool, n);
  hemi.color.copy(tmpColor);
  tmpColor.copy(hemiGroundWarm).lerp(hemiGroundCool, n);
  hemi.groundColor.copy(tmpColor);
  hemi.intensity = lerp(0.3, 0.16, n);

  fill.intensity = lerp(0.2, 0.38, n);

  tmpColor.copy(fogWarm).lerp(fogCool, n);
  scene.fog.color.copy(tmpColor);
  oceanUniforms.uFogColor.value.copy(tmpColor);

  lampBulbMat.emissiveIntensity = lerp(0.25, 2.4, n);
  beamMat.uniforms.uOpacity.value = n * 0.3;
  lanternRoom.material.emissiveIntensity = lerp(0.2, 3.0, n);
  beamPivot.rotation.y = elapsed * 0.35;
  for (const l of lamps) {
    l.light.intensity = n * 10;
    l.sprite.material.opacity = n * 0.55;
  }

  lens.material.emissiveIntensity = lerp(0.4, 2.2, n);
  headlight.intensity = n * 70;

  bloom.strength = lerp(0.22, 0.55, n);
  bloom.threshold = lerp(0.9, 0.7, n);

  skyUniforms.uNight.value = n;
  oceanUniforms.uNight.value = n;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  state.speed = damp(state.speed, state.targetSpeed, 4, dt);
  state.night = damp(state.night, state.targetNight, 2.2, dt);
  state.distance += state.speed * dt * 3.0;
  state.pedalAngle = (state.distance / 0.52) * 0.42;

  frontWheel.rotation.x = state.distance / 0.52;
  rearWheel.rotation.x = state.distance / 0.52;

  updateWorld(dt);
  updateRider(dt, elapsed);
  updateGulls(elapsed);
  updateDust(dt);
  updateLighting(dt);

  skyUniforms.uTime.value = elapsed;
  oceanUniforms.uTime.value = elapsed;

  if (state.started) {
    if (elapsed > state.nextGull) {
      sound.gull();
      state.nextGull = elapsed + rand(7, 16);
    }
    // tiny idle lean
    bike.rotation.z = Math.sin(elapsed * 0.7) * 0.004;
  }

  updateCamera(dt);
  composer.render();

  if (state.shot) {
    state.shot = false;
    try {
      const url = renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `pelican-pedal-${Date.now()}.png`;
      a.click();
      toast('截图已保存');
    } catch (err) {
      toast('截图失败');
    }
  }
}

animate();

// small debug/test hook
window.__pelican = {
  scene,
  camera,
  renderer,
  state,
  setNight: (v) => {
    state.targetNight = v;
    nightBtn.textContent = v > 0.5 ? '黄昏' : '星夜';
  },
  flyTo,
};
