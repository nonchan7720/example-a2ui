// 予約の MCP サーバー。Agent SDK と同じプロセスの中で動き、Claude からは mcp__reservations__* のツールに見える。
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { openReservations, type Problem, type Reservation, SLOTS } from '../api/reservations.ts'

// MCP サーバーの後ろにある API(このサンプルでは SQLite を直接開く)。MCP より上の層は、これに触らない。
const reservations = openReservations(process.env.A2UI_CHAT_DB ?? new URL('../../data/reservations.db', import.meta.url).pathname)

const SERVER = 'reservations'
const name = (toolName: string) => `mcp__${SERVER}__${toolName}`

/** 読むだけのツール。Claude がいつ呼んでもよい。 */
export const READ_TOOLS = ['search_availability', 'list_restaurants', 'list_menu_items', 'list_reservations'].map(name)
/** 予約を保存するツール。実行の前に、ユーザーに承認フォームを出す(agent/claude.ts の canUseTool)。 */
export const CREATE_TOOL = name('create_reservation')
/** フォームの選択欄が選択肢を取るために、Claude に呼ばせてよいツール(agent/options.ts)。 */
export const OPTION_TOOLS = ['list_restaurants', 'list_menu_items']

// 入力エラーの文言を日本語にする(承認フォームのエラー表示に使う)。
z.config(z.locales.ja())

/**
 * 選択肢を返すツールの共通の入力。ツールは { items: [{ id, name }], nextCursor? } を返す。
 * フォームの選択欄は、開いたとき・検索したとき・下までスクロールしたときに、Claude 経由でこのツールを 1 ページずつ呼ぶ。
 */
const paging = {
  query: z.string().optional().describe('Filter by name.'),
  cursor: z.string().optional().describe('nextCursor of the previous page.'),
  limit: z.number().int().min(1).max(50).optional().describe('Page size, default 10.'),
  ids: z.array(z.string()).optional().describe('Return only these ids (to look up names).'),
}

/**
 * create_reservation の入力。承認フォームはこのスキーマから作られる(app/approval.ts)。
 *   title       … ラベル
 *   enum        … その場で選ぶ選択肢(labels が表示名)
 *   optionsFrom … 別のツールから取る選択肢。params は「ツールの引数名: フォームの項目名」で、その項目の今の値が渡る
 *   min / max   … 入力チェック
 */
export const createReservationInput = {
  restaurantId: z.string().meta({ title: '店', description: 'id from search_availability', optionsFrom: { tool: 'list_restaurants' } }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD の形で入力してください')
    .meta({ title: '日付', description: 'YYYY-MM-DD' }),
  time: z.enum(SLOTS).meta({ title: '時間', description: 'one of availableTimes' }),
  partySize: z.number().int().min(1).max(20).meta({ title: '人数' }),
  contact: z
    .object({ name: z.string().min(1).max(40).meta({ title: 'お名前' }), phone: z.string().min(10).max(15).meta({ title: '電話番号' }) })
    .meta({ title: '連絡先' }),
  items: z
    .array(
      z.object({
        menuItemId: z.string().meta({
          title: 'メニュー',
          description: 'id from list_menu_items of the chosen restaurant',
          // メニューは店ごとに数十あるので、選択肢を埋め込まず、選ばれている店のメニューをツールから取る。
          optionsFrom: { tool: 'list_menu_items', params: { restaurantId: 'restaurantId' } },
        }),
        quantity: z.number().int().min(1).max(20).meta({ title: '数量' }),
      }),
    )
    .min(1)
    .meta({ title: '事前注文' }),
  notes: z.string().max(200).optional().meta({ title: 'ご要望' }),
}

/** 実行の前に承認フォームを出すツール。check は、スキーマでは分からない誤り(満席、店に無いメニューなど)を調べる。 */
export type Approval = { schema: z.ZodType; check?: (input: Record<string, unknown>) => Problem[] }

export const APPROVALS: Record<string, Approval> = {
  [CREATE_TOOL]: {
    schema: z.object(createReservationInput).meta({ title: '予約の保存' }),
    check: (input) => reservations.problems(input as Reservation),
  },
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

export function createReservationMcp() {
  return createSdkMcpServer({
    name: SERVER,
    tools: [
      tool(
        'search_availability',
        'List restaurants in Kyoto that can seat the party on a date, with the times that are still available.',
        { date: z.string().describe('YYYY-MM-DD'), partySize: z.number().int().min(1) },
        async ({ date, partySize }) => json(reservations.searchAvailability(date, partySize)),
      ),
      tool('list_restaurants', 'List restaurants, one page at a time.', paging, async (request) => json(reservations.listRestaurants(request))),
      tool(
        'list_menu_items',
        'List the menu items of a restaurant, one page at a time. A restaurant has dozens of items.',
        { restaurantId: z.string(), ...paging },
        async ({ restaurantId, ...request }) => json(reservations.listMenuItems(restaurantId, request)),
      ),
      tool(
        'create_reservation',
        'Save a reservation with its pre-ordered menu items. The user reviews and may edit the arguments before it runs; the result echoes what was saved.',
        createReservationInput,
        async (reservation) => {
          try {
            return json({ reservationId: reservations.createReservation(reservation), saved: reservation })
          } catch (error) {
            return { ...json({ error: (error as Error).message }), isError: true }
          }
        },
      ),
      tool('list_reservations', 'List the reservations saved so far.', {}, async () => json(reservations.listReservations())),
    ],
  })
}
