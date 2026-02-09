## to day

생활습관 + 집중 관리 웹앱. 기상부터 점심까지 보호 시간 모드, 하루 기록, 복습 게이트, 투두리스트를 제공합니다.

## Getting Started

### Firebase 설정

Firebase Console에서 웹 앱을 생성한 뒤, 아래 환경 변수를 설정하세요.

```
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
NEXT_PUBLIC_FIREBASE_VAPID_KEY=your_web_push_vapid_key
OPENAI_API_KEY=your_openai_api_key
```

### 기상 알림 푸시(Cloud Functions)

기상 알림을 앱이 닫혀 있을 때도 보내려면 Cloud Functions 스케줄러가 필요합니다.

1) Firebase CLI 로그인 및 프로젝트 선택
2) `functions` 폴더 설치

```bash
cd functions
npm install
```

3) Functions 배포

```bash
firebase deploy --only functions
```

기본 시간대는 `Asia/Seoul`이며, 필요하면 Functions 환경 변수 `TO_DAY_TIME_ZONE`으로 변경하세요.

### 개발 서버 실행

개발 서버를 실행하세요:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 열어 확인합니다.

`src/app/page.tsx`를 수정하면 자동으로 갱신됩니다.

Firebase Auth는 Google 로그인으로 구성되어 있습니다. Firebase 콘솔에서 Google 로그인을 활성화해 주세요.

### 모바일에서 사용하기

- 배포된 주소로 접속하면 휴대폰에서도 바로 사용할 수 있습니다.
- 로컬 개발 중이라면 같은 와이파이에서 PC의 IP:3000으로 접속하세요.
- iOS: 공유 → 홈 화면에 추가
- Android: 브라우저 메뉴 → 앱 설치

## 참고

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs)

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
