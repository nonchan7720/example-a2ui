// run.sh が記録した「SDK が LiteLLM へ送った実リクエスト」を、Bedrock 向け設定の LiteLLM に流し直し、
// LiteLLM が Bedrock へ送ろうとした内容と比べる。
// 使い方: node bedrock/replay.mjs <LiteLLM のマスターキー>
import fs from 'node:fs'

const read = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.dir === 'req')
const sent = read('logs/litellm-true.client.jsonl').filter((entry) => entry.url.startsWith('/v1/messages') && entry.body?.tools?.length)

for (const request of sent) {
  await fetch(`http://127.0.0.1:4000${request.url}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': request.headers['anthropic-version'],
      'anthropic-beta': request.headers['anthropic-beta'],
      'x-litellm-api-key': `Bearer ${process.argv[2]}`,
    },
    body: JSON.stringify(request.body),
  }).then((response) => response.text())
}

const converted = read('logs/bedrock.jsonl')
console.log(`SDK→LiteLLM ${sent.length} 件 / LiteLLM→Bedrock ${converted.length} 件`)
sent.forEach((original, index) => {
  const bedrock = converted[index]
  if (!bedrock) return
  const before = original.headers['anthropic-beta'].split(',')
  const after = bedrock.body.anthropic_beta ?? []
  const tools = bedrock.body.tools ?? []
  const references = JSON.stringify(bedrock.body.messages).split('"type":"tool_reference"').length - 1
  console.log(`  リクエスト ${index + 1}: ${bedrock.method} ${bedrock.url}`)
  console.log(
    `    tools=${JSON.stringify(original.body.tools) === JSON.stringify(tools) ? '完全一致' : '差分あり'} / defer_loading=${JSON.stringify(tools.filter((t) => t.defer_loading).map((t) => t.name))}`,
  )
  console.log(`    tool_reference ブロック=${references} 個`)
  console.log(`    Bedrock へ送るベータ=${after.join(', ')}`)
  console.log(`    落としたベータ=${before.filter((beta) => !after.includes(beta)).join(', ')}`)
  console.log(`    足したベータ=${after.filter((beta) => !before.includes(beta)).join(', ') || 'なし'}`)
  console.log(
    `    落とした項目=${Object.keys(original.body)
      .filter((key) => !(key in bedrock.body))
      .join(', ')}`,
  )
  console.log(`    thinking: ${JSON.stringify(original.body.thinking)} → ${JSON.stringify(bedrock.body.thinking)}`)
})
