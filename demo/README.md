# FGO preservation demo (raw WebGL, no dependencies)
1. Put the `demo/` folder inside the repo root (next to `Mesh/`, `Texture2D/`).
2. From the repo root: `python3 -m http.server 8000`  (or run `demo/run.sh`)
3. Open http://localhost:8000/demo/
Controls: WASD move, Shift run, Space jump, drag mouse or Q/E rotate camera, wheel zoom.
`python3 demo/make_manifest.py B2 C2 ...` regenerates manifest.json for other zone cells.
