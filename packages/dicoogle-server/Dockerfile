FROM maven:3.9.9-eclipse-temurin-11 AS builder

WORKDIR /src
COPY . .

# Build Dicoogle core jar
RUN mvn -f pom.xml -DskipTests -Dskip.installnodenpm -Dskip.npm package && \
    mkdir -p /runtime/bin /runtime/plugins && \
    cp dicoogle/target/dicoogle.jar /runtime/bin/dicoogle.jar && \
    (ls dicoogle/target/plugins/*.jar >/dev/null 2>&1 && cp dicoogle/target/plugins/*.jar /runtime/plugins/ || true) && \
    (ls bin/*.jar >/dev/null 2>&1 && cp bin/*.jar /runtime/plugins/ || true)

# Build the official lucene + filestorage plugins from source
RUN curl -sL https://github.com/dicoogle/dicoogle-plugins/archive/refs/heads/main.tar.gz | tar xz -C /tmp && \
    cd /tmp/dicoogle-plugins-main && \
    mvn -DskipTests package && \
    cp plugins/lucene/target/lucene-*.jar /runtime/plugins/ && \
    cp plugins/filestorage/target/filestorage-*.jar /runtime/plugins/ && \
    rm -rf /tmp/dicoogle-plugins-main

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
