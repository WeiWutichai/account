# image เดียวสำหรับทุกแอป (APP=accounting-api | id-api | accounting-web | id-web | console-web) · Node รุ่นเดียวกับ .nvmrc
# build: docker build -f deploy/Dockerfile --build-arg APP=accounting-api -t innovera/accounting-api .
FROM node:26.13.0-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g corepack@0.34.6 && corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG APP
# Next.js (accounting-web · id-web · console-web) ต้อง build · Nest รันด้วย tsx (ESM + .ts imports ตาม M0) — TODO(M3.5): compile เป็น JS เมื่อย้ายออกจาก tsx
RUN if [ -f "apps/$APP/next.config.ts" ]; then pnpm --filter @innovera/$APP build; fi

FROM node:26.13.0-bookworm-slim
ARG APP
ENV NODE_ENV=production APP=${APP} PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g corepack@0.34.6 && corepack enable && groupadd -r app && useradd -r -g app app
WORKDIR /repo
COPY --from=build --chown=app:app /repo /repo
USER app
WORKDIR /repo/apps/${APP}
# Next: next start · Nest: tsx src/main.ts
# รัน binary ใน node_modules ตรง ๆ (ไม่เรียก pnpm/corepack ตอนรัน — user app ไม่มี home)
CMD ["sh", "-c", "if [ -f next.config.ts ]; then exec ./node_modules/.bin/next start -p ${PORT:-3000}; else exec ./node_modules/.bin/tsx src/main.ts; fi"]
