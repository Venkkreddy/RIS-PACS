# Build from this fork so platform/core fixes (e.g. HangingProtocolService) ship in the bundle.
# Upstream `ohif/app` images ignore local source changes.
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN yarn install --frozen-lockfile

ENV NODE_ENV=production
ENV PUBLIC_URL=/
ENV APP_CONFIG=config/default.js
ENV NODE_OPTIONS=--max_old_space_size=8192

WORKDIR /app/platform/app
RUN yarn run build

# --- Runtime: TLS + reverse-proxy (Dicoogle / reporting backend) ---
FROM nginx:alpine

RUN apk add --no-cache openssl \
 && mkdir -p /etc/nginx/ssl \
 && openssl req -x509 -nodes -days 365 \
      -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/selfsigned.key \
      -out    /etc/nginx/ssl/selfsigned.crt \
      -subj   "/C=US/ST=State/L=City/O=TDAI/CN=tdai-viewer" \
      -addext "subjectAltName=DNS:localhost,DNS:ohif-viewer,IP:127.0.0.1,IP:34.16.87.46"

COPY default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/platform/app/dist/ /usr/share/nginx/html/
COPY platform/app/public/config/default.js /usr/share/nginx/html/app-config.js

RUN rm -f /usr/share/nginx/html/app-config.js.gz \
 && gzip -k /usr/share/nginx/html/app-config.js

# Inflate 0-byte stubs (upstream pattern) so non-gzip clients work.
RUN for gz in /usr/share/nginx/html/*.gz; do \
      target="${gz%.gz}"; \
      if [ -f "$target" ] && [ ! -s "$target" ]; then \
        gunzip -c "$gz" > "$target"; \
      fi; \
    done

# Cache-bust chunks + optional guard for legacy activeStudy edge cases.
RUN app_js=$(ls /usr/share/nginx/html/app.bundle.*.js | head -1) && \
    sed -i 's/\[chunkId\] + ".js"/[chunkId] + ".js?v=3"/g' "$app_js" && \
    sed -i 's/+ chunkId + ".css"/+ chunkId + ".css?v=3"/g' "$app_js" && \
    sed -i 's/} = this.activeStudy;/} = this.activeStudy || {};/g' "$app_js" && \
    rm -f "${app_js}.gz" && gzip -k "$app_js"

ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]

EXPOSE 443
