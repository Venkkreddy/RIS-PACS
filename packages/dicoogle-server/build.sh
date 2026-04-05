#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-build}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$ROOT_DIR/bin"

mkdir -p "$BIN_DIR"

build_from_source() {
  echo "Building Dicoogle from vendored source..."
  mvn -f "$ROOT_DIR/pom.xml" -DskipTests package

  # Copy build artifacts to runtime bin directory.
  cp "$ROOT_DIR/dicoogle/target/dicoogle.jar" "$BIN_DIR/dicoogle.jar"

  # Optional plugin/runtime jars when available from local builds.
  if compgen -G "$ROOT_DIR/dicoogle/target/plugins/*.jar" > /dev/null; then
    cp "$ROOT_DIR/dicoogle/target/plugins/"*.jar "$BIN_DIR/" || true
  fi
}

ensure_runtime_jars() {
  if [[ ! -f "$BIN_DIR/dicoogle.jar" ]]; then
    build_from_source
  fi
}

case "$MODE" in
  build)
    build_from_source
    ;;
  run)
    ensure_runtime_jars
    java -jar "$BIN_DIR/dicoogle.jar" -s
    ;;
  docker)
    ensure_runtime_jars
    docker build -t medical-imaging-platform-dicoogle "$ROOT_DIR"
    docker run --rm -p 8080:8080 -p 11112:104 medical-imaging-platform-dicoogle
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo "Usage: $0 [build|run|docker]"
    exit 1
    ;;
esac
