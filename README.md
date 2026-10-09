# 일하는 국회 — 국회의원 실적 대시보드

검증 가능한 의정활동 수치와 상대평가 등급을 공개해, 시민이 의원의 실적을 쉽게 비교하고 의원들이 기록으로 경쟁하도록 만드는 프로젝트입니다.

**현재 단계: 공개 운영.** 데이터는 매주 월요일 자동 갱신됩니다([자동 갱신](docs/auto-update.md)).

- 배포 주소: https://assembly-dashboard.pages.dev
- 배포 방식: Cloudflare Pages Git 연동(루트 `app`, 출력 `public`). `main`에 반영되면 실제 사이트로, 다른 브랜치는 미리보기 주소로 자동 배포됩니다.
- 소스: [`app/`](app/) — Cloudflare Pages Functions(API) + 코드와 함께 배포되는 데이터 파일 + 정적 HTML/JS

2026-10-01: [1차 데이터 검증](docs/data-validation-2026-10-01.md)을 수행했습니다. 입법·출결 자료의 가용성을 확인했고, 최신 표결 API와 국회 원문 간 누락 사례를 발견해 보완 검증 중입니다.

[2차 표결·재임 검증](docs/vote-and-identity-audit-2026-10-01.md): 목록 1,847건 전체 API 대조 및 추가 대상 814건 원문 대조 완료. API 자체 검사 1,033건, 원문 보완 검사 737건 통과. 경계일·총계 차이 77건의 처리 규칙은 회의록을 근거로 정했고 회귀 검증이 남았습니다.

[3차 출결 검증](docs/attendance-audit-2026-10-01.md): 제22대 본회의 XLSX 23개와 위원회 PDF 50개를 검사했습니다. 본회의 일별 상태와 위원회 행은 신원 연결이 가능했고, 공개 합계와 다른 출결 5행 및 위원회별 회의일 연결은 추가 확인 대상으로 남겼습니다.

[출결·표결 예외 후속 검증](docs/attendance-followup-2026-10-01.md): 본회의 119일을 회의록과 대조하고 위원회 9,285행의 의원 신원을 연결했습니다. 표결 예외 77건의 처리 규칙도 공식 회의록을 근거로 마련했습니다.

[3단계: 겸직 기간 처리](docs/role-adjustment.md): 국회의장·국무총리·장관 겸직 기간의 표결·본회의·위원회 기록과 재임일수를 분자·분모에서 함께 제외했습니다. 제외 건수는 표결 API·출결 원본(해시 검증)에서 날짜별로 다시 계산했고, 의원별 전체 합계가 D1과 일치하는지 확인했습니다. 국회부의장은 표시만 합니다.

[2단계 평가 산식 적용](docs/evaluation-draft.md): 위원회 출결 PDF 9,285행을 의원코드에 연결(298/299)해 월별 집계 지표로 추가했습니다. 입법 성과 40%·표결 참여 35%·본회의 출석 15%·위원회 출석 10%로 2단계 산식을 적용했습니다. 위원회 출석은 아직 회의일 단위가 아니라 낮은 비중입니다. 실제 의원 등급은 아직 공개하지 않습니다.

## 핵심 방향

- 공식 기록으로 확인할 수 있는 정량 실적을 공개합니다.
- 종합·항목별 상대평가 등급(S/A/B/C/D), 순위, 실제 수치를 함께 보여줍니다.
- 모든 집계에 기준일·평가 대상·계산 방식·원문 근거를 제공합니다.
- 첫 버전은 전체 의원 실적표, 의원 상세 성적표, 의원 간 비교에 집중합니다.
- 시민 투표·평점·참여 평가 기능은 초기 범위에 포함하지 않습니다.

## 기획 문서

| 문서 | 내용 |
| --- | --- |
| [서비스 기획](docs/product-plan.md) | 목적, 초기 화면과 기능, 확정 범위 |
| [상대평가 설계](docs/evaluation-draft.md) | 등급 구간, 2단계 적용 비중, 남은 쟁점 |
| [1단계 평가 지표 수치](docs/evaluation-metrics-2026-10-01.json) | 299명 전수 입법·표결·출석 지표의 분포 요약 (위원회 추가 전) |
| [데이터 확보 및 검증 계획](docs/data-plan.md) | 데이터 소스, 확인 현황, 품질 검증 |
| [1차 데이터 검증 결과](docs/data-validation-2026-10-01.md) | 실조회·원문 대조 결과와 평가 투입 전 해결할 사항 |
| [2차 표결·재임 검증](docs/vote-and-identity-audit-2026-10-01.md) | 표결 1,847건 대조, 원문 보완, 재임·동명이인 연결 |
| [3차 출결 검증](docs/attendance-audit-2026-10-01.md) | 제22대 본회의·상임위·특위 출결 파일 구조와 오류 검사 |
| [출결·표결 예외 후속 검증](docs/attendance-followup-2026-10-01.md) | 출결 전체 기간·신원 연결 및 표결 예외 처리 근거 |
| [단계별 진행 계획](docs/roadmap.md) | 단계별 산출물과 완료 기준 |
| [의사결정 기록](docs/decisions.md) | 사용자 합의와 미확정 사항 |
| [자동 갱신](docs/auto-update.md) | 주간 자동 수집·재계산·검증 흐름과 자동 반영 중단 조건 |

## 개발 환경

```
.github/workflows/data-update.yml  # 매주 월 06:00(KST) 자동 갱신
app/
  wrangler.toml          # Pages 설정
  data/source/           # 국회 공개 자료를 정리한 원자료(표결·출결·법안·의원)
  data/*.json            # 겸직 기간(member-roles), 정정값, 겸직 제외 건수·협치 가산점(생성)
  pipeline/              # fetch.py(수집) → build.py(재계산) → check.py(검증)
  scripts/compute-scores-stage3.cjs  # 백분위·등급 계산 (build.py가 호출)
  lib/                   # member-records.js·score-run.js(생성), scoring.js, seo.js
  functions/             # Pages Functions (API, 서버 렌더링, sitemap)
  public/                # 정적 프론트엔드, bills/<의원코드>.json(생성)
  migrations/            # 2026-10-09까지 쓰던 D1 스키마·시드(기록용)
```

로컬에서 다시 계산할 때:

```
pip install -r app/pipeline/requirements.txt
cd app/pipeline
ASSEMBLY_API_KEY=... python3 fetch.py   # 원자료 갱신 (키는 환경변수로만)
python3 build.py                        # 네트워크 없이 전부 재계산
python3 check.py                        # 공개본과 비교 검증
```

`build.py`는 같은 원자료에서 항상 같은 결과를 냅니다. 생성 파일(`lib/member-records.js`, `lib/score-run.js`, `data/role-adjustments.json`, `data/coop.json`, `public/bills/*.json`)은 직접 고치지 않습니다.

**데이터 처리 기준**은 `app/public/data-notes.json`에 항목을 추가하면 사이트 `/notes`에 바로 공개됩니다. 겸직 기간은 `app/data/member-roles.json`(날짜·출처)에 기록하면 다음 갱신부터 반영됩니다. 재현 절차와 검증 근거는 [겸직 기간 처리](docs/role-adjustment.md), [전수 재검증](docs/validation-2026-10-08.md), [자동 갱신](docs/auto-update.md)에 있습니다.

## 인증정보 관리

API 인증키와 GitHub 인증정보는 문서·소스·커밋·로그에 포함하지 않습니다. 국회 공공API 키는 환경변수 `ASSEMBLY_API_KEY`로만 읽으며, 자동 갱신은 GitHub 저장소 시크릿에 등록된 값을 씁니다. 배포는 Cloudflare Pages의 Git 연동으로 이뤄지며 별도 토큰이 필요 없습니다.
