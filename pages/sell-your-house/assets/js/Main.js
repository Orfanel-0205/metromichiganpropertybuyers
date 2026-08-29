// ===========================
// MAIN.JS - Common Functionality frontend
// ===========================

document.addEventListener('DOMContentLoaded', function() {
    // Mobile Menu Toggle
    initMobileMenu();
    
    // Quick Form Handler (Homepage)
    initQuickForm();
    
    // Smooth Scroll for Anchor Links
    initSmoothScroll();
    
    // Analytics Helper
    initAnalytics();
});

// ===========================
// MOBILE MENU
// ===========================
function initMobileMenu() {
    const menuToggle = document.querySelector('.mobile-menu-toggle');
    const navLinks = document.querySelector('.nav-links');
    
    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', function() {
            navLinks.classList.toggle('active');
            menuToggle.classList.toggle('active');
        });
        
        // Close menu when clicking on a link
        const links = navLinks.querySelectorAll('a');
        links.forEach(link => {
            link.addEventListener('click', function() {
                navLinks.classList.remove('active');
                menuToggle.classList.remove('active');
            });
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', function(e) {
            if (!menuToggle.contains(e.target) && !navLinks.contains(e.target)) {
                navLinks.classList.remove('active');
                menuToggle.classList.remove('active');
            }
        });
    }
}

// ===========================
// QUICK FORM (Homepage)
// ===========================
function initQuickForm() {
    const quickForm = document.getElementById('quickLeadForm');
    
    if (quickForm) {
        quickForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = {
                name: quickForm.querySelector('[name="name"]').value,
                phone: quickForm.querySelector('[name="phone"]').value,
                email: quickForm.querySelector('[name="email"]').value,
                propertyAddress: quickForm.querySelector('[name="address"]').value,
                source: 'homepage_quick_form',
                tracking: getTrackingData()
            };
            
            try {
                const response = await fetch(HSD_CONFIG.apiUrl('/api/leads'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
                
                if (response.ok) {
                    // Redirect to thank you page or show success
                    window.location.href = '/pages/thank-you/thank-you';
                } else {
                    alert('There was an error submitting your information. Please try again or call us at (517) 500-8870');
                }
            } catch (error) {
                console.error('Form submission error:', error);
                alert('There was an error submitting your information. Please try again or call us at (517) 500-8870');
            }
        });
    }
}

// ===========================
// SMOOTH SCROLL
// ===========================
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            if (href !== '#') {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }
        });
    });
}

// ===========================
// TRACKING & ANALYTICS
// ===========================
function initAnalytics() {
    // Capture UTM parameters and tracking data on page load
    const urlParams = new URLSearchParams(window.location.search);
    const trackingData = {
        gclid: urlParams.get('gclid') || '',
        fbclid: urlParams.get('fbclid') || '',
        utm_source: urlParams.get('utm_source') || '',
        utm_medium: urlParams.get('utm_medium') || '',
        utm_campaign: urlParams.get('utm_campaign') || '',
        referrer: document.referrer || ''
    };
    
    // Store in sessionStorage
    sessionStorage.setItem('trackingData', JSON.stringify(trackingData));
}

function getTrackingData() {
    const stored = sessionStorage.getItem('trackingData');
    return stored ? JSON.parse(stored) : {};
}

// ===========================
// UTILITY FUNCTIONS
// ===========================

// Format phone number as user types
function formatPhoneNumber(input) {
    // Get the current cursor position
    const cursorPosition = input.selectionStart;
    const oldLength = input.value.length;
    
    // Clean and format
    const cleaned = input.value.replace(/\D/g, '');
    let formatted = '';
    
    // Only format if there are digits
    if (cleaned.length === 0) {
        input.value = '';
        return;
    }
    
    if (cleaned.length <= 3) {
        formatted = cleaned;
    } else if (cleaned.length <= 6) {
        formatted = `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    } else if (cleaned.length <= 10) {
        formatted = `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    } else {
        // Limit to 10 digits
        formatted = `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
    }
    
    input.value = formatted;
    
    // Restore cursor position (approximately)
    const newLength = formatted.length;
    const lengthDiff = newLength - oldLength;
    const newCursorPosition = cursorPosition + lengthDiff;
    
    // Only restore if position is valid
    if (newCursorPosition >= 0 && newCursorPosition <= newLength) {
        input.setSelectionRange(newCursorPosition, newCursorPosition);
    }
}

// Validate email format
function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Validate phone format
function isValidPhone(phone) {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length === 10;
}

// Export for use in other scripts
window.formatPhoneNumber = formatPhoneNumber;
window.isValidEmail = isValidEmail;
window.isValidPhone = isValidPhone;
window.getTrackingData = getTrackingData;