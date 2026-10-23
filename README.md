# MiniLedger

MiniLedger is a simple phone-authenticated lending ledger for keeping track of money lent to friends. It includes a TypeScript/Fastify/PostgreSQL backend and a React Native Android app.

## Prerequisites

- Node.js 24 or a supported current Node.js release, with npm
- PostgreSQL 18 (or a compatible PostgreSQL release)
- Java 17, Android SDK, and an Android emulator for the mobile app
- Android SDK platform/build tools required by the generated Gradle project

## Backend setup

From the repository root:

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Edit `backend/.env` locally and set `DATABASE_URL`, `JWT_SECRET`, and `OTP_SECRET`. Use distinct, randomly generated secrets for JWT signing and OTP digesting. Do not commit `.env` or share its values. The example file contains placeholders only.

Create the PostgreSQL database named `miniledger` if it does not already exist. For a local PostgreSQL installation, this command prompts for the `postgres` role password:

```powershell
createdb -h localhost -p 5432 -U postgres miniledger
```

Apply migrations, generate the Prisma client, and verify connectivity:

```powershell
npm run db:migrate -- --name init
npm run prisma:generate
npm run db:check
```

Start the development backend:

```powershell
npm run dev
```

The API listens on port `3001` by default. Set `PORT` in the local environment to override it. Production-style startup is `npm run build` followed by `npm start`.

## Android app setup

Install the React Native dependencies:

```powershell
cd ..\mobile
npm install
```

Start the backend in another terminal. From the mobile directory, start Metro:

```powershell
npm start
```

For the Android emulator, configure the standard ADB port forwarding to the host services, then start the app:

```powershell
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3001 tcp:3001
npm run android
```

The app uses `http://localhost:3001` and sends authenticated loan requests with the in-memory JWT. Debug Android cleartext traffic is enabled by the generated development manifest placeholder; do not use HTTP for production deployment.

## Mock OTP login

Enter an international-format phone number such as `+14155552671` and request an OTP. The mock six-digit OTP is printed in the backend terminal, not returned in the API response. Enter it in the app within five minutes. A successful verification returns a one-hour Bearer JWT; the mobile app keeps it in component state for the current session.

## API endpoints

Protected endpoints require `Authorization: Bearer <token>`.

- `POST /auth/otp/request` — request a mock OTP for `{ "phoneNumber": "+14155552671" }`.
- `POST /auth/otp/verify` — verify `{ "phoneNumber": "+14155552671", "otp": "123456" }`; returns `{ "token": "…", "tokenType": "Bearer" }`.
- `GET /health` — backend health check.
- `POST /loans` — create a loan with `friendName`, positive decimal-string `amount`, and ISO `dueDate` (`YYYY-MM-DD`). Owner comes from the JWT.
- `GET /loans` — list the authenticated user's loans, newest first.
- `PATCH /loans/:id/repay` — mark an owned loan repaid; repeating the request preserves its original repayment time.
- `GET /loans/summary` — return the authenticated user's total lent, repaid, and overdue amounts as decimal strings. A loan due today is not overdue until the next UTC date.

## Tests and checks

Backend:

```powershell
cd ..\backend
npm test
npm run typecheck
npm run build
npm run db:check
```

Mobile:

```powershell
cd ..\mobile
npm test -- --runInBand
npx tsc --noEmit
npm run lint
```

Build the Android debug APK from `mobile/android`:

```powershell
.\gradlew.bat assembleDebug
```

The APK is written to `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
