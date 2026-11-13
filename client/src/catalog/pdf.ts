// PDF を作る(pdf-lib)処理と、作った PDF を canvas に描く(pdf.js)処理。

// 日本語を PDF に埋め込むためのフォント(約 5MB)。
import fontUrl from '@expo-google-fonts/noto-sans-jp/400Regular/NotoSansJP_400Regular.ttf?url'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export type Section = { heading: string; paragraphs: string[] }

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 56
const LINE_HEIGHT = 1.7

let fontBytes: Promise<ArrayBuffer> | undefined

/** 幅に収まるように 1 文字ずつ折り返す(日本語は単語の区切りが無いので文字単位)。 */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of text) {
    if (line && font.widthOfTextAtSize(line + char, size) > width) {
      lines.push(line)
      line = ''
    }
    line += char
  }
  return [...lines, line]
}

/** 表題と「見出し + 段落」の並びから A4 の PDF を作る。 */
export async function createPdf(title: string, sections: Section[]): Promise<Uint8Array> {
  fontBytes ??= fetch(fontUrl).then((response) => response.arrayBuffer())
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  pdf.setTitle(title)
  // subset: true(使う文字だけを埋め込む)にすると、このフォントでは文字の大半が欠ける。
  // そのためフォント全体を埋め込んでおり、PDF は 1 つ 3MB 強になる。
  const font = await pdf.embedFont(await fontBytes, { subset: false })

  let page: PDFPage = pdf.addPage([A4.width, A4.height])
  let y = A4.height - MARGIN
  // 文章を 1 かたまり書く。ページの下端まで来たら次のページへ送る。
  const write = (text: string, size: number, gapAfter: number, color = rgb(0.12, 0.14, 0.16)) => {
    for (const line of wrap(text, font, size, A4.width - MARGIN * 2)) {
      if (y - size < MARGIN) {
        page = pdf.addPage([A4.width, A4.height])
        y = A4.height - MARGIN
      }
      y -= size
      page.drawText(line, { x: MARGIN, y, size, font, color })
      y -= size * (LINE_HEIGHT - 1)
    }
    y -= gapAfter
  }

  write(title, 20, 16)
  for (const section of sections) {
    write(section.heading, 13, 4, rgb(0.18, 0.44, 0.92))
    for (const paragraph of section.paragraphs) write(paragraph, 10.5, 6)
    y -= 8
  }
  return pdf.save()
}

/** PDF の各ページを canvas に描き、container に並べる。 */
export async function renderPdf(bytes: Uint8Array, container: HTMLElement) {
  // pdf.js は渡したバッファを worker に移すので、コピーを渡す。
  const pdf = await getDocument({ data: bytes.slice() }).promise
  const canvases: HTMLCanvasElement[] = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, viewport }).promise
    canvases.push(canvas)
  }
  container.replaceChildren(...canvases)
}
