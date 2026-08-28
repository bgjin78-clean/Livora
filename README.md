# Livora

틱톡·유튜브 라이브 채팅에서 주문을 접수하는 서버형 데스크입니다.
승인된 채널만 연결되며, 설치 프로그램 없이 브라우저로 사용합니다.

## 실행

```bash
npm install
npm start
```

브라우저에서 `http://localhost:4173` 을 엽니다.

기본 관리자: `admin` / `livora-admin`
기본 판매자: `seller` / `seller1234`

운영 전에 `.env`의 비밀번호와 `JWT_SECRET`을 바꾸세요.
유튜브 수집은 `YOUTUBE_API_KEY`가 필요합니다.

## 배포

Vercel에는 올리지 마세요. 라이브 채팅 수집, SQLite, WebSocket이 서버리스와 맞지 않아 500이 납니다.

항상 켜져 있는 Node 서버가 필요합니다. GitHub 저장소를 [Render](https://render.com)나 Railway에 연결하고 Dockerfile로 배포하세요. 대시보드에서 `ADMIN_PASSWORD`, `JWT_SECRET`, `YOUTUBE_API_KEY`를 넣으면 됩니다.
