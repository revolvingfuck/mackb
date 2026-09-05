// Modern JavaScript with performance optimizations and error handling
class PortfolioManager {
    constructor() {
        this.elements = {};
        this.isMobile = false;
        this.isInitialized = false;
        this.resizeTimeout = null;
        this.init();
    }

    init() {
        try {
            this.cacheElements();
            this.setupEventListeners();
            this.setupParallaxEffect();
            this.updateLayout();
            this.isInitialized = true;
            console.log('Portfolio initialized successfully');
        } catch (error) {
            console.error('Failed to initialize portfolio:', error);
            this.handleFallback();
        }
    }

    cacheElements() {
        const selectors = {
            video: '#bg-video',
            desktopSource: '#desktop-video',
            mobileSource: '#mobile-video',
            resumeContainer: '.resume-container',
            resumeContent: '#resume-content',
            columnLeft: '#column-left',
            columnRight: '#column-right',
            socialLinks: '.social-links',
            navigation: 'nav a',
            smoothScrollLinks: 'a[href^="#"]'
        };

        for (const [key, selector] of Object.entries(selectors)) {
            const element = document.querySelector(selector);
            if (element) {
                this.elements[key] = element;
            } else {
                console.warn(`Element not found: ${selector}`);
            }
        }
    }

    setupEventListeners() {
        // Debounced resize handler for better performance
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => {
                this.updateLayout();
            }, 250);
        });

        // Orientation change handler
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.updateLayout();
            }, 100);
        });

        // Smooth scrolling for anchor links
        if (this.elements.smoothScrollLinks) {
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', (e) => this.handleSmoothScroll(e));
            });
        }

        // Navigation link tracking
        if (this.elements.navigation) {
            document.querySelectorAll('nav a').forEach(link => {
                link.addEventListener('click', (e) => this.trackNavigation(e));
            });
        }

        // Intersection Observer for performance
        this.setupIntersectionObserver();
    }

    setupIntersectionObserver() {
        const options = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-in');
                }
            });
        }, options);

        // Observe elements for animation
        document.querySelectorAll('.animate-on-scroll').forEach(el => {
            observer.observe(el);
        });
    }

    setupParallaxEffect() {
        const parallaxLayers = document.querySelectorAll('.parallax-layer');
        
        if (parallaxLayers.length === 0) return;

        window.addEventListener('scroll', () => {
            const scrolled = window.pageYOffset;
            
            parallaxLayers.forEach(layer => {
                const speed = parseFloat(layer.getAttribute('data-speed')) || 0.5;
                const yPos = -(scrolled * speed);
                layer.style.transform = `translateY(${yPos}px)`;
            });
        });

        // Also respond to mouse movement for interactive effect
        document.addEventListener('mousemove', (e) => {
            const mouseX = e.clientX / window.innerWidth;
            const mouseY = e.clientY / window.innerHeight;
            
            parallaxLayers.forEach(layer => {
                const speed = parseFloat(layer.getAttribute('data-speed')) || 0.5;
                const xOffset = (mouseX - 0.5) * 20 * speed;
                const yOffset = (mouseY - 0.5) * 20 * speed;
                
                const currentTransform = layer.style.transform || '';
                const scrollY = currentTransform.match(/translateY\(([^)]+)\)/);
                const scrollYValue = scrollY ? scrollY[1] : '0px';
                
                layer.style.transform = `translateY(${scrollYValue}) translateX(${xOffset}px) translateY(${yOffset}px)`;
            });
        });
    }

    updateLayout() {
        const wasMobile = this.isMobile;
        this.isMobile = window.innerWidth <= 800 || window.matchMedia("(orientation: portrait)").matches;

        if (wasMobile !== this.isMobile) {
            this.handleLayoutChange();
        }
    }

    handleLayoutChange() {
        if (this.isMobile) {
            this.applyMobileLayout();
        } else {
            this.applyDesktopLayout();
        }
    }

    applyMobileLayout() {
        console.log("Applying mobile layout");
        
        if (this.elements.video && this.elements.mobileSource) {
            this.elements.video.src = this.elements.mobileSource.src;
        }

        if (this.elements.resumeContent) {
            this.elements.resumeContent.style.flexDirection = 'column';
        }

        if (this.elements.columnRight && this.elements.columnRight.parentNode) {
            this.elements.columnRight.parentNode.removeChild(this.elements.columnRight);
        }

        if (this.elements.columnLeft) {
            this.elements.columnLeft.style.width = '100%';
        }

        this.animateElements('mobile');
    }

    applyDesktopLayout() {
        console.log("Applying desktop layout");
        
        if (this.elements.video && this.elements.desktopSource) {
            this.elements.video.src = this.elements.desktopSource.src;
        }

        if (this.elements.resumeContent) {
            this.elements.resumeContent.style.flexDirection = 'row';
        }

        if (this.elements.columnRight && !this.elements.resumeContent.contains(this.elements.columnRight)) {
            this.elements.resumeContent.appendChild(this.elements.columnRight);
        }

        if (this.elements.columnLeft) {
            this.elements.columnLeft.style.width = '50%';
        }

        if (this.elements.columnRight) {
            this.elements.columnRight.style.width = '50%';
        }

        this.animateElements('desktop');
    }

    animateElements(layout) {
        const animations = {
            mobile: {
                video: 'translateY(-100vh)',
                resume: 'translateY(-100vh)',
                social: 'translateX(-100vw)'
            },
            desktop: {
                video: 'translateY(0)',
                resume: 'translateY(0)',
                social: 'translateX(0)'
            }
        };

        const anim = animations[layout];
        
        if (this.elements.video) {
            this.elements.video.style.transform = anim.video;
        }
        
        if (this.elements.resumeContainer) {
            this.elements.resumeContainer.style.transform = anim.resume;
        }
        
        if (this.elements.socialLinks) {
            this.elements.socialLinks.style.transform = anim.social;
            this.elements.socialLinks.style.transition = 'transform 0.5s ease-in-out';
        }
    }

    handleSmoothScroll(e) {
        e.preventDefault();
        const targetId = e.currentTarget.getAttribute('href');
        const target = document.querySelector(targetId);
        
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    }

    trackNavigation(e) {
        const link = e.currentTarget;
        console.log('Navigation link clicked:', link.href);
        
        // Add analytics tracking here if needed
        if (typeof gtag !== 'undefined') {
            gtag('event', 'click', {
                'event_category': 'navigation',
                'event_label': link.href
            });
        }
    }

    handleFallback() {
        // Fallback for when initialization fails
        console.log('Using fallback mode');
        
        // Simple layout without complex animations
        document.body.classList.add('fallback-mode');
        
        // Ensure basic functionality works
        if (this.elements.video) {
            this.elements.video.style.display = 'none';
        }
    }

    // Public methods for external use
    refresh() {
        this.updateLayout();
    }

    getLayoutMode() {
        return this.isMobile ? 'mobile' : 'desktop';
    }
}

// Performance optimization: Use requestIdleCallback if available
const initPortfolio = () => {
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
            window.portfolioManager = new PortfolioManager();
        });
    } else {
        // Fallback for older browsers
        setTimeout(() => {
            window.portfolioManager = new PortfolioManager();
        }, 0);
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPortfolio);
} else {
    initPortfolio();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PortfolioManager;
} 