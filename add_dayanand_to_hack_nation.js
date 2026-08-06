const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '.env') });

const baseOpts = { strict: false };
const UserModel = mongoose.models.User || mongoose.model('User', new mongoose.Schema({ id: { type: String } }, baseOpts));
const TeamModel = mongoose.models.Team || mongoose.model('Team', new mongoose.Schema({ id: { type: String } }, baseOpts));

async function executeAddMember() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  const teamId = 'CS2026-177';
  const memberId = 'u_4oht6f9';

  // 1. Fetch team and user
  let team = await TeamModel.findOne({ id: teamId }).lean();
  let user = await UserModel.findOne({ id: memberId }).lean();

  if (!team) {
    console.error(`Team ${teamId} not found!`);
    await mongoose.disconnect();
    return;
  }

  if (!user) {
    console.error(`User ${memberId} not found!`);
    await mongoose.disconnect();
    return;
  }

  console.log(`Found Team: ${team.name} (${team.id})`);
  console.log(`Found User: ${user.name} (${user.id})`);

  // Build updated members list
  const currentMembers = team.members || [];
  let updatedMembers = [...currentMembers];
  if (!updatedMembers.includes(memberId)) {
    updatedMembers.push(memberId);
  }

  // Update joinRequests if present
  let updatedJoinRequests = (team.joinRequests || []).map(req => {
    if (req.userId === memberId || req.email === user.email) {
      return { ...req, status: 'ACCEPTED' };
    }
    return req;
  });

  const newMemberCount = updatedMembers.length;
  const newRemainingSlots = Math.max(0, 5 - newMemberCount);
  const newAvailableSlots = Math.max(0, 5 - newMemberCount);
  const newTeamStatus = newMemberCount >= 5 ? 'CLOSED' : 'OPEN';
  const newStatus = newMemberCount >= 5 ? 'full' : 'open';

  // 2. Update Team in MongoDB
  await TeamModel.updateOne(
    { id: teamId },
    {
      $set: {
        members: updatedMembers,
        memberCount: newMemberCount,
        paidSlots: newMemberCount,
        remainingSlots: newRemainingSlots,
        availableSlots: newAvailableSlots,
        teamStatus: newTeamStatus,
        status: newStatus,
        joinRequests: updatedJoinRequests
      }
    }
  );
  console.log('Updated Team in MongoDB successfully.');

  // 3. Update User in MongoDB
  await UserModel.updateOne(
    { id: memberId },
    {
      $set: {
        registrationType: 'TEAM',
        teamId: teamId,
        teamRole: 'member',
        role: 'participant',
        tempTeamName: team.name,
        tempTeamCode: teamId
      }
    }
  );
  console.log('Updated User in MongoDB successfully.');

  // 4. Sync data/teams.json
  const teamsFilePath = path.join(__dirname, 'data/teams.json');
  if (fs.existsSync(teamsFilePath)) {
    const teams = JSON.parse(fs.readFileSync(teamsFilePath, 'utf8'));
    const tIdx = teams.findIndex(x => x.id === teamId);
    if (tIdx !== -1) {
      teams[tIdx].members = updatedMembers;
      teams[tIdx].memberCount = newMemberCount;
      teams[tIdx].paidSlots = newMemberCount;
      teams[tIdx].remainingSlots = newRemainingSlots;
      teams[tIdx].availableSlots = newAvailableSlots;
      teams[tIdx].teamStatus = newTeamStatus;
      teams[tIdx].status = newStatus;
      teams[tIdx].joinRequests = updatedJoinRequests;
    } else {
      const updatedTeamObj = await TeamModel.findOne({ id: teamId }).lean();
      teams.push(updatedTeamObj);
    }
    fs.writeFileSync(teamsFilePath, JSON.stringify(teams, null, 2), 'utf8');
    console.log('Synced data/teams.json');
  }

  // 5. Sync data/users.json
  const usersFilePath = path.join(__dirname, 'data/users.json');
  if (fs.existsSync(usersFilePath)) {
    const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
    const uIdx = users.findIndex(x => x.id === memberId || x.email === user.email);
    if (uIdx !== -1) {
      users[uIdx].registrationType = 'TEAM';
      users[uIdx].teamId = teamId;
      users[uIdx].teamRole = 'member';
      users[uIdx].role = 'participant';
      users[uIdx].tempTeamName = team.name;
      users[uIdx].tempTeamCode = teamId;
    } else {
      const updatedUserObj = await UserModel.findOne({ id: memberId }).lean();
      users.push(updatedUserObj);
    }
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8');
    console.log('Synced data/users.json');
  }

  // 6. Verify and output updated state
  const verifiedTeam = await TeamModel.findOne({ id: teamId }).lean();
  const verifiedUser = await UserModel.findOne({ id: memberId }).lean();
  const teamMembers = await UserModel.find({ id: { $in: verifiedTeam.members } }).lean();

  console.log('\n================ VERIFICATION SUMMARY ================');
  console.log('Team ID:', verifiedTeam.id);
  console.log('Team Name:', verifiedTeam.name);
  console.log('Member Count:', verifiedTeam.memberCount);
  console.log('Team Status:', verifiedTeam.teamStatus, `(${verifiedTeam.status})`);
  console.log('Remaining Slots:', verifiedTeam.remainingSlots);
  console.log('\n--- Team Members ---');
  teamMembers.forEach((m, idx) => {
    console.log(`${idx + 1}. ${m.name} (${m.email}) | Role: ${m.teamRole} | ID: ${m.id}`);
  });

  console.log('\n--- Added Member Details ---');
  console.log('Name:', verifiedUser.name);
  console.log('Email:', verifiedUser.email);
  console.log('Registration Type:', verifiedUser.registrationType);
  console.log('Team ID:', verifiedUser.teamId);
  console.log('Team Role:', verifiedUser.teamRole);

  await mongoose.disconnect();
  console.log('Done!');
}

executeAddMember().catch(err => {
  console.error('Error executing update:', err);
  process.exit(1);
});
