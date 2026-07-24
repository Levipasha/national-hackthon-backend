const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const mongoUri = process.env.MONGODB_URI;

const VIP_EMAILS = [
  'vamshi.c2002@gmail.com',
  'vamshi.vam2002@gmail.com',
  'abbupsha61@gmail.com',
  'abbupasha61@gmail.com'
];

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('Connected to MongoDB');
    const db = mongoose.connection.db;

    for (const email of VIP_EMAILS) {
      const user = await db.collection('users').findOne({ email: new RegExp('^' + email + '$', 'i') });
      if (user) {
        console.log(`Found user ${email}:`, user._id, user.name, user.paymentStatus);
        const updateResult = await db.collection('users').updateOne(
          { _id: user._id },
          { 
            $set: { 
              paymentStatus: 'paid',
              amountPaid: 0,
              utr: 'VIP_FREE_PASS',
              paymentId: 'PAY_BYPASS_' + Date.now()
            } 
          }
        );
        console.log(`Updated user ${email} paymentStatus to 'paid':`, updateResult);

        if (user.teamId) {
          const teamUpdate = await db.collection('teams').updateOne(
            { id: user.teamId },
            { $set: { paymentStatus: 'paid' } }
          );
          console.log(`Updated team ${user.teamId} paymentStatus to 'paid':`, teamUpdate);
        }
      } else {
        console.log(`No registered user found for email ${email} yet.`);
      }
    }

    // Also check if a FREE100 coupon exists or create one
    const existingCoupon = await db.collection('coupons').findOne({ code: 'FREE100' });
    if (!existingCoupon) {
      await db.collection('coupons').insertOne({
        id: 'cpn_free100_' + Date.now(),
        code: 'FREE100',
        discountType: 'percentage',
        discountValue: 100,
        isActive: true,
        usageLimit: 100,
        usedCount: 0,
        createdAt: new Date().toISOString()
      });
      console.log('Created FREE100 100% discount coupon in DB.');
    } else {
      console.log('FREE100 coupon already exists in DB.');
    }

    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
