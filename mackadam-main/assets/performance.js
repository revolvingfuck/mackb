// Performance Optimization and Monitoring Script
class PerformanceMonitor {
    constructor() {
        this.metrics = {};
        this.observers = {};
        this.init();
    }

    init() {
        this.setupPerformanceObserver();
        this.setupResourceTiming();
        this.setupUserTiming();
        this.setupErrorTracking();
        this.setupServiceWorker();
        this.optimizeImages();
        this.setupLazyLoading();
    }

    setupPerformanceObserver() {
        // Observe navigation timing
        if ('PerformanceObserver' in window) {
            try {
                const navigationObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.recordMetric('navigation', entry);
                    }
                });
                navigationObserver.observe({ entryTypes: ['navigation'] });

                // Observe paint timing
                const paintObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.recordMetric('paint', entry);
                    }
                });
                paintObserver.observe({ entryTypes: ['paint'] });

                // Observe layout shifts
                const layoutObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.recordMetric('layout-shift', entry);
                    }
                });
                layoutObserver.observe({ entryTypes: ['layout-shift'] });

                // Observe largest contentful paint
                const lcpObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.recordMetric('lcp', entry);
                    }
                });
                lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });

                // Observe first input delay
                const fidObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.recordMetric('fid', entry);
                    }
                });
                fidObserver.observe({ entryTypes: ['first-input'] });

                this.observers = {
                    navigation: navigationObserver,
                    paint: paintObserver,
                    layoutShift: layoutObserver,
                    lcp: lcpObserver,
                    fid: fidObserver
                };
            } catch (error) {
                console.warn('PerformanceObserver not supported:', error);
            }
        }
    }

    setupResourceTiming() {
        // Monitor resource loading performance
        if ('performance' in window && 'getEntriesByType' in performance) {
            const resources = performance.getEntriesByType('resource');
            resources.forEach(resource => {
                this.recordMetric('resource', resource);
            });

            // Monitor new resources
            const resourceObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.recordMetric('resource', entry);
                }
            });
            resourceObserver.observe({ entryTypes: ['resource'] });
        }
    }

    setupUserTiming() {
        // Custom performance marks
        performance.mark('app-init-start');
        
        // Mark when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                performance.mark('dom-ready');
                performance.measure('dom-loading', 'app-init-start', 'dom-ready');
            });
        } else {
            performance.mark('dom-ready');
            performance.measure('dom-loading', 'app-init-start', 'dom-ready');
        }

        // Mark when page is fully loaded
        window.addEventListener('load', () => {
            performance.mark('page-loaded');
            performance.measure('page-loading', 'app-init-start', 'page-loaded');
            this.reportMetrics();
        });
    }

    setupErrorTracking() {
        // Track JavaScript errors
        window.addEventListener('error', (event) => {
            this.recordError('js-error', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error?.stack
            });
        });

        // Track unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.recordError('promise-rejection', {
                reason: event.reason,
                promise: event.promise
            });
        });

        // Track resource loading errors
        window.addEventListener('error', (event) => {
            if (event.target !== window) {
                this.recordError('resource-error', {
                    src: event.target.src || event.target.href,
                    tagName: event.target.tagName
                });
            }
        }, true);
    }

    setupServiceWorker() {
        // Register service worker for caching and offline support
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    console.log('Service Worker registered:', registration);
                    
                    // Check for updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                this.showUpdateNotification();
                            }
                        });
                    });
                })
                .catch(error => {
                    console.error('Service Worker registration failed:', error);
                });
        }
    }

    optimizeImages() {
        // Lazy load images
        const images = document.querySelectorAll('img[data-src]');
        const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.classList.remove('lazy');
                    imageObserver.unobserve(img);
                }
            });
        });

        images.forEach(img => imageObserver.observe(img));

        // Optimize video loading
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            video.preload = 'metadata';
            video.addEventListener('loadedmetadata', () => {
                video.classList.add('loaded');
            });
        });
    }

    setupLazyLoading() {
        // Lazy load components
        const lazyComponents = document.querySelectorAll('[data-lazy]');
        const componentObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadComponent(entry.target);
                    componentObserver.unobserve(entry.target);
                }
            });
        });

        lazyComponents.forEach(component => componentObserver.observe(component));
    }

    loadComponent(element) {
        const componentType = element.dataset.lazy;
        switch (componentType) {
            case 'threejs':
                this.loadThreeJSComponent(element);
                break;
            case 'video':
                this.loadVideoComponent(element);
                break;
            default:
                console.warn('Unknown lazy component type:', componentType);
        }
    }

    loadThreeJSComponent(element) {
        // Load Three.js component when needed
        if (typeof THREE === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
            script.onload = () => {
                this.initializeThreeJS(element);
            };
            document.head.appendChild(script);
        } else {
            this.initializeThreeJS(element);
        }
    }

    loadVideoComponent(element) {
        // Load video component when needed
        const video = element.querySelector('video');
        if (video) {
            video.load();
            video.play().catch(error => {
                console.warn('Video autoplay failed:', error);
            });
        }
    }

    initializeThreeJS(element) {
        // Initialize Three.js scene
        console.log('Initializing Three.js component');
        // Add your Three.js initialization code here
    }

    recordMetric(type, entry) {
        if (!this.metrics[type]) {
            this.metrics[type] = [];
        }
        this.metrics[type].push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
            timestamp: Date.now()
        });
    }

    recordError(type, error) {
        if (!this.metrics.errors) {
            this.metrics.errors = [];
        }
        this.metrics.errors.push({
            type,
            error,
            timestamp: Date.now()
        });
    }

    reportMetrics() {
        // Calculate and report performance metrics
        const navigation = performance.getEntriesByType('navigation')[0];
        const paint = performance.getEntriesByType('paint');
        
        const metrics = {
            // Core Web Vitals
            lcp: this.getLCP(),
            fid: this.getFID(),
            cls: this.getCLS(),
            
            // Navigation timing
            dns: navigation?.domainLookupEnd - navigation?.domainLookupStart,
            tcp: navigation?.connectEnd - navigation?.connectStart,
            ttfb: navigation?.responseStart - navigation?.requestStart,
            domContentLoaded: navigation?.domContentLoadedEventEnd - navigation?.domContentLoadedEventStart,
            loadComplete: navigation?.loadEventEnd - navigation?.loadEventStart,
            
            // Paint timing
            fcp: paint.find(p => p.name === 'first-contentful-paint')?.startTime,
            lcp: paint.find(p => p.name === 'largest-contentful-paint')?.startTime,
            
            // Custom metrics
            domReady: performance.getEntriesByName('dom-loading')[0]?.duration,
            pageLoad: performance.getEntriesByName('page-loading')[0]?.duration
        };

        console.log('Performance Metrics:', metrics);
        
        // Send metrics to analytics (if configured)
        if (typeof gtag !== 'undefined') {
            gtag('event', 'performance', {
                event_category: 'performance',
                event_label: 'page_load',
                value: Math.round(metrics.loadComplete),
                custom_map: {
                    'lcp': metrics.lcp,
                    'fid': metrics.fid,
                    'cls': metrics.cls
                }
            });
        }

        return metrics;
    }

    getLCP() {
        const entries = performance.getEntriesByType('largest-contentful-paint');
        return entries.length > 0 ? entries[entries.length - 1].startTime : 0;
    }

    getFID() {
        const entries = performance.getEntriesByType('first-input');
        return entries.length > 0 ? entries[0].processingStart - entries[0].startTime : 0;
    }

    getCLS() {
        let cls = 0;
        const entries = performance.getEntriesByType('layout-shift');
        entries.forEach(entry => {
            if (!entry.hadRecentInput) {
                cls += entry.value;
            }
        });
        return cls;
    }

    showUpdateNotification() {
        // Show update notification to user
        const notification = document.createElement('div');
        notification.className = 'update-notification';
        notification.innerHTML = `
            <p>New version available!</p>
            <button onclick="location.reload()">Update Now</button>
            <button onclick="this.parentElement.remove()">Later</button>
        `;
        document.body.appendChild(notification);
    }

    // Public methods
    getMetrics() {
        return this.metrics;
    }

    clearMetrics() {
        this.metrics = {};
    }

    disconnect() {
        Object.values(this.observers).forEach(observer => {
            if (observer && typeof observer.disconnect === 'function') {
                observer.disconnect();
            }
        });
    }
}

// Initialize performance monitor
window.performanceMonitor = new PerformanceMonitor();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PerformanceMonitor;
}




