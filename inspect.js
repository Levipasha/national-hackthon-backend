const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/hackathon";

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('Connected to MongoDB');
    // Fetch collections dynamically to bypass TypeScript schema checks
    const db = mongoose.connection.db;
    const teams = await db.collection('teams').find({}).toArray();
    console.log('All Teams:', teams);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
