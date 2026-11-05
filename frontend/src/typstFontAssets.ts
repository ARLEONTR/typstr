// The text and math fonts typst ships with (typst-assets), loaded into the
// browser compiler. scripts/download-typst-fonts.mjs fetches them into
// public/assets/typst-fonts when the image is built, so typstr serves them
// itself; the CDN is only a fallback (every editor load used to fetch them
// from jsDelivr, which is slow or blocked on some networks).
// The download script reads the version and the file names from this file.
export const TYPST_ASSETS_VERSION = 'v0.13.1'

export const TYPST_FONT_FILES = [
  'DejaVuSansMono-Bold.ttf',
  'DejaVuSansMono-BoldOblique.ttf',
  'DejaVuSansMono-Oblique.ttf',
  'DejaVuSansMono.ttf',
  'LibertinusSerif-Bold.otf',
  'LibertinusSerif-BoldItalic.otf',
  'LibertinusSerif-Italic.otf',
  'LibertinusSerif-Regular.otf',
  'LibertinusSerif-Semibold.otf',
  'LibertinusSerif-SemiboldItalic.otf',
  'NewCM10-Bold.otf',
  'NewCM10-BoldItalic.otf',
  'NewCM10-Italic.otf',
  'NewCM10-Regular.otf',
  'NewCMMath-Bold.otf',
  'NewCMMath-Book.otf',
  'NewCMMath-Regular.otf',
]

const LOCAL_BASE = `/assets/typst-fonts/${TYPST_ASSETS_VERSION}`
const CDN_BASE = `https://cdn.jsdelivr.net/gh/typst/typst-assets@${TYPST_ASSETS_VERSION}/files/fonts`

export function typstFontSources(): Array<{ local: string; cdn: string }> {
  return TYPST_FONT_FILES.map((file) => ({ local: `${LOCAL_BASE}/${file}`, cdn: `${CDN_BASE}/${file}` }))
}

/** TrueType, OpenType (CFF) or a font collection, judged by the first bytes. */
export function looksLikeFontFile(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  return tag === 'OTTO' || tag === 'true' || tag === 'ttcf' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)
}
