const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const mongoUri = process.env.MONGODB_URI;

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('Connected to MongoDB successfully.');
    const db = mongoose.connection.db;

    const txId = 'pay_THPFJbk3d2yi9Q';
    const log = await db.collection('payments').findOne({ razorpayPaymentId: txId });
    console.log('=== PAYMENT LOG DETAILS ===');
    console.log(JSON.stringify(log, null, 2));

    // Also let's check all payments in the database to see what amount is logged
    const allLogs = await db.collection('payments').find({}).toArray();
    console.log('\n=== ALL PAYMENT LOGS ===');
    console.log(JSON.stringify(allLogs, null, 2));

    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
