#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo ""
echo "============================================================"
echo "      TDAI RIS/PACS - Build Client Distribution"
echo "============================================================"
echo ""

# -- Check Docker --
if ! docker info > /dev/null 2>&1; then
    echo "  ERROR: Docker is not running. Start Docker Desktop first."
    exit 1
fi

# -- Step 1: Build all images --
echo "[1/4] Building all Docker images..."
echo "      This may take 5-10 minutes on first build."
echo ""
docker compose build
echo ""
echo "      All images built successfully."

# -- Step 2: Save images to tar --
echo ""
echo "[2/4] Saving all images to a single file (this will take a few minutes)..."

docker save -o tdai-images.tar \
    tdai-reporting-app-frontend \
    tdai-reporting-app-backend \
    tdai-dicoogle \
    tdai-ohif \
    tdai-monai-server \
    tdai-medasr-server \
    postgres:16-alpine \
    orthancteam/orthanc:latest

echo "      Images saved to tdai-images.tar"

# -- Step 3: Assemble client folder --
echo ""
echo "[3/4] Assembling client package folder..."

rm -rf TDAI-RIS-PACS
mkdir -p TDAI-RIS-PACS
mkdir -p TDAI-RIS-PACS/migrations

# Copy the client-specific compose (no build: sections, only image: refs)
cp docker-compose.client.yml  TDAI-RIS-PACS/docker-compose.yml

# Copy startup and shutdown scripts
cp start.bat           TDAI-RIS-PACS/
cp start.sh            TDAI-RIS-PACS/
cp stop.bat            TDAI-RIS-PACS/
cp stop.sh             TDAI-RIS-PACS/

# Copy pre-built images
cp tdai-images.tar     TDAI-RIS-PACS/

# Copy config files needed by bind-mounts
cp pacs-stack/orthanc/orthanc.json  TDAI-RIS-PACS/
cp -r packages/reporting-app/backend/migrations/* TDAI-RIS-PACS/migrations/ 2>/dev/null || true

# Copy service account (create empty placeholder if missing)
if [ -f "packages/reporting-app/backend/service-account.json" ]; then
    cp packages/reporting-app/backend/service-account.json TDAI-RIS-PACS/
else
    echo '{}' > TDAI-RIS-PACS/service-account.json
fi

# Copy docs
[ -f README.md ] && cp README.md TDAI-RIS-PACS/

# Ensure shell scripts are executable in the package
chmod +x TDAI-RIS-PACS/start.sh TDAI-RIS-PACS/stop.sh

echo "      Files copied to TDAI-RIS-PACS/"

# -- Step 4: Report --
echo ""
echo "[4/4] Package contents:"
echo ""
ls -lh TDAI-RIS-PACS/
echo ""

# Get folder size
if [ "$(uname)" = "Darwin" ]; then
    folder_size=$(du -sh TDAI-RIS-PACS | awk '{print $1}')
else
    folder_size=$(du -sh TDAI-RIS-PACS | cut -f1)
fi

echo "============================================================"
echo "                    Package Ready!"
echo "============================================================"
echo ""
echo "  Folder: TDAI-RIS-PACS/"
echo "  Size:   $folder_size"
echo ""
echo "  Contents:"
echo "    docker-compose.yml    (client version - no build sections)"
echo "    start.bat / start.sh  (one-click startup)"
echo "    stop.bat / stop.sh    (one-click shutdown)"
echo "    tdai-images.tar       (all 8 pre-built Docker images)"
echo "    orthanc.json          (PACS config)"
echo "    migrations/           (database schema)"
echo "    service-account.json  (Firebase credentials)"
echo "    README.md             (setup instructions)"
echo ""
echo "  Next steps:"
echo "    1. Zip the TDAI-RIS-PACS folder"
echo "    2. Send the zip to the client"
echo "    3. Client extracts and double-clicks start.bat (or ./start.sh)"
echo ""
echo "  No .env file, no source code, no build tools needed."
echo ""
