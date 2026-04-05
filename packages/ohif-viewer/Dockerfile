# Use official prebuilt OHIF v3 image (ohif/app, not ohif/viewer which is v2.x).
FROM ohif/app:latest

# Bake the nginx config so it doesn't need to be generated at runtime
# (the entrypoint's envsubst fails on read-only / permission-restricted filesystems).
COPY default.conf /etc/nginx/conf.d/default.conf

# Override runtime config to point OHIF to tdairad services.
COPY platform/app/public/config/default.js /usr/share/nginx/html/app-config.js

# Pre-compress app-config.js so gzip_static can serve it.
RUN rm -f /usr/share/nginx/html/app-config.js.gz \
 && gzip -k /usr/share/nginx/html/app-config.js

EXPOSE 80
