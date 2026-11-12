// 予約の保存先。Node 組み込みの SQLite を使う。店は架空のサンプルデータ。
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SLOTS = ['17:30', '18:00', '18:30', '19:00', '19:30', '20:00']

export const RESTAURANTS = [
  { id: 'hanakago', name: '花かご', area: '祇園・東山', cuisine: '懐石', seats: 12, courses: ['月コース 12,000円', '花コース 18,000円'] },
  { id: 'kamoshiki', name: '鴨四季', area: '河原町・先斗町', cuisine: '割烹', seats: 8, courses: ['おまかせ 15,000円', '鴨鍋コース 9,800円'] },
  {
    id: 'obanzai-tsumugi',
    name: 'おばんざい 紬',
    area: '京都駅周辺',
    cuisine: 'おばんざい',
    seats: 20,
    courses: ['おばんざい膳 4,500円', '季節の会席 7,000円'],
  },
]

export type Reservation = {
  restaurantId: string
  date: string
  time: string
  partySize: number
  contact: { name: string; phone: string }
  /** コースの事前注文(明細)。 */
  courses: { course: string; quantity: number }[]
  notes?: string
}

export function openReservations(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (id TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT NOT NULL, cuisine TEXT NOT NULL, seats INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
      date TEXT NOT NULL, time TEXT NOT NULL, party_size INTEGER NOT NULL,
      name TEXT NOT NULL, phone TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS reservation_courses (
      reservation_id INTEGER NOT NULL REFERENCES reservations(id),
      course TEXT NOT NULL, quantity INTEGER NOT NULL
    );
  `)
  const seed = db.prepare('INSERT OR IGNORE INTO restaurants (id, name, area, cuisine, seats) VALUES (?, ?, ?, ?, ?)')
  for (const r of RESTAURANTS) seed.run(r.id, r.name, r.area, r.cuisine, r.seats)
  const insertCourse = db.prepare('INSERT INTO reservation_courses (reservation_id, course, quantity) VALUES (?, ?, ?)')

  /** その店・日・時刻に、すでに予約されている人数。 */
  const booked = db.prepare('SELECT COALESCE(SUM(party_size), 0) AS total FROM reservations WHERE restaurant_id = ? AND date = ? AND time = ?')
  const seatsLeft = (restaurant: { id: string; seats: number }, date: string, time: string) =>
    restaurant.seats - Number(booked.get(restaurant.id, date, time)?.total ?? 0)

  return {
    /** 指定の日に、その人数で入れる店と時刻の一覧。 */
    searchAvailability(date: string, partySize: number) {
      return RESTAURANTS.map((restaurant) => ({
        ...restaurant,
        availableTimes: SLOTS.filter((time) => seatsLeft(restaurant, date, time) >= partySize),
      })).filter((restaurant) => restaurant.availableTimes.length > 0)
    },

    /** 予約を 1 件保存し、予約番号を返す。空きが無ければ例外。 */
    createReservation(r: Reservation): number {
      const restaurant = RESTAURANTS.find((candidate) => candidate.id === r.restaurantId)
      if (!restaurant) throw new Error(`店が見つかりません: ${r.restaurantId}`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !SLOTS.includes(r.time)) throw new Error(`日時が正しくありません: ${r.date} ${r.time}`)
      if (seatsLeft(restaurant, r.date, r.time) < r.partySize) throw new Error(`${restaurant.name} の ${r.date} ${r.time} は満席です`)
      for (const item of r.courses) {
        if (!restaurant.courses.includes(item.course)) throw new Error(`${restaurant.name} に無いコースです: ${item.course}`)
        if (!(item.quantity >= 1)) throw new Error(`数量が正しくありません: ${item.course}`)
      }
      // 予約と明細は、まとめて保存するか、どちらも保存しない。
      db.exec('BEGIN')
      try {
        const row = db
          .prepare('INSERT INTO reservations (restaurant_id, date, time, party_size, name, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
          .get(r.restaurantId, r.date, r.time, r.partySize, r.contact.name, r.contact.phone, r.notes ?? '')
        const id = Number(row?.id)
        for (const item of r.courses) insertCourse.run(id, item.course, item.quantity)
        db.exec('COMMIT')
        return id
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    listReservations() {
      const courses = db.prepare('SELECT course, quantity FROM reservation_courses WHERE reservation_id = ? ORDER BY rowid')
      return db
        .prepare('SELECT * FROM reservations ORDER BY id')
        .all()
        .map((reservation) => ({ ...reservation, courses: courses.all(reservation.id) }))
    },
  }
}

export type Reservations = ReturnType<typeof openReservations>
