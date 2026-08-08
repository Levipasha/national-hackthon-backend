const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const baseOpts = { strict: false };
const s = new mongoose.Schema({ id: { type: String, required: true, unique: true } }, baseOpts);
const TeamModel = mongoose.models.Team || mongoose.model('Team', s);
const ProblemModel = mongoose.models.Problem || mongoose.model('Problem', s);

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas');

  // Fetch all teams sorted by id
  const teams = await TeamModel.find({}).sort({ id: 1 }).lean();
  console.log(`Fetched ${teams.length} teams from DB.`);

  // Fetch all problems sorted by sno (numeric sort if possible, fallback to string)
  const problems = await ProblemModel.find({}).lean();
  problems.sort((a, b) => (parseInt(a.sno) || 0) - (parseInt(b.sno) || 0));
  console.log(`Fetched ${problems.length} problem statements from DB.`);

  if (teams.length === 0 || problems.length === 0) {
    console.error('No teams or problems found!');
    await mongoose.disconnect();
    return;
  }

  // Create mapping: 
  // Each problem gets assigned to a specific team.
  // 1-to-1 matching: Problem i (0..204) assigned to Team i.
  // Remaining problems (205..299) distributed round-robin among teams.
  
  // First clear all existing assignedTo arrays
  const bulkOps = [];
  const teamAssignmentSummary = {}; // teamId -> Array of problem titles/IDs

  for (let i = 0; i < problems.length; i++) {
    const prob = problems[i];
    // Determine assigned team using round-robin index: i % teams.length
    const assignedTeam = teams[i % teams.length];
    const assignedTeamId = assignedTeam.id;

    if (!teamAssignmentSummary[assignedTeamId]) {
      teamAssignmentSummary[assignedTeamId] = [];
    }
    teamAssignmentSummary[assignedTeamId].push({
      sno: prob.sno,
      probId: prob.id,
      title: prob.title
    });

    bulkOps.push({
      updateOne: {
        filter: { id: prob.id },
        update: { $set: { assignedTo: [assignedTeamId] } }
      }
    });
  }

  console.log(`Executing ${bulkOps.length} updates...`);
  await ProblemModel.bulkWrite(bulkOps);
  console.log('Successfully updated problem statement assignments in MongoDB!');

  // Verification step
  console.log('\n--- VERIFICATION SAMPLE (First 10 Teams) ---');
  teams.slice(0, 10).forEach((team, idx) => {
    const assigned = teamAssignmentSummary[team.id] || [];
    console.log(`Team [${idx + 1}] ID: ${team.id} | Name: ${team.name}`);
    assigned.forEach(p => {
      console.log(`  -> Assigned Problem #${p.sno}: ${p.title} (${p.probId})`);
    });
  });

  // Verify DB count
  const updatedProblems = await ProblemModel.find({}).lean();
  const sampleProb = updatedProblems[0];
  console.log('\nSample problem assignedTo in DB:', sampleProb.id, '->', sampleProb.assignedTo);

  await mongoose.disconnect();
  console.log('MongoDB connection closed.');
}

run().catch(console.error);
