# syntax=docker/dockerfile:1

FROM mcr.microsoft.com/playwright:v1.50.0-jammy AS base

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY package.json tsconfig.json tsconfig.base.json ./
COPY pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
COPY scripts ./scripts

RUN pnpm install
RUN pnpm run db:generate
RUN pnpm run build

CMD ["pnpm", "--filter", "@mercari-bot/api", "run", "start"]
