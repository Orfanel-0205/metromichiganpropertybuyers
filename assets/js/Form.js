// assets/js/Form.js
// ===========================
// SELLER LEAD FORMS
// ===========================
// One script for both entry points, because they feed the same pipeline:
//
//   #quickLeadForm    - the four-field teaser on the homepage. The API requires
//                       property type, condition, reason and timeframe, so this
//                       cannot submit a valid lead on its own. It carries what
//                       the visitor typed over to the full form instead of
//                       throwing it away.
//   #leadCaptureForm  - the multi-step form on /pages/sell-your-house. This is
//                       the one that POSTs to /api/leads.
//
// The API origin comes from assets/js/config.js (HSD_CONFIG), which is the only
// place a backend URL is written down.

(function () {
    'use strict';

    // What a seller is shown when something goes wrong. Real causes go to the
    // console for us; sellers get a sentence they can act on.
    var GENERIC_ERROR = "We couldn't submit your information right now. " +
        'Please try again, or call us at (517) 500-8870.';

    var SELL_PAGE = '/pages/sell-your-house/sell';

    function byId(id) {
        return document.getElementById(id);
    }

    // ─────────────────────────────────────────────
    // HOMEPAGE QUICK FORM
    // ─────────────────────────────────────────────
    // This form had no handler at all: the script looked only for
    // #leadCaptureForm, so on the homepage it threw on a null element and every
    // submission fell through to a plain GET that discarded the lead silently.

    function initQuickForm() {
        var form = byId('quickLeadForm');
        if (!form) return;

        form.addEventListener('submit', function (event) {
            event.preventDefault();

            var data = new FormData(form);
            var params = new URLSearchParams();

            // Field names here differ from the full form's, so map them across.
            var mapping = {
                name: 'fullName',
                phone: 'phone',
                email: 'email',
                address: 'propertyAddress'
            };

            Object.keys(mapping).forEach(function (key) {
                var value = (data.get(key) || '').toString().trim();
                if (value) params.set(mapping[key], value);
            });

            // Carry any campaign parameters through so attribution survives the hop.
            var current = new URLSearchParams(window.location.search);
            ['utm_source', 'utm_medium', 'utm_campaign', 'gclid'].forEach(function (key) {
                if (current.get(key)) params.set(key, current.get(key));
            });

            window.location.href = SELL_PAGE + '?' + params.toString();
        });
    }

    // ─────────────────────────────────────────────
    // PREFILL
    // ─────────────────────────────────────────────
    // Fills the full form from query parameters so someone arriving from the
    // homepage does not retype what they just entered.

    function prefillFromQuery() {
        var params = new URLSearchParams(window.location.search);
        ['fullName', 'phone', 'email', 'propertyAddress'].forEach(function (name) {
            var value = params.get(name);
            if (!value) return;
            var field = byId(name);
            if (field && !field.value) field.value = value;
        });
    }

    // ─────────────────────────────────────────────
    // FULL MULTI-STEP FORM
    // ─────────────────────────────────────────────

    function initLeadForm() {
        var form = byId('leadCaptureForm');
        if (!form) return;

        var steps = document.querySelectorAll('.form-step');
        var nextBtns = document.querySelectorAll('.btn-next');
        var backBtns = document.querySelectorAll('.btn-back');
        var progressFill = byId('progressFill');
        var progressText = byId('progressText');
        var successMessage = byId('successMessage');
        var errorMessage = byId('errorMessage');
        var errorText = byId('errorText');
        var submitBtn = byId('submitBtn');
        var formCard = document.querySelector('.form-card');

        var currentStep = 1;
        var totalSteps = steps.length;
        var submitting = false;

        prefillFromQuery();
        updateProgress();

        nextBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (validateStep(currentStep)) {
                    currentStep++;
                    showStep(currentStep);
                }
            });
        });

        backBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                currentStep--;
                showStep(currentStep);
            });
        });

        function showStep(step) {
            steps.forEach(function (s) {
                s.classList.remove('active');
                if (parseInt(s.dataset.step, 10) === step) s.classList.add('active');
            });
            updateProgress();
        }

        function updateProgress() {
            if (!progressFill || !progressText || totalSteps < 2) return;
            var percent = ((currentStep - 1) / (totalSteps - 1)) * 100;
            progressFill.style.width = Math.min(Math.max(percent, 5), 100) + '%';
            progressText.textContent = 'Step ' + currentStep + ' of ' + totalSteps;
        }

        function validateStep(step) {
            var stepEl = document.querySelector('.form-step[data-step="' + step + '"]');
            if (!stepEl) return true;

            var inputs = stepEl.querySelectorAll('input[required], select[required], textarea[required]');
            var isValid = true;
            var firstInvalid = null;

            inputs.forEach(function (input) {
                if (!input.value.trim()) {
                    isValid = false;
                    input.style.borderColor = '#D32F2F';
                    if (!firstInvalid) firstInvalid = input;

                    input.addEventListener('input', function () {
                        this.style.borderColor = '#ddd';
                    }, { once: true });
                }
            });

            // Focusing the first empty field beats an alert box that says
            // nothing about which field is missing.
            if (firstInvalid) {
                firstInvalid.focus();
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            return isValid;
        }

        function setLoading(isLoading) {
            if (!submitBtn) return;
            var btnText = submitBtn.querySelector('.btn-text');
            var btnLoader = submitBtn.querySelector('.btn-loader');

            submitBtn.disabled = isLoading;
            if (btnText) btnText.style.display = isLoading ? 'none' : '';
            if (btnLoader) btnLoader.style.display = isLoading ? 'inline-block' : 'none';
        }

        function showError(message) {
            // The form stays on screen. It used to be hidden on failure, which
            // left the seller staring at an error with no way to retry and no
            // way back - their answers were gone.
            if (errorText) errorText.textContent = message || GENERIC_ERROR;
            if (errorMessage) errorMessage.style.display = 'block';
            if (errorMessage) errorMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        function clearError() {
            if (errorMessage) errorMessage.style.display = 'none';
        }

        form.addEventListener('submit', async function (event) {
            event.preventDefault();

            // A second click while the first request is in flight would create a
            // duplicate lead. The button is disabled too, but Enter still fires
            // submit on some browsers.
            if (submitting) return;
            submitting = true;

            clearError();
            setLoading(true);

            var formData = new FormData(form);
            var data = Object.fromEntries(formData.entries());

            // Checkboxes are absent from FormData when unticked, so read it directly.
            var consent = byId('smsConsent');
            data.smsConsent = consent ? consent.checked : false;

            var urlParams = new URLSearchParams(window.location.search);
            data.tracking = {
                utm_source: urlParams.get('utm_source') || '',
                utm_medium: urlParams.get('utm_medium') || '',
                utm_campaign: urlParams.get('utm_campaign') || '',
                gclid: urlParams.get('gclid') || '',
                referrer: document.referrer || ''
            };

            try {
                var response = await fetch(HSD_CONFIG.apiUrl('/api/leads'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                var result = {};
                try {
                    result = await response.json();
                } catch (parseError) {
                    // A gateway error page, or the API being unreachable.
                    console.error('Lead submit: response was not JSON', parseError);
                }

                if (response.ok && result.success) {
                    form.style.display = 'none';
                    if (successMessage) successMessage.style.display = 'block';
                    if (formCard) formCard.scrollIntoView({ behavior: 'smooth' });
                    return;
                }

                // A 400 means the seller can fix it, so show what is wrong.
                // Anything else is ours, and they get the generic message.
                var message = GENERIC_ERROR;
                if (response.status === 400) {
                    if (Array.isArray(result.errors) && result.errors.length) {
                        message = result.errors.map(function (e) { return e.msg; }).join(' ');
                    } else if (result.message) {
                        message = result.message;
                    }
                } else if (response.status === 429 && result.message) {
                    message = result.message;
                }

                console.error('Lead submit failed:', response.status, result);
                showError(message);
                setLoading(false);
                submitting = false;

            } catch (error) {
                // Network failure, CORS refusal, or a cold backend that timed
                // out. "TypeError: Failed to fetch" means nothing to a seller.
                console.error('Lead submit error:', error);
                showError(GENERIC_ERROR);
                setLoading(false);
                submitting = false;
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        initQuickForm();
        initLeadForm();
    });
})();
