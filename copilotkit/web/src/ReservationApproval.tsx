// 予約の承認カード。Claude が confirm_reservation に渡した値を初期値にし、ユーザーが直してから承認できる。
import { ToolCallStatus } from '@copilotkit/react-core/v2'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'

export const reservationSchema = z.object({
  restaurantId: z.string().describe('Restaurant id from search_availability'),
  restaurantName: z.string().describe('Restaurant name shown to the user'),
  date: z.string().describe('YYYY-MM-DD'),
  time: z.string().describe('HH:mm, one of the available times of the restaurant'),
  partySize: z.number().describe('Number of guests'),
  name: z.string().describe('Name the reservation is under'),
})
type Reservation = z.infer<typeof reservationSchema>

type Props = {
  args: Partial<Reservation>
  status: ToolCallStatus
  result?: string
  respond?: (result: unknown) => Promise<void>
}

export function ReservationApproval({ args, status, result, respond }: Props) {
  // ユーザーが直した項目だけを持つ。直していない項目は、Claude が渡した値(args)のまま。
  const [edited, setEdited] = useState<Partial<Reservation>>({})
  const value = { ...args, ...edited }
  const field = (key: keyof Reservation, label: string, type = 'text') => (
    <label>
      {label}
      <input
        type={type}
        value={value[key] ?? ''}
        disabled={status !== ToolCallStatus.Executing}
        onChange={(event) => setEdited({ ...edited, [key]: type === 'number' ? Number(event.target.value) : event.target.value })}
        required
      />
    </label>
  )

  // 回答済み: 何と答えたかだけを出す。
  if (status === ToolCallStatus.Complete) {
    const approved = result?.includes('"approved":true')
    return <p className="approval-done">{approved ? '✔ 承認しました' : '✖ キャンセルしました'}</p>
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void respond?.({ approved: true, ...value })
  }

  return (
    <form className="approval" onSubmit={onSubmit}>
      <strong>この内容で予約しますか?</strong>
      <p>{value.restaurantName ?? '…'}</p>
      {field('date', '日付', 'date')}
      {field('time', '時刻', 'time')}
      {field('partySize', '人数', 'number')}
      {field('name', 'お名前')}
      <div>
        <button type="button" disabled={!respond} onClick={() => void respond?.({ approved: false })}>
          キャンセル
        </button>
        <button type="submit" className="primary" disabled={!respond}>
          承認して予約
        </button>
      </div>
    </form>
  )
}
