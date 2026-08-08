const { execSync } = require('child_process');

try {
  console.log('Staging files...');
  execSync('git add .', { stdio: 'inherit' });

  console.log('Committing changes...');
  execSync('git commit -m "Fix problem statement distribution logic and assign distinct problem statements per team"', { stdio: 'inherit' });

  console.log('Pushing to GitHub (origin main)...');
  execSync('git push origin main', { stdio: 'inherit' });

  console.log('Successfully pushed code to repository!');
} catch (err) {
  console.error('Git Push Error:', err.message);
  process.exit(1);
}
