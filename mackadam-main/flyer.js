// Company, Eternal: the poster on the right of the home page, as a card in 3D. It turns in once
// when the page opens (the box art is on its back), then floats and sways a little on its own and
// leans toward the pointer. A click opens the game. The arrow on its right slides it away; the tab
// at the edge of the screen brings it back. Without WebGL the flat image stands in.
import * as THREE from 'three';

const link = document.querySelector('.flyer');
const wrap = document.querySelector('.flyer-wrap');
const canvas = link && link.querySelector('.flyer-3d');
const hideBtn = document.querySelector('.flyer-hide');
const showBtn = document.querySelector('.flyer-show');

// The arrow hides the poster; the tab brings it back
function setHidden(hidden) {
    if (!wrap) return;
    wrap.classList.toggle('is-hidden', hidden);
    if (hideBtn) hideBtn.tabIndex = hidden ? -1 : 0;
    if (showBtn) showBtn.tabIndex = hidden ? 0 : -1;
    if (link) link.tabIndex = hidden ? -1 : 0;
}
if (hideBtn) hideBtn.addEventListener('click', () => { setHidden(true); if (showBtn) showBtn.focus({ preventScroll: true }); });
if (showBtn) showBtn.addEventListener('click', () => { setHidden(false); if (hideBtn) hideBtn.focus({ preventScroll: true }); });
setHidden(false);

if (link && canvas) start();

function start() {
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch (e) {
        link.classList.add('no-gl');
        return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    scene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const keyLight = new THREE.DirectionalLight(0xfff4e6, 2.2);
    keyLight.position.set(-2.5, 3, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x9fb8ff, 0.9);
    rimLight.position.set(3, -1, -2);
    scene.add(rimLight);

    // The card: 11 by 17, a little thick, plain paper on its edges
    const W = 1.1, H = 1.7, D = 0.025;
    const paper = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.9 });
    const front = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.55 });
    const back = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.7 });
    const card = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [paper, paper, paper, paper, front, back]);
    const group = new THREE.Group();
    group.add(card);
    group.visible = false;
    scene.add(group);

    // A soft shadow on the air behind it, so it reads as standing off the page
    const sc = document.createElement('canvas');
    sc.width = sc.height = 128;
    const sg = sc.getContext('2d'), gr = sg.createRadialGradient(64, 64, 8, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = gr;
    sg.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.6, H * 1.35),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shadow.position.set(0.08, -0.1, -0.45);
    shadow.visible = false;
    scene.add(shadow);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const asTexture = t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; };
    const loadImage = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });

    // The back: the box art, and what the card is for
    function backFace(art) {
        const c = document.createElement('canvas');
        c.width = 660;
        c.height = 1020;
        const g = c.getContext('2d');
        g.fillStyle = '#0d0d10';
        g.fillRect(0, 0, c.width, c.height);
        const ah = 660 * art.naturalHeight / art.naturalWidth;      // the cover at its own shape
        g.drawImage(art, 0, 490 - ah / 2, 660, ah);
        g.fillStyle = '#e9e4da';
        g.font = '700 38px Arial, Helvetica, sans-serif';
        g.textAlign = 'center';
        g.fillText('PLAY THE ALPHA DEMO', 330, 920);
        return asTexture(new THREE.CanvasTexture(c));
    }

    Promise.all([loadImage('assets/company-eternal-flyer.webp'), loadImage('demos/companyeternal.webp')])
        .then(([flyer, art]) => {
            front.map = asTexture(new THREE.Texture(flyer));
            front.map.needsUpdate = true;
            front.color.set(0xffffff);
            back.map = backFace(art);
            back.color.set(0xffffff);
            front.needsUpdate = back.needsUpdate = true;
            group.visible = shadow.visible = true;
            introAt = null;
        })
        .catch(() => link.classList.add('no-gl'));

    // The pointer: where it is over the card, from -1 to 1 each way
    let hoverWant = 0, hover = 0, tx = 0, ty = 0, px = 0, py = 0;
    link.addEventListener('pointermove', e => {
        const r = link.getBoundingClientRect();
        tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
        ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
        hoverWant = 1;
    });
    link.addEventListener('pointerleave', () => { hoverWant = 0; tx = ty = 0; });
    link.addEventListener('focus', () => { hoverWant = 1; });
    link.addEventListener('blur', () => { hoverWant = 0; });

    let lastW = 0, lastH = 0;
    function fit(r) {
        const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
        if (w === lastW && h === lastH) return;
        lastW = w;
        lastH = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // stand back far enough that the card fills most of the height
        const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        camera.position.set(0, 0, (H / 0.84) / 2 / half);
        camera.updateProjectionMatrix();
    }

    let introAt = null, then = performance.now();
    function frame(now) {
        requestAnimationFrame(frame);
        const dt = Math.min(0.05, (now - then) / 1000);
        then = now;
        const r = link.getBoundingClientRect();
        // nothing to draw while the tab is hidden or the brand block has risen away
        if (document.hidden || !group.visible || wrap.classList.contains('is-hidden') || r.bottom < 0 || r.top > window.innerHeight || r.width === 0) return;
        fit(r);
        const t = now / 1000;
        if (introAt === null) introAt = t;
        const intro = still ? 1 : Math.min(1, (t - introAt) / 1.8), ease = 1 - Math.pow(1 - intro, 3);
        hover += (hoverWant - hover) * Math.min(1, dt * 6);
        px += (tx - px) * Math.min(1, dt * 8);
        py += (ty - py) * Math.min(1, dt * 8);
        const sway = still ? 0 : 1 - hover;
        // a big poster sways less than a small card would
        group.rotation.y = -Math.PI * 2 * (1 - ease) + sway * 0.12 * Math.sin(t * 0.55) + hover * px * 0.22 + (still ? -0.12 : 0);
        group.rotation.x = sway * 0.04 * Math.sin(t * 0.8 + 1) + hover * py * 0.14 + (still ? 0.04 : 0);
        group.rotation.z = sway * 0.015 * Math.sin(t * 0.4);
        group.position.y = sway * 0.025 * Math.sin(t * 1.1);
        group.scale.setScalar(1 + hover * 0.03);
        shadow.material.opacity = 0.75 - group.position.y * 2 - hover * 0.15;
        renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
}
