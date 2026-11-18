// 記録用の中継。通ったリクエストとレスポンスを logs/<名前>.jsonl に 1 行ずつ残す。
// 使い方: node tap.mjs <待ち受けポート> <転送先> <名前>
// 認証に関わるヘッダーの値は記録しない。
import fs from 'node:fs'
import http from 'node:http'

const [port, upstream, name] = process.argv.slice(2)
const file = `logs/${name}.jsonl`
const secret = /^(authorization|x-api-key|cookie|proxy-authorization|x-litellm-api-key)$/i
const record = (entry) => fs.appendFileSync(file, `${JSON.stringify(entry)}\n`)
const redact = (headers) => Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, secret.test(key) ? '<redacted>' : value]))

fs.mkdirSync('logs', { recursive: true })
let count = 0

http
  .createServer(async (req, res) => {
    const id = ++count
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    let json
    try {
      json = JSON.parse(body.toString('utf8'))
    } catch {
      json = undefined
    }
    record({ id, dir: 'req', method: req.method, url: req.url, headers: redact(req.headers), body: json })

    const headers = { ...req.headers }
    for (const key of ['host', 'content-length', 'connection', 'accept-encoding']) delete headers[key]
    try {
      const response = await fetch(upstream + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body })
      const responseHeaders = Object.fromEntries(response.headers)
      for (const key of ['content-encoding', 'content-length', 'transfer-encoding']) delete responseHeaders[key]
      res.writeHead(response.status, responseHeaders)
      const parts = []
      if (response.body) {
        for await (const chunk of response.body) {
          parts.push(Buffer.from(chunk))
          res.write(chunk)
        }
      }
      res.end()
      record({ id, dir: 'res', status: response.status, body: Buffer.concat(parts).toString('utf8') })
    } catch (error) {
      record({ id, dir: 'err', error: String(error), cause: String(error.cause ?? '') })
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `tap: ${error}` } }))
    }
  })
  .listen(Number(port), '127.0.0.1', () => console.log(`tap ${name}: 127.0.0.1:${port} -> ${upstream}`))
