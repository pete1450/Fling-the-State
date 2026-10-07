#!/usr/bin/env python3
"""Assemble the single-file Fling the State build:
head.html + three.min.js + data.js + logic.js + game.js -> ~/workspace/your_files/state-slingshot/index.html"""
import pathlib
import re
import sys

root = pathlib.Path(__file__).parent
head = (root / "head.html").read_text()
three = (root / "three.min.js").read_text()
data = (root / "data.js").read_text()
logic = (root / "logic.js").read_text()
game = (root / "game.js").read_text()

# shared-scope collision check: data.js + logic.js + game.js share one <script> scope chain
# (separate <script> blocks, but top-level const/function names must not collide).
decl = re.compile(r"^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)", re.M)
seen = {}
problems = []
for name, src in [("data.js", data), ("logic.js", logic), ("game.js", game)]:
    # game.js wraps itself in an IIFE; only check its top-level-exposed names loosely:
    # strip the IIFE wrapper for a fair check of accidental globals.
    for m in decl.finditer(src):
        ident = m.group(1)
        if ident in seen:
            problems.append(f"{ident}: {seen[ident]} vs {name}")
        else:
            seen[ident] = name
if problems:
    print("name collisions:", problems, file=sys.stderr)
    sys.exit(1)

out = (
    head                      # head.html already ends with an open <script> tag
    + three + "\n</script>\n"
    + "<script>\n" + data + "\n</script>\n"
    + "<script>\n" + logic + "\n</script>\n"
    + "<script>\n" + game + "\n</script>\n"
    + "</body>\n</html>\n"
)

dest = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path.home() / "workspace" / "your_files" / "state-slingshot" / "index.html"
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(out)
print("wrote", dest, f"({len(out) / 1024:.0f} KB)")
