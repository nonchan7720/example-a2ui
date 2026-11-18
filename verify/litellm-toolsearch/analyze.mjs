// tap.mjs の記録から、tool search に関わる部分だけを取り出す。
// 使い方: node analyze.mjs <名前>...
// logs/<名前>.client.jsonl   = SDK が LiteLLM へ送ったもの
// logs/<名前>.upstream.jsonl = LiteLLM が Anthropic API へ送ったもの
import fs from 'node:fs'

const requests = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.dir === 'req' && entry.url.startsWith('/v1/messages') && entry.body?.tools?.length)

const blockTypes = (body) =>
  body.messages
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .flatMap((block) => [block.type, ...(Array.isArray(block.content) ? block.content.map((inner) => `${block.type}>${inner.type}`) : [])])

const betas = (entry) => new Set((entry.headers['anthropic-beta'] ?? '').split(',').filter(Boolean))

for (const name of process.argv.slice(2)) {
  const client = requests(`logs/${name}.client.jsonl`)
  const upstream = requests(`logs/${name}.upstream.jsonl`)
  console.log(`== ${name}: SDK→LiteLLM ${client.length} 件 / LiteLLM→Anthropic ${upstream.length} 件`)
  upstream.forEach((sent, index) => {
    const tools = sent.body.tools
    const deferred = tools.filter((t) => t.defer_loading).map((t) => t.name)
    const references = blockTypes(sent.body).filter((type) => type === 'tool_result>tool_reference').length
    console.log(`  リクエスト ${index + 1} (Anthropic に届いた内容)`)
    console.log(
      `    tools=${tools.length} 個 / うち MCP=${tools.filter((t) => t.name.startsWith('mcp__')).length} 個 / defer_loading=${JSON.stringify(deferred)}`,
    )
    console.log(
      `    tool_reference ブロック=${references} 個 / advanced-tool-use ベータ=${[...betas(sent)].some((b) => b.startsWith('advanced-tool-use')) ? 'あり' : 'なし'}`,
    )

    const original = client[index]
    if (!original) return
    const sameBody =
      JSON.stringify(original.body.tools) === JSON.stringify(tools) && JSON.stringify(original.body.messages) === JSON.stringify(sent.body.messages)
    const dropped = [...betas(original)].filter((beta) => !betas(sent).has(beta))
    console.log(`    LiteLLM の前後: tools と messages=${sameBody ? '完全一致' : '差分あり'} / 落ちたベータ=${dropped.join(',') || 'なし'}`)
    console.log(`    LiteLLM のキーが上流に漏れていないか: ${'x-litellm-api-key' in sent.headers ? '漏れている' : '漏れていない'}`)
  })
}
