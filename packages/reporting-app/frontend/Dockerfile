FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json turbo.json ./
COPY packages/reporting-app/package.json packages/reporting-app/
COPY packages/reporting-app/frontend/package.json packages/reporting-app/frontend/
COPY packages/reporting-app/shared/package.json packages/reporting-app/shared/

RUN npm ci --ignore-scripts

COPY packages/reporting-app/frontend/ packages/reporting-app/frontend/
COPY packages/reporting-app/shared/ packages/reporting-app/shared/

ARG VITE_API_BASE_URL=https://localhost:5173/api
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

RUN cd packages/reporting-app && npm run build -w shared && npm run build -w frontend

FROM nginx:alpine

RUN apk add --no-cache openssl \
 && mkdir -p /etc/nginx/ssl \
 && openssl req -x509 -nodes -days 365 \
      -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/selfsigned.key \
      -out    /etc/nginx/ssl/selfsigned.crt \
      -subj   "/C=US/ST=State/L=City/O=TDAI/CN=localhost" \
 && openssl dhparam -out /etc/nginx/ssl/dhparam.pem 2048

COPY --from=builder /app/packages/reporting-app/frontend/dist /usr/share/nginx/html

COPY <<'NGINX_CONF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name _;

    ssl_certificate     /etc/nginx/ssl/selfsigned.crt;
    ssl_certificate_key /etc/nginx/ssl/selfsigned.key;
    ssl_dhparam         /etc/nginx/ssl/dhparam.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "SAMEORIGIN" always;
    add_header X-XSS-Protection          "1; mode=block" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;

    root  /usr/share/nginx/html;
    index index.html;

    # Docker embedded DNS — re-resolve on every request so upstream IP
    # changes (container restarts) are picked up automatically.
    resolver 127.0.0.11 valid=10s ipv6=off;

    gzip on;
    gzip_vary on;
    gzip_min_length 256;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    location /api/ {
        set $backend http://reporting-app-backend:8080;
        rewrite ^/api/(.*) /$1 break;
        proxy_pass         $backend;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        client_max_body_size 0;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    location /dicom-web/ {
        set $backend http://reporting-app-backend:8080;
        rewrite ^/dicom-web/(.*) /dicom-web/$1 break;
        proxy_pass         $backend;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_buffering    off;
        proxy_request_buffering off;
        client_max_body_size 0;
        proxy_read_timeout 120s;
    }

    location /dicomweb/ {
        set $backend http://reporting-app-backend:8080;
        rewrite ^/dicomweb/(.*) /dicomweb/$1 break;
        proxy_pass         $backend;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_buffering    off;
        proxy_request_buffering off;
        client_max_body_size 0;
        proxy_read_timeout 120s;
    }

    location /wado/ {
        set $backend http://reporting-app-backend:8080;
        rewrite ^/wado/(.*) /wado/$1 break;
        proxy_pass         $backend;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_buffering    off;
        client_max_body_size 0;
        proxy_read_timeout 120s;
    }

    location / {
        try_files $uri /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
NGINX_CONF

EXPOSE 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-check-certificate -qO- https://127.0.0.1:443/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
