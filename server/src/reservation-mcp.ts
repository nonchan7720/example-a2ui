// 予約の MCP サーバー。Agent SDK と同じプロセスの中で動き、Claude からは mcp__reservations__* のツールに見える。
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { RESTAURANTS, type Reservations, SLOTS } from './reservations.ts'

const SERVER = 'reservations'
/** 読むだけのツール。Claude がいつ呼んでもよい。 */
export const READ_TOOLS = [`mcp__${SERVER}__search_availability`, `mcp__${SERVER}__list_reservations`]
/** 予約を保存するツール。実行の前に、ユーザーに承認フォームを出す(claude.ts の canUseTool)。 */
export const CREATE_TOOL = `mcp__${SERVER}__create_reservation`

// 入力エラーの文言を日本語にする(承認フォームのエラー表示に使う)。
z.config(z.locales.ja())

/** enum の値と、承認フォームに出す表示名(labels)。 */
const choice = (title: string, entries: [value: string, label: string][]) =>
  z.enum(entries.map(([value]) => value)).meta({ title, labels: Object.fromEntries(entries) })

/**
 * create_reservation の入力。承認フォームはこのスキーマから作られる(approval.ts)。
 * title がラベル、enum が選択肢、min / max などが入力チェックになる。ネストした項目(contact)と明細(courses)を含む。
 */
export const createReservationInput = {
  restaurantId: choice(
    '店',
    RESTAURANTS.map((r) => [r.id, `${r.name}(${r.area}/${r.cuisine})`]),
  ).describe('id from search_availability'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD の形で入力してください')
    .meta({ title: '日付', description: 'YYYY-MM-DD' }),
  time: choice(
    '時間',
    SLOTS.map((slot) => [slot, slot]),
  ).describe('one of availableTimes'),
  partySize: z.number().int().min(1).max(20).meta({ title: '人数' }),
  contact: z
    .object({ name: z.string().min(1).max(40).meta({ title: 'お名前' }), phone: z.string().min(10).max(15).meta({ title: '電話番号' }) })
    .meta({ title: '連絡先' }),
  courses: z
    .array(
      z.object({
        course: choice(
          'コース',
          RESTAURANTS.flatMap((r) => r.courses.map((course): [string, string] => [course, `${r.name}: ${course}`])),
        ),
        quantity: z.number().int().min(1).max(20).meta({ title: '数量' }),
      }),
    )
    .min(1)
    .meta({ title: 'コースの事前注文', description: "Pre-ordered courses. course must be one of the chosen restaurant's courses." }),
  notes: z.string().max(200).optional().meta({ title: 'ご要望' }),
}

/** 実行の前に承認フォームを出すツールと、その入力のスキーマ。 */
export const APPROVAL_SCHEMAS: Record<string, z.ZodType> = {
  [CREATE_TOOL]: z.object(createReservationInput).meta({ title: '予約の保存' }),
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

export function createReservationMcp(reservations: Reservations) {
  return createSdkMcpServer({
    name: SERVER,
    tools: [
      tool(
        'search_availability',
        'List restaurants in Kyoto that can seat the party on a date, with the times that are still available and the courses each one offers.',
        { date: z.string().describe('YYYY-MM-DD'), partySize: z.number().int().min(1) },
        async ({ date, partySize }) => json(reservations.searchAvailability(date, partySize)),
      ),
      tool(
        'create_reservation',
        'Save a reservation. The user reviews and may edit the arguments before it runs; the result echoes what was saved.',
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
