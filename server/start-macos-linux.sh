#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { printf '%s\n' 'Install Node.js 22 LTS or newer first.'; exit 1; }
if [ ! -d node_modules ]; then
  npm ci --omit=dev
fi
printf '%s\n' 'Open http://localhost:4173. Keep this terminal open.'
npm start
