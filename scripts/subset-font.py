"""
Builds static/fonts/inter-latin.woff2, the one font file every page needs.

The file is cut from the Latin file in @fontsource-variable/inter and keeps everything a page can
show with it, except the weights nothing here uses: every character, the optical-size axis (the
text cut and the display cut), and every OpenType feature are kept, and the weight axis is narrowed
from 100-900 to 400-700. That takes it from 73 KB to about 50 KB, on a file that first paint waits
for (see the comment above the @font-face rules in src/routes/layout.css).

A weight outside 400-700 is drawn at the nearest end of the range. To use one, widen WEIGHTS here
and the weight ranges in src/app.html and layout.css, and run this again.

The file keeps one address, which the script in src/app.html names. server.js lets browsers keep it
for a month and then refresh it in the background, so a new cut reaches a returning visitor without
anything having to be renamed.

The result is committed, so building the site needs neither Python nor this script. Run it only
after changing WEIGHTS or updating the package:

    pip install fonttools brotli
    python scripts/subset-font.py
"""

import io
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "node_modules/@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2"
TARGET = ROOT / "static/fonts/inter-latin.woff2"
WEIGHTS = (400, 700)

font = TTFont(SOURCE)
characters = list(font.getBestCmap())

# Nothing is removed in this step but what a browser never reads: glyph names, and name records
# beyond the ones that identify the font.
options = subset.Options()
options.layout_features = ["*"]
options.glyph_names = False
options.notdef_outline = True
options.name_IDs = [1, 2, 3, 4, 6]
subsetter = subset.Subsetter(options)
subsetter.populate(unicodes=characters)
subsetter.subset(font)

# Written out and read back, because the two tools do not agree on a font held in memory.
buffer = io.BytesIO()
font.flavor = None
font.save(buffer)
buffer.seek(0)

font = instancer.instantiateVariableFont(TTFont(buffer), {"wght": WEIGHTS})
font.flavor = "woff2"
TARGET.parent.mkdir(parents=True, exist_ok=True)
font.save(TARGET)

print(f"{TARGET.relative_to(ROOT)}: {TARGET.stat().st_size} bytes, {len(characters)} characters, "
      f"weights {WEIGHTS[0]}-{WEIGHTS[1]} (from {SOURCE.stat().st_size} bytes)")
