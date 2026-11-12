// 予約の MCP サーバー。Agent SDK と同じプロセスの中で動き、Claude からは mcp__reservations__* のツールに見える。
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Reservations } from './reservations.ts'

const SERVER = 'reservations'
/** 読むだけのツール。Claude がいつ呼んでもよい。 */
export const READ_TOOLS = [`mcp__${SERVER}__search_availability`, `mcp__${SERVER}__list_reservations`]
/** 予約を保存するツール。実行の前に、ユーザーに承認フォームを出す(claude.ts の canUseTool)。 */
export const CREATE_TOOL = `mcp__${SERVER}__create_reservation`

/**
 * create_reservation の入力。title は承認フォームのラベルになる(approval.ts)。
 * ネストした項目(contact)と明細(courses)を含む。
 */
export const createReservationInput = {
  restaurantId: z.string().meta({ title: '店', description: 'id from search_availability' }),
  date: z.string().meta({ title: '日付', description: 'YYYY-MM-DD' }),
  time: z.string().meta({ title: '時間', description: 'HH:MM, one of availableTimes' }),
  partySize: z.number().int().min(1).meta({ title: '人数' }),
  contact: z.object({ name: z.string().min(1).meta({ title: 'お名前' }), phone: z.string().min(1).meta({ title: '電話番号' }) }).meta({ title: '連絡先' }),
  courses: z
    .array(z.object({ course: z.string().meta({ title: 'コース' }), quantity: z.number().int().min(1).meta({ title: '数量' }) }))
    .meta({ title: 'コースの事前注文', description: "Pre-ordered courses. course must be one of the restaurant's courses." }),
  notes: z.string().optional().meta({ title: 'ご要望' }),
}

/** 承認フォームを出すツールと、その入力の JSON Schema。 */
export const APPROVAL_SCHEMAS: Record<string, unknown> = {
  [CREATE_TOOL]: z.toJSONSchema(z.object(createReservationInput).meta({ title: '予約の保存' })),
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
