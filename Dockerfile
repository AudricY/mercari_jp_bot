# syntax=docker/dockerfile:1

FROM node:22-slim AS base

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.22.0

# Install dependencies first (cached unless lockfile/workspace config changes)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/unified/package.json ./apps/unified/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
COPY scripts ./scripts

RUN pnpm run db:generate
RUN pnpm run build

CMD ["pnpm", "--filter", "@mercari-bot/unified", "run", "start"]
