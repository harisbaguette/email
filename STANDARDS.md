# 이 프로젝트가 지키는 표준

산출물: 웹앱, 대시보드, 업무 도구.
국제 표준의 기준 규칙을 바탕으로 이 프로젝트에 맞게 고쳐 쓰는 규칙이다. 작업을 시작할 때마다 읽고 지켜서 만든다.

- '기준 규칙'은 project start(`readiness.py start`)를 다시 돌리면 갱신된다. 손으로 고치지 않는다.
- '이 프로젝트 맞춤'은 AI가 프로젝트 성격에 맞게 쓴다. 더한 규칙, 바꾼 규칙(원래 → 바꾼 것, 까닭), 이 표준을 지킬 계획을 적는다. 맞춤이 기준 규칙보다 앞선다.
- 법이 정한 의무(개인정보, 결제, 등급과 확률 표시, 아동 보호)는 맞춤으로 빼지 않는다.
- 규칙을 어기는 코드나 파일을 만들지 않고, 자동 검사는 시험 명령에 넣어 바뀔 때마다 돌린다.

<!-- standard:iso-25010 -->
## ISO/IEC 25010:2023 제품 품질 모델

소프트웨어 품질을 9가지 특성으로 나눈 국제 표준.

### 기준 규칙

- 기능 적합성, 성능 효율, 호환성, 상호작용 능력, 신뢰성, 보안, 유지보수성, 유연성, 안전 가운데 이 제품에 해당하는 특성의 목표를 요구사항에 적는다.
- 목표마다 확인 방법(시험, 측정, 실제 사용)을 정한다.

원문: `python3 ~/.agents/work-methods/readiness.py source iso-25010`

### 이 프로젝트 맞춤

<!-- custom:iso-25010 -->
핵심 과업은 로그인, 검색, 메일 읽기, 인증번호 복사, 주소 관리다. 공통 컴포넌트 검사, Workers 통합 시험, 데스크톱·모바일 브라우저 시험을 함께 통과해야 한다.
<!-- /custom:iso-25010 -->
<!-- /standard:iso-25010 -->

<!-- standard:wcag -->
## WCAG 2.2 AA 접근성 (ISO/IEC 40500)

장애가 있는 사람도 쓸 수 있게 하는 국제 표준. 웹이 아닌 앱과 문서에는 WCAG2ICT로 적용한다.

### 기준 규칙

- 본문 글자와 배경의 대비는 4.5:1 이상, 큰 글자와 아이콘, 입력 칸 테두리는 3:1 이상으로 한다.
- 모든 기능을 키보드만으로 쓸 수 있게 하고, 포커스가 어디 있는지 보이게 한다.
- 의미 있는 이미지에는 대체 텍스트를, 입력 칸에는 보이는 이름표를 단다.
- 색만으로 정보를 전하지 않는다. 오류는 글로도 알린다.
- 누르는 대상은 24×24 CSS px 이상으로 하고, 200% 확대와 320 CSS px 폭에서도 내용이 잘리지 않게 한다.
- 1초에 3번 넘게 번쩍이는 화면을 만들지 않는다.
- 설치형 앱(데스크톱, 모바일)은 운영체제 접근성 API로 화면 요소의 이름, 역할, 상태를 알려 주고, 사용자가 운영체제에서 정한 글자 크기와 대비 설정을 따른다(EN 301 549 11장).
- EU에 내놓으면 EN 301 549를 기준으로 한다. 지금 EU 관보에 인용된 판은 v3.2.1(WCAG 2.1 AA 기반)이고, v4.1.1(2026-09)이 인용되면 그 판으로 옮긴다.

자동 검사: axe-core(@axe-core/playwright)로 주요 화면 검사; Lighthouse 접근성 점수의 실패 항목 확인

원문: `python3 ~/.agents/work-methods/readiness.py source wcag wcag2ict wcag-em apg en-301-549 accessibleeu-en301549`

### 이 프로젝트 맞춤

<!-- custom:wcag -->
44px 조작 높이와 명시적인 접근성 이름을 기본으로 한다. 모달의 포커스 이동·복원, 선택 메뉴의 키보드 조작, 320px 화면, 확대, 대비와 동작 줄이기를 검증한다. 자동 검사와 수동 화면 확인을 함께 사용한다.
<!-- /custom:wcag -->
<!-- /standard:wcag -->

<!-- standard:html -->
## HTML Living Standard

웹 문서를 바르게 쓰는 표준.

### 기준 규칙

- 문서에 lang 속성과 고유한 title을 둔다.
- 버튼은 button, 링크는 a, 영역은 header, nav, main, footer처럼 뜻에 맞는 요소를 쓴다.
- 제목(h1~h6)은 건너뛰지 않고 순서대로 쓴다.

자동 검사: Nu Html Checker(vnu)로 배포 빌드 검사

원문: `python3 ~/.agents/work-methods/readiness.py source whatwg-html`

### 이 프로젝트 맞춤

<!-- custom:html -->
공통 UI는 의미에 맞는 네이티브 요소로 구현한다. 화면에서 button, input, select, dialog를 직접 만들지 않고 src/ui의 컴포넌트를 사용한다.
<!-- /custom:html -->
<!-- /standard:html -->

<!-- standard:https -->
## HTTPS와 HTTP 의미 (RFC 9110, TLS)

웹과 API의 전송 보안과 상태 코드 표준.

### 기준 규칙

- 모든 주소를 HTTPS로 제공하고 HTTP는 HTTPS로 옮긴다.
- 인증서는 자동 갱신한다. 유효기간이 짧아지므로 손으로 갱신하지 않는다.
- 상태 코드를 뜻대로 쓴다(없는 주소 404, 요청 초과 429와 Retry-After).
- 보안 신고 창구를 /.well-known/security.txt에 둔다.

자동 검사: curl -I로 리디렉션과 헤더 확인; Mozilla HTTP Observatory로 보안 헤더 확인

원문: `python3 ~/.agents/work-methods/readiness.py source http-concurrency https-default tls-lifetime security-txt http-429`

### 이 프로젝트 맞춤

<!-- custom:https -->
운영 HTTPS는 Cloudflare가 관리하며 로컬 개발만 HTTP를 허용한다. 요청 제한에는 Retry-After를 포함한다. 인증서 운영 설정 확인은 로컬 시험과 구별한다.
<!-- /custom:https -->
<!-- /standard:https -->

<!-- standard:asvs -->
## OWASP ASVS 5.0 레벨 1과 Top 10:2025

웹과 서버 보안의 국제 검증 기준.

### 기준 규칙

- 권한은 화면이 아니라 서버에서 요청마다 확인한다.
- 외부 입력은 서버에서 검증하고, 화면과 쿼리에 넣을 때 인코딩하거나 매개변수로 넘긴다.
- 비밀번호는 8자 이상을 허용하고 유출된 비밀번호를 막으며, argon2id나 bcrypt로 저장한다.
- 비밀 키와 토큰은 코드와 저장소에 넣지 않고 환경 변수나 비밀 저장소에 둔다.
- 세션은 로그아웃과 만료 때 서버에서 끊는다.
- 의존성은 잠금 파일로 고정하고 알려진 취약점을 검사한다.
- 파일 올리기를 받으면 크기 상한을 두고, 확장자와 실제 내용(매직 바이트)이 맞는지 확인하며, 저장 파일 이름은 서버가 새로 만든다.
- 올린 파일은 서버 코드로 실행되지 않는 곳에 두고, 이미지는 다시 인코딩해 위치(GPS), 기기 정보 같은 Exif 메타데이터를 지운다.

자동 검사: gitleaks로 비밀 노출 검사; osv-scanner나 npm audit, pip-audit로 의존성 취약점 검사; OWASP ZAP baseline 검사(공개 서비스)

원문: `python3 ~/.agents/work-methods/readiness.py source asvs owasp-top10-2025 nist-800-63b owasp-auth-tests cipa-exif`

### 이 프로젝트 맞춤

<!-- custom:asvs -->
개인 수신함의 모든 메일·첨부·설정 API에서 세션을 검증한다. MIME 첨부 원본은 증거 보존을 위해 변형하지 않으며 다운로드 전용으로 제공한다. 세션·CSRF·요청 크기·HTML 격리·동시성 경계를 통합 시험으로 확인한다.
<!-- /custom:asvs -->
<!-- /standard:asvs -->

<!-- standard:data-formats -->
## 데이터 형식 표준 (UTF-8, JSON, ISO 8601/RFC 3339)

문자, 날짜, 데이터 교환의 기본 표준.

### 기준 규칙

- 글자는 UTF-8로 저장하고 주고받는다.
- 날짜와 시간은 RFC 3339(ISO 8601) 형식과 시간대를 함께 저장한다. 화면에는 사용자 지역 형식으로 보인다.
- 데이터 교환은 JSON(RFC 8259)이나 표준 형식을 쓰고, 금액은 정수 최소 단위와 통화 코드(ISO 4217)로 다룬다.
- 미래 일정과 반복 일정은 UTC 오프셋과 함께 IANA 시간대 이름(Asia/Seoul)을 저장한다. 문자열로 주고받을 때는 RFC 9557 형식(2026-10-08T09:00:00+09:00[Asia/Seoul])을 쓴다.
- 나라는 ISO 3166-1 두 글자 코드(KR), 전화번호는 E.164 국제 형식(+82로 시작)으로 저장한다.
- 사용자가 입력한 글자는 유니코드 NFC로 정규화해 저장하고 비교한다. 그래야 자모가 풀린 한글과 합쳐진 한글이 다른 글자로 취급되지 않는다.

원문: `python3 ~/.agents/work-methods/readiness.py source rfc3339 rfc8259 rfc9557 iana-tz iso-3166 itu-e164 w3c-charmod-norm`

### 이 프로젝트 맞춤

<!-- custom:data-formats -->
기존 DB의 UTC 밀리초 숫자를 유지하고 표시할 때 한국어 지역 형식으로 변환한다. 원본 메일은 변형하지 않는다. 사용자가 쓰는 검색어와 주소 메모는 UTF-8로 다룬다.
<!-- /custom:data-formats -->
<!-- /standard:data-formats -->

<!-- standard:web-vitals -->
## Core Web Vitals (LCP 2.5초, INP 200ms, CLS 0.1) — 공개 웹 페이지일 때

웹 화면 속도와 안정성의 업계 기준.

### 기준 규칙

- 이미지는 크기를 지정하고 적절한 형식과 크기로 내보낸다.
- 첫 화면에 필요 없는 스크립트는 늦게 불러온다.
- 광고나 늦게 뜨는 요소가 내용을 밀어내지 않게 자리를 잡아 둔다.
- 사진은 AVIF나 WebP로 내보내고, srcset과 sizes로 화면 크기에 맞는 파일을 받게 하며, 첫 화면 밖 이미지는 loading="lazy"로 늦게 받는다.
- 파일 이름에 내용 해시가 붙은 정적 파일은 Cache-Control: max-age=31536000, immutable로 오래 캐시하고, HTML은 매번 새로 확인하게 한다.

자동 검사: Lighthouse 성능 측정; web-vitals 라이브러리나 PageSpeed Insights로 실제 사용자 값 확인

원문: `python3 ~/.agents/work-methods/readiness.py source web-vitals page-experience aom-avif rfc9649 rfc8246 whatwg-html`

### 이 프로젝트 맞춤

<!-- custom:web-vitals -->
설정 화면의 코드는 필요할 때 로드한다. 메일 목록 갱신을 취소할 수 있게 하고 중복 조회를 줄인다. 빌드 크기와 대표 브라우저 로딩·상호작용을 측정하며 로컬 값을 운영 사용자 값으로 표현하지 않는다.
<!-- /custom:web-vitals -->
<!-- /standard:web-vitals -->

<!-- standard:pwa -->
## Web App Manifest — 설치형 웹앱(PWA)으로 낼 때

웹앱을 홈 화면에 설치하게 하는 표준.

### 기준 규칙

- manifest에 이름, 아이콘(192px, 512px), 시작 주소, 표시 방식을 둔다.

자동 검사: Lighthouse PWA 항목 확인

원문: `python3 ~/.agents/work-methods/readiness.py source web-manifest`

### 이 프로젝트 맞춤

<!-- custom:pwa -->
앱 셸만 캐시하고 API 응답·메일 본문·첨부는 저장하지 않는다. 기존 아이콘과 manifest를 유지하고 오프라인 복구와 업데이트를 검사한다.
<!-- /custom:pwa -->
<!-- /standard:pwa -->

<!-- standard:licensing -->
## 라이선스 표기 (SPDX, REUSE)

코드, 글꼴, 그림, 소리를 쓸 권리를 밝히는 표준.

### 기준 규칙

- 가져다 쓴 코드와 에셋의 라이선스를 확인하고 출처를 ASSETS.md나 고지 파일에 남긴다.
- 내 프로젝트의 라이선스를 SPDX 식별자로 LICENSE에 밝힌다.
- 상업 이용, 변형, 재배포 조건이 맞지 않는 에셋은 쓰지 않는다.

자동 검사: reuse lint; license-checker나 pip-licenses로 의존성 라이선스 목록 만들기

원문: `python3 ~/.agents/work-methods/readiness.py source spdx-licenses reuse cc`

### 이 프로젝트 맞춤

<!-- custom:licensing -->
비공개 개인용 프로젝트로 공개 라이선스를 새로 부여하지 않는다. 사용 중인 에셋과 라이브러리의 출처·고지 파일을 유지한다.
<!-- /custom:licensing -->
<!-- /standard:licensing -->

<!-- standard:graphics -->
## 그래픽 형식과 색 (SVG, PNG, sRGB, 인쇄는 PDF/X)

로고, 아이콘, 그림 파일을 어디서나 같게 보이게 하는 표준.

### 기준 규칙

- 로고와 아이콘은 SVG 원본을 두고, 필요한 크기의 PNG를 함께 내보낸다.
- 화면용 색과 이미지는 sRGB로 만든다. 인쇄물은 인쇄소가 요구하는 PDF/X 형식과 CMYK 사양으로 낸다.
- 브랜드 색은 HEX와 RGB 값으로 적어 디자인과 코드가 같은 값을 쓰게 한다.
- 공개하는 사진에서는 위치(GPS), 기기 일련번호 같은 Exif 정보를 지운다. C2PA 내용 증명은 남긴다.

자동 검사: SVGO로 SVG 정리; ImageMagick identify로 색 공간과 크기 확인

원문: `python3 ~/.agents/work-methods/readiness.py source svg2 png3 srgb cipa-exif`

### 이 프로젝트 맞춤

<!-- custom:graphics -->
기존 Mailroom SVG·PNG 브랜드 에셋과 Lucide 아이콘을 사용한다. 추가 그림이 필요하지 않은 설정과 수신함에는 장식을 더하지 않는다.
<!-- /custom:graphics -->
<!-- /standard:graphics -->

<!-- standard:privacy -->
## 개인정보 보호 (한국 개인정보보호법, GDPR) — 개인정보를 모을 때(문의 폼, 회원, 분석 도구, 광고, 댓글 포함)

개인정보를 모을 때 지키는 법.

### 기준 규칙

- 꼭 필요한 정보만 모은다. 문의 폼도 답장에 필요한 칸만 둔다.
- 무엇을 왜 얼마나 보관하는지 처리방침에 적고, 모든 페이지에서 처리방침으로 갈 수 있게 한다.
- 분석 도구, 광고, 필수가 아닌 쿠키는 대상 지역 규칙에 맞게 미리 알리고, 동의가 필요한 곳에서는 동의 전에 켜지 않는다.
- 만 14세 미만은 법정대리인 동의를 받는다.
- 사용자가 자기 정보를 보고 지우고 탈퇴할 수 있게 한다.
- 적용되는 다른 법은 regulations.md의 판별 질문으로 가린다.
- EEA, 영국, 스위스 사용자에게 Google AdSense, Ad Manager, AdMob 맞춤 광고를 띄우면 Google 인증을 받은 CMP(IAB TCF 연동)로 동의를 받는다.

원문: `python3 ~/.agents/work-methods/readiness.py source kr-privacy gdpr-scope cookies google-cmp`

### 이 프로젝트 맞춤

<!-- custom:privacy -->
메일·인증정보를 로그·브라우저 영구 저장소·시험 산출물에 남기지 않는다. Jev 전송 전 민감 토큰을 가리고 외부 이미지는 메일별 동의 뒤 요청한다. 가입·광고·분석 추적 기능은 없다.
<!-- /custom:privacy -->
<!-- /standard:privacy -->

<!-- standard:fonts -->
## 글꼴 형식 (Open Font Format ISO/IEC 14496-22:2026 = OpenType, WOFF2) — 글꼴 파일을 직접 넣거나 브랜드 글꼴을 정할 때

글꼴 원본과 웹 글꼴을 어디서나 같게 쓰는 표준 형식.

### 기준 규칙

- 글꼴 원본은 OpenType(.otf, .ttf)으로 두고 라이선스 파일을 함께 보관한다.
- 글꼴 라이선스가 웹 임베딩, 앱 포함, PDF 포함을 허용하는지 쓰기 전에 확인한다.
- 웹에 싣는 글꼴은 WOFF2로 내보낸다.
- 한글처럼 글자 수가 많은 글꼴은 쓰는 글자만 남기거나 unicode-range로 나눠 받게 해 첫 화면 용량을 줄인다.

자동 검사: fonttools(pyftsubset --flavor=woff2)로 서브셋과 WOFF2 변환

원문: `python3 ~/.agents/work-methods/readiness.py source off-iso14496-22 w3c-woff2 ms-opentype`

### 이 프로젝트 맞춤

<!-- custom:fonts -->
기존 Pretendard WOFF2를 자체 호스팅하고 시스템 글꼴 대체와 font-display: swap을 유지한다.
<!-- /custom:fonts -->
<!-- /standard:fonts -->

<!-- standard:web-security-headers -->
## 웹 보안 헤더와 쿠키 (HSTS RFC 6797, CSP, CORS, SRI, 쿠키 속성)

브라우저가 내 사이트를 안전하게 다루도록 응답에 붙이는 헤더와 쿠키 설정.

### 기준 규칙

- 모든 응답에 Strict-Transport-Security 헤더를 보내고 max-age는 1년(31536000초) 이상으로 한다.
- CORS의 Access-Control-Allow-Origin은 고정값이나 허용 목록으로만 준다. 요청의 Origin을 확인 없이 그대로 돌려주지 않는다.
- 쿠키에는 Secure 속성과 __Host- 또는 __Secure- 접두어를 붙이고, 세션 쿠키는 HttpOnly와 SameSite도 붙인다.
- Content-Security-Policy로 스크립트를 불러올 출처를 제한하고, frame-ancestors로 다른 사이트에 끼워 넣기를 막고, X-Content-Type-Options: nosniff를 보낸다.
- 외부 CDN에서 불러오는 스크립트와 스타일에는 SRI(integrity 속성)를 단다.

자동 검사: Mozilla HTTP Observatory; curl -I로 응답 헤더 확인

원문: `python3 ~/.agents/work-methods/readiness.py source asvs owasp-headers rfc6797 w3c-csp3 w3c-sri`

### 이 프로젝트 맞춤

<!-- custom:web-security-headers -->
운영 세션 쿠키는 __Host-·Secure·HttpOnly·SameSite=Strict를 사용한다. 메일 HTML에는 별도 CSP와 sandbox를 적용한다. 로컬 테스트도 운영 인증정보를 사용하지 않는다.
<!-- /custom:web-security-headers -->
<!-- /standard:web-security-headers -->

<!-- standard:observability -->
## 로그와 요청 추적 (W3C Trace Context, OpenTelemetry, OWASP Logging) — 서버나 늘 도는 봇을 운영할 때

운영 중인 서버에서 문제를 찾아낼 수 있게 남기는 로그와 추적 기준.

### 기준 규칙

- 로그는 한 줄에 한 사건씩 JSON 같은 구조화 형식으로 남기고, 시각(UTC나 시간대 포함), 수준, 요청 ID를 넣는다.
- 서비스 사이를 오가는 요청은 W3C traceparent 헤더로 이어서 한 요청을 끝까지 따라갈 수 있게 한다.
- 비밀번호, 액세스 토큰, 세션 ID, 카드 정보, 민감한 개인정보는 로그에 그대로 남기지 않고 지우거나 가린다.
- 로그인 성공과 실패, 권한 거부를 기록한다.

자동 검사: OpenTelemetry SDK 자동 계측; gitleaks로 로그 샘플 속 비밀 검사

원문: `python3 ~/.agents/work-methods/readiness.py source w3c-trace-context otel-logs owasp-logging asvs`

### 이 프로젝트 맞춤

<!-- custom:observability -->
진단에는 사건 종류와 오류 종류만 기록한다. URL 쿼리·본문·토큰·주소가 포함된 예외 문자열은 로그에 넣지 않는다.
<!-- /custom:observability -->
<!-- /standard:observability -->

<!-- standard:qr-code -->
## QR 코드 (ISO/IEC 18004:2024) — 인쇄물이나 화면에 QR 코드를 넣을 때

인쇄물과 화면의 QR 코드가 잘 읽히게 하는 국제 표준.

### 기준 규칙

- QR 코드 둘레에 4모듈 폭 이상의 빈 여백(quiet zone)을 둔다.
- 오류 정정 수준은 M 이상으로 만들고, 짙은 점을 밝은 바탕에 둔다.
- 실제 인쇄 크기로 시험 인쇄해 여러 휴대폰 카메라로 읽히는지, 넣은 주소가 HTTPS로 바로 열리는지 확인한다.

자동 검사: zbarimg로 만든 이미지 읽기 확인

원문: `python3 ~/.agents/work-methods/readiness.py source iso-18004 denso-qr-margin`

### 이 프로젝트 맞춤

<!-- custom:qr-code -->
TOTP 등록 QR은 로컬에서 생성한다. 설정 키를 외부 QR 생성 서비스에 전송하지 않는다.
<!-- /custom:qr-code -->
<!-- /standard:qr-code -->

## 이 프로젝트만의 규칙과 계획

<!-- custom:project -->
src/ui가 공통 UI와 토큰의 유일한 정의다. 화면 CSS는 배치와 메일 고유 표현을 담당하며 공통 조작 요소의 모양을 덮어쓰지 않는다. npm run check와 npm run test:e2e로 검사한다. 주소와 메일을 자동 만료시키지 않는다. 영구 삭제는 휴지통과 사용자 확인을 거친다.
<!-- /custom:project -->

## 해당 없음으로 뺀 표준

<!-- custom:skipped -->
- OAuth 2.0 보안 모범 사례와 OpenID Connect (RFC 9700, RFC 7636 PKCE, OIDC Core = ISO/IEC 26131:2024): Jev 판정: 해당 없음(해당 확률 0.03)
- 표 데이터 교환 (CSV RFC 4180, CSV 수식 주입 방지): Jev 판정: 해당 없음(해당 확률 0.08)
- 아동 대상 설계 (UK Age Appropriate Design Code, IEEE 2089-2021): Jev 판정: 해당 없음(해당 확률 0.09)
<!-- /custom:skipped -->

## 다 됐는지 확인

계획 지도의 '완성 기준' 작업이 이 표준을 포함한 점검 목록이다. 모두 증거와 함께 끝나야 완성이다.
