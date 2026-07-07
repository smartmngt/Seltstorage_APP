// ═══════════════════════════════════════════════════
// 열려라창고 반포점 - 매출 자동 감지 서버
// ═══════════════════════════════════════════════════
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const cron = require('node-cron');
const webpush = require('web-push');
const path = require('path');
const { readJSON, writeJSON } = require('./db');
const { runScrape } = require('./scraper');
const users = require('./users');

const app = express();
// Render/Cloud Run 등 프록시 뒤에서 실행되므로, https 여부를 프록시 헤더로 신뢰하도록 설정
// (이게 없으면 secure 쿠키(로그인 세션)가 저장되지 않음)
app.set('trust proxy', 1);
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

// ── 환경변수 (Render 대시보드에서 설정) ──
const {
  APP_PASSWORD,          // (구버전 호환용, 더는 사용 안 함)
  ADMIN_USERNAME,        // 최초 관리자 아이디 (최초 1회만 사용)
  ADMIN_PASSWORD,        // 최초 관리자 비밀번호 (최초 1회만 사용)
  CAFE24_ID,             // cafe24 관리자 아이디
  CAFE24_PWD,            // cafe24 관리자 비밀번호
  SYNC_KEY,              // 창고앱(GitHub Pages)이 데이터를 가져갈 때 쓰는 키
  CHECK_KEY,             // cron-job.org가 외부에서 체크를 트리거할 때 쓰는 키
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  SESSION_SECRET,
} = process.env;

users.ensureAdminSeed(ADMIN_USERNAME, ADMIN_PASSWORD);

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

app.use(session({
  secret: SESSION_SECRET || 'change-me-please',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'none', secure: true },
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.username) return next();
  return res.status(401).json({ error: '로그인이 필요해요' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).json({ error: '관리자만 할 수 있어요' });
}

// ═══════════════════════════════════════════════════
// 로그인 (아이디/비밀번호, 여러 명 가능)
// ═══════════════════════════════════════════════════
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = users.findUser(username || '');
  if (!user || !users.verifyPassword(password || '', user.salt, user.hash)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 틀렸어요' });
  }
  req.session.username = user.username;
  req.session.role = user.role;
  res.json({ ok: true, username: user.username, role: user.role });
});
app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/me', (req, res) => {
  if (req.session && req.session.username) {
    return res.json({ loggedIn: true, username: req.session.username, role: req.session.role });
  }
  res.json({ loggedIn: false });
});

// ═══════════════════════════════════════════════════
// 관리자 전용: 직원 계정 관리
// ═══════════════════════════════════════════════════
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json(users.publicUserList());
});
app.post('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '아이디/비밀번호를 입력해주세요' });
  try {
    users.createUser(username, password, role);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.delete('/api/admin/users/:username', requireAuth, requireAdmin, (req, res) => {
  if (req.params.username === req.session.username) {
    return res.status(400).json({ error: '자기 자신은 삭제할 수 없어요' });
  }
  users.deleteUser(req.params.username);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════
// 매출 체크 (스크래핑 + 신규 감지 + 대기열 등록 + 알림 발송)
// ═══════════════════════════════════════════════════
async function checkNewSales() {
  if (!CAFE24_ID || !CAFE24_PWD) {
    console.log('[checkNewSales] CAFE24_ID/CAFE24_PWD 미설정, 건너뜀');
    return { newCount: 0 };
  }
  console.log('[checkNewSales] 시작', new Date().toISOString());
  const rows = await runScrape(CAFE24_ID, CAFE24_PWD);

  const seen = readJSON('seen.json', []);
  const seenSet = new Set(seen);
  const pending = readJSON('pending.json', []);

  const newRows = rows.filter(r => !seenSet.has(r.no));
  if (newRows.length === 0) {
    console.log('[checkNewSales] 새 매출 없음');
    return { newCount: 0 };
  }

  newRows.forEach(r => {
    seenSet.add(r.no);
    pending.push({ ...r, detectedAt: new Date().toISOString() });
  });

  writeJSON('seen.json', Array.from(seenSet));
  writeJSON('pending.json', pending);
  console.log(`[checkNewSales] 새 매출 ${newRows.length}건 감지, 대기열 등록`);

  await sendPushToAll({
    title: `📦 새 매출 ${newRows.length}건 감지`,
    body: newRows.map(r => `${r.name} · ${r.unit} · ${r.amount.toLocaleString()}원`).join('\n'),
  });

  return { newCount: newRows.length };
}

app.get('/api/check-now', async (req, res) => {
  if (!CHECK_KEY || req.query.key !== CHECK_KEY) return res.status(403).json({ error: 'invalid key' });
  try {
    const result = await checkNewSales();
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[check-now] 오류:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 10분마다 내부적으로도 한번씩 시도 (서버가 깨어있는 동안 보조 수단)
// AUTO_CHECK_ENABLED=true 로 설정해야 켜짐 (기본은 꺼짐 - IP 차단 방지)
if (process.env.AUTO_CHECK_ENABLED === 'true') {
  cron.schedule('*/10 * * * *', () => {
    checkNewSales().catch(e => console.error('[cron] 오류:', e.message));
  });
  console.log('[cron] 자동 체크 활성화됨 (10분마다)');
} else {
  console.log('[cron] 자동 체크 비활성화 상태 (AUTO_CHECK_ENABLED=true로 설정하면 켜짐)');
}

// ═══════════════════════════════════════════════════
// 창고 앱 데이터 (회원/계약/고정비/변동비) - 모두가 같은 데이터를 봄
// 게스트(role=user)는 조회만, 관리자만 저장 가능
// ═══════════════════════════════════════════════════
const APPDATA_DEFAULT = { members: [], contracts: [], fixedCosts: [], variableCosts: [] };

app.get('/api/appdata', requireAuth, (req, res) => {
  res.json(readJSON('appdata.json', APPDATA_DEFAULT));
});

app.post('/api/appdata', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const data = {
    members: Array.isArray(body.members) ? body.members : [],
    contracts: Array.isArray(body.contracts) ? body.contracts : [],
    fixedCosts: Array.isArray(body.fixedCosts) ? body.fixedCosts : [],
    variableCosts: Array.isArray(body.variableCosts) ? body.variableCosts : [],
  };
  writeJSON('appdata.json', data);
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

// ═══════════════════════════════════════════════════
// 대기열 승인/거부 (승인 화면 전용, 로그인 필요)
// ═══════════════════════════════════════════════════
app.get('/api/pending', requireAuth, (req, res) => {
  res.json(readJSON('pending.json', []));
});

app.post('/api/approve', requireAuth, (req, res) => {
  const { no } = req.body || {};
  const pending = readJSON('pending.json', []);
  const idx = pending.findIndex(p => p.no === no);
  if (idx === -1) return res.status(404).json({ error: '대기중인 항목이 아니에요' });
  const item = pending[idx];
  pending.splice(idx, 1);
  writeJSON('pending.json', pending);

  const confirmed = readJSON('confirmed.json', []);
  confirmed.push({ ...item, confirmedAt: new Date().toISOString() });
  writeJSON('confirmed.json', confirmed);

  res.json({ ok: true });
});

app.post('/api/reject', requireAuth, (req, res) => {
  const { no } = req.body || {};
  const pending = readJSON('pending.json', []);
  const idx = pending.findIndex(p => p.no === no);
  if (idx === -1) return res.status(404).json({ error: '대기중인 항목이 아니에요' });
  pending.splice(idx, 1);
  writeJSON('pending.json', pending);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════
// 창고앱(GitHub Pages)이 승인된 매출을 가져가는 API
// - 세션쿠키 대신 간단한 key로 인증 (다른 도메인이라 쿠키 전달이 번거로움)
// ═══════════════════════════════════════════════════
app.get('/api/confirmed', (req, res) => {
  if (!SYNC_KEY || req.query.key !== SYNC_KEY) return res.status(403).json({ error: 'invalid key' });
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const confirmed = readJSON('confirmed.json', []);
  const result = confirmed.filter(c => new Date(c.confirmedAt) > since);
  res.json(result);
});

// ═══════════════════════════════════════════════════
// 웹푸시 구독
// ═══════════════════════════════════════════════════
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY || '' });
});

app.post('/api/push-subscribe', requireAuth, requireAdmin, (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: '구독 정보가 올바르지 않아요' });
  const subs = readJSON('subscriptions.json', []);
  if (!subs.some(s => s.endpoint === sub.endpoint)) {
    subs.push({ ...sub, username: req.session.username });
    writeJSON('subscriptions.json', subs);
  }
  res.json({ ok: true });
});

async function sendPushToAll(payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('[push] VAPID 키 미설정, 알림 생략');
    return;
  }
  const subs = readJSON('subscriptions.json', []);
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, body);
    } catch (e) {
      console.error('[push] 발송 실패 (구독 만료 가능):', e.message);
    }
  }
}

// ═══════════════════════════════════════════════════
// 정적 파일 (승인 화면)
// ═══════════════════════════════════════════════════
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
