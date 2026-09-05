import * as THREE from 'three';
import { OrbitControls } from './assets/three.js-master/examples/jsm/controls/OrbitControls.js';

console.log('Script started');
console.log('THREE loaded:', THREE);
console.log('All loaders and controls loaded');

// Scene setup
const scene = new THREE.Scene();
scene.background = null; // transparent, so the page behind shows through
console.log('Scene created');

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true  // Enable transparency so the page shows through the scene
});

renderer.setClearColor(0x000000, 0); // Transparent background
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; // Enable shadows
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Soft shadows
const container = document.getElementById('three-container');
if (container) {
    container.appendChild(renderer.domElement);
    console.log('Renderer added to container');
} else {
    console.error('three-container not found!');
}

// Create environment map for rainbow reflections
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

// Create a gradient texture for the environment
const envScene = new THREE.Scene();
const envCamera = new THREE.PerspectiveCamera();

// Add colorful lights to create rainbow reflections
const light1 = new THREE.PointLight(0xff0000, 2, 100);
light1.position.set(10, 10, 10);
envScene.add(light1);

const light2 = new THREE.PointLight(0x00ff00, 2, 100);
light2.position.set(-10, 10, 10);
envScene.add(light2);

const light3 = new THREE.PointLight(0x0000ff, 2, 100);
light3.position.set(0, 10, -10);
envScene.add(light3);

const light4 = new THREE.PointLight(0xffff00, 2, 100);
light4.position.set(10, -10, 0);
envScene.add(light4);

const light5 = new THREE.PointLight(0xff00ff, 2, 100);
light5.position.set(-10, -10, 0);
envScene.add(light5);

const light6 = new THREE.PointLight(0x00ffff, 2, 100);
light6.position.set(0, 0, 10);
envScene.add(light6);

// Generate environment map from the colorful scene
const renderTarget = pmremGenerator.fromScene(envScene);
scene.environment = renderTarget.texture;

console.log('Rainbow environment map created');

// Lighting - Spotlight setup (from underneath and behind)
const spotlight = new THREE.SpotLight(0xffffff, 8);
spotlight.position.set(0, -10, -5);
spotlight.angle = Math.PI / 3;
spotlight.penumbra = 0.5;
spotlight.decay = 0.5;
spotlight.distance = 100;
spotlight.castShadow = true;
spotlight.shadow.mapSize.width = 2048;
spotlight.shadow.mapSize.height = 2048;
spotlight.shadow.camera.near = 0.5;
spotlight.shadow.camera.far = 500;
spotlight.target.position.set(0, 0, 3);
scene.add(spotlight);
scene.add(spotlight.target);
console.log('Spotlight added (from underneath and behind)');

// Ambient light - slightly brighter to see details
const ambientLight = new THREE.AmbientLight(0x333333, 0.8);
scene.add(ambientLight);

// Add directional light from above for shadows
const shadowLight = new THREE.DirectionalLight(0xffffff, 2);
shadowLight.position.set(0, 10, 5);
shadowLight.castShadow = true;
shadowLight.shadow.mapSize.width = 2048;
shadowLight.shadow.mapSize.height = 2048;
shadowLight.shadow.camera.left = -20;
shadowLight.shadow.camera.right = 20;
shadowLight.shadow.camera.top = 20;
shadowLight.shadow.camera.bottom = -20;
scene.add(shadowLight);

// Add horizontal floor plane to receive shadows (before the wall)
const floorGeometry = new THREE.PlaneGeometry(100, 40);
const floorMaterial = new THREE.ShadowMaterial({
    opacity: 0.8
});
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2; // Flat horizontal
floor.position.y = -6; // At the floor/wall intersection level
floor.position.z = 5;
floor.receiveShadow = true;
scene.add(floor);

// Add vertical wall plane to receive shadows (after the floor line)
const wallGeometry = new THREE.PlaneGeometry(100, 50);
const wallMaterial = new THREE.ShadowMaterial({
    opacity: 0.8
});
const wall = new THREE.Mesh(wallGeometry, wallMaterial);
wall.rotation.x = 0; // Vertical wall
wall.position.y = -6 + 25; // Position at the intersection, extending upward
wall.position.z = -15;
wall.receiveShadow = true;
scene.add(wall);
console.log('Floor and wall shadow planes added (dramatic)');

// Camera position
camera.position.set(0, 3, 10);
camera.lookAt(0, 0, 0);

// OrbitControls setup - disabled so the menu stays put
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false; // Disable orbit controls
console.log('OrbitControls added (disabled)');

// The menu, social icons and MENU button are HTML now (.brand-nav in
// index.html), which is the only way to line them up exactly under the
// mark. The billboards below are still built so every transition and
// raycast path keeps working, they are just never shown.
const HTML_NAV = true;

// Create flat billboard menu
let menuButton = null;
let menuOpen = false;
let menuItems = [];
let hoverTime = 0;

// Function to create a flat text billboard using canvas texture
function createTextBillboard(text, width, height, fontSize) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Clear canvas (transparent background)
    ctx.clearRect(0, 0, width, height);

    // Add drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;

    // Draw white text
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    // Create flat plane geometry
    const geometry = new THREE.PlaneGeometry(width / 100, height / 100);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true
    });

    const mesh = new THREE.Mesh(geometry, material);
    // No castShadow for menu items
    return mesh;
}

// Create MENU billboard
menuButton = createTextBillboard('MENU', 384, 96, 60);
menuButton.position.set(-7.5, 0.5, 3); // Moved down more and to the left
menuButton.rotation.x = -0.3; // Tilt towards viewer (parallel to floor)
if (HTML_NAV) menuButton.visible = false;
scene.add(menuButton);
console.log('MENU billboard created');

// Initial call to adjust for mobile if needed
setTimeout(() => adjustForMobile(), 100);

// Create menu item billboards (RESUME, WORKS, DEMOS)
const menuTexts = [
    { text: 'RESUME', link: 'Resume.html', yPos: 1.5, mobileYPos: 3.4 },
    { text: 'WORKS', link: 'works.html', yPos: 0, mobileYPos: 1.9 },
    { text: 'DEMOS', link: 'demos.html', yPos: -1.5, mobileYPos: 0.4 }
];

menuTexts.forEach((menuData) => {
    const billboard = createTextBillboard(menuData.text, 384, 96, 48);
    billboard.position.set(-15, menuData.yPos, 3); // Start off-screen
    billboard.rotation.x = -0.3; // Tilt towards viewer (parallel to floor)
    billboard.userData.link = menuData.link;
    billboard.userData.desktopYPos = menuData.yPos;
    billboard.userData.mobileYPos = menuData.mobileYPos;
    billboard.visible = false;

    scene.add(billboard);
    menuItems.push(billboard);
});

console.log('Menu item billboards created');

// Create social icon billboards in a single line at bottom center
let socialIcons = [];
const textureLoader = new THREE.TextureLoader();

const socialIconData = [
    { src: './assets/email-svgrepo-com.svg', link: 'mailto:n0.0ne.and.poly@gmail.com' },
    { src: './assets/instagram-svgrepo-com.svg', link: 'https://www.instagram.com/mac.b90/' },
    { src: './assets/youtube-svgrepo-com.svg', link: 'https://www.youtube.com/@no1s_channel' },
    { src: './assets/linkedin-svgrepo-com.svg', link: 'https://www.linkedin.com/in/brian-macadam-48b5ab390/' }
];

const iconSpacing = 1.3; // Space between icons (increased)
const startX = -10.5; // Even further left
const bottomY = -4.5; // Bottom of screen

socialIconData.forEach((iconData, index) => {
    textureLoader.load(iconData.src, (texture) => {
        // Create circular icon display - slightly bigger
        const geometry = new THREE.CircleGeometry(0.28, 32);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide
        });

        const iconMesh = new THREE.Mesh(geometry, material);
        const xPos = startX + (index * iconSpacing);
        iconMesh.position.set(xPos, bottomY, 3);
        iconMesh.rotation.x = -0.3; // Tilt towards viewer
        iconMesh.userData.link = iconData.link;
        iconMesh.userData.floatOffset = index * 0.5; // Stagger the float animation
        iconMesh.userData.originalY = bottomY; // Store original Y position
        // No shadow casting for social icons

        if (HTML_NAV) iconMesh.visible = false;
        scene.add(iconMesh);
        socialIcons.push(iconMesh);
    });
});

console.log('Social icons created');

// Function to go back home from Resume
function goBackHome() {
    console.log('Going back home...');

    const container = document.getElementById('resume-content-container');

    // Slide all resume sections off to the right
    const sections = container.querySelectorAll('.resume-section');
    sections.forEach((section, index) => {
        setTimeout(() => {
            section.classList.add('sliding-right');
        }, index * 50);
    });

    // Fade out container
    setTimeout(() => {
        container.classList.remove('active');
    }, 600);

    // Slide index elements back in from left
    setTimeout(() => {
        // Logo slides in - reset all animation classes first
        const logo = document.getElementById('center-logo');
        if (logo) {
            logo.classList.remove('sliding-left', 'sliding-in-left');
            logo.style.animation = 'none';
            // Force reflow
            void logo.offsetWidth;
            logo.classList.add('sliding-in-left');
            // Remove animation class after it completes
            setTimeout(() => {
                logo.classList.remove('sliding-in-left');
                logo.style.animation = '';
            }, 1000);
        }

        // Close menu and show menu button
        menuOpen = false;
        menuItems.forEach(item => {
            item.visible = false;
        });

        if (menuButton && !HTML_NAV) {
            menuButton.visible = true;
            if (menuButton.material) {
                menuButton.material.opacity = 1;
            }
            const isMobile = window.innerWidth <= 768;
            menuButton.position.x = isMobile ? 0 : -7.5;
            menuButton.position.y = isMobile ? 1.9 : 0.5;
        }

        // Show and restore social icons
        if (!HTML_NAV) socialIcons.forEach((icon, index) => {
            setTimeout(() => {
                icon.visible = true;
                if (icon.material) {
                    icon.material.opacity = 1;
                }
                adjustForMobile(); // Restore proper positions
            }, index * 50);
        });

        // Clear resume content after transition
        setTimeout(() => {
            container.innerHTML = '';

            // Remove override styles
            const overrideStyle = document.getElementById('resume-override-styles');
            if (overrideStyle) {
                overrideStyle.remove();
            }
        }, 1000);

    }, 800);
}

// Function to load Resume page with transition
async function loadResumePage() {
    console.log('Loading Resume page...');

    // Make logo slide off left
    const logo = document.getElementById('center-logo');
    if (logo) logo.classList.add('sliding-left');

    // Make menu button slide off left
    if (menuButton && menuButton.material) {
        const startOpacity = menuButton.material.opacity || 1;
        const slideDuration = 1000;
        const startTime = Date.now();
        const startX = menuButton.position.x;

        function animateMenuButtonSlide() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / slideDuration, 1);

            menuButton.position.x = startX - (20 * progress);
            menuButton.material.opacity = startOpacity * (1 - progress);

            if (progress < 1) {
                requestAnimationFrame(animateMenuButtonSlide);
            } else {
                menuButton.visible = false;
            }
        }
        animateMenuButtonSlide();
    }

    // Make menu items slide off left
    menuItems.forEach((item, index) => {
        setTimeout(() => {
            if (item.material && item.material.opacity !== undefined) {
                const startOpacity = item.material.opacity;
                const slideDuration = 1000;
                const startTime = Date.now();
                const startX = item.position.x;

                function animateSlide() {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(elapsed / slideDuration, 1);

                    item.position.x = startX - (20 * progress);
                    item.material.opacity = startOpacity * (1 - progress);

                    if (progress < 1) {
                        requestAnimationFrame(animateSlide);
                    } else {
                        item.visible = false;
                    }
                }
                animateSlide();
            }
        }, index * 100);
    });

    // Make social icons slide off left
    socialIcons.forEach((icon, index) => {
        setTimeout(() => {
            if (icon.material && icon.material.opacity !== undefined) {
                const startOpacity = icon.material.opacity;
                const slideDuration = 1000;
                const startTime = Date.now();
                const startX = icon.position.x;

                function animateSlide() {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(elapsed / slideDuration, 1);

                    icon.position.x = startX - (20 * progress);
                    icon.material.opacity = startOpacity * (1 - progress);

                    if (progress < 1) {
                        requestAnimationFrame(animateSlide);
                    } else {
                        icon.visible = false;
                    }
                }
                animateSlide();
            }
        }, index * 50);
    });

    // Fetch Resume content and inject with full styling
    try {
        console.log('Fetching Resume.html...');
        const response = await fetch('./Resume.html');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const html = await response.text();
        console.log('Resume HTML fetched successfully');

        // Parse HTML and keep all content including styles
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Get body content
        const bodyContent = doc.body.innerHTML;

        // Inject into container with all original styling
        const container = document.getElementById('resume-content-container');
        console.log('Container found:', container);

        // Clear container and load CSS
        container.innerHTML = '';

        // Load external CSS file into the document head
        let cssLoaded = false;
        const existingLink = document.querySelector('link[href="./resume.css"]');

        if (!existingLink) {
            const linkTag = document.createElement('link');
            linkTag.rel = 'stylesheet';
            linkTag.href = './resume.css';
            linkTag.onload = () => {
                cssLoaded = true;
                console.log('CSS loaded successfully');
            };
            document.head.appendChild(linkTag);
            console.log('CSS link added to head');
        } else {
            cssLoaded = true;
        }

        // Create wrapper with body content
        const wrapper = document.createElement('div');
        wrapper.innerHTML = bodyContent;

        container.appendChild(wrapper);
        console.log('Content injected into container');

        // Remove or hide the loader immediately
        const loader = container.querySelector('#loader');
        if (loader) {
            loader.remove();
            console.log('Loader removed');
        }

        // Make all resume sections visible immediately
        const sections = container.querySelectorAll('.resume-section');
        console.log('Found resume sections:', sections.length);

        sections.forEach(section => {
            section.classList.add('visible');
        });

        // Keep the page background visible through the resume
        const overrideStyle = document.createElement('style');
        overrideStyle.id = 'resume-override-styles';
        // The scroller and the video's gradient wash stay out of the way so
        // the sea shows through. .resume-container is deliberately NOT cleared
        // here any more - it is the single dark card the resume sits on, and
        // forcing it transparent was what made that card invisible.
        overrideStyle.textContent = `
            #resume-content-container {
                background: transparent !important;
            }
            #resume-content-container .gradient-overlay {
                display: none !important;
            }
        `;
        document.head.appendChild(overrideStyle);

        // Add close button to go back
        const closeButton = document.createElement('a');
        closeButton.href = '#';
        closeButton.className = 'home-link';
        closeButton.textContent = '← HOME';
        closeButton.style.position = 'fixed';
        closeButton.style.top = '30px';
        closeButton.style.right = '30px';
        closeButton.style.zIndex = '1001';
        closeButton.onclick = (e) => {
            e.preventDefault();
            goBackHome();
        };
        container.appendChild(closeButton);

        // Activate container after CSS loads and a delay
        setTimeout(() => {
            console.log('Activating container');
            container.classList.add('active');
        }, 1500);

    } catch (error) {
        console.error('Error loading Resume page:', error);
        alert('Error loading Resume: ' + error.message);
    }
}

// Demos gallery. Selecting DEMOS lifts the whole brand UI up and off screen,
// then the game covers slide in from the right. Nothing navigates away - the
// sea keeps running behind the covers the whole time.
let demosOpen = false;
let worksOpen = false;
let worksLoaded = false;

// The billboards are invisible under HTML_NAV, but they still rise so the
// three.js path behaves if that flag is ever flipped back.
function riseOffScreen(mesh, onDone) {
    if (mesh.userData.restY === undefined) mesh.userData.restY = mesh.position.y;
    const startY = mesh.position.y;
    const targetY = 12;
    let progress = 0;
    const riseInterval = setInterval(() => {
        progress += 0.02;
        mesh.position.y = startY + (targetY - startY) * progress;
        if (progress >= 1) {
            clearInterval(riseInterval);
            mesh.visible = false;
            if (onDone) onDone();
        }
    }, 16);
}

// Lift the logo, nav and social row straight up and off. Shared by DEMOS and
// WORKS - both reveal their content over the cleared page.
function riseBrandUI() {
    const logo = document.getElementById('center-logo');
    if (logo) logo.classList.add('rising-up');

    if (menuButton) riseOffScreen(menuButton);
    menuItems.forEach((item, index) => setTimeout(() => riseOffScreen(item), index * 100));
    socialIcons.forEach((icon, index) => setTimeout(() => riseOffScreen(icon), index * 50));
}

// Settle it back down from above.
function settleBrandUI() {
    // Same reset dance as goBackHome(): a `forwards` animation will not re-run
    // on an element that still carries it, so the classes come off, a reflow is
    // forced, and only then does the new class go on.
    const logo = document.getElementById('center-logo');
    if (logo) {
        logo.classList.remove('rising-up', 'settling-down');
        logo.style.animation = 'none';
        void logo.offsetWidth;
        logo.classList.add('settling-down');
        setTimeout(() => {
            logo.classList.remove('settling-down');
            logo.style.animation = '';
        }, 950);
    }

    const restore = (mesh) => {
        if (mesh.userData.restY !== undefined) mesh.position.y = mesh.userData.restY;
        if (!HTML_NAV) mesh.visible = true;
    };
    if (menuButton) restore(menuButton);
    socialIcons.forEach(restore);
    menuItems.forEach((item) => {
        if (item.userData.restY !== undefined) item.position.y = item.userData.restY;
    });
}

async function loadDemosPage() {
    console.log('Opening demos gallery...');
    demosOpen = true;
    riseBrandUI();

    // Reveal the covers before the rise finishes, so the two motions overlap
    // instead of reading as two separate beats.
    setTimeout(() => {
        const gallery = document.getElementById('demos-gallery');
        if (!gallery) return;
        gallery.classList.add('active');
        gallery.setAttribute('aria-hidden', 'false');
        const firstCard = gallery.querySelector('.demo-card');
        if (firstCard) firstCard.focus({ preventScroll: true });
    }, 700);
}

// Send the covers away and settle the brand UI back down from above.
function closeDemosGallery() {
    if (!demosOpen) return;
    console.log('Closing demos gallery...');

    const gallery = document.getElementById('demos-gallery');
    if (gallery) {
        gallery.classList.remove('active');
        gallery.setAttribute('aria-hidden', 'true');
    }

    setTimeout(() => {
        settleBrandUI();
        demosOpen = false;
        adjustForMobile();
    }, 450);
}

// --- Works ---

// works.css carries a handful of unscoped rules (`nav`, `#three-container`,
// `body`) that would otherwise reach out of the injected panel and restyle the
// home page - the brand nav would get torn out of the lockup and pinned to the
// top-left, and the site's own three.js scene would drop to 30% opacity.
// Same guard-rail idea as the resume-override-styles block in loadResumePage.
const WORKS_OVERRIDE_CSS = `
    .brand-nav {
        position: static;
        top: auto;
        left: auto;
        z-index: auto;
        transition: none;
    }
    #three-container {
        z-index: 1;
        opacity: 1;
        pointer-events: auto;
    }
    #works-three-container {
        position: fixed;
        inset: 0;
        z-index: 2;
        opacity: 0.3;
        pointer-events: none;
    }
`;

async function injectWorksPanel(container) {
    const response = await fetch('./works.html');
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching works.html`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');

    // The dead video reference (232408_medium.mp4 is not in the repo) and the
    // loading veil both go: the sea is the backdrop here, and the veil is only
    // ever lifted by a window 'load' event that fired long before this runs.
    doc.querySelectorAll('#video-background, #loading').forEach((el) => el.remove());

    // Rename so works.js targets its own particle layer instead of ours.
    const worksThree = doc.getElementById('three-container');
    if (worksThree) worksThree.id = 'works-three-container';

    container.innerHTML = '';
    container.append(...doc.body.children);

    if (!document.querySelector('link[href="./works.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = './works.css';
        document.head.appendChild(link);
        await new Promise((res) => { link.onload = res; link.onerror = res; });
    }

    if (!document.getElementById('works-override-styles')) {
        const style = document.createElement('style');
        style.id = 'works-override-styles';
        style.textContent = WORKS_OVERRIDE_CSS;
        document.head.appendChild(style);
    }

    // The injected "← Home" goes back to the page it is already on.
    const homeLink = container.querySelector('nav a');
    if (homeLink) {
        homeLink.addEventListener('click', (e) => {
            e.preventDefault();
            closeWorksPage();
        });
    }

    // Imported once; the module cache means a second visit reuses the panel
    // with its handlers already wired, which is why the DOM is never cleared.
    await import('./works.js');
}

async function loadWorksPage() {
    if (worksOpen) return;
    console.log('Opening works...');
    worksOpen = true;
    riseBrandUI();

    const container = document.getElementById('works-content-container');
    if (!container) return;

    try {
        if (!worksLoaded) {
            await injectWorksPanel(container);
            worksLoaded = true;
        }
    } catch (error) {
        console.error('Error loading works:', error);
        worksOpen = false;
        settleBrandUI();
        return;
    }

    container.classList.remove('leaving');
    container.style.animation = 'none';
    void container.offsetWidth;
    container.classList.add('active');
    container.style.animation = '';
}

function closeWorksPage() {
    if (!worksOpen) return;
    console.log('Closing works...');

    const container = document.getElementById('works-content-container');
    if (container) {
        container.classList.remove('active');
        container.classList.add('leaving');
        setTimeout(() => container.classList.remove('leaving'), 650);
    }

    setTimeout(() => {
        settleBrandUI();
        worksOpen = false;
        adjustForMobile();
    }, 300);
}

// Function to adjust positions for mobile view
function adjustForMobile() {
    // This writes position.y on every billboard, which would fight the demos
    // rise mid-flight. closeDemosGallery() calls it once on the way back.
    if (demosOpen) return;

    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // Position menu button in the middle center, raised up
        if (menuButton) {
            menuButton.position.set(0, 1.9, 3);
        }

        // Adjust menu items positions for mobile - centered
        menuItems.forEach((item) => {
            if (item.userData.mobileYPos !== undefined) {
                item.position.y = item.userData.mobileYPos;
            }
            // Center menu items horizontally
            if (item.visible) {
                item.position.x = 0;
            }
        });

        // Reposition social icons to bottom center, responsive to screen height
        const mobileIconSpacing = 1.0;
        const mobileStartX = -(socialIcons.length - 1) * mobileIconSpacing / 2;

        // Calculate responsive bottom position based on viewport height
        // Use camera FOV and position to calculate visible area at z=3
        const vFOV = camera.fov * Math.PI / 180;
        const height = 2 * Math.tan(vFOV / 2) * (camera.position.z - 3);
        const mobileBottomY = -(height / 2) + 1.2; // 1.2 units above bottom edge

        socialIcons.forEach((icon, index) => {
            const xPos = mobileStartX + (index * mobileIconSpacing);
            icon.position.x = xPos;
            icon.position.y = mobileBottomY;
            icon.userData.originalY = mobileBottomY;
        });

        console.log('Mobile layout applied');
    } else {
        // Desktop positions (restore original)
        if (menuButton) {
            menuButton.position.set(-7.5, 0.5, 3);
        }

        // Restore menu items Y positions for desktop
        menuItems.forEach((item) => {
            if (item.userData.desktopYPos !== undefined) {
                item.position.y = item.userData.desktopYPos;
            }
        });

        const desktopStartX = -10.5;
        const desktopBottomY = -4.5;

        socialIcons.forEach((icon, index) => {
            const xPos = desktopStartX + (index * 1.3);
            icon.position.x = xPos;
            icon.position.y = desktopBottomY;
            icon.userData.originalY = desktopBottomY;
        });
    }
}



// Animation loop
function animate() {
    requestAnimationFrame(animate);

    // Update controls
    controls.update();

    // Animate menu button hover - gentle floating
    if (menuButton && !menuOpen) {
        hoverTime += 0.02;
        const isMobile = window.innerWidth <= 768;
        const baseY = isMobile ? 1.9 : 0.5;
        menuButton.position.y = baseY + Math.sin(hoverTime) * 0.05;
        menuButton.rotation.z = Math.sin(hoverTime * 0.5) * 0.02;
    }

    // Animate social icons - gentle floating
    socialIcons.forEach((icon) => {
        const offset = icon.userData.floatOffset;
        const originalY = icon.userData.originalY;
        icon.position.y = originalY + Math.sin(hoverTime + offset) * 0.05;
        icon.rotation.z = Math.sin((hoverTime + offset) * 0.5) * 0.01;
    });

    renderer.render(scene, camera);
}

// Raycaster for click detection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onMenuClick(event) {
    // Calculate mouse position
    const clientX = event.clientX !== undefined ? event.clientX : (event.changedTouches ? event.changedTouches[0].clientX : 0);
    const clientY = event.clientY !== undefined ? event.clientY : (event.changedTouches ? event.changedTouches[0].clientY : 0);

    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;

    if (HTML_NAV) return;                 // the HTML nav owns navigation
    raycaster.setFromCamera(mouse, camera);

    // Check if menu button was clicked
    if (menuButton && !menuOpen) {
        const intersects = raycaster.intersectObject(menuButton, true);
        if (intersects.length > 0) {
            console.log('Menu button clicked!');
            // Slide out and open menu
            menuOpen = true;
            slideOutMenuButton();
            setTimeout(slideInMenuItems, 300);
        }
    } else if (menuOpen) {
        // Check if any menu item was clicked
        menuItems.forEach((item) => {
            const intersects = raycaster.intersectObject(item, true);
            if (intersects.length > 0) {
                console.log('Menu item clicked:', item.userData.link);

                // Special handling for Resume and Demos links
                if (item.userData.link === 'Resume.html') {
                    loadResumePage();
                } else if (item.userData.link === 'demos.html') {
                    loadDemosPage();
                } else {
                    window.location.href = item.userData.link;
                }
            }
        });
    }

    // Check if any social icon was clicked
    socialIcons.forEach((icon) => {
        const intersects = raycaster.intersectObject(icon, true);
        if (intersects.length > 0) {
            console.log('Social icon clicked:', icon.userData.link);
            if (icon.userData.link.startsWith('http') || icon.userData.link.startsWith('mailto:')) {
                window.open(icon.userData.link, '_blank');
            } else {
                window.location.href = icon.userData.link;
            }
        }
    });
}

function slideOutMenuButton() {
    const startX = menuButton.position.x;
    const targetX = -15;
    let progress = 0;

    const slideInterval = setInterval(() => {
        progress += 0.05;
        if (menuButton) {
            menuButton.position.x = startX + (targetX - startX) * easeOutCubic(progress);
        }
        if (progress >= 1) {
            clearInterval(slideInterval);
            if (menuButton) menuButton.visible = false;
        }
    }, 16);
}

function slideInMenuItems() {
    const isMobile = window.innerWidth <= 768;
    const targetX = isMobile ? 0 : -7.5;

    menuItems.forEach((item, index) => {
        setTimeout(() => {
            item.visible = true;
            const startX = item.position.x;
            let progress = 0;

            const slideInterval = setInterval(() => {
                progress += 0.05;
                item.position.x = startX + (targetX - startX) * easeOutCubic(progress);
                if (progress >= 1) {
                    clearInterval(slideInterval);
                }
            }, 16);
        }, index * 150);
    });
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// --- HTML nav ---
document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.addEventListener('click', () => {
        const nav = btn.dataset.nav;
        if (nav === 'resume') loadResumePage();
        else if (nav === 'demos') loadDemosPage();
        else loadWorksPage();
    });
});

const demosBackButton = document.querySelector('.demos-back');
if (demosBackButton) demosBackButton.addEventListener('click', closeDemosGallery);

// Add click/touch event listeners
renderer.domElement.addEventListener('click', onMenuClick);
renderer.domElement.addEventListener('touchend', onMenuClick);

// Add ESC key listener to close menu
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    if (demosOpen) {
        console.log('ESC pressed - closing demos gallery');
        closeDemosGallery();
    } else if (worksOpen) {
        // works.js owns Escape while its own content viewer is up; only take
        // over once that has been dismissed.
        const viewer = document.getElementById('contentViewer');
        if (viewer && viewer.classList.contains('active')) return;
        console.log('ESC pressed - closing works');
        closeWorksPage();
    } else if (menuOpen) {
        console.log('ESC pressed - closing menu');
        closeMenu();
    }
});

// Add swipe gesture detection for mobile menu close
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

renderer.domElement.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
});

renderer.domElement.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
});

function handleSwipe() {
    const isMobile = window.innerWidth <= 768;
    if (!menuOpen || !isMobile) return;

    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const minSwipeDistance = 50;

    // Swipe right (deltaX positive and greater than minSwipeDistance)
    if (deltaX > minSwipeDistance && Math.abs(deltaX) > Math.abs(deltaY)) {
        console.log('Swipe right detected - closing menu');
        closeMenu();
    }
    // Swipe up (deltaY negative and greater than minSwipeDistance)
    else if (deltaY < -minSwipeDistance && Math.abs(deltaY) > Math.abs(deltaX)) {
        console.log('Swipe up detected - closing menu');
        closeMenu();
    }
}

// Function to close menu and bring back menu button
function closeMenu() {
    // Slide out menu items in reverse
    menuItems.forEach((item, index) => {
        const startX = item.position.x;
        const targetX = -15;
        let progress = 0;

        const slideInterval = setInterval(() => {
            progress += 0.05;
            item.position.x = startX + (targetX - startX) * easeOutCubic(progress);
            if (progress >= 1) {
                clearInterval(slideInterval);
                item.visible = false;
            }
        }, 16);
    });

    // Slide in menu button after items are gone
    setTimeout(() => {
        if (menuButton && !HTML_NAV) {
            menuButton.visible = true;
            const isMobile = window.innerWidth <= 768;
            const startX = -15;
            const targetX = isMobile ? 0 : -7.5;
            let progress = 0;

            const slideInterval = setInterval(() => {
                progress += 0.05;
                menuButton.position.x = startX + (targetX - startX) * easeOutCubic(progress);
                if (progress >= 1) {
                    clearInterval(slideInterval);
                }
            }, 16);
        }
    }, 300);

    menuOpen = false;
}

// Start animation
animate();
console.log('Animation started');

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Adjust layout for mobile/desktop
    adjustForMobile();
});

