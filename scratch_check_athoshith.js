const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const mongoUri = process.env.MONGODB_URI;

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('Connected to MongoDB');
    const db = mongoose.connection.db;

    const targetEmail = 'athoshith1@gmail.com';
    const users = await db.collection('users').find({ email: new RegExp('^' + targetEmail + '$', 'i') }).toArray();
    console.log('Users found with email athoshith1@gmail.com:', JSON.stringify(users, null, 2));

    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
