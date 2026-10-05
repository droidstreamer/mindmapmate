# Turns ../showcase/raw/gif-*.png (from `npm run showcase`) into ../showcase/demo.gif: each state holds, then cross-fades to the next.
import glob
from PIL import Image

frames = [Image.open(f).convert('RGB') for f in sorted(glob.glob('../showcase/raw/gif-*.png'))]
w = 420
frames = [f.resize((w, round(f.height * w / f.width)), Image.LANCZOS) for f in frames]
hold = [900, 1000, 1500, 700, 700, 2000]  # ms per state: the map opens, then tasks get ticked
out, dur = [], []
for i, f in enumerate(frames):
    out.append(f); dur.append(hold[i])
    nxt = frames[(i + 1) % len(frames)]
    for k in range(1, 5):  # 4-step cross-fade, ~60 ms each
        out.append(Image.blend(f, nxt, k / 5)); dur.append(60)
out = [f.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE) for f in out]
out[0].save('../showcase/demo.gif', save_all=True, append_images=out[1:], duration=dur, loop=0, optimize=True)
print('demo.gif', len(out), 'frames')
