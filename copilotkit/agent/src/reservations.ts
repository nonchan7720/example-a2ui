// 予約のツール(Claude Agent SDK のプロセス内 MCP サーバー)。データは架空で、メモリにだけ持つ。
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

const RESTAURANTS = [
  { id: 'kikunoi', name: '菊乃井(懐石)', times: ['18:00', '19:30'] },
  { id: 'tempura-matsu', name: '天ぷら 松', times: ['17:30', '20:00'] },
  { id: 'sushi-iwa', name: '鮨 いわ', times: ['18:30'] },
]

type Reservation = { id: string; restaurantId: string; date: string; time: string; partySize: number; name: string }
const saved: Reservation[] = []

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

export const SERVER = 'reservations'
/** 常に許可する、読むだけのツール(`mcp__<サーバー名>__<ツール名>`)。 */
export const READ_TOOLS = ['search_availability', 'list_reservations'].map((name) => `mcp__${SERVER}__${name}`)
/** 予約を保存するツール。ユーザーの承認が要る(approval-gate.ts)。 */
export const CREATE_TOOL = `mcp__${SERVER}__create_reservation`

/** create_reservation の入力。承認カード(confirm_reservation)が返す値も、この形で確かめる。 */
export const reservationInput = z.object({
  restaurantId: z.string(),
  date: z.string().describe('YYYY-MM-DD'),
  time: z.string().describe('HH:mm'),
  partySize: z.number().int().min(1),
  name: z.string().min(1),
})

export function createReservationMcp() {
  return createSdkMcpServer({
    name: SERVER,
    tools: [
      tool(
        'search_availability',
        'List restaurants in Kyoto that can seat the party on a date, with the times that are still available.',
        { date: z.string().describe('YYYY-MM-DD'), partySize: z.number().int().min(1) },
        async ({ partySize }) => json(partySize > 8 ? [] : RESTAURANTS),
      ),
      tool(
        'create_reservation',
        'Save a reservation. It runs only after the user approved through confirm_reservation, and saves the approved values; the result echoes what was saved.',
        reservationInput.shape,
        async (input) => {
          const restaurant = RESTAURANTS.find((candidate) => candidate.id === input.restaurantId)
          if (!restaurant?.times.includes(input.time)) return { ...json({ error: 'その店のその時刻は空いていません' }), isError: true }
          const reservation = { id: `R${String(saved.length + 1).padStart(4, '0')}`, ...input }
          saved.push(reservation)
          return json({ reservationId: reservation.id, saved: reservation })
        },
      ),
      tool('list_reservations', 'List the reservations saved so far.', {}, async () => json(saved)),
    ],
  })
}
