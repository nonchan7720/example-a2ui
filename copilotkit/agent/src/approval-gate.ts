// 承認の強制。
// 承認カードは CopilotKit の公式の方法(ブラウザ側のツール confirm_reservation、web/ の useHumanInTheLoop)で出す。
// それだけだと「承認してから保存する」かどうかは Claude 次第なので、Agent SDK の canUseTool でサーバー側から止める:
//   - confirm_reservation の結果(ユーザーの回答)が Claude に返るところを見て、承認された値をスレッドごとに覚える
//   - create_reservation は canUseTool を通る。承認が無ければ断り、あれば承認された値に入力を差し替えて実行する
//   - 承認は 1 回の保存で使い切る
import { ClaudeAgentAdapter } from '@ag-ui/claude-agent-sdk'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { z } from 'zod'

/** 承認を求めるブラウザ側のツールと、承認が要るツール。 */
export type Gate = {
  /** ブラウザ側のツールの名前(useHumanInTheLoop の name)。 */
  confirmTool: string
  /** 承認が要るツールの名前(`mcp__<サーバー名>__<ツール名>`)。 */
  gatedTool: string
  /** 承認された値の形。ここを通った値だけが、承認が要るツールの入力になる。 */
  schema: z.ZodType<Record<string, unknown>>
}

/** スレッドごとの、まだ使われていない承認。 */
export class Approvals {
  private readonly pending = new Map<string, Record<string, unknown>>()
  private readonly gate: Gate

  constructor(gate: Gate) {
    this.gate = gate
  }

  /** ブラウザ側のツールの結果を見る。`{"approved": true, ...値}` なら承認として覚え、それ以外なら前の承認も取り消す。 */
  record(threadId: string, toolName: string, result: unknown): void {
    if (toolName !== this.gate.confirmTool) return
    this.pending.delete(threadId)
    const answer = parseAnswer(result)
    if (answer?.approved !== true) return
    const values = this.gate.schema.safeParse(answer)
    if (values.success) this.pending.set(threadId, values.data)
  }

  /** そのスレッドの canUseTool。 */
  canUseTool(threadId: string): CanUseTool {
    return async (toolName) => {
      if (toolName !== this.gate.gatedTool) return { behavior: 'deny', message: 'This tool is not available.' }
      const approved = this.pending.get(threadId)
      if (!approved) {
        return { behavior: 'deny', message: `The user has not approved this. Call ${this.gate.confirmTool} first and wait for {"approved": true}.` }
      }
      this.pending.delete(threadId)
      // Claude が書いた引数ではなく、ユーザーが承認した値で実行する。
      return { behavior: 'allow', updatedInput: approved }
    }
  }
}

/** ツールの結果(文字列、テキストのブロックの配列、{ content } のどれか)から、回答の JSON を取り出す。 */
function parseAnswer(result: unknown): Record<string, unknown> | undefined {
  const content = result && typeof result === 'object' && 'content' in result ? result.content : result
  const text = Array.isArray(content) ? content.map((block) => (block?.type === 'text' ? block.text : '')).join('') : content
  if (typeof text !== 'string') return undefined
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

type BuildOptions = ClaudeAgentAdapter['buildOptions']

/** ClaudeAgentAdapter に、承認の強制を足したもの。 */
export class GatedClaudeAgent extends ClaudeAgentAdapter {
  // CopilotKit のランタイムはリクエストごとにエージェントを clone() するので、承認はインスタンスではなくここ(プロセスで 1 つ)に持つ。
  static approvals: Approvals

  override buildOptions(...[input, profileOptions, resolveFrontendResult]: Parameters<BuildOptions>): ReturnType<BuildOptions> {
    const { approvals } = GatedClaudeAgent
    const { threadId } = input
    // ブラウザ側のツールの結果が Claude に返る直前に、ここを通る。
    const observed: typeof resolveFrontendResult =
      resolveFrontendResult &&
      ((name, args) => {
        const result = resolveFrontendResult(name, args)
        void Promise.resolve(result).then((value) => approvals.record(threadId, name, value))
        return result
      })
    const options = super.buildOptions(input, profileOptions, observed)
    // allowedTools に無いツール(= 承認が要るツール)は、実行の前に canUseTool に来る。
    return { ...options, canUseTool: approvals.canUseTool(threadId) }
  }
}
