const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const uri = process.env.MONGODB_URI;
console.log('Connecting to database:', uri);

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // 1. Get all active users and teams
  const users = await db.collection('users').find({}).toArray();
  const userIds = new Set(users.map(u => u.id));
  const userMongoIds = new Set(users.map(u => u._id.toString()));

  const teams = await db.collection('teams').find({}).toArray();
  const teamIds = new Set(teams.map(t => t.id));

  console.log(`Active state: ${users.length} users, ${teams.length} teams.`);

  // 2. Clean up payments
  const payments = await db.collection('payments').find({}).toArray();
  let deletedPayments = 0;
  for (const p of payments) {
    if (!userIds.has(p.userId) && !userMongoIds.has(p.userId)) {
      await db.collection('payments').deleteOne({ _id: p._id });
      deletedPayments++;
    }
  }
  console.log(`Cleared ${deletedPayments} orphaned payments.`);

  // 3. Clean up invites
  const invites = await db.collection('invites').find({}).toArray();
  let deletedInvites = 0;
  for (const invite of invites) {
    if (!teamIds.has(invite.teamId) || !userIds.has(invite.leaderId)) {
      await db.collection('invites').deleteOne({ _id: invite._id });
      deletedInvites++;
    }
  }
  console.log(`Cleared ${deletedInvites} orphaned invites.`);

  // 4. Clean up individual/team notifications
  const notifications = await db.collection('notifications').find({}).toArray();
  let deletedNotifications = 0;
  for (const n of notifications) {
    if (n.recipientType === 'individual' && n.recipientTarget && !userIds.has(n.recipientTarget) && !userMongoIds.has(n.recipientTarget)) {
      await db.collection('notifications').deleteOne({ _id: n._id });
      deletedNotifications++;
    } else if (n.recipientType === 'team' && n.recipientTarget && !teamIds.has(n.recipientTarget)) {
      await db.collection('notifications').deleteOne({ _id: n._id });
      deletedNotifications++;
    }
  }
  console.log(`Cleared ${deletedNotifications} orphaned notifications.`);

  await mongoose.disconnect();
  console.log('Finished database clean up.');
}

run().catch(console.error);
