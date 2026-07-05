// ═══════════════════════════════════════════════════
// cafe24(avanaj) 로그인 + 매출 스크래핑
// 로컬 테스트(test-scraper.js)에서 검증된 로직을 그대로 이식
// ═══════════════════════════════════════════════════
const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://avanaj.cafe24.com';
const LOGIN_URL = BASE + '/_gnbprocess/process/member/member_manager.php';
const SALES_URL = BASE + '/admin/branch_office/branch1/salesManagement/sales.html';

async function login(id, pwd) {
  const params = new URLSearchParams();
  params.append('id', id);
  params.append('pwd', pwd);
  params.append('memMode', 'login');

  const res = await axios.post(LOGIN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
  });

  if (!res.data || res.data.result !== 'ok') {
    throw new Error('cafe24 로그인 실패: ' + JSON.stringify(res.data));
  }

  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error('cafe24 세션 쿠키를 받지 못했어요.');
  return setCookie.map(c => c.split(';')[0]).join('; ');
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
    const res = await axios.get(url, {
      headers: { Cookie: cookie, Referer: BASE + '/admin/index.php' },
      validateStatus: () => true,
    });
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
