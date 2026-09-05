import * as THREE from 'three';
import { GLTFLoader } from './assets/three.js-master/examples/jsm/loaders/GLTFLoader.js';

let scene, camera, renderer;
let model = null;
let animationProgress = 0;
const animationDuration = 3.0; // 3 seconds for animation
let isAnimating = true;
let comingSoonBillboard = null;
let flashTime = 0;
let cameraZoomProgress = 0;
let isCameraZooming = false;

function addComingSoonOverlay() {
    // Screen position/size on the arcade machine
    const screenWidth = 1.05 * 0.39933478125 * 0.8; // Shrunk by 10%, 15%, 15%, 15%, 15%, 15%, 20%
    const screenHeight = 1.05 * 0.39933478125 * 0.8; // Shrunk by 10%, 15%, 15%, 15%, 15%, 15%, 20%
    const screenY = 1.22 - 1.05; // Moved down by original height (back to center)
    const screenZ = 0.36;
    const screenX = 0;

    // Create canvas for "COMING SOON" text
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // No background - transparent canvas

    // Draw "COMING SOON" text in green
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 75px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('COMING', canvas.width / 2, canvas.height / 2 - 60);
    ctx.fillText('SOON', canvas.width / 2, canvas.height / 2 + 20);

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);

    // Cut off bottom 10% of canvas
    texture.repeat.y = 0.9;
    texture.offset.y = 0.1;

    // Create billboard with canvas texture
    const billboardGeometry = new THREE.PlaneGeometry(screenWidth, screenHeight);
    const billboardMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide
    });

    comingSoonBillboard = new THREE.Mesh(billboardGeometry, billboardMaterial);
    comingSoonBillboard.position.set(screenX, screenY, screenZ + 0.01);
    model.add(comingSoonBillboard);

    console.log('COMING SOON billboard added');
}

function init() {
    // Scene
    scene = new THREE.Scene();

    // Camera - start at default position
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.y = 0;
    camera.position.z = 5;

    // Renderer
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    document.getElementById('three-container').appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight2.position.set(-5, -5, 5);
    scene.add(directionalLight2);

    // Load texture
    const textureLoader = new THREE.TextureLoader();
    const diffuseTexture = textureLoader.load('./assets/2c8fc1f6d1a8489b84ac8b1d6f0823aa__texture_diffuse.png');

    // Load GLTF model
    const loader = new GLTFLoader();
    loader.load(
        './assets/3Dmodels/27a3f298280c4f0cbb64b61d0081bddf_Textured.gltf',
        (gltf) => {
            model = gltf.scene;

            // Apply texture to all meshes in the model
            model.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshPhysicalMaterial({
                        map: diffuseTexture,
                        metalness: 0.3,
                        roughness: 0.7,
                        clearcoat: 1.0,
                        clearcoatRoughness: 0.2,
                        color: 0xff4400 // Volcanic orange-red tint
                    });
                }
            });

            // Center the model
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            model.position.x = -center.x;
            model.position.y = -center.y;
            model.position.z = -center.z;

            // Scale model to reasonable size
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 3.0 / maxDim;
            model.scale.setScalar(scale);

            // Start position (bottom of screen, off-screen)
            model.position.y = -8;
            model.position.z = 0;

            // Start rotation (upside down or sideways)
            model.rotation.x = Math.PI;
            model.rotation.y = Math.PI * 2;

            scene.add(model);
            console.log('GLTF model loaded successfully');

            // Add "COMING SOON" overlay on the arcade screen
            addComingSoonOverlay();
        },
        (xhr) => {
            console.log((xhr.loaded / xhr.total * 100) + '% loaded');
        },
        (error) => {
            console.error('Error loading GLTF model:', error);
        }
    );

    // Handle window resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}

function animate() {
    requestAnimationFrame(animate);

    if (model && isAnimating) {
        animationProgress += 0.016 / animationDuration; // ~60fps

        if (animationProgress <= 1.0) {
            // Easing function for smooth animation (ease-out)
            const easeProgress = 1 - Math.pow(1 - animationProgress, 3);

            // Animate Y position from -8 to 0 (center)
            model.position.y = -8 + (8 * easeProgress);

            // Rotate to face forward
            model.rotation.x = Math.PI - (Math.PI * easeProgress);
            model.rotation.y = Math.PI * 2 - (Math.PI * 2 * easeProgress);
        } else {
            // Animation complete - ensure final position
            model.position.y = 0;
            model.rotation.x = 0;
            model.rotation.y = 0;
            isAnimating = false;
            // Start camera zoom after model lands
            if (!isCameraZooming) {
                isCameraZooming = true;
            }
        }
    }

    // Camera zoom animation - only after model lands
    if (isCameraZooming && cameraZoomProgress < 1.0) {
        cameraZoomProgress += 0.01; // Slower zoom over ~1.6 seconds
        const easeZoom = 1 - Math.pow(1 - cameraZoomProgress, 3); // Ease-out

        // Zoom from z=5 to z=2.2, y=0 to y=0.17 (billboard position)
        camera.position.z = 5 - (2.8 * easeZoom);
        camera.position.y = 0.17 * easeZoom;
    }

    // Show and flash "COMING SOON" billboard only after animation completes
    if (comingSoonBillboard && !isAnimating) {
        flashTime += 0.05;
        const flashOpacity = (Math.sin(flashTime) + 1) / 2; // Oscillates between 0 and 1

        comingSoonBillboard.material.opacity = 0.5 + flashOpacity * 0.5; // 0.5 to 1.0
    }

    renderer.render(scene, camera);
}


init();
