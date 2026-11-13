// 予約の保存先。Node 組み込みの SQLite を使う。店とメニューは架空のサンプルデータ。
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SLOTS = ['17:30', '18:00', '18:30', '19:00', '19:30', '20:00']

export const RESTAURANTS = [
  { id: 'hanakago', name: '花かご', area: '祇園・東山', cuisine: '懐石', seats: 12 },
  { id: 'kamoshiki', name: '鴨四季', area: '河原町・先斗町', cuisine: '割烹', seats: 8 },
  { id: 'obanzai-tsumugi', name: 'おばんざい 紬', area: '京都駅周辺', cuisine: 'おばんざい', seats: 20 },
]

// メニューは 1 店あたり 24 品(食材 6 × 調理法 4)。選択肢をページに分けて取りに行く例のために、数を多くしている。
const INGREDIENTS = ['鯛', '鰆', '鴨', '湯葉', '賀茂なす', '九条ねぎ']
const DISHES = [
  { name: 'の昆布締め', price: 1800 },
  { name: 'の炊き合わせ', price: 1400 },
  { name: 'の天ぷら', price: 1600 },
  { name: 'の土鍋ごはん', price: 2200 },
]

export type Reservation = {
  restaurantId: string
  date: string
  time: string
  partySize: number
  contact: { name: string; phone: string }
  /** 事前注文(明細)。 */
  items: { menuItemId: string; quantity: number }[]
  notes?: string
}

/** 選択肢の 1 ページ。nextCursor があれば続きがある。 */
export type Page = { items: { id: string; name: string }[]; nextCursor?: string }
export type PageRequest = { query?: string; cursor?: string; limit?: number; ids?: string[] }

/** 入力のどこが、なぜ保存できないか。path は入力の中の場所。 */
export type Problem = { path: (string | number)[]; message: string }

export function openReservations(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (id TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT NOT NULL, cuisine TEXT NOT NULL, seats INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS menu_items (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id), name TEXT NOT NULL, price INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
      date TEXT NOT NULL, time TEXT NOT NULL, party_size INTEGER NOT NULL,
      name TEXT NOT NULL, phone TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS reservation_items (
      reservation_id INTEGER NOT NULL REFERENCES reservations(id),
      menu_item_id TEXT NOT NULL REFERENCES menu_items(id), quantity INTEGER NOT NULL
    );
  `)
  const seedRestaurant = db.prepare('INSERT OR IGNORE INTO restaurants (id, name, area, cuisine, seats) VALUES (?, ?, ?, ?, ?)')
  const seedMenuItem = db.prepare('INSERT OR IGNORE INTO menu_items (id, restaurant_id, name, price) VALUES (?, ?, ?, ?)')
  for (const r of RESTAURANTS) {
    seedRestaurant.run(r.id, r.name, r.area, r.cuisine, r.seats)
    INGREDIENTS.forEach((ingredient, i) => {
      DISHES.forEach((dish, j) => {
        seedMenuItem.run(`${r.id}-${String(i * DISHES.length + j + 1).padStart(2, '0')}`, r.id, `${ingredient}${dish.name}`, dish.price)
      })
    })
  }

  /** その店・日・時刻に、すでに予約されている人数。 */
  const booked = db.prepare('SELECT COALESCE(SUM(party_size), 0) AS total FROM reservations WHERE restaurant_id = ? AND date = ? AND time = ?')
  const seatsLeft = (restaurant: { id: string; seats: number }, date: string, time: string) =>
    restaurant.seats - Number(booked.get(restaurant.id, date, time)?.total ?? 0)

  /**
   * 選択肢を 1 ページ返す。ids を渡すと、その ID のものだけを返す(選択済みの値の表示名を引くとき)。
   * cursor は「この ID より後ろ」。ページの境目でデータが増減しても、重複や抜けが起きにくい。
   */
  const page = (table: string, label: string, where: string, args: string[], { query, cursor, limit = 10, ids }: PageRequest): Page => {
    const conditions = [where, 'id > ?']
    const values = [...args, cursor ?? '']
    if (query) {
      conditions.push('name LIKE ?')
      values.push(`%${query}%`)
    }
    if (ids) conditions.push(`id IN (${ids.map(() => '?').join(', ') || "''"})`)
    const size = Math.min(Math.max(limit, 1), 50)
    const rows = db
      .prepare(`SELECT id, ${label} AS name FROM ${table} WHERE ${conditions.join(' AND ')} ORDER BY id LIMIT ?`)
      .all(...values, ...(ids ?? []), size + 1) as { id: string; name: string }[]
    const items = rows.slice(0, size).map(({ id, name }) => ({ id, name }))
    return { items, nextCursor: rows.length > size ? items.at(-1)?.id : undefined }
  }

  const self = {
    /** 指定の日に、その人数で入れる店と時刻の一覧。 */
    searchAvailability(date: string, partySize: number) {
      return RESTAURANTS.map((restaurant) => ({
        ...restaurant,
        availableTimes: SLOTS.filter((time) => seatsLeft(restaurant, date, time) >= partySize),
      })).filter((restaurant) => restaurant.availableTimes.length > 0)
    },

    listRestaurants(request: PageRequest = {}): Page {
      return page('restaurants', "name || '(' || area || '/' || cuisine || ')'", '1 = 1', [], request)
    },

    /** ある店のメニュー。名前は「品名 価格」。 */
    listMenuItems(restaurantId: string, request: PageRequest = {}): Page {
      return page('menu_items', "name || ' ' || printf('%,d', price) || '円'", 'restaurant_id = ?', [restaurantId], request)
    },

    /** この内容で保存できるかを調べる。保存できるなら空の配列。 */
    problems(r: Reservation): Problem[] {
      const restaurant = RESTAURANTS.find((candidate) => candidate.id === r.restaurantId)
      if (!restaurant) return [{ path: ['restaurantId'], message: 'この店は見つかりません' }]
      const problems: Problem[] = []
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) problems.push({ path: ['date'], message: 'YYYY-MM-DD の形で入力してください' })
      if (!SLOTS.includes(r.time)) problems.push({ path: ['time'], message: 'この時刻は選べません' })
      else if (seatsLeft(restaurant, r.date, r.time) < r.partySize) problems.push({ path: ['time'], message: `${restaurant.name} のこの時刻は満席です` })
      const onMenu = new Set(self.listMenuItems(restaurant.id, { ids: r.items.map((item) => item.menuItemId), limit: 50 }).items.map((item) => item.id))
      r.items.forEach((item, index) => {
        if (!onMenu.has(item.menuItemId)) problems.push({ path: ['items', index, 'menuItemId'], message: `${restaurant.name} のメニューにありません` })
        if (!(item.quantity >= 1)) problems.push({ path: ['items', index, 'quantity'], message: '1 以上で入力してください' })
      })
      return problems
    },

    /** 予約を 1 件保存し、予約番号を返す。保存できない内容なら例外。 */
    createReservation(r: Reservation): number {
      const problems = self.problems(r)
      if (problems.length > 0) throw new Error(problems.map((problem) => `${problem.path.join('.')}: ${problem.message}`).join(' / '))
      // 予約と明細は、まとめて保存するか、どちらも保存しない。
      db.exec('BEGIN')
      try {
        const row = db
          .prepare('INSERT INTO reservations (restaurant_id, date, time, party_size, name, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
          .get(r.restaurantId, r.date, r.time, r.partySize, r.contact.name, r.contact.phone, r.notes ?? '')
        const id = Number(row?.id)
        const insertItem = db.prepare('INSERT INTO reservation_items (reservation_id, menu_item_id, quantity) VALUES (?, ?, ?)')
        for (const item of r.items) insertItem.run(id, item.menuItemId, item.quantity)
        db.exec('COMMIT')
        return id
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    listReservations() {
      const items = db.prepare(
        'SELECT menu_item_id, name, quantity FROM reservation_items JOIN menu_items ON menu_items.id = menu_item_id WHERE reservation_id = ? ORDER BY reservation_items.rowid',
      )
      return db
        .prepare('SELECT * FROM reservations ORDER BY id')
        .all()
        .map((reservation) => ({ ...reservation, items: items.all(reservation.id) }))
    },
  }
  return self
}

export type Reservations = ReturnType<typeof openReservations>
