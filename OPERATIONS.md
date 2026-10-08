# 운영

## 이상이 생기면

GitHub의 **Mailroom 운영 감시**가 15분 간격으로 HTTPS, 인증서 만료, DB 연결, 예약 작업과 최근 이상 징후를 확인한다. GitHub 예약 작업은 지연되거나 비활성화될 수 있으므로 실시간 감시를 보장하지 않는다. 저장소 소유자는 GitHub 알림 설정에서 Actions의 실패 알림을 켠다.

- `login_attack`: 로그인한 기기를 확인하고 낯선 기기를 해제한다. 비밀번호를 바꾸고 2단계 인증을 켠다.
- `mail_limited`: 설정에서 공격받는 주소의 수신을 중지한다. 기존 메일은 유지된다.
- `storage_near_limit`, `storage_full`: 필요한 원본을 먼저 내려받은 뒤 불필요한 메일만 직접 삭제한다.
- `scheduled_jobs_stale`, `cron_error`: Cloudflare의 `bluekite-mail` 예약 실행과 D1 상태를 확인한다.
- `api_error`, `mail_error`: Worker 로그의 사건 종류와 요청 ID를 확인한다. 비밀값이나 메일 본문은 로그에 넣지 않는다.

`/api/health`는 앱 연결, `/api/monitor`는 DB와 예약 작업까지 확인한다. 후자는 Cloudflare `MONITOR_TOKEN`과 GitHub `MAILROOM_MONITOR_TOKEN`의 같은 값으로 인증한다. 이 토큰에는 메일 읽기나 설정 변경 권한이 없다.

## 백업과 복원

D1 Time Travel이 변경 사항을 자동 보관한다. 무료 플랜의 복구 가능 기간은 7일이다. 운영 DB는 `bluekite-mail`이며 다른 프로젝트의 DB를 사용하지 않는다.

1. `npx wrangler d1 time-travel info bluekite-mail`로 복구 가능한 북마크를 확인한다.
2. 복원 전에 `npx wrangler d1 export bluekite-mail --remote --output .local/mail-backup.sql`로 현재 상태를 별도 보관한다. `.local`은 권한 700, 백업은 600으로 제한한다.
3. 백업은 먼저 별도의 로컬 D1 저장소에서 읽어 주소 수, 메일 수, 원본 조각과 외래 키를 확인한다. 운영 DB에 시험 복원하지 않는다.
4. 실제 복원이 필요할 때만 `npx wrangler d1 time-travel restore bluekite-mail --bookmark 북마크`를 사용한다. 복원 시점 이후의 변경이 사라지므로 현재 백업과 비교한다.
5. 복원 뒤 세션과 알림 구독을 해제하고 비밀번호를 다시 설정한다. MFA 키와 Cloudflare 비밀값은 D1 백업에 없으므로 별도로 안전하게 보관해야 한다.

SQL 백업에는 메일 원문과 인증 정보가 있다. Git, 이슈, 채팅이나 공개 아티팩트에 올리지 않는다.

## 갱신

Cloudflare가 사용자 지정 도메인의 TLS 인증서를 관리한다. 외부 감시는 유효기간이 14일 미만이면 실패한다. `security.txt`의 만료일도 감시하며 30일 전에 실패한다.

감시 토큰을 바꾸면 Cloudflare와 GitHub의 비밀값을 함께 갱신한다. 감시 실패 훈련은 Actions의 `drill` 옵션으로 실행할 수 있고 운영 데이터는 바꾸지 않는다.
