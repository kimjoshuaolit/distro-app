# Film LUT

`fuji-fp-100c.bin` is the colour of Fuji FP-100C instant film, used by the photo
bake in `../retro.ts`.

- **Source:** the "Fuji Fp-100c" HaldCLUT from the G'MIC film emulation presets
  (<https://gmic.eu/color_presets/>), from Pat David's film emulation work
  (<https://patdavid.net/2015/03/film-emulation-in-rawtherapee/>), shared under
  CC BY-SA 4.0. Fujifilm is named for information only; this project isn't
  affiliated with or endorsed by Fujifilm.
- **Changes:** resampled from the 64-point HaldCLUT to a 33-point cube
  (trilinear). Colours stay within about 1/255 of the original (99th
  percentile).
- **Format:** raw bytes, 33 × 33 × 33 × RGB = 107,811 bytes, ordered blue, then
  green, then red (red fastest). It's raw rather than PNG so that no browser
  colour management can alter it.
