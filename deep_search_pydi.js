const Razorpay = require('razorpay');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const key_id = process.env.RAZORPAY_KEY_ID || process.env.key_id;
const key_secret = process.env.RAZORPAY_KEY_SECRET || process.env.key_secret;

const instance = new Razorpay({ key_id, key_secret });

async function deepSearch() {
  console.log('Fetching ALL payments from Razorpay for deep search...');
  let skip = 0;
  let allPayments = [];
  while (skip < 1000) {
    const res = await instance.payments.all({ count: 100, skip });
    const items = res.items || [];
    allPayments.push(...items);
    if (items.length < 100) break;
    skip += 100;
  }

  console.log(`Retrieved ${allPayments.length} total payments from Razorpay.`);

  const targetEmail = 'pydirakesh2006@gmail.com';
  const targetPhone = '7981431284';

  const matchesEmail = allPayments.filter(p => JSON.stringify(p).toLowerCase().includes(targetEmail.toLowerCase()));
  const matchesPhone = allPayments.filter(p => JSON.stringify(p).includes(targetPhone));
  const matchesPydi = allPayments.filter(p => JSON.stringify(p).toLowerCase().includes('pydi'));

  console.log(`\n=== SEARCH BY EMAIL (${targetEmail}) ===`);
  console.log(JSON.stringify(matchesEmail, null, 2));

  console.log(`\n=== SEARCH BY PHONE (${targetPhone}) ===`);
  console.log(JSON.stringify(matchesPhone, null, 2));

  console.log(`\n=== SEARCH BY NAME ("pydi") ===`);
  console.log(JSON.stringify(matchesPydi, null, 2));
}

deepSearch().catch(console.error);
