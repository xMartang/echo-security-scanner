# syntax=docker/dockerfile:1

# -- Shared stages (keep in sync with src/api/Dockerfile) --
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

# -- Scanner-specific runtime --
# Adds the Trivy CLI binary so the sandboxed scan processor can call
# `trivy image --server ...` -- the API service has no need for Trivy.
#
# Runs as root, matching the trivy-server service. The bullmq container mounts
# /var/run/docker.sock so the Trivy client can find pre-pulled images locally;
# the socket's owner / group inside the container varies across Docker Desktop
# on macOS, Docker Desktop on Windows, and rootless Linux, so dropping to a
# non-root user requires platform-specific group_add gymnastics. Running as
# root is documented as an accepted trade-off in README "Security trade-offs".
FROM node:24.15.0-alpine AS scanner-runtime

WORKDIR /app

COPY --from=aquasec/trivy:0.70.0 /usr/local/bin/trivy /usr/local/bin/trivy
RUN trivy --version

# Copy only what the runtime needs
COPY --from=deps   /app/node_modules ./node_modules
COPY --from=build  /app/dist         ./dist
COPY --from=build  /app/prisma       ./prisma
COPY package.json ./
COPY src/bullmq/healthcheck.mjs ./healthcheck.mjs

CMD ["node", "dist/bullmq/index.js"]
