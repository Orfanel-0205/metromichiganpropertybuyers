require('dotenv').config();

// --- ClickSend API Configuration ---
const username = process.env.CLICKSEND_USERNAME;
const apiKey = process.env.CLICKSEND_API_KEY;

// Node 18+ provides fetch, so this legacy ClickSend integration has no hidden
// axios dependency and remains dormant when credentials are absent.
async function clicksendRequest(path, options = {}) {
    // fetch has no default timeout, so an unresponsive provider would hang
    // whatever is awaiting this call.
    const timeout = parseInt(process.env.SMS_TIMEOUT_MS, 10) || 15000;

    const response = await fetch(`https://rest.clicksend.com/v3${path}`, {
        ...options,
        signal: AbortSignal.timeout(timeout),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`,
            ...(options.headers || {})
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.response_msg || `ClickSend returned HTTP ${response.status}`);
        error.response = { status: response.status, data };
        throw error;
    }
    return { data };
}

const clicksendApi = {
    get: (path) => clicksendRequest(path),
    post: (path, payload) => clicksendRequest(path, {
        method: 'POST',
        body: JSON.stringify(payload)
    })
};

/**
 * Sends a single SMS message.
 */
async function sendSMS(to, message, from = null) {
    try {
        console.log('📱 sendSMS called with:', {
            to,
            messageLength: message?.length,
            from
        });

        if (!username || !apiKey) {
            throw new Error('ClickSend credentials are not configured in .env file.');
        }

        // Use shared number pool by default (better for trial accounts)
        const fromNumber = from || process.env.CLICKSEND_FROM_NUMBER || '';

        const payload = {
            messages: [{
                source: "cash-home-buyer",
                to: to,
                body: message,
                from: fromNumber
            }]
        };

        console.log('📤 Sending SMS payload:', JSON.stringify(payload, null, 2));

        const response = await clicksendApi.post('/sms/send', payload);
        const messageData = response.data.data.messages[0];

        // ClickSend answers HTTP 200 even when it refuses to send: the outcome is
        // in the per-message status. INSUFFICIENT_CREDIT, for one, means nothing
        // was delivered, so reporting success here would hide a dead alert path.
        const accepted = messageData.status === 'SUCCESS';

        if (!accepted) {
            console.error(`❌ SMS not delivered (${messageData.status}) to ${to}:`, {
                status: messageData.status,
                messageId: messageData.message_id,
                price: messageData.message_price
            });

            return {
                success: false,
                error: `ClickSend rejected the message: ${messageData.status}`,
                status: messageData.status,
                messageId: messageData.message_id,
                data: response.data
            };
        }

        console.log('✅ SMS sent successfully:', messageData);

        return {
            success: true,
            messageId: messageData.message_id,
            status: messageData.status,
            cost: response.data.data.total_price,
            data: response.data,
        };
    } catch (error) {
        const errorResponse = error.response?.data;

        console.error('❌ SMS Error:', {
            message: errorResponse?.response_msg || error.message,
            code: errorResponse?.response_code || error.response?.status,
            data: errorResponse
        });

        return {
            success: false,
            error: errorResponse?.response_msg || error.message,
            status: errorResponse?.response_code || error.response?.status || 500,
        };
    }
}

/**
 * Sends a confirmation SMS to a new lead.
 */
async function sendLeadSmsConfirmation(lead) {
    console.log('📱 sendLeadSmsConfirmation called for:', lead.fullName);
    console.log('   Phone:', lead.phone);
    console.log('   SMS Consent:', lead.smsConsent);

    if (!lead.smsConsent) {
        console.warn(`⚠️ SMS not sent to ${lead.fullName}: No SMS consent.`);
        return { success: false, error: 'User has not consented to SMS.' };
    }

    const firstName = lead.fullName.split(' ')[0];

    const message =
        `Hi ${firstName}, this is Metro Michigan Property Buyers. ` +
        `We've received your inquiry for ${lead.propertyAddress} ` +
        `and will be in touch shortly.`;

    console.log('📝 Message to send:', message);

    return sendSMS(lead.phone, message);
}

/**
 * Sends an SMS notification to the admin about a new lead.
 */
async function sendAdminSmsNotification(lead) {
    const adminPhone = process.env.ADMIN_PHONE;

    console.log('📱 sendAdminSmsNotification called');
    console.log('   Admin Phone:', adminPhone);

    if (!adminPhone) {
        console.error('❌ Admin SMS not sent: ADMIN_PHONE not set in .env');
        return { success: false, error: 'ADMIN_PHONE not set in .env' };
    }

    const message =
        `New Lead: ${lead.fullName}, ${lead.phone}, ` +
        `Property: ${lead.propertyAddress}.`;

    console.log('📝 Admin message:', message);

    return sendSMS(adminPhone, message);
}

/**
 * Retrieves ClickSend account balance.
 */
async function getAccountBalance() {
    try {
        if (!username || !apiKey) {
            throw new Error('ClickSend credentials are not configured in .env file.');
        }

        const response = await clicksendApi.get('/account');

        console.log('💰 Account balance retrieved:', response.data.data.balance);

        return {
            success: true,
            balance: response.data.data.balance,
            currency: response.data.data._currency,
        };
    } catch (error) {
        const errorResponse = error.response?.data;

        console.error('❌ Balance check error:', errorResponse || error.message);

        return {
            success: false,
            error: errorResponse?.response_msg || error.message,
            status: errorResponse?.response_code || error.response?.status || 500,
        };
    }
}

/**
 * Calculates SMS price before sending.
 */
async function calculateSMSPrice(to, message) {
    try {
        if (!username || !apiKey) {
            throw new Error('ClickSend credentials are not configured in .env file.');
        }

        const payload = {
            messages: [{
                to: to,
                body: message
            }]
        };

        console.log('💲 Calculating SMS price for:', to);

        const response = await clicksendApi.post('/sms/price', payload);
        const priceData = response.data.data;

        console.log('💲 Price result:', priceData);

        return {
            success: true,
            price: priceData.total_price,
            currency: priceData._currency,
            data: priceData,
        };
    } catch (error) {
        const errorResponse = error.response?.data;

        console.error('❌ SMS price error:', errorResponse || error.message);

        return {
            success: false,
            error: errorResponse?.response_msg || error.message,
            status: errorResponse?.response_code || error.response?.status || 500,
        };
    }
}

module.exports = {
    sendSMS,
    sendLeadSmsConfirmation,
    sendAdminSmsNotification,
    getAccountBalance,
    calculateSMSPrice,
};
