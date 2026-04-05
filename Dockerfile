FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY shared/ shared/
COPY packages/reporting-app/backend/ packages/reporting-app/backend/
COPY packages/reporting-app/shared/ packages/reporting-app/shared/
COPY packages/reporting-app/package.json packages/reporting-app/
RUN npm ci --ignore-scripts
RUN npx turbo run build --filter=medical-report-system-backend

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/shared/ shared/
COPY --from=builder /app/packages/reporting-app/backend/ packages/reporting-app/backend/
COPY --from=builder /app/packages/reporting-app/shared/ packages/reporting-app/shared/
COPY --from=builder /app/packages/reporting-app/package.json packages/reporting-app/
COPY --from=builder /app/node_modules/ node_modules/
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "packages/reporting-app/backend/dist/server.js"]
