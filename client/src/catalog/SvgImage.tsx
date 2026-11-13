// Claude が SVG で描いた画像。SVG と PNG でダウンロードできる。
import { createComponentImplementation } from '@a2ui/react'
import { useRef } from 'react'
import { z } from 'zod'
import { download } from './download.ts'

const SvgImageApi = {
  name: 'SvgImage',
  schema: z.object({ title: z.string(), svg: z.string() }),
}

export const SvgImage = createComponentImplementation(SvgImageApi, ({ props }) => {
  const { title, svg } = props
  const image = useRef<HTMLImageElement>(null)
  // <img> で表示するので、SVG の中のスクリプトは動かず、外部のファイルも読み込まれない。
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

  const savePng = () => {
    const img = image.current
    if (!img) return
    // 表示の 2 倍の解像度で canvas に描き、PNG にする。
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth * 2
    canvas.height = img.naturalHeight * 2
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => blob && download(blob, `${title}.png`), 'image/png')
  }

  return (
    <figure className="doc">
      <figcaption>
        <strong>{title}</strong>
        <span>
          <button type="button" onClick={() => download(new Blob([svg], { type: 'image/svg+xml' }), `${title}.svg`)}>
            SVG
          </button>
          <button type="button" onClick={savePng}>
            PNG
          </button>
        </span>
      </figcaption>
      <img ref={image} src={source} alt={title} />
    </figure>
  )
})
