# 배포 가이드 (처음이어도 순서대로만 하면 돼요)

## 0) 이 폴더에 들어있는 것
- server.js, scraper.js, db.js, package.json → 서버 코드
- public/ → 승인 화면 (index.html, app.js, sw.js, icon-192.png)

## 1) GitHub 저장소 만들기
1. github.com 접속 → 우측 상단 "+" → New repository
2. 이름 예: `warehouse-server` (Public으로)
3. Create repository
4. 이 zip 안의 파일 전체를 (server.js, scraper.js, db.js, package.json, public 폴더 통째로) 업로드
   - "Add file" → "Upload files" → 전부 드래그 → Commit

## 2) Render 가입 + 서비스 생성
1. https://render.com 접속 → GitHub 계정으로 가입(로그인)
2. 대시보드에서 **New +** → **Web Service**
3. 방금 만든 GitHub 저장소(warehouse-server) 선택 → Connect
4. 설정:
   - Name: 아무 이름 (예: warehouse-server)
   - Region: Singapore (한국에서 제일 가까움)
   - Branch: main
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Instance Type: **Free**
5. 아래 "Environment Variables" 부분에서 **Add Environment Variable**로 하나씩 추가:

| Key | Value |
|---|---|
| `ADMIN_USERNAME` | 사장님(관리자) 아이디 (최초 1회만 사용해서 계정 생성) |
| `ADMIN_PASSWORD` | 사장님(관리자) 비밀번호 |
| `CAFE24_ID` | cafe24 관리자 아이디 |
| `CAFE24_PWD` | cafe24 관리자 비밀번호 |
| `SYNC_KEY` | 임의의 긴 문자열 (예: 컴퓨터로 아무 비밀번호 생성기 돌려서 32자 정도) |
| `CHECK_KEY` | 임의의 긴 문자열 (SYNC_KEY와 다른 값으로) |
| `SESSION_SECRET` | 임의의 긴 문자열 |
| `VAPID_PUBLIC_KEY` | `BNnWYwMPlFNwNXFSs77haaOIoHQdgeImnO5LSL4CbKNUpRHRytLB_6xiSGfBrLjUiF0D1eSfDexRssi_9vJomug` |
| `VAPID_PRIVATE_KEY` | `jSNi_1EmD6tcJq6I6PZv7TE0pND6Whjp6goTk03Wm_c` |

   (VAPID 키는 미리 생성해둔 값이니 그대로 복사해서 넣으시면 돼요)

6. **Create Web Service** 클릭 → 몇 분 기다리면 배포 완료
7. 완료되면 상단에 `https://warehouse-server-xxxx.onrender.com` 같은 주소가 생겨요. **이 주소를 꼭 저장해두세요.**

## 3) cron-job.org로 5~10분마다 깨우기
1. https://cron-job.org 가입 (무료)
2. **Create cronjob**
3. URL: `https://[아까 그 주소]/api/check-now?key=[CHECK_KEY로 넣은 값]`
4. 실행 주기: 매 10분
5. 저장

## 4) 창고 앱에 연결하기
1. 창고 앱(`smartmngt.github.io/selfstorage`) 접속 → **설정 탭**
2. "🔄 매출 자동 동기화" 카드에:
   - 서버 주소: `https://[2번에서 받은 주소]` 입력
   - 동기화 키: `SYNC_KEY`로 넣었던 값 입력
3. "지금 동기화" 눌러서 테스트

## 5) 승인 화면 + 알림 설정
1. 폰 브라우저로 `https://[서버 주소]` 접속
2. **관리자(사장님)**: `ADMIN_USERNAME` / `ADMIN_PASSWORD`로 로그인
3. 로그인하면 화면 하단에 "👥 직원 계정 관리"가 보여요 — 여기서 **직원 수만큼 자유롭게 아이디/비번을 만들어서 나눠주면** 돼요 (3명 제한 없음)
4. **관리자만** "🔔 알림 켜기" 버튼이 보여요 — 눌러서 알림 권한 허용하면, 새 매출 감지 알림은 **관리자 폰에만** 옵니다
5. 직원들은 각자 받은 아이디/비번으로 로그인해서 승인 화면을 보고 승인/거부만 할 수 있어요 (알림은 안 옴, 계정 관리 메뉴도 안 보임)
6. 다들 홈 화면에 추가해두면 편해요 (크롬 메뉴 → 홈 화면에 추가)

## 이제 흐름은 이렇게 됩니다
1. cafe24에 새 결제 발생
2. 10분 이내 서버가 감지 → **관리자 폰에만** 알림
3. 관리자든 직원이든, 승인 화면 열어서 내용 확인 → 승인/거부
4. 창고 앱을 다음에 열면 (또는 설정에서 "지금 동기화") 자동으로 회원+계약이 등록됨

## 주의할 점
- cafe24 결제 내역엔 **전화번호가 없어서**, 자동 등록된 회원은 연락처가 빈 칸이에요. 회원 탭에서 나중에 채워주세요.
- Render 무료 요금제라 가끔 응답이 느릴 수 있어요 (몇 초 정도, 큰 문제 없음)
- 서버 코드를 나중에 수정해서 GitHub에 다시 올리면, Render가 자동으로 재배포해요 (그 사이 잠깐 서비스가 멈췄다 다시 켜져요)
