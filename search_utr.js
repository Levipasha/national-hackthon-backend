const Razorpay = require('razorpay');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const key_id = process.env.RAZORPAY_KEY_ID || process.env.key_id;
const key_secret = process.env.RAZORPAY_KEY_SECRET || process.env.key_secret;

const instance = new Razorpay({ key_id, key_secret });

async function searchAll() {
  const targetUtr = '638626905943';
  const targetTxn = 'T2608041948249849288887';
  let skip = 0;
  let allPayments = [];
  let hasMore = true;

  console.log('Fetching payments page by page from Razorpay...');

  while (hasMore && skip < 500) {
    try {
      const res = await instance.payments.all({
        count: 100,
        skip: skip
      });
      const items = res.items || [];
      allPayments.push(...items);
      console.log(`Fetched ${items.length} items (Total: ${allPayments.length})`);
      if (items.length < 100) {
        hasMore = false;
      } else {
        skip += 100;
      }
    } catch (e) {
      console.error('Error fetching page:', e);
      break;
    }
  }

  console.log(`Search total ${allPayments.length} payments.`);

  const matchByUtr = allPayments.filter(p => {
    const rrn = p.acquirer_data?.rrn || '';
    const uti = p.acquirer_data?.upi_transaction_id || '';
    const str = JSON.stringify(p);
    return rrn.includes(targetUtr) || str.includes(targetUtr) || uti.includes(targetUtr) || str.includes(targetTxn);
  });

  console.log('\n=== EXACT MATCH FOR UTR 638626905943 / TXN ===');
  console.log(JSON.stringify(matchByUtr, null, 2));

  console.log('\n=== ALL AUG 4, 2026 PAYMENTS AROUND 07:48 PM IST (14:18 UTC) ===');
  // 07:48 PM IST on Aug 4, 2026 is 14:18:00 UTC -> 1785853080
  const timeMatches = allPayments.filter(p => {
    const pDate = new Date(p.created_at * 1000);
    const dateStr = pDate.toISOString();
    return dateStr.includes('2026-08-04');
  });

  console.log(`Total payments on 2026-08-04: ${timeMatches.length}`);
  timeMatches.forEach(p => {
    const istTime = new Date(p.created_at * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    console.log(`[${p.id}] Status: ${p.status} | Amount: ₹${p.amount/100} | Time: ${istTime} | Email: ${p.email} | Contact: ${p.contact} | RRN: ${p.acquirer_data?.rrn || 'N/A'}`);
  });
}

searchAll();
