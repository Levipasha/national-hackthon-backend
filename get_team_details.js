const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '.env') });

const baseOpts = { strict: false };
const UserModel = mongoose.models.User || mongoose.model('User', new mongoose.Schema({ id: { type: String } }, baseOpts));
const TeamModel = mongoose.models.Team || mongoose.model('Team', new mongoose.Schema({ id: { type: String } }, baseOpts));

async function getTeamDetails() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  const searchEmail = 'mandalapukeerthi2007@gmail.com';
  const teamNameStr = 'Arora Nexus';

  // Find team by name or leader email
  let team = await TeamModel.findOne({
    $or: [
      { name: new RegExp(`^${teamNameStr}$`, 'i') },
      { name: /arora/i }
    ]
  }).lean();

  if (!team) {
    const leaderUser = await UserModel.findOne({ email: searchEmail }).lean();
    if (leaderUser && leaderUser.teamId) {
      team = await TeamModel.findOne({ id: leaderUser.teamId }).lean();
    }
  }

  console.log('\n--- TEAM RECORD IN MONGO ---');
  console.log(JSON.stringify(team, null, 2));

  // Find all users belonging to this team or leader
  let teamUsers = [];
  if (team) {
    teamUsers = await UserModel.find({ teamId: team.id }).lean();
  } else {
    teamUsers = await UserModel.find({ email: searchEmail }).lean();
  }

  console.log('\n--- TEAM USERS IN MONGO ---');
  console.log(JSON.stringify(teamUsers, null, 2));

  // Also check local json files just in case
  const teamsFilePath = path.join(__dirname, 'data/teams.json');
  const usersFilePath = path.join(__dirname, 'data/users.json');

  if (fs.existsSync(teamsFilePath)) {
    const jsonTeams = JSON.parse(fs.readFileSync(teamsFilePath, 'utf8'));
    const jsonMatchTeam = jsonTeams.filter(t => t.name && t.name.toLowerCase().includes('arora'));
    console.log('\n--- JSON TEAMS ---');
    console.log(JSON.stringify(jsonMatchTeam, null, 2));
  }

  if (fs.existsSync(usersFilePath)) {
    const jsonUsers = JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
    const jsonMatchUsers = jsonUsers.filter(u => u.email === searchEmail || (team && u.teamId === team.id));
    console.log('\n--- JSON USERS ---');
    console.log(JSON.stringify(jsonMatchUsers, null, 2));
  }

  await mongoose.disconnect();
}

getTeamDetails().catch(err => {
  console.error(err);
  process.exit(1);
});
