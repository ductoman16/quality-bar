FROM node:24.18.0-alpine@sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc

ARG QUALITY_BAR_VERSION

LABEL org.opencontainers.image.title="Quality Bar" \
      org.opencontainers.image.version="${QUALITY_BAR_VERSION}"

RUN addgroup -g 10001 quality-bar \
    && adduser -D -H -u 10001 -G quality-bar quality-bar

WORKDIR /app

COPY --chown=10001:10001 package.json ./
COPY --chown=10001:10001 src ./src

ENV NODE_ENV=production

USER 10001:10001

EXPOSE 3000

HEALTHCHECK --interval=2s --timeout=2s --start-period=2s --retries=10 \
  CMD ["node", "src/healthcheck.js"]

CMD ["node", "src/main.js"]
