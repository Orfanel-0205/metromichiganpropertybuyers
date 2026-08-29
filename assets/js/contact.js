// ===========================
// CONTACT FORM - METRO MICHIGAN PROPERTY BUYERS
// ===========================
// Posts to POST /api/contact, which emails the message to ADMIN_EMAIL.
// Client-side checks mirror the server's express-validator rules; the server
// is still the authority.

(function () {
    'use strict';

    var form = document.getElementById('contactForm');
    if (!form) return;

    var statusEl = document.getElementById('formStatus');
    var submitBtn = document.getElementById('contactSubmit');

    var FIELDS = ['name', 'email', 'phone', 'message'];

    function setStatus(kind, text) {
        statusEl.className = 'form-status ' + kind;
        statusEl.textContent = text;
        statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function clearStatus() {
        statusEl.className = 'form-status';
        statusEl.textContent = '';
    }

    function setFieldError(field, message) {
        var row = document.getElementById('row-' + field);
        var err = document.getElementById('err-' + field);
        if (!row || !err) return;
        if (message) {
            row.classList.add('has-error');
            err.textContent = message;
        } else {
            row.classList.remove('has-error');
            err.textContent = '';
        }
    }

    function clearAllErrors() {
        FIELDS.forEach(function (f) { setFieldError(f, ''); });
    }

    // Mirrors the server rules so people get feedback before a round trip.
    function validate(values) {
        var errors = {};

        if (!values.name || values.name.length < 2) {
            errors.name = 'Please enter your name (at least 2 characters).';
        } else if (values.name.length > 100) {
            errors.name = 'Name must be 100 characters or fewer.';
        }

        if (!values.email) {
            errors.email = 'Please enter your email address.';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) {
            errors.email = 'Please enter a valid email address.';
        }

        if (values.phone) {
            var digits = values.phone.replace(/\D/g, '');
            if (digits.length < 10 || digits.length > 15) {
                errors.phone = 'Enter a valid phone number, or leave it blank.';
            }
        }

        if (!values.message || values.message.length < 10) {
            errors.message = 'Please tell us a little more (at least 10 characters).';
        } else if (values.message.length > 2000) {
            errors.message = 'Message must be 2000 characters or fewer.';
        }

        return errors;
    }

    // Clear a field's error as soon as the visitor starts fixing it.
    FIELDS.forEach(function (f) {
        var input = form.querySelector('[name="' + f + '"]');
        if (input) {
            input.addEventListener('input', function () { setFieldError(f, ''); });
        }
    });

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        clearStatus();
        clearAllErrors();

        var values = {
            name: form.querySelector('[name="name"]').value.trim(),
            email: form.querySelector('[name="email"]').value.trim(),
            phone: form.querySelector('[name="phone"]').value.trim(),
            message: form.querySelector('[name="message"]').value.trim(),
            website: form.querySelector('[name="website"]').value
        };

        var errors = validate(values);
        var firstBad = FIELDS.find(function (f) { return errors[f]; });
        if (firstBad) {
            Object.keys(errors).forEach(function (f) { setFieldError(f, errors[f]); });
            var el = form.querySelector('[name="' + firstBad + '"]');
            if (el) el.focus();
            return;
        }

        var original = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        try {
            var endpoint = (window.HSD_CONFIG && window.HSD_CONFIG.apiUrl)
                ? window.HSD_CONFIG.apiUrl('/api/contact')
                : '/api/contact';

            var res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(values)
            });

            var data = await res.json().catch(function () { return null; });

            if (res.ok && data && data.success) {
                form.reset();
                setStatus('ok', data.message || "Thanks for reaching out! We'll get back to you within one business day.");
                return;
            }

            // Surface per-field problems the server caught.
            if (data && Array.isArray(data.errors)) {
                data.errors.forEach(function (err) {
                    if (FIELDS.indexOf(err.path) !== -1) setFieldError(err.path, err.msg);
                });
            }

            setStatus('err', (data && data.message) ||
                'We could not send your message. Please call (517) 500-8870 or email offer@metromichiganpropertybuyers.com.');

        } catch (err) {
            setStatus('err',
                'We could not reach the server. Please call (517) 500-8870 or email offer@metromichiganpropertybuyers.com.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = original;
        }
    });
})();
