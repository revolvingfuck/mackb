// Hide loader after content loads
window.addEventListener('load', () => {
    setTimeout(() => {
        document.getElementById('loader').classList.add('hidden');
        
        // Trigger section animations after loader disappears
        setTimeout(() => {
            document.querySelectorAll('.resume-section').forEach((section, index) => {
                setTimeout(() => {
                    section.classList.add('visible');
                }, index * 200);
            });
        }, 500);
    }, 1500);
});

// Scroll progress bar
window.addEventListener('scroll', () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrollPercent = (scrollTop / scrollHeight) * 100;
    document.querySelector('.scroll-progress-bar').style.width = scrollPercent + '%';
});

// Animate text word by word for title
function animateText(elementId, delay = 100) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const text = element.textContent;
    const words = text.split(' ');
    element.innerHTML = '';
    
    words.forEach((word, index) => {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = word + ' ';
        span.style.animationDelay = `${index * delay}ms`;
        element.appendChild(span);
    });
}

// Trigger text animations when sections become visible
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px'
};

const textObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const h2Elements = entry.target.querySelectorAll('h2');
            h2Elements.forEach(h2 => {
                h2.style.animationDelay = '0.5s';
            });
        }
    });
}, observerOptions);

// Observe all content cards
document.querySelectorAll('.content-card').forEach(card => {
    textObserver.observe(card);
});

// Mouse parallax effect
let mouseX = 0;
let mouseY = 0;
let currentX = 0;
let currentY = 0;

document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 20;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 20;
});

function animateParallax() {
    currentX += (mouseX - currentX) * 0.1;
    currentY += (mouseY - currentY) * 0.1;
    
    document.querySelector('.gradient-overlay').style.transform = 
        `translate(${currentX}px, ${currentY}px)`;
    
    requestAnimationFrame(animateParallax);
}
animateParallax();

// Add scroll-triggered animations for experience items
const experienceObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateX(0)';
        }
    });
}, {
    threshold: 0.2
});

document.querySelectorAll('.experience-item').forEach((item, index) => {
    item.style.opacity = '0';
    item.style.transform = 'translateX(-30px)';
    item.style.transition = `all 0.6s ease ${index * 0.1}s`;
    experienceObserver.observe(item);
});

// Skill tags staggered animation
const skillObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const skills = entry.target.querySelectorAll('.skill-tag');
            skills.forEach((skill, index) => {
                setTimeout(() => {
                    skill.style.opacity = '1';
                    skill.style.transform = 'scale(1)';
                }, index * 50);
            });
        }
    });
}, {
    threshold: 0.2
});

const skillsContainer = document.querySelector('.skills-container');
if (skillsContainer) {
    skillsContainer.querySelectorAll('.skill-tag').forEach(skill => {
        skill.style.opacity = '0';
        skill.style.transform = 'scale(0.8)';
        skill.style.transition = 'all 0.5s ease';
    });
    skillObserver.observe(skillsContainer);
}
