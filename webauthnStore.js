const { readJSON, writeJSON } = require('./db');

function getCreds(username) {
  const all = readJSON('webauthn.json', {});
  return all[username] || [];
}
function saveCred(username, cred) {
  const all = readJSON('webauthn.json', {});
  if (!all[username]) all[username] = [];
  all[username].push(cred);
  writeJSON('webauthn.json', all);
}
function updateCounter(username, credentialID, counter) {
  const all = readJSON('webauthn.json', {});
  const creds = all[username] || [];
  const c = creds.find(c => c.credentialID === credentialID);
  if (c) c.counter = counter;
  writeJSON('webauthn.json', all);
}
function hasAnyCreds(username) {
  return getCreds(username).length > 0;
}

module.exports = { getCreds, saveCred, updateCounter, hasAnyCreds };
