const express = require('express');
const router = express.Router();
const Testimonial = require('../models/Testimonial'); // Adjust path if needed
const nodemailer = require('nodemailer');
const { authMiddleware } = require('../middleware/Auth');

// ==========================================
// GET ALL APPROVED TESTIMONIALS (Public)
// ==========================================
router.get('/testimonials', async (req, res) => {
    try {
        const testimonials = await Testimonial.find({ isApproved: true })
            .sort({ isFeatured: -1, createdAt: -1 })
            .select('-email'); // Don't send emails to frontend
        
        res.status(200).json({
            success: true,
            count: testimonials.length,
            data: testimonials
        });
    } catch (error) {
        console.error('Error fetching testimonials:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch testimonials'
        });
    }
});

// ==========================================
// POST NEW TESTIMONIAL (Public)
// ==========================================
router.post('/testimonials', async (req, res) => {
    try {
        console.log('📝 Received testimonial submission:', req.body);

        const { name, location, message, rating, situation, email } = req.body;

        // Validate required fields
        if (!name || !location || !message || !rating) {
            console.log('❌ Validation failed: Missing required fields');
            return res.status(400).json({
                success: false,
                message: 'Please provide name, location, message, and rating'
            });
        }

        // Validate rating range
        if (rating < 1 || rating > 5) {
            console.log('❌ Validation failed: Invalid rating');
            return res.status(400).json({
                success: false,
                message: 'Rating must be between 1 and 5'
            });
        }

        // Create new testimonial
        const testimonial = new Testimonial({
            name,
            location,
            message,
            rating,
            situation: situation || '',
            email: email || '',
            isApproved: false, // Held for admin approval before it appears publicly
            isFeatured: false,
            createdAt: new Date()
        });

        await testimonial.save();

        console.log('✅ New testimonial saved (pending approval):', {
            id: testimonial._id,
            name,
            location,
            rating
        });

        // Send confirmation email if email provided
        if (email && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            try {
                await sendConfirmationEmail(email, name);
                console.log('✅ Confirmation email sent to:', email);
            } catch (emailError) {
                console.error('⚠️ Failed to send confirmation email:', emailError.message);
                // Don't fail the request if email fails
            }
        }

        // Notify admin via Socket.IO
        const io = req.app.get('socketio');
        if (io) {
            io.emit('new-testimonial', {
                name,
                location,
                rating,
                timestamp: new Date()
            });
            console.log('✅ Socket.IO notification sent');
        }

        res.status(201).json({
            success: true,
            message: 'Thank you for your review! It will be posted after verification.',
            data: {
                id: testimonial._id,
                name: testimonial.name,
                rating: testimonial.rating
            }
        });

    } catch (error) {
        console.error('❌ Error saving testimonial:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit testimonial. Please try again.',
            error: error.message
        });
    }
});

// ==========================================
// ADMIN MODERATION (Protected)
// Declared before any '/testimonials/:id' route so the literal path wins.
// ==========================================

// GET /api/testimonials/admin?status=pending|approved|all
router.get('/testimonials/admin', authMiddleware, async (req, res) => {
    try {
        const { status = 'pending' } = req.query;

        const query = {};
        if (status === 'pending') query.isApproved = false;
        else if (status === 'approved') query.isApproved = true;

        const testimonials = await Testimonial.find(query).sort({ createdAt: -1 }).limit(200);

        const [pendingCount, approvedCount] = await Promise.all([
            Testimonial.countDocuments({ isApproved: false }),
            Testimonial.countDocuments({ isApproved: true })
        ]);

        res.status(200).json({
            success: true,
            count: testimonials.length,
            counts: { pending: pendingCount, approved: approvedCount },
            data: testimonials
        });
    } catch (error) {
        console.error('Error fetching testimonials for moderation:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch testimonials' });
    }
});

// PATCH /api/testimonials/:id/approve  { approved: true|false, featured: true|false }
router.patch('/testimonials/:id/approve', authMiddleware, async (req, res) => {
    try {
        const update = {};
        if (typeof req.body.approved === 'boolean') update.isApproved = req.body.approved;
        if (typeof req.body.featured === 'boolean') update.isFeatured = req.body.featured;

        if (!Object.keys(update).length) {
            return res.status(400).json({
                success: false,
                message: 'Provide approved and/or featured as booleans'
            });
        }

        const testimonial = await Testimonial.findByIdAndUpdate(
            req.params.id,
            update,
            { new: true, runValidators: true }
        );

        if (!testimonial) {
            return res.status(404).json({ success: false, message: 'Testimonial not found' });
        }

        console.log(`Testimonial ${testimonial._id} updated by ${req.admin?.username || 'admin'}:`, update);

        res.status(200).json({ success: true, message: 'Testimonial updated', data: testimonial });
    } catch (error) {
        console.error('Error updating testimonial:', error);
        res.status(500).json({ success: false, message: 'Failed to update testimonial' });
    }
});

// DELETE /api/testimonials/:id  - reject a review outright
router.delete('/testimonials/:id', authMiddleware, async (req, res) => {
    try {
        const testimonial = await Testimonial.findByIdAndDelete(req.params.id);

        if (!testimonial) {
            return res.status(404).json({ success: false, message: 'Testimonial not found' });
        }

        console.log(`Testimonial ${req.params.id} deleted by ${req.admin?.username || 'admin'}`);

        res.status(200).json({ success: true, message: 'Testimonial deleted' });
    } catch (error) {
        console.error('Error deleting testimonial:', error);
        res.status(500).json({ success: false, message: 'Failed to delete testimonial' });
    }
});

// ==========================================
// SEND CONFIRMATION EMAIL
// ==========================================
async function sendConfirmationEmail(email, name) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log('⚠️ Email not configured, skipping confirmation email');
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    const mailOptions = {
        from: `"METRO MICHIGAN PROPERTY BUYERS" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Thank You for Your Review! - METRO MICHIGAN PROPERTY BUYERS',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #D32F2F; color: white; padding: 20px; text-align: center; }
                    .content { padding: 30px; background: #f9f9f9; }
                    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Thank You for Your Review!</h1>
                    </div>
                    <div class="content">
                        <p>Dear ${name},</p>
                        <p>Thank you for taking the time to share your experience with METRO MICHIGAN PROPERTY BUYERS!</p>
                        <p>Your review has been received and will be reviewed by our team. We typically post reviews within 24-48 hours after verification.</p>
                        <p>Your feedback helps other homeowners make informed decisions about selling their houses for cash.</p>
                        <p>If you have any questions, please don't hesitate to contact us.</p>
                        <p>Best regards,<br>The METRO MICHIGAN PROPERTY BUYERS Team</p>
                    </div>
                    <div class="footer">
                        <p>METRO MICHIGAN PROPERTY BUYERS<br>
                        Email: offer@metromichiganpropertybuyers.com<br>
                        Phone: (517) 500-8870</p>
                    </div>
                </div>
            </body>
            </html>
        `
    };

    await transporter.sendMail(mailOptions);
}

module.exports = router;