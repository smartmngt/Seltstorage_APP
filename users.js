const crypto = require('crypto');
const { readJSON, writeJSON } = require('./db');

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

function getUsers() {
  return readJSON('users.json', []);
}
function saveUsers(users) {
  writeJSON('users.json', users);
}

// 최초 실행시 관리자 계정이 없으면 환경변수로 하나 만들어줌
function ensureAdminSeed(adminUsername, adminPassword) {
  const users = getUsers();
  if (users.length > 0) return;
  if (!adminUsername || !adminPassword) {
    console.log('[users] ADMIN_USERNAME/ADMIN_PASSWORD가 없어서 관리자 계정을 만들지 못했어요.');
    return;
  }
  const { salt, hash } = hashPassword(adminPassword);
  users.push({ username: adminUsername, salt, hash, role: 'admin', createdAt: new Date().toISOString() });
  saveUsers(users);
  console.log(`[users] 관리자 계정(${adminUsername})을 생성했어요.`);
}

function findUser(username) {
  return getUsers().find(u => u.username === username);
}

function createUser(username, password, role) {
  const users = getUsers();
  if (users.some(u => u.username === username)) {
    throw new Error('이미 있는 아이디예요');
  }
  const { salt, hash } = hashPassword(password);
  users.push({ username, salt, hash, role: role === 'admin' ? 'admin' : 'user', createdAt: new Date().toISOString() });
  saveUsers(users);
}

function deleteUser(username) {
  const users = getUsers().filter(u => u.username !== username);
  saveUsers(users);
}

function publicUserList() {
  return getUsers().map(u => ({ username: u.username, role: u.role, createdAt: u.createdAt }));
}

module.exports = { hashPassword, verifyPassword, getUsers, findUser, createUser, deleteUser, publicUserList, ensureAdminSeed };
