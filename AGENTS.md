# Mailroom

개인용 수신 전용 메일함. 프런트엔드는 `email.bluekite.co.kr`, 메일 주소는 `*@bluekite.co.kr`이다.

- `src/`: React 화면, 스타일 토큰, API 클라이언트, 격리된 메일 본문 표시.
- `worker/`: HTTP API, 세션 인증, MIME 수신·D1 보관. HTTP로 메일을 집어넣는 운영 엔드포인트는 없다.
- `worker/sorting.ts`: 저장 뒤 Jev 분류, D1 잠금·일일 요청 제한·장애 재시도. `sorting-policy.ts`의 기준은 `test/sorting-cases.json`으로 검증한다. 자동 분류는 삭제하지 않으며 사용자 분류를 덮어쓰지 않는다.
- `worker/two-factor.ts`: 인증 앱 TOTP·일회용 복구 코드. 설정 키는 Worker secret `MFA_ENCRYPTION_KEY`로 암호화하며 테스트에서 운영 인증을 켜지 않는다.
- `shared/`: 화면과 API의 공통 타입.
- `migrations/`: D1 스키마. 운영 DB는 `bluekite-mail`이다.
- `wrangler.jsonc`: Cloudflare 계정·Worker·D1·웹 도메인 설정. doweek의 DB나 Worker를 수정하지 않는다.
- `scripts/reset-password.mjs`: 로컬 또는 운영 비밀번호 재설정. 생성된 비밀번호는 `.local/`에만 기록한다.

명령은 `package.json`을 따른다. `npm test`는 실제 Workers 런타임과 D1 통합 검사, `npm run test:e2e`는 로컬 브라우저 과업 검사다. `npm run deploy`는 화면 빌드·D1 마이그레이션·Worker 배포를 수행한다.

메일 주소와 메일을 만료시키지 않는다. 사용자 비밀값·메일 본문·원본·백업·접속 정보는 Git에 담지 않는다. HTML 본문은 정리 후 sandbox iframe에 표시하고 외부 이미지는 사용자가 허용하기 전에는 불러오지 않는다.
