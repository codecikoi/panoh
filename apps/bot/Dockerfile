# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/bot/package.json apps/bot/
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @madat/bot build

FROM node:22-alpine
# Headless Chromium prints the PDF reports; Noto covers the scripts of all 30 bot languages (incl. CJK, Arabic, Hebrew, Indic, Thai) and emoji.
RUN apk add --no-cache chromium font-noto font-noto-cjk font-noto-arabic font-noto-hebrew font-noto-thai \
      font-noto-devanagari font-noto-bengali font-noto-emoji \
 && fc-cache -f >/dev/null
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/bot/dist ./dist
COPY --from=build /repo/packages/core/drizzle ./drizzle
ENV MIGRATIONS_DIR=/app/drizzle
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
