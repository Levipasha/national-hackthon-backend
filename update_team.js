const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/hackathon";

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('Connected to MongoDB');
    const db = mongoose.connection.db;
    const result = await db.collection('teams').updateOne(
      { id: 'cs2026-001' },
      { $set: { paidSlots: 5 } }
    );
    console.log('Update result:', result);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
