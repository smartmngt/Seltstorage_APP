// ═══════════════════════════════════════════════════
// cafe24(avanaj) 로그인 + 매출 스크래핑
// 로컬 테스트(test-scraper.js)에서 검증된 로직을 그대로 이식
// ═══════════════════════════════════════════════════
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

const BASE = 'https://avanaj.cafe24.com';
const LOGIN_URL = BASE + '/_gnbprocess/process/member/member_manager.php';
const SALES_URL = BASE + '/admin/branch_office/branch1/salesManagement/sales.html';

// 일반 브라우저처럼 보이도록 공통 헤더 지정 (안 그러면 봇으로 의심받아 차단될 수 있음)
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ═══════════════════════════════════════════════════
// CUPID 봇차단 챌린지 감지 + 자동 풀이
// (cupid.js 챌린지 페이지는 AES로 암호화된 값을 복호화해서
//  CUPID 쿠키를 만들고 나서야 원래 요청을 통과시켜줌.
//  브라우저의 그 자바스크립트 계산을 Node에서 그대로 재현함)
// ═══════════════════════════════════════════════════
function isCupidChallenge(body) {
  return typeof body === 'string' && (body.includes('cupid.js') || body.includes('slowAES'));
}

function solveCupidCookie(html) {
  // var a=toNumbers("..."), b=toNumbers("..."), c=toNumbers("...")
  const m = html.match(/toNumbers\("([0-9a-f]+)"\)\s*,\s*b\s*=\s*toNumbers\("([0-9a-f]+)"\)\s*,\s*c\s*=\s*toNumbers\("([0-9a-f]+)"\)/);
  if (!m) return null;
  const [, keyHex, ivHex, cipherHex] = m;
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const cipher = Buffer.from(cipherHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);
  const out = Buffer.concat([decipher.update(cipher), decipher.final()]);
  return out.toString('hex');
}

// cupid 챌린지가 나오면 풀어서 쿠키를 얻고, 원래 요청을 재시도해주는 래퍼
// baseCookie: 이미 갖고 있는 쿠키(세션 등)에 CUPID 값을 덧붙여서 재요청함
async function withCupidRetry(makeRequest, baseCookie) {
  const res = await makeRequest(baseCookie || '');
  if (!isCupidChallenge(res.data)) return { res, cookie: baseCookie || '' };

  console.log('[cupid] 봇차단 챌린지 감지, 자동으로 풀어봅니다...');
  const cupidVal = solveCupidCookie(res.data);
  if (!cupidVal) throw new Error('CUPID 챌린지 패턴을 찾지 못했어요 (사이트 쪽 로직이 바뀌었을 수 있어요)');

  const newCookie = (baseCookie ? baseCookie + '; ' : '') + 'CUPID=' + cupidVal;
  const retryRes = await makeRequest(newCookie);
  if (isCupidChallenge(retryRes.data)) {
    throw new Error('CUPID 챌린지를 풀었는데도 계속 차단돼요. (IP 자체가 차단됐을 가능성)');
  }
  console.log('[cupid] 챌린지 통과 성공!');
  return { res: retryRes, cookie: newCookie };
}

async function login(id, pwd) {
  const params = new URLSearchParams();
  params.append('id', id);
  params.append('pwd', pwd);
  params.append('memMode', 'login');

  const { res, cookie: cupidCookie } = await withCupidRetry((cookie) => axios.post(LOGIN_URL, params.toString(), {
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': BASE + '/admin/',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    validateStatus: () => true,
  }));

  if (!res.data || res.data.result !== 'ok') {
    const bodyStr = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    if (bodyStr.includes('cupid.js') || bodyStr.includes('slowAES')) {
      throw new Error('cafe24 로그인 실패: 사이트 보안(WAF)이 이 서버를 의심해서 자바스크립트 퍼즐을 요구했어요. (봇 차단 페이지)');
    }
    throw new Error(`cafe24 로그인 실패 (상태코드 ${res.status}): ` + bodyStr.slice(0, 500));
  }

  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error('cafe24 세션 쿠키를 받지 못했어요.');
  const sessionCookie = setCookie.map(c => c.split(';')[0]).join('; ');
  // 세션 쿠키 + (있었다면) CUPID 쿠키를 합쳐서 이후 요청에서도 계속 사용
  return cupidCookie ? sessionCookie + '; ' + cupidCookie : sessionCookie;
}

function findJsRedirect(html) {
  const m = html.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

async function fetchFinalSalesHtml(cookie) {
  let url = SALES_URL;
  let html = '';
  const visited = [];
  for (let hop = 0; hop < 6; hop++) {
    const { res, cookie: updatedCookie } = await withCupidRetry((c) => axios.get(url, {
      headers: { ...BROWSER_HEADERS, Cookie: c, Referer: BASE + '/admin/index.php' },
      validateStatus: () => true,
    }), cookie);
    cookie = updatedCookie; // 이후 요청에도 계속 최신 쿠키 사용
    html = res.data;
    visited.push(url);
    const redirect = findJsRedirect(html);
    if (redirect) {
      url = new URL(redirect, url).toString();
      if (visited.includes(url)) break;
      continue;
    }
    break;
  }
  return html;
}

function parseSalesTable(html) {
  const $ = cheerio.load(html);
  let $rows = $('table.table-striped tbody tr');
  if ($rows.length === 0) {
    let best = null, bestCount = 0;
    $('table').each((i, t) => {
      const cnt = $(t).find('tbody tr').length || $(t).find('tr').length;
      if (cnt > bestCount) { bestCount = cnt; best = t; }
    });
    if (best) $rows = $(best).find('tbody tr').length ? $(best).find('tbody tr') : $(best).find('tr');
  }

  const rows = [];
  $rows.each((i, el) => {
    const tds = $(el).find('td');
    if (tds.length < 7) return;
    rows.push({
      no: $(tds[0]).text().trim(),
      orderDate: $(tds[1]).text().trim(),
      name: $(tds[2]).text().trim(),
      unit: $(tds[3]).text().trim(),
      period: $(tds[4]).text().trim(),
      amountRaw: $(tds[5]).text().trim(),
      status: $(tds[6]).text().trim(),
    });
  });
  return rows;
}

// 기간 텍스트("30일") → 숫자(30)
function parsePeriodDays(periodText) {
  const m = String(periodText).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// "60,000원" → 60000
function parseAmount(amountText) {
  const m = String(amountText).replace(/[^0-9]/g, '');
  return m ? parseInt(m, 10) : 0;
}

// "2026.07.04" → "2026-07-04"
function parseDate(dateText) {
  const m = String(dateText).match(/(\d{4})\.(\d{2})\.(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function runScrape(cafe24Id, cafe24Pwd) {
  const cookie = await login(cafe24Id, cafe24Pwd);
  const html = await fetchFinalSalesHtml(cookie);
  const rawRows = parseSalesTable(html);
  return rawRows
    .filter(r => r.status === '결제완료')
    .map(r => ({
      no: r.no,
      orderDate: parseDate(r.orderDate),
      name: r.name,
      unit: r.unit,
      periodDays: parsePeriodDays(r.period),
      periodText: r.period,
      amount: parseAmount(r.amountRaw),
      status: r.status,
    }));
}

module.exports = { runScrape };
