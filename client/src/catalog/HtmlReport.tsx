// HTML のレポート。.html でダウンロードできる。
import { createComponentImplementation } from '@a2ui/react'
import { useState } from 'react'
import { z } from 'zod'
import { download } from './download.ts'

const HtmlReportApi = {
  name: 'HtmlReport',
  schema: z.object({ title: z.string(), html: z.string() }),
}

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')

/** 断片を 1 つの HTML 文書にする。CSP で外部への通信とスクリプトを止める。 */
const toDocument = (title: string, html: string) => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(title)}</title>
<style>body { margin: 24px; font-family: system-ui, sans-serif; line-height: 1.7; color: #1f2328; } table { border-collapse: collapse; } th, td { padding: 6px 12px; border: 1px solid #d9dde3; }</style>
</head>
<body>
${html}
</body>
</html>`

export const HtmlReport = createComponentImplementation(HtmlReportApi, ({ props }) => {
  const { title, html } = props
  const [height, setHeight] = useState(400)
  const source = toDocument(title, html)

  return (
    <figure className="doc">
      <figcaption>
        <strong>{title}</strong>
        <span>
          <button type="button" onClick={() => download(new Blob([source], { type: 'text/html;charset=utf-8' }), `${title}.html`)}>
            HTML
          </button>
        </span>
      </figcaption>
      {/* Claude が書いた HTML なので、スクリプトを実行しない sandbox の中に表示する。
          allow-same-origin は高さを測るためだけに付けている(スクリプトは動かないので外には触れない)。 */}
      <iframe
        title={title}
        sandbox="allow-same-origin"
        srcDoc={source}
        style={{ height }}
        onLoad={(event) => setHeight((event.currentTarget.contentDocument?.documentElement.scrollHeight ?? 400) + 2)}
      />
    </figure>
  )
})
