#!/usr/bin/env node
// Create a RideWorld account from the command line (the first admin, or a lost-password reset).
//   node tools/adduser.js <username> [--admin] [--name "Display Name"] [--reset]
// Prints a generated password. Normally accounts are managed in the app (Accounts, admins only).
const crypto = require('crypto');
const accounts = require('../lib/accounts');

const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith('--'));
const nameAt = args.indexOf('--name');
if (!username) { console.error('usage: node tools/adduser.js <username> [--admin] [--name "Display Name"] [--reset]'); process.exit(1); }
const password = crypto.randomBytes(12).toString('base64url');
const r = args.includes('--reset')
  ? accounts.setPassword(username, password)
  : accounts.createUser({ username, name: nameAt > 0 ? args[nameAt + 1] : username, password, admin: args.includes('--admin') });
if (r.error) { console.error(r.error); process.exit(1); }
console.log(`${args.includes('--reset') ? 'Reset' : 'Created'} ${r.user.username}${r.user.admin ? ' (admin)' : ''}. Password: ${password}`);
