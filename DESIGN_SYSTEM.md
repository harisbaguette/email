# Mailroom 디자인 시스템

모든 화면은 `src/ui`에서 컴포넌트를 가져온다. 색·크기·모서리·간격은 `src/ui/tokens.css`, 공통 조작 요소의 모양은 `src/ui/components.css`에서 바꾼다. `src/styles.css`는 화면 배치와 메일의 내용 표현을 담당한다.

## 기본 규격

| 항목        | 규칙                                                                           |
| ----------- | ------------------------------------------------------------------------------ |
| 조작 영역   | 버튼·입력·선택 메뉴·스위치 최소 높이 44px                                      |
| 모서리      | 조작 요소 12px, 작은 배지 8px, 패널·모달 20px                                  |
| 글자        | 입력 16px, 본문 15px, 버튼·레이블 14px, 보조 정보 12px                         |
| 간격        | 4·8·12·16·20·24·32px 토큰 사용                                                 |
| 색          | 본문 `--text`, 설명 `--muted`, 구분선 `--line`, 선택 `--blue`, 위험 `--danger` |
| 키보드      | 모든 조작에 포커스 표시. 모달을 닫으면 연 버튼으로 복귀                        |
| 작은 화면   | 320px부터 사용 가능. 조작 높이를 줄이지 않고 배치를 바꿈                       |
| 동작 줄이기 | `prefers-reduced-motion`에서는 애니메이션과 전환을 제거                        |

## 컴포넌트 선택

| 컴포넌트       | 사용할 곳과 규칙                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`       | `primary`: 주요 완료 행동. `secondary`: 취소·보조 행동. `ghost`: 낮은 강조. `danger`: 영구 삭제. `danger-ghost`: 수신 중지·로그아웃. `row`: 목록 행. `navigation`: 설정 이동 |
| `IconButton`   | 아이콘만 있는 작업. `label` 필수. 삭제는 `tone="danger"`                                                                                                                     |
| `ButtonLink`   | 다운로드·외부 이동처럼 URL을 여는 버튼 모양의 링크                                                                                                                           |
| `Field`        | 입력 레이블·설명·오류 연결. `label`, 선택적으로 `hint`, `error`                                                                                                              |
| `TextInput`    | 문자·비밀번호·날짜 입력. `Field`의 ID와 오류 설명을 자동 연결                                                                                                                |
| `SearchField`  | 검색 아이콘과 입력을 묶음. `label` 필수                                                                                                                                      |
| `Checkbox`     | 다중 선택·동의. 보이는 레이블 또는 접근성 이름 필수                                                                                                                          |
| `Switch`       | 즉시 저장하는 켜기·끄기. 이름과 `checked`, `onCheckedChange` 필수                                                                                                            |
| `Select`       | 하나의 값 선택. 방향키·Enter·Escape 지원. 모달 내부에서도 사용 가능                                                                                                          |
| `ActionMenu`   | 여러 보조 행동. 자식은 `MenuItem` 또는 `MenuLink`. Escape로 닫고 방향키로 이동                                                                                               |
| `Modal`        | 확인·짧은 입력. 제목 필수. 처리 중에는 `busy`로 닫기 차단. 파괴적 작업은 취소에 초기 포커스                                                                                  |
| `Disclosure`   | 부가 설명·설정 펼치기. `summary`에 요약                                                                                                                                      |
| `Badge`        | 짧은 상태·수신 주소. 색과 함께 글자로 의미 표시                                                                                                                              |
| `Notice`       | 화면·입력 오류 또는 안내. `error`, `success`, `info`. 오류를 해당 작업 가까이에 표시                                                                                         |
| `EmptyState`   | 빈 목록의 제목·아이콘·다음 행동                                                                                                                                              |
| `LoadingState` | 비동기 화면의 대기 안내                                                                                                                                                      |
| `Toast`        | 간단한 완료 알림. 오류와 되돌리기는 사용자가 닫을 때까지 유지                                                                                                                |

버튼의 기본 `type`은 `button`이다. 폼 제출은 `type="submit"`을 명시한다. 비활성화는 `disabled`, 진행 중은 `busy`를 사용하고 진행 상태를 글자로도 보여 준다.

```tsx
import { Button, Field, TextInput } from './ui';

<form onSubmit={save}>
  <Field label="주소 메모" hint="60자까지 입력할 수 있습니다." error={error}>
    <TextInput value={memo} maxLength={60} onChange={(event) => setMemo(event.target.value)} />
  </Field>
  <Button type="submit" variant="primary" busy={saving}>
    {saving ? '저장 중…' : '저장'}
  </Button>
</form>;
```

새로운 모양이 필요하면 먼저 기존 variant를 사용한다. 반복되는 새 행동은 공통 컴포넌트에 정의한 뒤 화면에 연결한다. 화면에서 네이티브 조작 요소를 직접 만들거나 공통 버튼·입력의 스타일을 덮어쓰지 않는다.

`npm run check:ui`는 직접 만든 조작 요소, 하드코딩한 색, 공통 컨트롤 덮어쓰기, 중복 CSS를 검사한다. `npm run check`는 UI 검사·서버 시험·빌드를, `npm run test:e2e`는 실제 브라우저의 핵심 과업을 확인한다.
