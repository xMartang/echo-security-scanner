# syntax=docker/dockerfile:1

# -- Shared stages (keep in sync with src/bullmq/Dockerfile) --
# Both Dockerfiles repeat these stages; Docker BuildKit layer caching ensures
# no duplicated work when both are built from the same context.

FROM node:24.15.0-alpine AS deps

WORKDIR /app

# Disable husky's prepare hook -- it is meaningless (and fails) inside Docker.
ENV HUSKY=0

# Enable corepack so pnpm is available without a global install
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# Schema is needed so prisma generate can create the typed client after install
COPY prisma ./prisma

# Install prod deps only -- no devDependencies -- then generate the Prisma client.
# generate must happen here so the typed client is in the prod node_modules that
# get copied into the runtime stage.
RUN pnpm install --frozen-lockfile --prod && pnpm exec prisma generate

FROM node:24.15.0-alpine AS build

WORKDIR /app
ENV HUSKY=0
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# Install ALL deps (including devDependencies needed for tsc, tsc-alias, prisma)
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client, compile TypeScript, rewrite path aliases
RUN pnpm exec prisma generate && pnpm run build

# -- API-specific runtime --
# Minimal runtime image for the Express API.
# No source, no tests, no devDependencies, no Trivy binary.
FROM node:24.15.0-alpine AS api-runtime

WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 nodeapp && adduser -u 1001 -G nodeapp -D nodeapp
USER nodeapp

# Copy only what the runtime needs
COPY --from=deps   --chown=nodeapp:nodeapp /app/node_modules ./node_modules
COPY --from=build  --chown=nodeapp:nodeapp /app/dist         ./dist
COPY --from=build  --chown=nodeapp:nodeapp /app/prisma       ./prisma
COPY --chown=nodeapp:nodeapp package.json ./

EXPOSE 3000

# Run migrations then start the API.
# prisma migrate deploy is idempotent -- safe to run on every boot.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/api/index.js"]
