#!/usr/bin/env bash
set -euo pipefail

# Run from repository root.

mkdir -p packages/reporting-app packages/dicoogle-server packages/ohif-viewer

mv backend frontend shared docs integrations scripts deploy.sh package.json package-lock.json README.md .gitignore packages/reporting-app/

cat > packages/dicoogle-server/README.md <<'EOF'
# Dicoogle Server

To be populated with full Dicoogle source, custom plugin scripts, and runtime config.
EOF

cat > packages/ohif-viewer/README.md <<'EOF'
# OHIF Viewer

To be populated with full OHIF viewer source and reporting integration extension.
EOF

echo "Restructure completed."
