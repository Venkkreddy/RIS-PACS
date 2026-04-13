# Pin to a stable OHIF v3 release to avoid ChunkLoadError from hash drift.
FROM ohif/app:v3.12.0

USER root

RUN apk add --no-cache openssl \
 && mkdir -p /etc/nginx/ssl \
 && openssl req -x509 -nodes -days 365 \
      -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/selfsigned.key \
      -out    /etc/nginx/ssl/selfsigned.crt \
      -subj   "/C=US/ST=State/L=City/O=TDAI/CN=localhost"

COPY default.conf /etc/nginx/conf.d/default.conf
COPY platform/app/public/config/default.js /usr/share/nginx/html/app-config.js

RUN rm -f /usr/share/nginx/html/app-config.js.gz \
 && gzip -k /usr/share/nginx/html/app-config.js

# The upstream OHIF image ships every .js / .css as a 0-byte stub with only
# the .gz companion containing real content.  This relies entirely on
# gzip_static; if ANY client (Service-Worker cache, proxy, prefetch) stores
# the 0-byte response the viewer breaks with ChunkLoadError.
# Fix: inflate every stub so both compressed and uncompressed files exist.
RUN for gz in /usr/share/nginx/html/*.gz; do \
      target="${gz%.gz}"; \
      if [ -f "$target" ] && [ ! -s "$target" ]; then \
        gunzip -c "$gz" > "$target"; \
      fi; \
    done

# Cache-bust: browsers that previously cached the 0-byte stubs with
# Cache-Control: immutable won't re-fetch them for up to a year.
# Patch the webpack runtime so chunk URLs get a ?v=2 suffix, which the
# browser treats as a new resource.  Nginx ignores the query string when
# resolving try_files, so the same files on disk are served.
RUN app_js=$(ls /usr/share/nginx/html/app.bundle.*.js | head -1) && \
    sed -i 's/\[chunkId\] + ".js"/[chunkId] + ".js?v=2"/g' "$app_js" && \
    sed -i 's/+ chunkId + ".css"/+ chunkId + ".css?v=2"/g' "$app_js" && \
    rm -f "${app_js}.gz" && gzip -k "$app_js"

# Bypass the stock OHIF entrypoint (envsubst) which overwrites our config files.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]

EXPOSE 443
