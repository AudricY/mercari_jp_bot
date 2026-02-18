# syntax=docker/dockerfile:1

FROM node:22-slim AS base

WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm@10.22.0

COPY package.json tsconfig.json tsconfig.base.json ./
COPY pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
COPY scripts ./scripts

RUN pnpm install
RUN pnpm run db:generate
RUN pnpm run build

CMD ["pnpm", "--filter", "@mercari-bot/unified", "run", "start"]
