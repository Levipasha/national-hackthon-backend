const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const mongoUri = process.env.MONGODB_URI;

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('Connected to MongoDB successfully.');
    const db = mongoose.connection.db;

    const teamId = 'CS2026-405';
    const team = await db.collection('teams').findOne({ id: teamId });
    console.log('=== TEAM ===');
    console.log(JSON.stringify(team, null, 2));

    console.log('\n=== USERS IN TEAM ===');
    const users = await db.collection('users').find({ teamId: teamId }).toArray();
    for (const u of users) {
      console.log(`User: ${u.email} (${u.name})`);
      console.log(`  paymentId: "${u.paymentId}"`);
      console.log(`  amountPaid: ${u.amountPaid}`);
      console.log(`  paymentStatus: "${u.paymentStatus}"`);
    }

    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
