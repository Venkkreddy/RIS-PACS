FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace metadata first for better layer caching.
COPY package.json package-lock.json turbo.json ./
COPY packages/reporting-app/package.json packages/reporting-app/
COPY packages/reporting-app/frontend/package.json packages/reporting-app/frontend/
COPY packages/reporting-app/shared/package.json packages/reporting-app/shared/

# Copy source required for frontend + shared workspace build.
COPY packages/reporting-app/frontend/ packages/reporting-app/frontend/
COPY packages/reporting-app/shared/ packages/reporting-app/shared/

RUN npm ci --ignore-scripts

# Firebase config (build-time)
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
RUN cd packages/reporting-app && npm run build -w shared && npm run build -w frontend

FROM nginx:alpine
COPY --from=builder /app/packages/reporting-app/frontend/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 80;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n\n  location / {\n    try_files $uri /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
