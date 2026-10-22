#!/bin/sh
# Serve the repo root, then open http://localhost:8000/demo/
cd "$(dirname "$0")/.." && python3 -m http.server 8000
