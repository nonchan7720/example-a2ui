// Claude Agent SDK に 15 個の MCP ツールを渡し、そのうち 1 個だけが返す合言葉を取ってこさせる。
// 使い方: node toolsearch.mjs <名前> <ANTHROPIC_BASE_URL | direct> <ENABLE_TOOL_SEARCH の値 | unset>
import fs from 'node:fs'
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

const [name, baseUrl, toolSearch] = process.argv.slice(2)
const log = (line) => console.log(`[${name}] ${line}`)

// 実行のたびに変わる値にして、ツールを呼ばずに答えられないようにする。
const code = `ZEBRA-${Math.floor(Math.random() * 1e6)}`
const dummies = [
  'invoice_lookup',
  'crm_search_contacts',
  'calendar_find_slot',
  'weather_forecast',
  'stock_quote',
  'translate_text',
  'pdf_extract_tables',
  'image_resize',
  'dns_lookup',
  'unit_convert',
  'geo_reverse',
  'ticket_create',
  'payroll_summary',
  'inventory_count',
].map((id) => tool(id, `Dummy ${id.replaceAll('_', ' ')} tool.`, { q: z.string() }, async () => ({ content: [{ type: 'text', text: 'n/a' }] })))
const target = tool('warehouse_secret_code', 'Returns the secret code of the warehouse vault.', { vault: z.string() }, async ({ vault }) => ({
  content: [{ type: 'text', text: `vault=${vault} code=${code}` }],
}))

const env = { ...process.env }
if (baseUrl !== 'direct') env.ANTHROPIC_BASE_URL = baseUrl
if (toolSearch === 'unset') delete env.ENABLE_TOOL_SEARCH
else env.ENABLE_TOOL_SEARCH = toolSearch

fs.mkdirSync('logs', { recursive: true })
const calls = []
const messages = query({
  prompt: "Get the secret code of warehouse vault 'A7' using the available tools and reply with the code only.",
  options: {
    model: 'claude-sonnet-5-5',
    maxTurns: 6,
    settingSources: [],
    mcpServers: { biz: createSdkMcpServer({ name: 'biz', version: '1.0.0', tools: [...dummies, target] }) },
    allowedTools: ['mcp__biz'],
    env,
    extraArgs: { 'debug-file': `logs/${name}.debug.txt` },
  },
})

for await (const message of messages) {
  if (message.type === 'system' && message.subtype === 'init') {
    log(
      `init: ToolSearch ツール=${message.tools.includes('ToolSearch') ? 'あり' : 'なし'} / MCP ツール=${message.tools.filter((t) => t.startsWith('mcp__biz')).length} 個`,
    )
  }
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type !== 'tool_use') continue
      calls.push(block.name)
      log(`tool_use: ${block.name} ${JSON.stringify(block.input)}`)
    }
  }
  if (message.type === 'user' && Array.isArray(message.message.content)) {
    for (const block of message.message.content) {
      if (block.type === 'tool_result') log(`tool_result: ${JSON.stringify(block.content)}`)
    }
  }
  if (message.type === 'result') {
    log(`result: ${message.subtype} / ターン数=${message.num_turns} / 合言葉を取得=${String(message.result).includes(code) ? '成功' : '失敗'}`)
  }
}
log(`呼び出し順: ${calls.join(' → ')}`)
