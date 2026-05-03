#!/usr/bin/env bash
set -euo pipefail

DEFAULT_VAULT="$HOME/Documents/Personal"
VAULT="${1:-$DEFAULT_VAULT}"
PLUGIN_DIR="$VAULT/.obsidian/plugins/sludge-pump"

echo "Building..."
npm run build

echo "Installing to $PLUGIN_DIR..."
cp main.js manifest.json styles.css "$PLUGIN_DIR/"

echo ""
echo "Done! If Obsidian is running, reload the plugin to pick up the changes:"
echo ""
echo "  1. Open Settings (gear icon)"
echo "  2. Go to Community plugins"
echo "  3. Find 'Sludge Pump' and toggle it OFF, then back ON"
echo ""
echo "  (If that doesn't work, close and reopen Obsidian.)"
