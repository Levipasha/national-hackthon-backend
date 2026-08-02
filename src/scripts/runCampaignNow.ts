import dotenv from 'dotenv';
import { connectDatabase } from '../config/db';
import { sendCampaignMail1, sendCampaignMail2 } from '../services/campaignService';

dotenv.config();

async function run() {
  console.log('--- CodeSprint 2026 Campaign Email Broadcast Script ---');
  await connectDatabase();

  const mode = process.argv[2] || 'all';

  if (mode === 'mail1' || mode === 'all') {
    console.log('Sending Mail 1 (Guidelines PDF)...');
    const res1 = await sendCampaignMail1();
    console.log('Mail 1 Result:', res1);
  }

  if (mode === 'mail2' || mode === 'all') {
    if (mode === 'all') {
      console.log('Waiting 10 minutes interval before Mail 2...');
      await new Promise(r => setTimeout(r, 10 * 60 * 1000));
    }
    console.log('Sending Mail 2 (WhatsApp Group)...');
    const res2 = await sendCampaignMail2();
    console.log('Mail 2 Result:', res2);
  }

  console.log('--- Campaign Finished ---');
  process.exit(0);
}

run().catch(err => {
  console.error('Campaign Error:', err);
  process.exit(1);
});
