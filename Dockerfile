FROM node:24.18.0-alpine@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc

ARG QUALITY_BAR_VERSION
ARG BUNDLED_GIT_VERSION=2.54.0-r0
ARG BUNDLED_CODEX_VERSION=0.145.0

RUN node --eval "if (!/^[0-9]+\\.[0-9]+\\.[0-9]+$/.test(process.argv[1])) throw new Error('QUALITY_BAR_VERSION must be a semantic version')" "$QUALITY_BAR_VERSION"

LABEL org.opencontainers.image.title="Quality Bar" \
      org.opencontainers.image.version="${QUALITY_BAR_VERSION}" \
      org.opencontainers.image.git.version="${BUNDLED_GIT_VERSION}" \
      org.opencontainers.image.codex.version="${BUNDLED_CODEX_VERSION}"

RUN apk add --no-cache "git=${BUNDLED_GIT_VERSION}" \
    && npm install --global "@openai/codex@${BUNDLED_CODEX_VERSION}" \
    && addgroup -g 10001 quality-bar \
    && adduser -D -H -u 10001 -G quality-bar quality-bar \
    && install -d -m 0700 -o 10001 -g 10001 /var/lib/quality-bar /var/lib/quality-bar/codex-home /var/cache/quality-bar/checkouts /var/backups/quality-bar \
    && install -d /etc/quality-bar /run/secrets

WORKDIR /app

COPY --chown=10001:10001 package.json ./
COPY --chown=10001:10001 src ./src

ENV NODE_ENV=production
ENV CODEX_HOME=/var/lib/quality-bar/codex-home

USER 10001:10001

EXPOSE 3000

HEALTHCHECK --interval=2s --timeout=2s --start-period=2s --retries=10 \
  CMD ["node", "src/healthcheck.js"]

CMD ["node", "src/main.js"]
