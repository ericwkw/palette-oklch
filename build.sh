#!/bin/sh
# Assemble the single-file tool from the parts in build/.
cd "$(dirname "$0")" || exit 1
cat build/01-head.html build/02-body.html build/03-core.js build/04-ui.js > index.html
echo "index.html — $(wc -l < index.html) lines"
