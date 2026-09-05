import * as THREE from 'three';

// =============================================================================
// LOADING SCREEN
// =============================================================================
window.addEventListener('load', () => {
    setTimeout(() => {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.classList.add('hidden');
        }
    }, 500);
});

// =============================================================================
// THREE.JS PARTICLE SYSTEM
// =============================================================================
let scene, camera, renderer, particles;

function initThree() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);

    // When this page is injected into index.html the host already owns a
    // #three-container for its own scene, so prefer the works-specific one.
    // Standalone works.html has no such element and falls through as before.
    const container = document.getElementById('works-three-container')
        || document.getElementById('three-container');
    if (container) {
        container.appendChild(renderer.domElement);
    }

    // Create particles
    const particleCount = 100;
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 30;
        positions[i + 1] = (Math.random() - 0.5) * 30;
        positions[i + 2] = (Math.random() - 0.5) * 30;

        velocities[i] = (Math.random() - 0.5) * 0.005;
        velocities[i + 1] = (Math.random() - 0.5) * 0.005;
        velocities[i + 2] = (Math.random() - 0.5) * 0.005;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.03,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending
    });

    particles = new THREE.Points(geometry, material);
    scene.add(particles);

    camera.position.z = 5;
    particles.userData = { velocities };
}

function animate() {
    requestAnimationFrame(animate);

    if (particles) {
        const positions = particles.geometry.attributes.position.array;
        const velocities = particles.userData.velocities;

        for (let i = 0; i < positions.length; i += 3) {
            positions[i] += velocities[i];
            positions[i + 1] += velocities[i + 1];
            positions[i + 2] += velocities[i + 2];

            if (positions[i] > 15) positions[i] = -15;
            if (positions[i] < -15) positions[i] = 15;
            if (positions[i + 1] > 15) positions[i + 1] = -15;
            if (positions[i + 1] < -15) positions[i + 1] = 15;
        }

        particles.geometry.attributes.position.needsUpdate = true;
        particles.rotation.y += 0.0002;
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});

// =============================================================================
// CONTENT VIEWER FUNCTIONS
// =============================================================================
const WorksApp = {
    // Open content viewer
    openViewer(type, source, title) {
        const viewer = document.getElementById('contentViewer');
        const iframe = document.getElementById('viewerIframe');
        const viewerTitle = document.getElementById('viewerTitle');

        if (!viewer || !iframe) {
            console.error('Viewer elements not found');
            return;
        }

        // Set title
        if (viewerTitle) {
            viewerTitle.textContent = title;
        }

        // Reset iframe
        iframe.style.display = 'none';
        iframe.src = '';

        // Set content based on type
        if (type === 'video') {
            iframe.style.display = 'block';
            iframe.src = `https://www.youtube.com/embed/${source}?autoplay=1&rel=0&modestbranding=1`;
        } else if (type === 'pdf') {
            iframe.style.display = 'block';
            iframe.src = source;
        } else if (type === 'image') {
            iframe.style.display = 'block';
            iframe.src = source;
        } else if (type === 'website') {
            iframe.style.display = 'block';
            iframe.src = source;
        }

        // Show viewer and hide other elements
        viewer.classList.add('active');
        this.toggleViewingMode(true);
    },

    // Close content viewer
    closeViewer() {
        const viewer = document.getElementById('contentViewer');
        const iframe = document.getElementById('viewerIframe');

        if (!viewer || !iframe) {
            return;
        }

        // Hide viewer and show other elements
        viewer.classList.remove('active');
        this.toggleViewingMode(false);

        // Clear content after transition
        setTimeout(() => {
            iframe.src = '';
            iframe.style.display = 'none';
        }, 300);
    },

    // Toggle viewing mode for other elements
    toggleViewingMode(isViewing) {
        const elements = [
            document.querySelector('.content-select-container'),
            document.querySelector('.page-header'),
            document.querySelector('nav'),
            document.getElementById('selectedContentDisplay')
        ];

        elements.forEach(el => {
            if (el) {
                if (isViewing) {
                    el.classList.add('viewing');
                } else {
                    el.classList.remove('viewing');
                }
            }
        });
    },

    // Show a project card
    showProject(index) {
        const projectCards = document.querySelectorAll('.project-card');
        const selectedContentDisplay = document.getElementById('selectedContentDisplay');
        const dropdown = document.getElementById('dropdown');

        if (index < 0 || index >= projectCards.length) {
            return;
        }

        // Hide all cards
        projectCards.forEach(card => card.classList.remove('active'));

        // Show selected card
        projectCards[index].classList.add('active');

        // Show the display container
        if (selectedContentDisplay) {
            selectedContentDisplay.classList.add('active');
        }

        // Hide dropdown
        if (dropdown) {
            dropdown.classList.remove('active');
        }
    },

    // Initialize all event listeners
    init() {
        // Dropdown menu
        this.initDropdown();

        // Project selection from dropdown
        this.initProjectSelection();

        // View content buttons
        this.initViewButtons();

        // Viewer close button and overlay
        this.initViewerControls();

        // ESC key to close viewer
        this.initKeyboardShortcuts();

        // YouTube thumbnail fallback
        this.initYouTubeFallback();
    },

    // Initialize dropdown
    initDropdown() {
        const dropdown = document.getElementById('dropdown');
        const dropdownButton = document.getElementById('dropdownButton');

        if (!dropdown || !dropdownButton) {
            return;
        }

        // Toggle dropdown on button click
        dropdownButton.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('active');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (dropdown && !dropdown.contains(e.target)) {
                dropdown.classList.remove('active');
            }
        });
    },

    // Initialize project selection from dropdown
    initProjectSelection() {
        const dropdownItems = document.querySelectorAll('.dropdown-item');

        dropdownItems.forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.getAttribute('data-index'), 10);
                if (!isNaN(index)) {
                    this.showProject(index);
                }
            });
        });
    },

    // Initialize view content buttons
    initViewButtons() {
        const projectLinks = document.querySelectorAll('.project-link');

        projectLinks.forEach((button) => {
            // Get data from data attributes
            const type = button.getAttribute('data-type');
            const source = button.getAttribute('data-source');
            const title = button.getAttribute('data-title');

            if (!type || !source || !title) {
                console.warn('Button missing data attributes:', button);
                return;
            }

            // Add click event listener
            button.addEventListener('click', (e) => {
                e.preventDefault();
                this.openViewer(type, source, title);
            });

            // Add keyboard support (Enter and Space)
            button.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.openViewer(type, source, title);
                }
            });

            // Make button focusable if not already
            if (!button.hasAttribute('tabindex')) {
                button.setAttribute('tabindex', '0');
            }
        });
    },

    // Initialize viewer controls (close button and overlay)
    initViewerControls() {
        const viewerCloseBtn = document.querySelector('.viewer-close-btn');
        const viewerOverlay = document.querySelector('.viewer-overlay');

        if (viewerCloseBtn) {
            viewerCloseBtn.addEventListener('click', () => {
                this.closeViewer();
            });
        }

        if (viewerOverlay) {
            viewerOverlay.addEventListener('click', () => {
                this.closeViewer();
            });
        }
    },

    // Initialize keyboard shortcuts
    initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const viewer = document.getElementById('contentViewer');
                if (viewer && viewer.classList.contains('active')) {
                    this.closeViewer();
                }
            }
        });
    },

    // Initialize YouTube thumbnail fallback
    initYouTubeFallback() {
        const youtubeImages = document.querySelectorAll('.project-thumbnail img[src*="youtube"]');

        youtubeImages.forEach((img) => {
            img.addEventListener('error', function() {
                if (!this.src.includes('hqdefault.jpg')) {
                    const match = this.src.match(/\/vi\/([^\/]+)\//);
                    if (match && match[1]) {
                        const videoId = match[1];
                        this.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                    }
                }
            });
        });
    }
};

// =============================================================================
// INITIALIZE EVERYTHING WHEN DOM IS READY
// =============================================================================
function initialize() {
    initThree();
    animate();
    WorksApp.init();
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
