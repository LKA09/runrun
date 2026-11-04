# RUNRUN

사진 한 장과 짧은 글로 러닝을 인증하는 한국어 커뮤니티입니다.

- React + TypeScript + Vite 프런트엔드. GitHub Pages에서 정적 파일을 배포합니다.
- NestJS 12 + Express 백엔드. Cloudflare의 Node HTTP 어댑터로 Workers에서 실행합니다.
- Better Auth의 Google OAuth 로그인. D1에 사용자와 세션을 저장합니다.
- D1에 러닝 기록과 응원, R2 비공개 버킷에 사진을 저장합니다.

## 서비스 구성

목표 주소는 `https://running.rootnode.kr`입니다. GitHub Pages를 정적 origin으로 두고 Cloudflare Worker가 같은 호스트에서 `/api/*`를 처리합니다. 정적 요청을 GitHub로 전달할 때는 쿠키와 Authorization 헤더를 제거합니다. 브라우저의 서드파티 쿠키 허용에 의존하지 않습니다.

실제 리소스:

- GitHub: https://github.com/LKA09/runrun
- Worker: `runrun-api` / https://runrun-api.gbin8498.workers.dev
- D1: `runrun-db` (APAC)
- R2: `runrun-photos` (공개 버킷 아님)

## 로컬 실행

Node 22 이상이 필요합니다.

```sh
npm ci
cp worker/.dev.vars.example worker/.dev.vars
# worker/.dev.vars에 로컬 Google OAuth 값과 충분히 긴 랜덤 인증 비밀값 설정
npm run db:local
npm run api:dev
```

다른 터미널에서 `npm run dev`를 실행하고 http://127.0.0.1:5173 에 접속합니다. Google OAuth 로컬 콜백은 `http://127.0.0.1:8787/api/auth/callback/google`입니다. 운영 OAuth 콜백은 `https://running.rootnode.kr/api/auth/callback/google`입니다.

## 검증

```sh
npm run build
npm run api:build
npm test   # 로컬 Wrangler API 실행 중에 실행
npm audit --audit-level=high
```

통합 테스트는 고정된 루프백 주소와 `--local` D1만 사용합니다. 테스트용 사용자와 세션을 생성하고 종료 시 제거합니다. 테스트에서는 실제 로컬 D1/R2에 사진을 저장하고, 위조 쿠키·인증 누락·CSRF·타인 삭제·중복 응원·사진 삭제 등을 검증합니다. 운영 인증 우회 기능은 없습니다.

## 보안 설계

- Google 로그인을 Better Auth에 맡기며 이메일/비밀번호 가입은 비활성화했습니다. 외부 계정 연결도 비활성화했습니다.
- 로그인 쿠키는 Secure, HttpOnly, SameSite=Lax이며 Domain을 설정하지 않습니다. 토큰을 localStorage나 URL에 저장하지 않습니다.
- OAuth secret과 인증 secret은 Wrangler Secrets에만 등록합니다. 프런트 빌드에는 공개 설정만 포함합니다.
- API 쓰기는 정확히 일치하는 Origin을 요구합니다. CORS에 와일드카드를 허용하지 않습니다.
- DB 쿼리는 매개변수 바인딩을 사용합니다. 사진 업로드와 삭제, 응원은 검증된 세션을 요구하며 삭제는 작성자 조건을 SQL에 포함합니다.
- 원본 요청 스트림 크기를 제한하고 JSON·폼·날짜·숫자·커서·사진 크기를 검증합니다.
- 프런트가 사진을 JPEG로 다시 인코딩합니다. 서버는 제한된 JPEG 마커 파서로 크기·프레임·세그먼트를 검증하고 EXIF/XMP/코멘트/마지막 마커 뒤 데이터를 제거합니다. 서버에서 임의 이미지를 압축 해제하지 않아 메모리 폭탄과 무료 Workers CPU 제한을 피합니다. 응답은 image/jpeg, nosniff, sandbox CSP로 제한합니다.
- 글은 React의 텍스트 렌더링을 사용하며 HTML로 삽입하지 않습니다. CSP, HSTS, X-Frame-Options 및 Referrer-Policy를 적용합니다.
- D1의 원자적 카운터로 요청/로그인/업로드/응원을 제한합니다. IP는 rate limit 키에 넣기 전에 해시합니다. 인프라 차원의 대규모 DDoS 보호와 사용량 한도는 Cloudflare 정책에 따릅니다.
- 일일 정리 작업이 만료 세션·인증정보·rate limit과 업로드 중단 시 남은 사진을 정리합니다.
- 로그에 요청 본문, 쿠키, 이메일, OAuth 응답을 출력하지 않습니다. 전체 요청 URL을 남기는 invocation log는 비활성화합니다.
- GitHub Actions 권한은 job 단위로 제한하고 외부 Action은 확인한 commit SHA로 고정합니다.

러닝 피드·이름·인증 사진은 공개됩니다. 이메일과 세션은 공개 응답에서 제외합니다. 작성자는 사진과 기록을 함께 삭제할 수 있습니다. 비밀값을 저장소에 커밋하지 마세요.

## 배포

`main` 푸시는 `.github/workflows/pages.yml`을 통해 GitHub Pages를 배포합니다. Worker 변경은 인증된 로컬 CLI에서 별도로 배포합니다.

```sh
npm run db:remote
npx wrangler secret put BETTER_AUTH_SECRET --config worker/wrangler.jsonc
npx wrangler secret put GOOGLE_CLIENT_ID --config worker/wrangler.jsonc
npx wrangler secret put GOOGLE_CLIENT_SECRET --config worker/wrangler.jsonc
npm run api:deploy
```

운영 Google OAuth 클라이언트 `RUNRUN Web`을 생성하고 프로덕션으로 게시했습니다. 기본 프로필·이메일·OpenID만 요청하며 인증정보는 Worker Secrets에 등록했습니다. 실제 브라우저에서 Google 로그인, 세션 유지, 사진 업로드, 피드와 개인 통계, 응원을 확인했습니다. 점검용 게시물과 사진은 검증 후 정리했습니다.

가비아의 DNS 25개와 새 `running` 레코드를 합친 26개를 `.local/rootnode.kr.zone`에 백업하고 Cloudflare로 이전했습니다. 내보낸 zone과 대조해 누락·의도하지 않은 추가·값 변경이 없는 것을 확인했습니다. 등록기관은 가비아에 유지하고 네임서버는 `damian.ns.cloudflare.com`, `liz.ns.cloudflare.com`으로 변경했습니다. `running`만 프록시하며 기존 서비스 레코드는 DNS-only로 유지합니다. TLS Full (Strict), 최소 TLS 1.2, HTTPS 강제 적용, Universal SSL 활성화를 확인했습니다. Worker route는 `running.rootnode.kr/*`입니다. 이전 DNS를 캐시한 리졸버에서는 전파되는 동안 이전 정적 사이트가 보일 수 있습니다.

백업 파일, `.dev.vars`, 빌드 결과와 로컬 DB는 Git에 포함하지 않습니다. OAuth 인증정보를 옮기는 데 사용한 임시 파일은 서버 등록 후 삭제했습니다.

사진 출처: [Unsplash](https://unsplash.com), 러닝 이미지 `photo-1552674605-db6ffd4facb5`. RUNRUN은 Nike와 제휴하지 않은 독립 커뮤니티입니다.
