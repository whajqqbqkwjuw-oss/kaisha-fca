'use strict';

/**
 * Example: Fetch User Profile
 *
 * Loads an appstate and fetches the extended public profile for a given user.
 *
 * Usage:
 *   USER_ID=<user_id> node examples/user-profile.js
 */

const fs     = require('fs');
const path   = require('path');
const kaisha = require('../src/index');

async function main() {
  const userID = process.env.USER_ID;

  if (!userID) {
    console.error('Set the USER_ID environment variable before running this example.');
    process.exit(1);
  }

  const sessionPath = path.resolve(__dirname, '../session.json');
  if (!fs.existsSync(sessionPath)) {
    console.error(`session.json not found at ${sessionPath}. Run examples/login.js first.`);
    process.exit(1);
  }

  const appstate = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  const client   = await kaisha.login(
    { type: 'appstate', appstate },
    { logLevel: 'info' }
  );

  console.log('Authenticated as user:', client.session.data.userID);

  const profile = await client.api.fetchUserProfile(userID);

  console.log('\nUser Profile:');
  console.log('─────────────────────────────────');
  console.log(`ID:            ${profile.id}`);
  console.log(`Name:          ${profile.name}`);
  console.log(`Username:      ${profile.vanity || '(none)'}`);
  console.log(`Gender:        ${profile.gender}`);
  console.log(`Bio:           ${profile.bio || '(not set)'}`);
  console.log(`Location:      ${profile.location || '(not set)'}`);
  console.log(`Hometown:      ${profile.hometown || '(not set)'}`);
  console.log(`Relationship:  ${profile.relationship || '(not set)'}`);
  console.log(`Work:          ${profile.work.join(', ') || '(not set)'}`);
  console.log(`Education:     ${profile.education.join(', ') || '(not set)'}`);
  console.log(`Website:       ${profile.website || '(not set)'}`);
  console.log(`Picture:       ${profile.profilePictureURL}`);
  console.log(`Cover:         ${profile.coverPhotoURL || '(none)'}`);

  client.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
