# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/bot/package.json apps/bot/
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @budgie/bot build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/bot/dist ./dist
COPY --from=build /repo/packages/core/drizzle ./drizzle
ENV MIGRATIONS_DIR=/app/drizzle
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
