// 本物の Claude 呼び出しでアプリを通しで操作し、動画・スクリーンショット・ダウンロードしたファイルを残す。
// 使い方: サーバーとクライアントを起動してから  node e2e/run.cjs [reservation|cancel|documents]
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const url = process.env.APP_URL ?? 'http://localhost:5173'
const evidence = path.join(__dirname, '..', 'docs', 'evidence')

async function open(name) {
  const dir = path.join(evidence, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  // ロケールが未設定だと、日本語のファイル名のダウンロードが "download" という名前になる。
  const browser = await chromium.launch({
    env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    recordVideo: { dir, size: { width: 1280, height: 900 } },
  })
  const page = await context.newPage()
  const log = (line) => {
    console.log(line)
    fs.appendFileSync(path.join(dir, 'log.txt'), `${line}\n`)
  }
  page.on('pageerror', (error) => log(`[pageerror] ${error.message}`))
  page.on('console', (message) => message.type() === 'error' && log(`[console.error] ${message.text()}`))
  page.on(
    'request',
    (request) =>
      /\/api\/(chat|approval|options)$/.test(request.url()) &&
      log(
        `[POST ${new URL(request.url()).pathname}] ${request.postDataJSON().message ?? JSON.stringify(request.postDataJSON().action ?? request.postDataJSON())}`,
      ),
  )
  await page.goto(url)

  let shot = 0
  return {
    page,
    dir,
    log,
    /** チャット欄から送信し、応答が終わるまで待つ。 */
    async say(text) {
      await page.getByLabel('メッセージ').pressSequentially(text, { delay: 15 })
      await page.getByRole('button', { name: '送信', exact: true }).click()
      await this.idle()
    },
    async idle() {
      await page.waitForSelector('.busy', { timeout: 10_000 }).catch(() => {})
      await page.waitForSelector('.busy', { state: 'detached', timeout: 300_000 })
      await page.waitForTimeout(1000)
    },
    async screenshot(label) {
      shot += 1
      await page.screenshot({ path: path.join(dir, `${String(shot).padStart(2, '0')}-${label}.png`), fullPage: true })
    },
    /** ボタンを押して始まったダウンロードを保存する。 */
    async download(button) {
      const [file] = await Promise.all([page.waitForEvent('download'), button.click()])
      const saved = path.join(dir, file.suggestedFilename())
      await file.saveAs(saved)
      log(`[download] ${file.suggestedFilename()} (${fs.statSync(saved).size} bytes)`)
      await page.waitForTimeout(500)
    },
    async close() {
      log(`[chat]\n${(await page.locator('.chat li').allTextContents()).join('\n')}`)
      log(`[surfaces]\n${await page.locator('.surfaces').ariaSnapshot()}`)
      await context.close() // 動画はここで書き出される
      fs.renameSync(await page.video().path(), path.join(dir, `${name}.webm`))
      await browser.close()
    },
  }
}

/** 予約を依頼し、Claude が出したフォームを埋めて送信し、承認フォームが出るまで進める。 */
async function submitReservationForm(app) {
  const { page, log } = app
  await app.say('来週金曜の夜、4人で京都の和食を予約したい。予約フォームを出して')
  await app.screenshot('form')

  // フォームの中身は毎回 Claude が決めるので、空のテキスト欄を placeholder から推測して埋める。
  const fields = page.locator('.surface input:not([type=date], [type=time], [type=range], [type=checkbox], [type=radio]), .surface textarea')
  for (let i = 0; i < (await fields.count()); i++) {
    const field = fields.nth(i)
    if (await field.inputValue()) continue
    const hint = `${(await field.getAttribute('placeholder')) ?? ''} ${(await field.getAttribute('type')) ?? ''}`
    const value = /090|電話|tel/i.test(hint) ? '090-1234-5678' : /山田|太郎|名前/.test(hint) ? '山田 太郎' : '窓際の席を希望'
    await field.pressSequentially(value, { delay: 30 })
    log(`[fill] "${hint.trim()}" <- ${value}`)
  }
  await app.screenshot('filled')

  const submit = page
    .locator('.surface')
    .getByRole('button')
    .filter({ hasNotText: /キャンセル|クリア|リセット|やめる/ })
    .last()
  log(`[click] ${(await submit.textContent()).trim()}`)
  await submit.click()

  // Claude が create_reservation を呼ぶと、実行の前に承認フォームが出る。
  const approval = page.locator('.surface[data-surface-id^="approval_"]')
  await approval.waitFor({ timeout: 300_000 })
  await page.waitForTimeout(1000)
  await app.screenshot('approval')
  return approval
}

/** 指定の値が入っている入力欄を探す。 */
async function findInput(scope, value) {
  const inputs = scope.locator('input')
  for (let i = 0; i < (await inputs.count()); i++) if ((await inputs.nth(i).inputValue()) === value) return inputs.nth(i)
  throw new Error(`"${value}" が入った入力欄が無い`)
}

/** 最後に保存された予約と、その明細を SQLite から直接読む。 */
function lastReservation() {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path.join(__dirname, '..', 'server', 'data', 'reservations.db'), { readOnly: true })
  const reservation = db.prepare('SELECT * FROM reservations ORDER BY id DESC LIMIT 1').get()
  const items = db
    .prepare(
      'SELECT menu_item_id, name, quantity FROM reservation_items JOIN menu_items ON menu_items.id = menu_item_id WHERE reservation_id = ? ORDER BY reservation_items.rowid',
    )
    .all(reservation?.id ?? 0)
  db.close()
  return { reservation, items }
}

const scenarios = {
  // 予約: MCP の空き状況でフォームが作られ、送信すると承認フォームが出る。そこで値を直して承認すると SQLite に保存される。
  async reservation() {
    const app = await open('reservation')
    const { page, log } = app
    const approval = await submitReservationForm(app)
    const approve = approval.getByRole('button', { name: '承認して実行' })

    // 入力チェック 1(フォーム上): お名前を空にすると、承認ボタンが押せなくなる。
    const name = await findInput(approval, '山田 太郎')
    await name.fill('')
    await page.waitForTimeout(500)
    await approve.scrollIntoViewIfNeeded()
    log(`[check] お名前が空のとき、承認ボタンは押せない: ${await approve.isDisabled()}`)
    await app.screenshot('approval-name-empty')
    await name.pressSequentially('山田 花子', { delay: 30 })
    log(`[edit] お名前: 山田 太郎 -> 山田 花子(承認ボタンは押せる: ${await approve.isEnabled()})`)

    // 入力チェック 2(サーバー側): 明細の数量を 0 にして承認すると、理由が返り、フォームは開いたまま。
    await approval.getByLabel('数量 1').fill('0')
    await approve.click()
    await page.locator('.chat li.error').waitFor()
    log(`[check] 数量 0 で承認したときの表示: ${(await page.locator('.chat li.error').last().textContent()).replaceAll('\n', ' / ')}`)
    await app.screenshot('approval-rejected')

    // 明細を直す: 1 行目の数量を 3 に戻し、行を追加して、メニューを選択欄から選ぶ。
    // メニューは店ごとに 24 品あり、選択欄は Claude 経由で MCP のツールを 10 件ずつ呼ぶ(1 ページ数秒)。
    await approval.getByLabel('数量 1').fill('3')
    await approval.getByRole('button', { name: '行を追加' }).click()
    await approval.getByRole('button', { name: 'メニュー 2', exact: true }).click()
    const list = approval.getByRole('list', { name: 'メニュー 2の選択肢' })
    const options = list.locator('li button')
    const waitForOptions = async (count) => {
      for (let i = 0; i < 300 && (await options.count()) !== count; i++) await page.waitForTimeout(200)
      if ((await options.count()) !== count) throw new Error(`選択肢が ${count} 件にならない(${await options.count()} 件)`)
    }
    await waitForOptions(10)
    await list.evaluate((element) => element.scrollIntoView({ block: 'end' })) // 選択肢の一覧が画面に入るようにする
    log('[lookup] 開いた直後: 10 件')
    await app.screenshot('lookup-open')
    for (const count of [20, 24]) {
      await list.evaluate((element) => element.scrollTo({ top: element.scrollHeight })) // 下端までスクロールすると続きを取りに行く
      await waitForOptions(count)
      log(`[lookup] 下までスクロール: ${count} 件`)
    }
    await app.screenshot('lookup-scrolled')
    await approval.getByLabel('メニュー 2を検索').pressSequentially('鴨', { delay: 50 })
    await waitForOptions(4)
    log(`[lookup] 「鴨」で検索: ${(await options.allTextContents()).join(' / ')}`)
    await app.screenshot('lookup-search')
    await options.filter({ hasText: '鴨の土鍋ごはん' }).click()
    await approval.getByLabel('数量 2').fill('1')
    log('[edit] 事前注文: 1 行目の数量を 3 に、2 行目に「鴨の土鍋ごはん」を 1 つ')
    await app.screenshot('approval-edited')
    await approve.click()
    log('[click] 承認して実行')
    await app.idle()
    await app.screenshot('saved')

    // 保存された行を SQLite から直接読む。
    const { reservation, items } = lastReservation()
    log(`[sqlite] reservations: ${JSON.stringify(reservation)}`)
    log(`[sqlite] reservation_items: ${JSON.stringify(items)}`)
    if (reservation?.name !== '山田 花子' || items.length !== 2 || items[1].name !== '鴨の土鍋ごはん')
      throw new Error('承認フォームで直した内容が保存されていない')
    await app.close()
  },

  // 承認フォームでキャンセルすると、ツールは実行されず、何も保存されない。
  async cancel() {
    const app = await open('cancel')
    const before = lastReservation().reservation?.id ?? 0
    const approval = await submitReservationForm(app)
    await approval.getByRole('button', { name: 'キャンセル' }).click()
    app.log('[click] キャンセル')
    await app.idle()
    await app.screenshot('cancelled')
    const after = lastReservation().reservation?.id ?? 0
    app.log(`[sqlite] 最後の予約番号: キャンセル前 ${before} / キャンセル後 ${after}`)
    if (after !== before) throw new Error('キャンセルしたのに保存されている')
    await app.close()
  },

  // 表(CSV・Excel)、スライド(PowerPoint)、HTML レポート、PDF、画像を出してもらい、それぞれダウンロードする。
  async documents() {
    const app = await open('documents')
    const { page } = app
    const surfaces = page.locator('.surfaces')
    // 新しく出た資料が見えるように、描画領域をその位置までスクロールする。
    const showLast = () =>
      surfaces
        .locator('.doc')
        .last()
        .evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'smooth' }))
        .then(() => page.waitForTimeout(800))

    await app.say('架空の雑貨店の2026年4〜9月の月別売上(売上・客数・客単価)を表にして')
    await app.screenshot('table')
    await app.download(surfaces.getByRole('button', { name: 'CSV', exact: true }).last())
    await app.download(surfaces.getByRole('button', { name: 'Excel', exact: true }).last())

    await app.say('この内容を社内報告用のスライド3枚にまとめて')
    await showLast()
    await app.screenshot('slides')
    await app.download(surfaces.getByRole('button', { name: 'PowerPoint', exact: true }).last())

    await app.say('同じ内容をHTMLのレポートにして。売上の棒グラフも入れて')
    await showLast()
    await app.screenshot('html-report')
    await app.download(surfaces.getByRole('button', { name: 'HTML', exact: true }).last())

    await app.say('同じ内容を1〜2ページの報告書にしてPDFで見せて')
    await showLast()
    await surfaces.locator('.pdf-pages canvas').first().waitFor() // PDF の作成と描画が終わるまで待つ
    await app.screenshot('pdf')
    await app.download(surfaces.getByRole('button', { name: 'PDF', exact: true }).last())

    await app.say('売上の推移が一目でわかる折れ線グラフを画像で描いて')
    await showLast()
    await app.screenshot('image')
    await app.download(surfaces.getByRole('button', { name: 'SVG', exact: true }).last())
    await app.download(surfaces.getByRole('button', { name: 'PNG', exact: true }).last())
    await app.close()
  },
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios)
;(async () => {
  for (const name of names) await scenarios[name]()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
