# OG image build

`og.html` is the source for `public/og.png` — a purpose-composed 1200×630 card
rather than a crop of the landing page, so the type stays legible at the size
link previews actually render.

Regenerate after any brand or headline change:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --screenshot="$PWD/public/og.png" --window-size=1200,630 \
  "file://$PWD/.ogbuild/og.html"
```

`--force-device-scale-factor=2` renders at 2400×1260 for retina previews; the
1.91:1 ratio is what LinkedIn, Slack and X expect.
