FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json turbo.json ./
COPY packages/reporting-app/package.json packages/reporting-app/
COPY packages/reporting-app/backend/package.json packages/reporting-app/backend/
COPY packages/reporting-app/shared/package.json packages/reporting-app/shared/

RUN npm ci --ignore-scripts

COPY packages/reporting-app/shared/ packages/reporting-app/shared/
COPY packages/reporting-app/backend/ packages/reporting-app/backend/

RUN npx turbo run build --filter=medical-report-system-backend

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends wget tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/reporting-app/package.json packages/reporting-app/
COPY --from=builder /app/packages/reporting-app/backend/dist/ packages/reporting-app/backend/dist/
COPY --from=builder /app/packages/reporting-app/backend/package.json packages/reporting-app/backend/
COPY --from=builder /app/packages/reporting-app/backend/migrations/ packages/reporting-app/backend/migrations/
COPY --from=builder /app/packages/reporting-app/shared/dist/ packages/reporting-app/shared/dist/
COPY --from=builder /app/packages/reporting-app/shared/package.json packages/reporting-app/shared/

RUN npm ci --omit=dev --ignore-scripts

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/reporting-app/backend/dist/server.js"]
