// ==========================================
// 📱 CLICKSEND SMS COMPREHENSIVE TESTER
// Run this with: node test-clicksend.js
// ==========================================

require('dotenv').config();
const mongoose = require('mongoose');
const { sendSMS, sendLeadSmsConfirmation, sendAdminSmsNotification, calculateSMSPrice, getAccountBalance } = require('./utils/sms');

// Helper for delays
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fix DNS for Node 18+ environments
const dns = require('dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);

// The number to receive test messages
const TEST_TO_NUMBER = process.env.RECIPIENT_PHONE || process.env.ADMIN_PHONE;

async function runTests() {
    let exitCode = 0;
    console.log('\n🚀 Starting ClickSend SMS Tests...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`ClickSend Username: ${process.env.CLICKSEND_USERNAME || '❌ MISSING'}`);
    console.log(`ClickSend API Key: ${process.env.CLICKSEND_API_KEY ? '✅ Loaded (hidden)' : '❌ MISSING'}`);
    console.log(`Sender ID: ${process.env.CLICKSEND_FROM_NUMBER || 'MetroMich (default)'}`);
    console.log(`Test recipient: ${TEST_TO_NUMBER || '❌ MISSING (set RECIPIENT_PHONE in .env)'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check if ClickSend credentials are configured
    if (!process.env.CLICKSEND_USERNAME || !process.env.CLICKSEND_API_KEY) {
        console.error('❌ CLICKSEND_USERNAME or CLICKSEND_API_KEY missing in .env file!');
        console.error('\n💡 Add these to your .env file:');
        console.error('   CLICKSEND_USERNAME=YOUR_CLICKSEND_USERNAME');
        console.error('   CLICKSEND_API_KEY=YOUR_API_KEY_FROM_CLICKSEND_DASHBOARD');
        console.error('   CLICKSEND_FROM_NUMBER=MetroMich');
        process.exit(1);
    }

    if (!TEST_TO_NUMBER) {
        console.error('❌ RECIPIENT_PHONE or ADMIN_PHONE missing in .env file!');
        console.error('\n💡 Add one of these to your .env file to specify where to send test messages:');
        console.error('   RECIPIENT_PHONE=+1234567890');
        process.exit(1);
    }

    try {
        // Connect to MongoDB (required for some tests)
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Test 0: Check Account Balance
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🧪 Test 0: Checking ClickSend Account Balance...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const balanceResult = await getAccountBalance();
        if (balanceResult.success) {
            console.log(`✅ Account Balance: ${balanceResult.currency.currency_prefix_d}${balanceResult.balance}`);
            console.log(`   Currency: ${balanceResult.currency.currency_name_long} (${balanceResult.currency.currency_name_short})`);
            
            if (parseFloat(balanceResult.balance) < 1) {
                console.warn('⚠️  WARNING: Low balance! Add funds at https://dashboard.clicksend.com/');
            }
        } else {
            console.error('❌ Failed to get balance:', balanceResult.error);
        }
        console.log('');

        // Test 1: Calculate SMS Price
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🧪 Test 1: Calculating SMS Price...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const testMessage = 'Test message from Metro Michigan Property Buyers via ClickSend!';
        const priceResult = await calculateSMSPrice(TEST_TO_NUMBER, testMessage);
        
        if (priceResult.success) {
            console.log(`✅ Price calculated successfully!`);
            console.log(`   Cost: ${priceResult.currency.currency_prefix_d}${priceResult.price}`);
            console.log(`   Message parts: ${priceResult.data.messages[0].message_parts}`);
            console.log(`   Country: ${priceResult.data.messages[0].country}`);
        } else {
            console.error('❌ Price calculation failed:', priceResult.error);
        }
        console.log('');

        // Test 2: Send Basic SMS
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🧪 Test 2: Sending Basic SMS...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const basicResult = await sendSMS(
            TEST_TO_NUMBER,
            'Test 1 (Shared Number): This test uses a shared number for better deliverability.',
            '' // Using an empty 'from' to send from ClickSend's shared number pool
        );
        
        if (basicResult.success) {
            console.log('✅ Basic SMS sent successfully!');
            console.log(`   Message ID: ${basicResult.messageId}`);
            console.log(`   Status: ${basicResult.status}`);
            console.log(`   Cost: ${basicResult.cost}`);
            console.log(`   To: ${TEST_TO_NUMBER}`);
        } else {
            console.error('❌ Basic SMS failed:', basicResult.error);
        }
        console.log('');

        // Wait 2 seconds before next test
        console.log('⏳ Waiting 2 seconds before next test...\n');
        await delay(2000);

        // Test 3: Send Lead Confirmation SMS
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🧪 Test 3: Testing Lead Confirmation SMS...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const mockLead = {
            fullName: 'John Dela Cruz',
            phone: TEST_TO_NUMBER,
            propertyAddress: '123 Quezon Avenue, Quezon City',
            smsConsent: true
        };
        
        const leadResult = await sendLeadSmsConfirmation(mockLead);
        
        if (leadResult.success) {
            console.log('✅ Lead Confirmation SMS sent successfully!');
            console.log(`   Message ID: ${leadResult.messageId}`);
            console.log(`   Status: ${leadResult.status}`);
            console.log(`   Cost: ${leadResult.cost}`);
        } else {
            console.error('❌ Lead Confirmation SMS failed:', leadResult.error);
        }
        console.log('');

        // Wait 2 seconds before next test
        console.log('⏳ Waiting 2 seconds before next test...\n');
        await delay(2000);

        // Test 4: Send Admin Notification SMS
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🧪 Test 4: Testing Admin Notification SMS...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const adminResult = await sendAdminSmsNotification(mockLead);
        
        if (adminResult.success) {
            console.log('✅ Admin Notification SMS sent successfully!');
            console.log(`   Message ID: ${adminResult.messageId}`);
            console.log(`   Status: ${adminResult.status}`);
            console.log(`   Cost: ${adminResult.cost}`);
        } else {
            console.error('❌ Admin Notification SMS failed:', adminResult.error);
        }
        console.log('');

        // Test 5: Long Message Test
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🧪 Test 5: Testing Long Message (Multi-part)...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const longMessage = `This is a longer test message from Metro Michigan Property Buyers. We want to see how ClickSend handles messages that are longer than 160 characters. This message should be split into multiple SMS parts. ClickSend automatically handles this for us, and we'll see the cost reflect the number of parts. This is important for understanding pricing!`;
        
        const longPriceResult = await calculateSMSPrice(TEST_TO_NUMBER, longMessage);
        
        if (longPriceResult.success) {
            console.log(`✅ Long message analysis:`);
            console.log(`   Message length: ${longMessage.length} characters`);
            console.log(`   Message parts: ${longPriceResult.data.messages[0].message_parts}`);
            console.log(`   Estimated cost: ${longPriceResult.currency.currency_prefix_d}${longPriceResult.price}`);
            console.log(`   (Note: Each SMS part ~160 characters)`);
        } else {
            console.error('❌ Long message price check failed:', longPriceResult.error);
        }
        console.log('');

        // Final Summary
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ ALL TESTS COMPLETED!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('📱 Check your phone for test messages!');
        console.log('   You should have received 3 SMS messages:');
        console.log('   1. Basic test message');
        console.log('   2. Lead confirmation (personalized)');
        console.log('   3. Admin notification');
        console.log('');
        console.log('💡 Next Steps:');
        console.log('   1. Verify all 3 messages arrived');
        console.log('   2. Check message formatting looks good');
        console.log('   3. Test form submission on your website');
        console.log('   4. Monitor ClickSend dashboard for delivery status');
        console.log('      https://dashboard.clicksend.com/sms/history');
        console.log('');
        console.log('💰 ClickSend Pricing:');
        console.log('   - Philippines SMS: ~$0.05-0.08 per message');
        console.log('   - Multi-part messages cost more (160 chars = 1 part)');
        console.log('   - Check pricing: https://www.clicksend.com/pricing');
        console.log('');

    } catch (error) {
        console.error('\n❌ A CRITICAL ERROR OCCURRED DURING TESTS:');
        console.error(error);
        exitCode = 1;
        
        // Provide helpful advice based on common critical errors
        if (error.code === 'ENOTFOUND' && error.hostname === 'rest.clicksend.com') {
            console.error('\n💡 SOLUTION:');
            console.error('   Could not connect to the ClickSend API. Please check your internet connection.');
        } else if (error.name === 'MongooseServerSelectionError') {
            console.error('\n💡 SOLUTION:');
            console.error('   Could not connect to MongoDB. Verify your MONGODB_URI in the .env file and ensure the database is running and accessible.');
        }
    } finally {
        await mongoose.disconnect();
        console.log('👋 Disconnected from MongoDB.');
        process.exit(exitCode);
    }
}

// Run all tests
runTests();
