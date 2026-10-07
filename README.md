# Bluekite Mail

`@bluekite.co.kr`로 오는 메일을 [email.bluekite.co.kr](https://email.bluekite.co.kr)에서 읽는 개인 수신함입니다.

- **주소 만들기 → 만들고 복사**를 누르면 바로 쓸 주소가 준비됩니다. 자동으로 채운 이름을 `pixiv`처럼 바꿔도 됩니다. 미리 만들지 않은 주소도 메일이 도착하면 수신함에 나타납니다.
- 주소를 만든 뒤에는 해당 주소의 메일이 자동으로 갱신됩니다. 메일에 인증번호가 명확히 적혀 있으면 **인증번호 복사**로 가져올 수 있습니다.
- 모든 주소를 한곳에서 보거나, 왼쪽 주소를 선택해 따로 볼 수 있습니다.
- 제목·보낸 사람·받는 주소·본문으로 검색할 수 있습니다.
- 첨부 파일과 `.eml` 원본을 내려받을 수 있습니다.
- 메일과 주소는 자동 삭제하지 않습니다. 휴지통의 메일도 직접 영구 삭제하기 전까지 보관합니다.
- 외부 이미지는 기본으로 차단합니다. 필요한 메일에서 **외부 이미지 표시**를 누르면 불러옵니다.

수신 전용입니다. 메일 한 통은 첨부를 포함해 10 MiB까지 받습니다. 긴 본문은 화면에서 일부만 표시하며 전체 내용은 원본 파일에 보관합니다. 서버는 Cloudflare Workers와 D1을 사용하며 Gmail·네이버로 전달하지 않습니다.

## 로그인

처음 설정한 비밀번호는 이 컴퓨터의 `.local/접속정보.txt`에 있습니다. 로그인 후 **설정 → 비밀번호 변경**에서 바꿀 수 있습니다.

비밀번호를 잊었을 때는 Cloudflare 계정에 로그인한 컴퓨터에서 다음 명령을 실행합니다. 새 비밀번호가 같은 파일에 저장되고 기존 로그인은 모두 해제됩니다.

```sh
npm run password:reset
```

## 로컬 실행

Node.js 22 이상이 필요합니다.

```sh
npm ci
npm run db:local
npm run password:local
npm run dev
```

`http://127.0.0.1:8787`에서 열고 `.local/local-access.json`의 비밀번호로 로그인합니다. 로컬 메일과 운영 메일은 분리됩니다. 화면 개발 중에는 다른 터미널에서 `npm run dev:ui`를 실행해 Vite를 사용할 수 있습니다.

```sh
npm test
npm run test:e2e
```

브라우저가 없는 환경에서는 먼저 `npx playwright install chromium`을 실행합니다. 브라우저 검사는 로컬 로그인 비밀번호를 재설정하고 테스트 메일을 넣습니다.

## 배포

Cloudflare 계정과 도메인, D1 연결은 `wrangler.jsonc`에 있습니다.

```sh
npx wrangler login
npm run deploy
```

GitHub에 푸시하는 것만으로 운영 사이트가 갱신되지는 않습니다. `npm run deploy`가 데이터베이스 마이그레이션과 화면·Worker 배포를 수행합니다. 기존 메일과 비밀번호는 유지합니다.

Email Routing의 `*@bluekite.co.kr` catch-all을 `bluekite-mail` Worker로 연결해야 메일이 도착합니다. DNS의 MX 레코드는 Cloudflare Email Routing이 관리합니다. 같은 도메인에 다른 메일 서비스를 연결하면 수신 경로가 달라질 수 있습니다.

데이터베이스에는 메일 본문과 압축한 원본이 함께 들어 있습니다. 별도 백업은 다음 명령으로 만들 수 있습니다. 백업 파일에는 개인 메일이 포함되므로 공개 저장소에 올리지 마세요.

```sh
npx wrangler d1 export bluekite-mail --remote --output .local/backup.sql
```

Cloudflare 요금제의 Workers·D1 사용량과 저장 한도가 적용됩니다. D1이 가득 차거나 한도를 넘으면 새 메일 저장이 실패할 수 있습니다. 설정 화면에서 보관 중인 메일의 용량을 확인할 수 있습니다.

## 사용한 프로젝트

- [PostalMime](https://github.com/postalsys/postal-mime): MIME·첨부 파일 해석
- [sanitize-html](https://www.npmjs.com/package/sanitize-html): 메일 HTML 정리
- [html-to-text](https://github.com/html-to-text/node-html-to-text): HTML 메일의 텍스트 변환
- [Lucide](https://lucide.dev): 아이콘. 출처와 라이선스는 [ASSETS.md](ASSETS.md)에 있습니다.
