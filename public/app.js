const API = ''; // 같은 서버에서 서빙하니 상대경로로 충분
let myRole = null;

async function checkLogin() {
  const r = await fetch(API + '/api/me', { credentials: 'include' }).then(r => r.json());
  if (r.loggedIn) {
    myRole = r.role;
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('main-view').style.display = 'block';
    document.getElementById('whoami').textContent = `${r.username}님 (${r.role === 'admin' ? '관리자' : '직원'})`;
    document.getElementById('push-btn').style.display = (r.role === 'admin') ? 'inline-block' : 'none';
    document.getElementById('admin-panel').style.display = (r.role === 'admin') ? 'block' : 'none';
    loadPending();
    if (r.role === 'admin') loadUsers();
  } else {
    myRole = null;
    document.getElementById('login-view').style.display = 'block';
    document.getElementById('main-view').style.display = 'none';
  }
}

async function doLogin() {
  const username = document.getElementById('username').value.trim();
  const pw = document.getElementById('pw').value;
  const res = await fetch(API + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password: pw }),
  });
  if (res.ok) {
    checkLogin();
  } else {
    const d = await res.json().catch(() => ({}));
    document.getElementById('login-err').textContent = d.error || '로그인에 실패했어요';
  }
}

async function doLogout() {
  await fetch(API + '/api/logout', { method: 'POST', credentials: 'include' });
  checkLogin();
}

// ── 관리자: 직원 계정 관리 ──
async function loadUsers() {
  const list = await fetch(API + '/api/admin/users', { credentials: 'include' }).then(r => r.json());
  const el = document.getElementById('user-list');
  el.innerHTML = list.map(u => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #F1F5F9;">
      <div><b>${u.username}</b> <span style="font-size:12px;color:#94A3B8;">${u.role === 'admin' ? '(관리자)' : '(직원)'}</span></div>
      ${u.role !== 'admin' ? `<button style="width:auto;padding:6px 10px;font-size:12px;" class="btn-red" onclick="removeUser('${u.username}')">삭제</button>` : ''}
    </div>
  `).join('') || '<div style="font-size:13px;color:#94A3B8;">등록된 직원이 없어요</div>';
}
async function createUser() {
  const username = document.getElementById('new-username').value.trim();
  const password = document.getElementById('new-password').value;
  if (!username || !password) { alert('아이디/비밀번호를 입력해주세요'); return; }
  const res = await fetch(API + '/api/admin/users', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role: 'user' }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { alert(d.error || '계정 생성 실패'); return; }
  document.getElementById('new-username').value = '';
  document.getElementById('new-password').value = '';
  loadUsers();
}
async function removeUser(username) {
  if (!confirm(`${username} 계정을 삭제할까요?`)) return;
  await fetch(API + '/api/admin/users/' + encodeURIComponent(username), { method: 'DELETE', credentials: 'include' });
  loadUsers();
}

async function loadPending() {
  const list = await fetch(API + '/api/pending', { credentials: 'include' }).then(r => r.json());
  const el = document.getElementById('list');
  if (!list.length) {
    el.innerHTML = '<div class="empty">✅ 대기중인 매출이 없어요</div>';
    return;
  }
  el.innerHTML = list.map(item => `
    <div class="card">
      <div class="name">${item.name}</div>
      <div class="meta">${item.unit} · ${item.periodText} · ${item.orderDate}</div>
      <div class="amt">${item.amount.toLocaleString()}원</div>
      <div class="row2">
        <button class="btn-red" onclick="reject('${item.no}')">거부</button>
        <button class="btn-green" onclick="approve('${item.no}')">✅ 승인</button>
      </div>
    </div>
  `).join('');
}

async function approve(no) {
  await fetch(API + '/api/approve', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ no }),
  });
  loadPending();
}

async function reject(no) {
  if (!confirm('이 항목을 거부할까요? (매출로 반영되지 않아요)')) return;
  await fetch(API + '/api/reject', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ no }),
  });
  loadPending();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('이 브라우저는 푸시 알림을 지원하지 않아요. 크롬을 이용해주세요.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { alert('알림 권한을 허용해주셔야 알림을 받을 수 있어요.'); return; }

  const reg = await navigator.serviceWorker.register('/sw.js');
  const { key } = await fetch(API + '/api/vapid-public-key').then(r => r.json());
  if (!key) { alert('서버에 VAPID 키가 설정되지 않았어요.'); return; }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });

  await fetch(API + '/api/push-subscribe', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  });
  alert('알림이 설정됐어요! 이제 새 매출이 감지되면 폰으로 알림이 와요.');
}

checkLogin();
setInterval(() => { if (document.getElementById('main-view').style.display === 'block') loadPending(); }, 30000);
