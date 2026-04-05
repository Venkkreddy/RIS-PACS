#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
PACKAGE_DIR="$DIST_DIR/tdai-local-dicoogle"
ZIP_PATH="$DIST_DIR/tdai-local-dicoogle.zip"

mkdir -p "$PACKAGE_DIR/bin" "$PACKAGE_DIR/config" "$PACKAGE_DIR/scripts"
rm -f "$ZIP_PATH"

cp -a "$ROOT_DIR/bin/." "$PACKAGE_DIR/bin/" || true
cp "$ROOT_DIR/local-config/preconfig.xml" "$PACKAGE_DIR/config/preconfig.xml"
cp "$ROOT_DIR/src/custom-webhook.lua" "$PACKAGE_DIR/config/custom-webhook.lua"

cat > "$PACKAGE_DIR/scripts/run-linux-mac.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
java -jar "$DIR/bin/dicoogle.jar" -s
EOF

cat > "$PACKAGE_DIR/scripts/run-windows.bat" <<'EOF'
@echo off
set DIR=%~dp0..
java -jar "%DIR%\bin\dicoogle.jar" -s
EOF

cat > "$PACKAGE_DIR/INSTALL.md" <<'EOF'
# Local Dicoogle Installer (Radiographer)

1. Ensure Java 11+ is installed.
2. Extract this ZIP to a local folder.
3. Confirm `config/preconfig.xml` points to your central endpoint.
4. Start Dicoogle:
   - macOS/Linux: `bash scripts/run-linux-mac.sh`
   - Windows: `scripts\\run-windows.bat`
5. Send studies to local AET `TDAI-LOCAL` on port `104`.

On ingest, studies are configured to forward to the central endpoint.
EOF

chmod +x "$PACKAGE_DIR/scripts/run-linux-mac.sh"

(cd "$DIST_DIR" && zip -r "$(basename "$ZIP_PATH")" "$(basename "$PACKAGE_DIR")")

echo "Local installer package created at: $ZIP_PATH"
