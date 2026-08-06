const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '.env') });

const baseOpts = { strict: false };
const UserModel = mongoose.models.User || mongoose.model('User', new mongoose.Schema({ id: { type: String } }, baseOpts));
const TeamModel = mongoose.models.Team || mongoose.model('Team', new mongoose.Schema({ id: { type: String } }, baseOpts));

async function searchAll() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const allTeams = await TeamModel.find({}).lean();
  console.log(`Total teams in Mongo: ${allTeams.length}`);

  const allUsers = await UserModel.find({}).lean();
  console.log(`Total users in Mongo: ${allUsers.length}`);

  const matchUsers = allUsers.filter(u => {
    const s = JSON.stringify(u).toLowerCase();
    return s.includes('mandalapu') || s.includes('keerthi') || s.includes('9182345394') || s.includes('arora');
  });

  console.log('\n--- MATCHED USERS ---');
  console.log(JSON.stringify(matchUsers, null, 2));

  const matchTeams = allTeams.filter(t => {
    const s = JSON.stringify(t).toLowerCase();
    return s.includes('arora') || s.includes('nexus') || s.includes('mandalapu');
  });

  console.log('\n--- MATCHED TEAMS ---');
  console.log(JSON.stringify(matchTeams, null, 2));

  await mongoose.disconnect();
}

searchAll().catch(console.error);
