# Mailroom

개인용 수신 전용 메일함. 프런트엔드는 `email.bluekite.co.kr`, 메일 주소는 `*@bluekite.co.kr`이다.

- `src/`: React 화면, API 클라이언트, 격리된 메일 본문 표시.
- `src/ui/`: 공통 UI 컴포넌트와 디자인 토큰. 사용 규칙은 `DESIGN_SYSTEM.md`, 자동 검사는 `npm run check:ui`. 화면에서 기본 조작 요소를 직접 만들거나 공통 스타일을 덮어쓰지 않는다.
- `worker/`: HTTP API, 세션 인증, MIME 수신·D1 보관. HTTP로 메일을 집어넣는 운영 엔드포인트는 없다.
- `worker/sorting.ts`: 저장 뒤 Jev 분류, D1 잠금·일일 요청 제한·장애 재시도. `sorting-policy.ts`의 기준은 `test/sorting-cases.json`으로 검증한다. 자동 분류는 삭제하지 않으며 사용자 분류를 덮어쓰지 않는다.
- `worker/two-factor.ts`: 인증 앱 TOTP·일회용 복구 코드. 설정 키는 Worker secret `MFA_ENCRYPTION_KEY`로 암호화하며 테스트에서 운영 인증을 켜지 않는다.
- `worker/passkeys.ts`: WebAuthn 패스키 등록·로그인·삭제. RP/origin·UV·일회용 challenge·보안 변경 시점을 검증한다. 테스트는 로컬 가상 인증기로 하고 운영에 테스트 패스키를 등록하지 않는다.
- `shared/`: 화면과 API의 공통 타입.
- `worker/abuse.ts`: API·다운로드 요청 제한과 D1 수신량 예산. 등록한 주소만 수신한다. 저장 한도는 `0006_abuse_protection.sql`의 원자적 트리거와 일치시킨다. 보안 상태 정리는 메일을 삭제하지 않는다.
- `migrations/`: D1 스키마. 운영 DB는 `bluekite-mail`이다.
- `wrangler.jsonc`: Cloudflare 계정·Worker·D1·웹 도메인 설정. doweek의 DB나 Worker를 수정하지 않는다.
- `scripts/reset-password.mjs`: 로컬 또는 운영 비밀번호 재설정. 생성된 비밀번호는 `.local/`에만 기록한다.

명령은 `package.json`을 따른다. `npm test`는 실제 Workers 런타임과 D1 통합 검사, `npm run test:e2e`는 로컬 브라우저 과업 검사다. `npm run deploy`는 화면 빌드·D1 마이그레이션·Worker 배포를 수행한다.

메일 주소와 메일을 만료시키지 않는다. 사용자 비밀값·메일 본문·원본·백업·접속 정보는 Git에 담지 않는다. HTML 본문은 정리 후 sandbox iframe에 표시하고 외부 이미지는 사용자가 허용하기 전에는 불러오지 않는다.
<!-- project-map:start -->
이 프로젝트는 Project Map을 사용한다. 공용 상태는 .project-map/state.json이다.
작업 시작·계획 변경·마일스톤 완료·막힘·인계 시 아래 명령으로 상태를 읽고 바뀐 항목만 갱신한다.
`node "$HOME/.local/share/project-map/cli.cjs" status --root .`
갱신 명령과 스키마: 같은 CLI의 `help`. 사용자 변경을 먼저 반영하고 완료 근거를 적는다.
'완성 기준' 작업은 노트의 확인 방법을 실제로 해 본 결과를 근거로 적어야 완료다. 제품인데 '완성 기준'이 없으면 ~/.agents/work-methods/completeness/done.md대로 넣는다.
STANDARDS.md가 있으면 작업을 시작할 때 읽고 그 표준의 규칙을 지켜서 만든다.
지도는 기존 요청의 진행 기록이며 새 작업의 허가가 아니다. HTML은 자동 생성된다.
<!-- project-map:end -->
