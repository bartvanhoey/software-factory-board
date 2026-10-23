# syntax=docker/dockerfile:1.7

# Pinned by digest. To bump: docker pull <tag>, docker inspect, update the digest here.
FROM mcr.microsoft.com/dotnet/sdk@sha256:738f72aff955d5c5690e06b6fc8ecd1b90ead564099a257ac528ff720b8da85f AS dotnet-sdk

FROM node@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

ARG TARGETARCH
ARG GH_VERSION=2.87.3
ARG GH_SHA256_AMD64=c6e5537631fca45f277ef405ce8751d139b491e9402cc20891a003525a8773b2
ARG GH_SHA256_ARM64=5f5d89563bf26751e2173b37e594065504e85b6b781c1f1832d24bf2c2b4554f
ARG NPM_VERSION=12.2.1
ARG CLAUDE_CODE_VERSION=2.1.308
ARG FACTORY_UID=10001

# git + runtime libs the .NET SDK needs (the SDK itself is copied from the official image).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client \
      libicu72 libssl3 zlib1g libgcc-s1 libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

# GitHub CLI: pinned version, checksum verified.
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) sha="$GH_SHA256_AMD64" ;; \
      arm64) sha="$GH_SHA256_ARM64" ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/gh.tgz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz"; \
    echo "${sha}  /tmp/gh.tgz" | sha256sum -c -; \
    tar -xzf /tmp/gh.tgz -C /tmp; \
    install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh" /usr/local/bin/gh; \
    rm -rf /tmp/gh.tgz "/tmp/gh_${GH_VERSION}_linux_${TARGETARCH}"

# .NET 8 SDK from the pinned official image.
COPY --from=dotnet-sdk /usr/share/dotnet /usr/share/dotnet
RUN ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet

# npm, pinned. npm 12 blocks dependency install scripts unless allowlisted:
# global installs use --allow-scripts, /app uses allowScripts in package.json.
RUN npm install -g "npm@${NPM_VERSION}" \
 && npm cache clean --force

# Claude Code CLI, pinned. Only its own postinstall is allowed to run.
RUN npm install -g --allow-scripts=@anthropic-ai/claude-code "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force

# Non-root user. No sudo, no login shell. The base image's `node` user (uid 1000) is removed.
RUN userdel -r node \
 && groupadd --gid "${FACTORY_UID}" factory \
 && useradd --uid "${FACTORY_UID}" --gid factory --home-dir /home/factory --shell /usr/sbin/nologin factory \
 && mkdir -p /workspace /data /home/factory \
 && chown -R factory:factory /workspace /data /home/factory

COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/factory-entrypoint

# Factory code at /app, owned by root: the agent can read it but never modify it.
# projects/ is mounted at /app/projects by compose.
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY web/package.json web/
RUN npm ci
COPY shared shared
COPY web web
# Built once at image build; `next start` serves it (see the web service in compose).
# `next build` occasionally dies with a V8 crash (exit 133/139, about 1 build in 15 on
# Docker Desktop/WSL2) and then passes unchanged on the next try, so retry a few times.
RUN for attempt in 1 2 3; do \
      NEXT_TELEMETRY_DISABLED=1 npm run build -w web && exit 0; \
      echo "next build crashed (attempt $attempt of 3), retrying" >&2; \
    done; \
    exit 1

ENV HOME=/home/factory \
    DOTNET_NOLOGO=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    DOTNET_GENERATE_ASPNET_CERTIFICATE=false \
    DISABLE_AUTOUPDATER=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    GH_PROMPT_DISABLED=1 \
    GIT_TERMINAL_PROMPT=0

USER factory
ENTRYPOINT ["factory-entrypoint"]
