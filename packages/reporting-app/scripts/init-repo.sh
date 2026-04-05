#!/usr/bin/env bash
set -euo pipefail

# Creates a new private GitHub repository and clones it locally.
# Requires GitHub CLI with repo creation permissions.

REPO_NAME="medical-report-system"
OWNER="${1:-$USER}"
TARGET_DIR="${2:-$REPO_NAME}"

gh repo create "$OWNER/$REPO_NAME" --private --source . --remote origin --push || true

git remote set-url origin "https://github.com/$OWNER/$REPO_NAME.git"
git push -u origin main

echo "Repository initialized at https://github.com/$OWNER/$REPO_NAME"
echo "Local path: $TARGET_DIR"
