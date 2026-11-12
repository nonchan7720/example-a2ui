import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openReservations } from './reservations.ts'

const booking = {
  restaurantId: 'kamoshiki',
  date: '2026-11-20',
  time: '19:00',
  partySize: 4,
  contact: { name: '山田 太郎', phone: '090-1234-5678' },
  courses: [
    { course: 'おまかせ 15,000円', quantity: 3 },
    { course: '鴨鍋コース 9,800円', quantity: 1 },
  ],
}

test('予約を保存すると番号が返り、一覧に出る', () => {
  const reservations = openReservations(':memory:')
  const id = reservations.createReservation(booking)
  assert.equal(id, 1)
  assert.partialDeepStrictEqual(reservations.listReservations(), [
    { id: 1, restaurant_id: 'kamoshiki', time: '19:00', party_size: 4, name: '山田 太郎', courses: booking.courses },
  ])
})

test('席が埋まった時刻は空き状況から消え、それ以上は予約できない', () => {
  const reservations = openReservations(':memory:')
  reservations.createReservation(booking)
  reservations.createReservation(booking) // 8 席の店に 4 人 × 2 組
  const kamoshiki = reservations.searchAvailability('2026-11-20', 4).find((r) => r.id === 'kamoshiki')
  assert.ok(kamoshiki)
  assert.ok(!kamoshiki.availableTimes.includes('19:00'))
  assert.ok(kamoshiki.availableTimes.includes('19:30'))
  assert.throws(() => reservations.createReservation(booking), /満席/)
})

test('存在しない店・時刻・コースは保存しない', () => {
  const reservations = openReservations(':memory:')
  assert.throws(() => reservations.createReservation({ ...booking, restaurantId: 'nowhere' }), /店が見つかりません/)
  assert.throws(() => reservations.createReservation({ ...booking, time: '03:00' }), /日時が正しくありません/)
  assert.throws(() => reservations.createReservation({ ...booking, courses: [{ course: '無いコース', quantity: 1 }] }), /無いコース/)
  assert.deepEqual(reservations.listReservations(), [])
})
