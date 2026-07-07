const crypto = require('crypto');

// 서버 메모리가 아니라 "서명된 토큰" 자체에 로그인 정보를 담아서
// 서버가 재시작/재배포 돼도 로그인이 안 풀리게 함 (자동로그인의 핵심)
function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function makeToken(user, secret) {
  return sign({ username: user.username, role: user.role, exp: Date.now() + 90 * 24 * 60 * 60 * 1000 }, secret);
}

module.exports = { sign, verify, makeToken };
