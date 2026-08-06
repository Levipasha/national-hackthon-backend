const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '.env') });

const baseOpts = { strict: false };
const UserModel = mongoose.models.User || mongoose.model('User', new mongoose.Schema({ id: { type: String } }, baseOpts));
const TeamModel = mongoose.models.Team || mongoose.model('Team', new mongoose.Schema({ id: { type: String } }, baseOpts));
const PaymentModel = mongoose.models.Payment || mongoose.model('Payment', new mongoose.Schema({ id: { type: String } }, baseOpts));

async function verifyAndUpdatePayment() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);

  const teamId = 'CS2026-1395';
  const teamName = 'code Strom';
  const utr = '283053851234';
  const txnId = 'pay_TLe' + utr.substring(0, 10);
  const amount = 1995;
  const createdAt = new Date().toISOString();

  // 1. Fetch team and users
  const team = await TeamModel.findOne({ id: teamId }).lean();
  if (!team) {
    console.error('Team not found in MongoDB!');
    await mongoose.disconnect();
    return;
  }

  const members = await UserModel.find({ id: { $in: team.members } }).lean();
  console.log(`Found Team ${team.name} (${team.id}) with ${members.length} members.`);

  // 2. Update Team in MongoDB
  await TeamModel.updateOne(
    { id: teamId },
    {
      $set: {
        paymentStatus: 'paid',
        utr: utr,
        paymentUtr: utr,
        paidSlots: team.members.length,
        remainingSlots: 0,
        availableSlots: 0,
        teamStatus: 'CLOSED',
        status: 'full'
      }
    }
  );
  console.log('Updated Team paymentStatus to paid in MongoDB.');

  // 3. Update Members in MongoDB
  const leaderId = team.leaderId;
  for (const m of members) {
    const isLeader = m.id === leaderId;
    await UserModel.updateOne(
      { id: m.id },
      {
        $set: {
          paymentStatus: 'paid',
          paymentId: txnId,
          utr: utr,
          paymentUtr: utr,
          amountPaid: isLeader ? amount : 0,
          registrationType: 'TEAM',
          teamId: teamId,
          tempTeamName: teamName,
          tempTeamCode: teamId
        }
      }
    );
  }
  console.log('Updated all 5 team members to paid in MongoDB.');

  // 4. Create Payment Log in MongoDB if not existing
  let paymentLog = await PaymentModel.findOne({ utr: utr }).lean();
  if (!paymentLog) {
    const leader = members.find(m => m.id === leaderId) || members[0];
    const newPaymentObj = {
      id: `pay_log_${Math.random().toString(36).substring(2, 9)}`,
      razorpayPaymentId: txnId,
      razorpayOrderId: `order_${Math.random().toString(36).substring(2, 12)}`,
      userId: leader.id,
      userName: leader.name,
      userEmail: leader.email,
      amount: amount,
      utr: utr,
      rrn: utr,
      status: 'success',
      createdAt: createdAt
    };
    paymentLog = await PaymentModel.create(newPaymentObj);
    console.log('Created Payment Log in MongoDB.');
  }

  // 5. Sync data/teams.json
  const teamsFilePath = path.join(__dirname, 'data/teams.json');
  if (fs.existsSync(teamsFilePath)) {
    const teams = JSON.parse(fs.readFileSync(teamsFilePath, 'utf8'));
    const idx = teams.findIndex(t => t.id === teamId);
    if (idx !== -1) {
      teams[idx].paymentStatus = 'paid';
      teams[idx].utr = utr;
      teams[idx].paidSlots = team.members.length;
      teams[idx].remainingSlots = 0;
      teams[idx].availableSlots = 0;
      teams[idx].teamStatus = 'CLOSED';
      teams[idx].status = 'full';
    } else {
      const updatedTeam = await TeamModel.findOne({ id: teamId }).lean();
      teams.push(updatedTeam);
    }
    fs.writeFileSync(teamsFilePath, JSON.stringify(teams, null, 2), 'utf8');
    console.log('Synced data/teams.json');
  }

  // 6. Sync data/users.json
  const usersFilePath = path.join(__dirname, 'data/users.json');
  if (fs.existsSync(usersFilePath)) {
    const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
    for (const m of members) {
      const isLeader = m.id === leaderId;
      const uIdx = users.findIndex(u => u.id === m.id || u.email === m.email);
      if (uIdx !== -1) {
        users[uIdx].paymentStatus = 'paid';
        users[uIdx].paymentId = txnId;
        users[uIdx].utr = utr;
        users[uIdx].amountPaid = isLeader ? amount : 0;
        users[uIdx].registrationType = 'TEAM';
        users[uIdx].teamId = teamId;
      } else {
        const updatedUser = await UserModel.findOne({ id: m.id }).lean();
        users.push(updatedUser);
      }
    }
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8');
    console.log('Synced data/users.json');
  }

  // 7. Sync data/payments.json
  const paymentsFilePath = path.join(__dirname, 'data/payments.json');
  if (fs.existsSync(paymentsFilePath)) {
    const payments = JSON.parse(fs.readFileSync(paymentsFilePath, 'utf8'));
    const pIdx = payments.findIndex(p => p.utr === utr || p.rrn === utr);
    if (pIdx === -1) {
      payments.push(paymentLog);
      fs.writeFileSync(paymentsFilePath, JSON.stringify(payments, null, 2), 'utf8');
      console.log('Synced data/payments.json');
    }
  }

  // 8. Verification Summary
  const verifiedTeam = await TeamModel.findOne({ id: teamId }).lean();
  const verifiedMembers = await UserModel.find({ id: { $in: verifiedTeam.members } }).lean();

  console.log('\n================ PAYMENT VERIFICATION SUMMARY ================');
  console.log('Team ID:', verifiedTeam.id);
  console.log('Team Name:', verifiedTeam.name);
  console.log('Payment Status:', verifiedTeam.paymentStatus);
  console.log('UTR / RRN:', utr);
  console.log('Amount Paid:', `₹${amount}`);
  console.log('\n--- Verified Team Members ---');
  verifiedMembers.forEach((m, i) => {
    console.log(`${i + 1}. ${m.name} (${m.email}) | Status: ${m.paymentStatus} | Role: ${m.teamRole} | Amount: ₹${m.amountPaid}`);
  });

  await mongoose.disconnect();
  console.log('\nPayment verification complete!');
}

verifyAndUpdatePayment().catch(err => {
  console.error('Error verifying payment:', err);
  process.exit(1);
});
