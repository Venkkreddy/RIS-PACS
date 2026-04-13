FROM maven:3.9.9-eclipse-temurin-11 AS builder

WORKDIR /src
COPY . .

# Build Dicoogle core and plugin jars from vendored source
RUN mvn -f pom.xml -DskipTests -Dskip.installnodenpm -Dskip.npm package && \
    mkdir -p /runtime/bin /runtime/plugins && \
    cp dicoogle/target/dicoogle.jar /runtime/bin/dicoogle.jar && \
    (ls dicoogle/target/plugins/*.jar >/dev/null 2>&1 && cp dicoogle/target/plugins/*.jar /runtime/plugins/ || true) && \
    (ls bin/*.jar >/dev/null 2>&1 && cp bin/*.jar /runtime/plugins/ || true)

# Download official Dicoogle 3.5.1 release to get pre-built lucene + filestorage plugins
RUN curl -fsSL -o /tmp/dicoogle-release.zip \
      https://github.com/dicoogle/dicoogle/releases/download/3.5.1/Dicoogle_v3.5.1.zip && \
    cd /tmp && unzip -o dicoogle-release.zip -d dicoogle-release && \
    find /tmp/dicoogle-release -iname 'lucene*.jar' -exec cp {} /runtime/plugins/ \; && \
    find /tmp/dicoogle-release -iname 'filestorage*.jar' -exec cp {} /runtime/plugins/ \; && \
    rm -rf /tmp/dicoogle-release /tmp/dicoogle-release.zip

FROM eclipse-temurin:11-jre

WORKDIR /opt/dicoogle

COPY --from=builder /runtime/bin/dicoogle.jar /opt/dicoogle/dicoogle.jar
COPY --from=builder /runtime/plugins/ /opt/dicoogle/Plugins/
COPY config/*.xml /opt/dicoogle/Plugins/settings/
COPY src/custom-webhook.lua /opt/dicoogle/Plugins/lua/custom-webhook.lua

# Provide the pre-configured server.xml so Dicoogle starts with lucene DIM
# provider, file-storage, and the correct DICOM port (104).
COPY confs/server.xml /opt/dicoogle/confs/server.xml

EXPOSE 8080 104

CMD ["java", "-jar", "/opt/dicoogle/dicoogle.jar", "-s"]
