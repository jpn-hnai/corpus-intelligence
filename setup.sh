#!/usr/bin/env bash
#
# setup.sh — One-command setup for corpus-intelligence
#
# Usage:
#   git clone https://github.com/jpn-hnai/corpus-intelligence.git
#   cd corpus-intelligence
#   ./setup.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[setup]${NC} $*"; }
err() { echo -e "${RED}[setup]${NC} $*" >&2; }

# Check Node.js
if ! command -v node &>/dev/null; then
    err "Node.js not found. Install Node.js 18+ first: https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    err "Node.js 18+ required (found v$(node -v))"
    exit 1
fi

# Build the CLI
log "Installing CLI dependencies..."
cd cli
npm install --silent

log "Building CLI..."
npm run build --silent

log "Build complete. Starting installer..."
echo ""

# Run the interactive installer
node dist/install.js
