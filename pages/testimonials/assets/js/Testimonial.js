// Star Rating Functionality
document.addEventListener('DOMContentLoaded', function() {
    const stars = document.querySelectorAll('.star');
    const ratingFeedback = document.getElementById('ratingFeedback');
    let selectedRating = 0;

    // Load approved testimonials on page load
    loadApprovedTestimonials();

    // Star rating click handler
    stars.forEach((star, index) => {
        star.addEventListener('click', function() {
            selectedRating = parseInt(this.getAttribute('data-rating'));
            updateStarDisplay(selectedRating);
            updateRatingFeedback(selectedRating);
        });

        star.addEventListener('mouseenter', function() {
            const hoverRating = parseInt(this.getAttribute('data-rating'));
            updateStarDisplay(hoverRating);
        });
    });

    // Reset stars on mouse leave
    const starRating = document.getElementById('starRating');
    if (starRating) {
        starRating.addEventListener('mouseleave', function() {
            updateStarDisplay(selectedRating);
        });
    }

    function updateStarDisplay(rating) {
        stars.forEach((star, index) => {
            if (index < rating) {
                star.textContent = '★';
                star.style.color = '#FFA000';
                star.classList.add('active');
            } else {
                star.textContent = '☆';
                star.style.color = '#ddd';
                star.classList.remove('active');
            }
        });
    }

    function updateRatingFeedback(rating) {
        const feedbackText = [
            '',
            'Poor',
            'Fair', 
            'Good',
            'Very Good',
            'Excellent'
        ];
        if (ratingFeedback) {
            ratingFeedback.textContent = feedbackText[rating];
            ratingFeedback.style.color = '#666';
        }
    }

    // Character counter for review text
    const reviewText = document.getElementById('reviewText');
    const charCount = document.getElementById('charCount');

    if (reviewText && charCount) {
        reviewText.addEventListener('input', function() {
            charCount.textContent = this.value.length;
        });
    }

    // Form submission
    const reviewForm = document.getElementById('reviewForm');
    const submitBtn = document.getElementById('submitReviewBtn');

    if (reviewForm && submitBtn) {
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoader = submitBtn.querySelector('.btn-loader');
        const reviewSuccess = document.getElementById('reviewSuccess');

        reviewForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            // Validate rating
            if (selectedRating === 0) {
                if (ratingFeedback) {
                    ratingFeedback.textContent = 'Please select a rating';
                    ratingFeedback.style.color = '#D32F2F';
                }
                return;
            }

            // Get form data
            const formData = {
                name: document.getElementById('reviewName').value.trim(),
                location: document.getElementById('reviewLocation').value.trim(),
                message: document.getElementById('reviewText').value.trim(),
                rating: selectedRating,
                situation: document.getElementById('situationType').value,
                email: document.getElementById('reviewEmail').value.trim(),
                isFeatured: false
            };

            // Show loading state
            submitBtn.disabled = true;
            if (btnText) btnText.style.display = 'none';
            if (btnLoader) btnLoader.style.display = 'inline-block';

            try {
                // Submit to MongoDB via your backend API
                const response = await fetch(HSD_CONFIG.apiUrl('/api/testimonials'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(formData)
                });

                const data = await response.json();

                if (response.ok) {
                    // Show success message
                    reviewForm.style.display = 'none';
                    if (reviewSuccess) reviewSuccess.style.display = 'block';

                    // ✨ NEW: Add the testimonial to the page immediately
                    const grid = document.getElementById('testimonialsGrid');
                    const newCard = createTestimonialCard({
                        name: formData.name,
                        location: formData.location,
                        message: formData.message,
                        rating: formData.rating,
                        situation: formData.situation,
                        createdAt: new Date()
                    });
                    
                    // Add it to the top of the grid with animation
                    grid.insertBefore(newCard, grid.firstChild);

                    // Add visual highlight to show it's new
                    newCard.style.border = '2px solid #4CAF50';
                    newCard.style.boxShadow = '0 0 20px rgba(76, 175, 80, 0.3)';
                    
                    // Remove highlight after 3 seconds
                    setTimeout(() => {
                        newCard.style.border = '';
                        newCard.style.boxShadow = '';
                    }, 3000);

                    // Scroll to the new testimonial
                    setTimeout(() => {
                        newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 500);

                    // After 2 seconds, scroll to success message
                    setTimeout(() => {
                        reviewSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 2500);

                } else {
                    throw new Error(data.message || 'Submission failed');
                }
            } catch (error) {
                console.error('Error submitting review:', error);
                alert('There was an error submitting your review. Please try again later.');
                
                // Reset button state
                submitBtn.disabled = false;
                if (btnText) btnText.style.display = 'inline-block';
                if (btnLoader) btnLoader.style.display = 'none';
            }
        });
    }
});

// Load approved testimonials from the backend
async function loadApprovedTestimonials() {
    try {
        const response = await fetch(HSD_CONFIG.apiUrl('/api/testimonials'));
        
        if (!response.ok) {
            console.error('Failed to load testimonials');
            return;
        }

        const data = await response.json();
        
        if (data.success && data.data.length > 0) {
            const grid = document.getElementById('testimonialsGrid');
            
            // Add approved testimonials to the grid
            data.data.forEach(testimonial => {
                const card = createTestimonialCard(testimonial);
                grid.appendChild(card);
            });

            console.log(`✅ Loaded ${data.data.length} approved testimonials`);
        }
    } catch (error) {
        console.error('Error loading testimonials:', error);
    }
}

// Create a testimonial card element
function createTestimonialCard(testimonial) {
    const card = document.createElement('div');
    card.className = 'testimonial-card';
    card.style.animation = 'fadeIn 0.5s ease-in';
    
    // Generate star rating
    const stars = '★'.repeat(testimonial.rating) + '☆'.repeat(5 - testimonial.rating);
    
    // Format date
    const date = new Date(testimonial.createdAt);
    const formattedDate = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
    
    card.innerHTML = `
        <div class="testimonial-stars">${stars}</div>
        <p class="testimonial-text">"${testimonial.message}"</p>
        <p class="testimonial-author">— ${testimonial.name}, ${testimonial.location}</p>
        ${testimonial.situation ? `<p style="color: #999; font-size: 0.9rem; margin-top: 0.5rem;">${testimonial.situation} · ${formattedDate}</p>` : `<p style="color: #999; font-size: 0.9rem; margin-top: 0.5rem;">${formattedDate}</p>`}
    `;
    
    return card;
}

// Reset form function
function resetReviewForm() {
    const reviewForm = document.getElementById('reviewForm');
    const reviewSuccess = document.getElementById('reviewSuccess');
    
    if (reviewForm) {
        reviewForm.reset();
        reviewForm.style.display = 'block';
    }
    
    if (reviewSuccess) {
        reviewSuccess.style.display = 'none';
    }
    
    // Reset stars
    const stars = document.querySelectorAll('.star');
    stars.forEach(star => {
        star.textContent = '☆';
        star.style.color = '#ddd';
        star.classList.remove('active');
    });
    
    // Reset rating feedback
    const ratingFeedback = document.getElementById('ratingFeedback');
    if (ratingFeedback) ratingFeedback.textContent = '';
    
    const charCount = document.getElementById('charCount');
    if (charCount) charCount.textContent = '0';
    
    // Reset button
    const submitBtn = document.getElementById('submitReviewBtn');
    if (submitBtn) {
        submitBtn.disabled = false;
        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoader = submitBtn.querySelector('.btn-loader');
        if (btnText) btnText.style.display = 'inline-block';
        if (btnLoader) btnLoader.style.display = 'none';
    }

    // Scroll back to form
    reviewForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}