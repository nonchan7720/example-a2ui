// A2UI 側の処理: カタログの読み込み、プロンプト生成、Claude の出力(A2UI Express)の検証と変換。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { A2uiGenerator, CatalogConfig, InMemoryCatalogProvider, type RendererCapabilities, type RendererState, type StreamPart } from '@a2ui/agent'
import { withDocumentComponents } from './document-catalog.ts'

const catalogPath = fileURLToPath(new URL('../../node_modules/@a2ui/web_core/src/v1_0/schemas/catalogs/basic/catalog.json', import.meta.url))

// 起動時に 1 回だけ作る。基本カタログと、それに資料表示(表・スライド・HTML レポート)を足したカタログの 2 つ。
// どちらを使うかは、リクエストごとにクライアントの capabilities で決まる。
const catalog = CatalogConfig.fromPath(catalogPath)
const documentCatalog = new CatalogConfig(new InMemoryCatalogProvider(withDocumentComponents(JSON.parse(readFileSync(catalogPath, 'utf8')))).load())
const generator = new A2uiGenerator([documentCatalog, catalog])

/** クライアントが何も送ってこなかったときの capabilities。キーは 'v1_0' ではなく '1.0'。 */
export const defaultCapabilities: Record<string, RendererCapabilities> = {
  '1.0': { supportedCatalogIds: [catalog.catalog.id] },
}

/** リクエストごとの processor。promptSnippet と openStream() を使う。 */
export function createProcessor(capabilities: Record<string, RendererCapabilities> = defaultCapabilities) {
  return generator.createProcessor(capabilities)
}

/** SSE でクライアントへ送る形。a2ui はそのまま MessageProcessor.processMessages() に渡せる。 */
export type WirePart = { type: 'text'; text: string } | { type: 'a2ui'; a2ui: unknown[] } | { type: 'error'; message: string }

export function toWire(part: StreamPart): WirePart {
  return part.type === 'error' ? { type: 'error', message: part.error.message } : part
}

/**
 * Claude の出力を chunk ごとに読むストリームを開く。
 * 壊れたブロックは error の part になり、その後ろの text / a2ui は読み続ける。
 */
export function openA2uiStream(processor: ReturnType<typeof createProcessor>, state: RendererState) {
  const stream = processor.openStream({ state, afterRejectedBlock: 'continue' })
  // ブロックの拒否以外の失敗は例外になる。そこまでに確定した part は error.partialResults に入っている。
  let ended = false
  const safely = (read: () => StreamPart[]): WirePart[] => {
    if (ended) return []
    try {
      return read().map(toWire)
    } catch (error) {
      ended = true
      const partial = ((error as { partialResults?: StreamPart[] }).partialResults ?? []).map(toWire)
      return [...partial, { type: 'error', message: error instanceof Error ? error.message : String(error) }]
    }
  }
  return {
    feed: (chunk: string) => safely(() => stream.feed(chunk)),
    close: () => safely(() => stream.close()),
  }
}
