document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('leadCaptureForm');
    const steps = document.querySelectorAll('.form-step');
    const nextBtns = document.querySelectorAll('.btn-next');
    const backBtns = document.querySelectorAll('.btn-back');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');
    const submitBtn = document.getElementById('submitBtn');
    const formCard = document.querySelector('.form-card');
    
    let currentStep = 1;
    const totalSteps = steps.length;

    // Initialize
    updateProgress();

    // Next Button Click
    nextBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (validateStep(currentStep)) {
                currentStep++;
                showStep(currentStep);
            }
        });
    });

    // Back Button Click
    backBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            currentStep--;
            showStep(currentStep);
        });
    });

    function showStep(step) {
        steps.forEach(s => {
            s.classList.remove('active');
            if (parseInt(s.dataset.step) === step) {
                s.classList.add('active');
            }
        });
        updateProgress();
    }

    function updateProgress() {
        const percent = ((currentStep - 1) / (totalSteps - 1)) * 100;
        // Ensure we don't go over 100% visually or under 0%
        const visualPercent = Math.min(Math.max(percent, 5), 100);
        
        progressFill.style.width = `${visualPercent}%`;
        progressText.textContent = `Step ${currentStep} of ${totalSteps}`;
    }

    function validateStep(step) {
        const currentStepEl = document.querySelector(`.form-step[data-step="${step}"]`);
        const inputs = currentStepEl.querySelectorAll('input[required], select[required], textarea[required]');
        let isValid = true;

        inputs.forEach(input => {
            if (!input.value.trim()) {
                isValid = false;
                input.style.borderColor = '#D32F2F';
                
                // Reset color on input
                input.addEventListener('input', function() {
                    this.style.borderColor = '#ddd';
                }, { once: true });
            }
        });

        if (!isValid) {
            alert('Please fill in all required fields.');
        }

        return isValid;
    }

    // Form Submission
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Show loading state
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoader = submitBtn.querySelector('.btn-loader');
        submitBtn.disabled = true;
        btnText.style.display = 'none';
        btnLoader.style.display = 'inline-block';
        
        // Gather data
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        
        // Handle Checkbox manually
        data.smsConsent = form.querySelector('#smsConsent').checked;
        
        // Add tracking info (if you have UTM params in URL)
        const urlParams = new URLSearchParams(window.location.search);
        data.tracking = {
            utm_source: urlParams.get('utm_source') || '',
            utm_medium: urlParams.get('utm_medium') || '',
            utm_campaign: urlParams.get('utm_campaign') || '',
            gclid: urlParams.get('gclid') || ''
        };

        try {
            // Backend origin comes from assets/js/config.js (localhost vs deployed API)
            const response = await fetch(HSD_CONFIG.apiUrl('/api/leads'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (result.success) {
                form.style.display = 'none';
                successMessage.style.display = 'block';
                // Scroll to top of message
                formCard.scrollIntoView({ behavior: 'smooth' });
            } else {
                throw new Error(result.message || 'Submission failed');
            }
        } catch (error) {
            console.error('Error:', error);
            form.style.display = 'none';
            errorMessage.style.display = 'block';
            document.getElementById('errorText').textContent = 'Connection error. Please ensure the server is running.';
        }
    });
});