import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openReservations } from './reservations.ts'

const booking = {
  restaurantId: 'kamoshiki',
  date: '2026-11-20',
  time: '19:00',
  partySize: 4,
  contact: { name: '山田 太郎', phone: '090-1234-5678' },
  items: [
    { menuItemId: 'kamoshiki-01', quantity: 3 },
    { menuItemId: 'kamoshiki-12', quantity: 1 },
  ],
}

test('予約を保存すると番号が返り、明細と一緒に一覧に出る', () => {
  const reservations = openReservations(':memory:')
  assert.equal(reservations.createReservation(booking), 1)
  assert.partialDeepStrictEqual(reservations.listReservations(), [
    {
      id: 1,
      restaurant_id: 'kamoshiki',
      party_size: 4,
      name: '山田 太郎',
      items: [
        { menu_item_id: 'kamoshiki-01', name: '鯛の昆布締め', quantity: 3 },
        { menu_item_id: 'kamoshiki-12', name: '鴨の土鍋ごはん', quantity: 1 },
      ],
    },
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

test('保存できない内容は、場所と理由が分かり、何も保存されない', () => {
  const reservations = openReservations(':memory:')
  const wrong = { ...booking, time: '03:00', items: [booking.items[0], { menuItemId: 'hanakago-01', quantity: 0 }] }
  assert.deepEqual(reservations.problems(wrong), [
    { path: ['time'], message: 'この時刻は選べません' },
    { path: ['items', 1, 'menuItemId'], message: '鴨四季 のメニューにありません' },
    { path: ['items', 1, 'quantity'], message: '1 以上で入力してください' },
  ])
  assert.throws(() => reservations.createReservation(wrong))
  assert.deepEqual(reservations.listReservations(), [])
})

test('メニューはページに分けて取れ、検索と ID 指定ができる', () => {
  const reservations = openReservations(':memory:')
  const first = reservations.listMenuItems('hanakago', { limit: 10 })
  assert.equal(first.items.length, 10)
  assert.deepEqual(first.items[0], { id: 'hanakago-01', name: '鯛の昆布締め 1,800円' })
  const second = reservations.listMenuItems('hanakago', { limit: 10, cursor: first.nextCursor })
  const third = reservations.listMenuItems('hanakago', { limit: 10, cursor: second.nextCursor })
  assert.equal(second.items[0].id, 'hanakago-11')
  assert.equal(third.items.length, 4)
  assert.equal(third.nextCursor, undefined)

  assert.deepEqual(
    reservations.listMenuItems('hanakago', { query: '鴨' }).items.map((item) => item.name),
    ['鴨の昆布締め 1,800円', '鴨の炊き合わせ 1,400円', '鴨の天ぷら 1,600円', '鴨の土鍋ごはん 2,200円'],
  )
  assert.deepEqual(reservations.listMenuItems('hanakago', { ids: ['hanakago-24', 'kamoshiki-01'] }).items, [
    { id: 'hanakago-24', name: '九条ねぎの土鍋ごはん 2,200円' },
  ])
})
