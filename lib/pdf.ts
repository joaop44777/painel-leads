import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, rgb, StandardFonts, degrees } from '@cantoo/pdf-lib'
import fontkit from '@cantoo/fontkit'
import type { EditorElement, PageInfo } from './types'

let workerConfigured = false
function ensureWorker() {
  if (workerConfigured) return
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()
  workerConfigured = true
}

export async function loadPdf(bytes: Uint8Array) {
  ensureWorker()
  // PDF.js transfers the supplied typed array to its worker. Passing the
  // caller's buffer directly therefore detaches it, which breaks subsequent
  // inspection/export steps. Always give PDF.js an isolated copy.
  const workerBytes = new Uint8Array(bytes)
  return (await pdfjsLib.getDocument({ data: workerBytes }).promise)
}

function normalizeFontFamily(value: string) {
  const v = value.toLowerCase()
  if (/helvetica|arial|liberation sans|sans-serif/.test(v)) return 'Helvetica'
  if (/times|serif|liberation serif/.test(v)) return 'Times'
  if (/courier|mono|monospace/.test(v)) return 'Courier'
  return value || 'Helvetica'
}

export async function inspectPdf(bytes: Uint8Array): Promise<{ pages: PageInfo[]; elements: EditorElement[] }> {
  const pdf = await loadPdf(bytes)
  const pages: PageInfo[] = []
  const elements: EditorElement[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const text = await page.getTextContent()
    const styles = (text as any).styles || {}
    const items = text.items.filter((item: any) => typeof item.str === 'string' && item.str.trim()) as any[]
    pages.push({ index: i - 1, width: viewport.width, height: viewport.height, textCount: items.length })

    items.forEach((item, idx) => {
      const tx = item.transform || [1, 0, 0, 1, 0, 0]
      const style = styles[item.fontName] || {}
      const h = Math.max(8, Math.abs(tx[3] || item.height || 12))
      const x = tx[4]
      const y = viewport.height - tx[5] - h
      const w = Math.max(4, item.width || item.str.length * h * .45)
      const rawFontName = String(item.fontName || '')
      const rawFamily = String(style.fontFamily || '')
      const combinedFontName = `${rawFamily} ${rawFontName}`
      const weight = /bold|black|heavy|semibold|demi|medium|700|800|900/i.test(combinedFontName) ? 'bold' : 'normal'
      const italic = /italic|oblique|slanted/i.test(combinedFontName) ? 'italic' : 'normal'
      const cssFamily = normalizeFontFamily(rawFamily || rawFontName)
      elements.push({
        id: `p${i}-text-${idx}`, page: i - 1, kind: 'text',
        name: `Texto — ${item.str.slice(0, 34)}`, x, y, width: w, height: h,
        rotation: Math.atan2(tx[1] || 0, tx[0] || 1) * 180 / Math.PI,
        text: item.str, originalText: item.str, fontSize: h,
        fontFamily: cssFamily, originalFontFamily: cssFamily, fontWeight: weight, fontStyle: italic, originalFontSize: h, originalFontWeight: weight, originalFontStyle: italic,
        color: '#111827', editable: true, sourceIndex: idx, visible: true,
        nativeEdit: 'pending',
      })
    })
  }
  return { pages, elements }
}

export async function renderPage(pdf: any, pageIndex: number, scale = 1.25) {
  const page = await pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvasContext: context, viewport }).promise
  return { canvas, width: viewport.width, height: viewport.height }
}

export async function createImagePdf(file: File) {
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await PDFDocument.create()
  const isJpg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)
  const image = isJpg ? await doc.embedJpg(data) : await doc.embedPng(data)
  const page = doc.addPage([image.width, image.height])
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  return doc.save()
}

function parseHex(hex: string) {
  const h = hex.replace('#', '')
  const normalized = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = Number.parseInt(normalized, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out
}

async function inflate(data: Uint8Array) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Seu navegador não oferece descompressão local de PDF.')
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function deflate(data: Uint8Array) {
  if (typeof CompressionStream === 'undefined') throw new Error('Seu navegador não oferece compressão local de PDF.')
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function escapeLiteral(bytes: Uint8Array) {
  let out = ''
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b)
    else if (b >= 32 && b <= 126) out += String.fromCharCode(b)
    else out += `\\${b.toString(8).padStart(3, '0')}`
  }
  return `(${out})`
}

function asciiReplacementInStream(source: Uint8Array, oldText: string, newText: string) {
  // Conservative native path: literal PDF strings containing plain ASCII.
  // The replacement may have a different length; PDF text operators keep the
  // original font, weight, italic state, color and positioning instructions.
  if (!oldText || /[^\x20-\x7E]/.test(oldText + newText)) return null
  const oldBytes = new TextEncoder().encode(oldText)
  const newBytes = new TextEncoder().encode(newText)
  const chunks: Uint8Array[] = []
  let cursor = 0
  let matches = 0
  let i = 0
  while (i < source.length) {
    if (source[i] !== 0x28) { i++; continue }
    let j = i + 1, depth = 1
    while (j < source.length && depth > 0) {
      if (source[j] === 0x5c) { j += 2; continue }
      if (source[j] === 0x28) depth++
      else if (source[j] === 0x29) depth--
      j++
    }
    if (depth !== 0) break
    const literal = source.slice(i + 1, j - 1)
    if (literal.length === oldBytes.length && literal.every((v, k) => v === oldBytes[k])) {
      chunks.push(source.slice(cursor, i + 1), newBytes, source.slice(j - 1, j))
      cursor = j
      matches++
    }
    i = j
  }
  if (matches !== 1) return null
  chunks.push(source.slice(cursor))
  return concatBytes(chunks)
}

async function tryNativeTextEdits(doc: any, original: Uint8Array, elements: EditorElement[]) {
  doc.registerFontkit(fontkit)
  const edits = elements.filter(e => {
    if (e.kind !== 'text' || e.sourceIndex === undefined || e.originalText === undefined || e.text === e.originalText || e.visible === false) return false
    const styleChanged = e.fontSize !== (e.originalFontSize ?? e.fontSize) || e.fontWeight !== (e.originalFontWeight ?? e.fontWeight) || e.fontStyle !== (e.originalFontStyle ?? e.fontStyle) || (e.fontKey !== undefined)
    return !styleChanged
  })
  if (!edits.length) return new Set<string>()

  const applied = new Set<string>()
  const byPage = new Map<number, EditorElement[]>()
  for (const el of edits) byPage.set(el.page, [...(byPage.get(el.page) || []), el])

  for (const [pageIndex, pageEdits] of byPage) {
    const page = doc.getPage(pageIndex)
    const node = (page as any).node
    const context = doc.context
    if (!node?.dict || !context) continue
    const contents = node.dict.get(PDFName.of('Contents'))
    if (!contents) continue
    const refs: any[] = []
    if (Array.isArray(contents)) refs.push(...contents)
    else if (typeof contents.size === 'function') for (let i = 0; i < contents.size(); i++) refs.push(contents.get(i))
    else refs.push(contents)

    for (const ref of refs) {
      const stream = context.lookup(ref)
      if (!stream || typeof stream.getContents !== 'function') continue
      let raw = new Uint8Array(stream.getContents())
      const filters = stream.dict?.get?.(PDFName.of('Filter'))
      const filterName = filters?.decodeText?.() || String(filters || '')
      let decoded = raw
      let wasCompressed = /FlateDecode/.test(filterName)
      try { if (wasCompressed) decoded = await inflate(raw) } catch { continue }

      for (const el of pageEdits) {
        const replacement = asciiReplacementInStream(decoded, el.originalText || '', el.text || '')
        if (!replacement) continue
        decoded = replacement
        applied.add(el.id)
        el.nativeEdit = 'applied'
      }

      if (decoded !== raw && applied.size) {
        try {
          const encoded = wasCompressed ? await deflate(decoded) : decoded
          const dict = stream.dict.clone(context)
          dict.set(PDFName.of('Length'), PDFNumber.of(encoded.length))
          context.assign(ref, PDFRawStream.of(dict, encoded))
        } catch {
          for (const el of pageEdits) if (applied.has(el.id)) { applied.delete(el.id); el.nativeEdit = 'fallback' }
        }
      }
    }
  }
  return applied
}

async function embedFontFor(doc: any, el: EditorElement, fonts?: Record<string, Uint8Array>) {
  if (el.fontKey && fonts?.[el.fontKey]) {
    doc.registerFontkit(fontkit)
    return doc.embedFont(fonts[el.fontKey], { subset: true })
  }
  const family = (el.fontFamily || 'Helvetica').toLowerCase()
  const bold = el.fontWeight === 'bold'
  const italic = el.fontStyle === 'italic'
  let standard = StandardFonts.Helvetica
  if (family.includes('times')) standard = bold && italic ? StandardFonts.TimesRomanBoldItalic : bold ? StandardFonts.TimesRomanBold : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman
  else if (family.includes('courier')) standard = bold && italic ? StandardFonts.CourierBoldOblique : bold ? StandardFonts.CourierBold : italic ? StandardFonts.CourierOblique : StandardFonts.Courier
  else standard = bold && italic ? StandardFonts.HelveticaBoldOblique : bold ? StandardFonts.HelveticaBold : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica
  return doc.embedFont(standard)
}

export async function exportPdf(original: Uint8Array, elements: EditorElement[], pages: PageInfo[], fonts?: Record<string, Uint8Array>) {
  const doc: any = await PDFDocument.load(original)
  const nativeApplied = await tryNativeTextEdits(doc, original, elements)

  for (const el of elements) {
    if (el.visible === false) continue
    const page = doc.getPage(el.page)
    const y = pages[el.page].height - el.y - el.height
    const color = parseHex(el.color || '#111827')
    const stroke = parseHex(el.stroke || '#4b8cff')
    const opacity = el.opacity ?? 1

    if (el.kind === 'text' && el.text) {
      const sourceStyleChanged = el.sourceIndex !== undefined && (
        el.fontSize !== (el.originalFontSize ?? el.fontSize) ||
        el.fontWeight !== (el.originalFontWeight ?? el.fontWeight) ||
        el.fontStyle !== (el.originalFontStyle ?? el.fontStyle) ||
        el.fontKey !== undefined ||
        el.fontFamily !== (el.originalFontFamily ?? el.fontFamily)
      )
      const sourceTextChanged = el.sourceIndex !== undefined && el.text !== el.originalText
      const shouldDraw = el.sourceIndex === undefined || sourceStyleChanged || (sourceTextChanged && !nativeApplied.has(el.id))
      if (shouldDraw) {
      if (el.sourceIndex !== undefined) {
        // Fallback for PDFs whose embedded font encoding cannot be safely rewritten.
        // It is intentionally limited to the selected text bounding box.
        page.drawRectangle({ x: el.x - 1, y: y - 1, width: el.width + 2, height: el.height + 2, color: rgb(1, 1, 1), opacity: 1 })
      }
      const font = await embedFontFor(doc, el, fonts)
      const textWidth = font.widthOfTextAtSize(el.text, Math.max(6, el.fontSize || 12))
      let drawX = el.x
      if (el.textAlign === 'center') drawX = el.x + Math.max(0, (el.width - textWidth) / 2)
      if (el.textAlign === 'right') drawX = el.x + Math.max(0, el.width - textWidth)
      page.drawText(el.text, {
        x: drawX, y: y + Math.max(0, el.height - (el.fontSize || 12)), size: Math.max(6, el.fontSize || 12),
        font, color: rgb(color.r, color.g, color.b), opacity, rotate: degrees(el.rotation || 0),
      })
      if (el.underline) page.drawLine({ start: { x: drawX, y: y + 1 }, end: { x: drawX + textWidth, y: y + 1 }, thickness: Math.max(1, (el.fontSize || 12) / 14), color: rgb(color.r, color.g, color.b), opacity })
      }
    }

    if (el.sourceIndex === undefined && el.kind === 'rect') page.drawRectangle({ x: el.x, y, width: el.width, height: el.height, color: rgb(parseHex(el.fill || '#2d7ff9').r, parseHex(el.fill || '#2d7ff9').g, parseHex(el.fill || '#2d7ff9').b), borderColor: rgb(stroke.r, stroke.g, stroke.b), borderWidth: el.strokeWidth || 1, opacity, rotate: degrees(el.rotation || 0) })
    if (el.sourceIndex === undefined && el.kind === 'ellipse') page.drawEllipse({ x: el.x + el.width / 2, y: y + el.height / 2, xScale: el.width / 2, yScale: el.height / 2, color: rgb(parseHex(el.fill || '#2d7ff9').r, parseHex(el.fill || '#2d7ff9').g, parseHex(el.fill || '#2d7ff9').b), borderColor: rgb(stroke.r, stroke.g, stroke.b), borderWidth: el.strokeWidth || 1, opacity, rotate: degrees(el.rotation || 0) })
    if (el.sourceIndex === undefined && (el.kind === 'line' || el.kind === 'arrow')) {
      page.drawLine({ start: { x: el.x, y: y + el.height / 2 }, end: { x: el.x + el.width, y: y + el.height / 2 }, thickness: el.strokeWidth || 2, color: rgb(stroke.r, stroke.g, stroke.b), opacity })
      if (el.kind === 'arrow') {
        page.drawLine({ start: { x: el.x + el.width, y: y + el.height / 2 }, end: { x: el.x + el.width - 8, y: y + el.height / 2 + 5 }, thickness: el.strokeWidth || 2, color: rgb(stroke.r, stroke.g, stroke.b), opacity })
        page.drawLine({ start: { x: el.x + el.width, y: y + el.height / 2 }, end: { x: el.x + el.width - 8, y: y + el.height / 2 - 5 }, thickness: el.strokeWidth || 2, color: rgb(stroke.r, stroke.g, stroke.b), opacity })
      }
    }
    if (el.sourceIndex === undefined && el.kind === 'image' && el.src) {
      try {
        const base64 = el.src.split(',')[1]
        const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        const image = el.src.startsWith('data:image/jpeg') ? await doc.embedJpg(raw) : await doc.embedPng(raw)
        page.drawImage(image, { x: el.x, y, width: el.width, height: el.height, rotate: degrees(el.rotation || 0), opacity })
      } catch { /* ignore malformed image data rather than corrupting the document */ }
    }
  }
  return await doc.save()
}
