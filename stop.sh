#!/usr/bin/env bash
set -euo pipefail

# cd into the directory where this script lives
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "      Stopping all services and cleaning up..."
echo ""

docker compose down

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  System stopped successfully."
echo ""
echo "  To start again, run: ./start.sh"
echo "══════════════════════════════════════════════════════════════"
echo ""
