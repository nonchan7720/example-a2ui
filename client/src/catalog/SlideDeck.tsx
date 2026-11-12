// スライド。PowerPoint(.pptx) でダウンロードできる。
import { createComponentImplementation } from '@a2ui/react'
import { z } from 'zod'
import { download } from './download.ts'

const SlideDeckApi = {
  name: 'SlideDeck',
  schema: z.object({
    title: z.string(),
    slides: z.array(z.object({ title: z.string(), bullets: z.array(z.string()) })),
  }),
}

export const SlideDeck = createComponentImplementation(SlideDeckApi, ({ props }) => {
  const { title, slides } = props

  const savePowerPoint = async () => {
    // pptxgenjs は大きいので、押されたときに読み込む。
    const { default: PptxGenJS } = await import('pptxgenjs')
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_WIDE' // 13.33 x 7.5 インチ
    pptx.title = title
    for (const slide of slides) {
      const page = pptx.addSlide()
      page.addText(slide.title, { x: 0.6, y: 0.4, w: 12.1, h: 1, fontSize: 30, bold: true, fontFace: 'Yu Gothic' })
      page.addText(
        slide.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
        { x: 0.6, y: 1.6, w: 12.1, h: 5.2, fontSize: 20, valign: 'top', paraSpaceAfter: 10, fontFace: 'Yu Gothic' },
      )
    }
    download((await pptx.write({ outputType: 'blob' })) as Blob, `${title}.pptx`)
  }

  return (
    <figure className="doc">
      <figcaption>
        <strong>{title}</strong>
        <span>
          <button type="button" onClick={savePowerPoint}>
            PowerPoint
          </button>
        </span>
      </figcaption>
      <ol className="slides">
        {slides.map((slide, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: スライドに ID は無く、並び替えもしない
          <li key={index}>
            <h3>{slide.title}</h3>
            <ul>
              {slide.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <small>
              {index + 1} / {slides.length}
            </small>
          </li>
        ))}
      </ol>
    </figure>
  )
})
