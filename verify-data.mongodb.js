// MongoDB Playground
// Use this to verify your data is being saved correctly

// 1. Select the database (matches the one in your logs)
use('uscashbuyers');

// 2. View Admin Users (To verify your login credentials exist)
console.log("--- 👤 ADMIN USERS ---");
const admins = db.getCollection('admins').find({}, { 
    username: 1, 
    email: 1, 
    role: 1, 
    lastLogin: 1 
}).toArray();
console.log(admins);

// 3. View Leads/Transactions (To verify form submissions)
console.log("--- 🏠 LEADS (TRANSACTIONS) ---");
const leads = db.getCollection('leads').find({}).sort({ submittedAt: -1 }).toArray();

if (leads.length === 0) {
    console.log("No leads found yet. Go to http://localhost:5000/pages/sell-your-house/sell.html to submit one.");
} else {
    console.log(leads);
}