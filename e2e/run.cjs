// 本物の Claude 呼び出しでアプリを通しで操作し、動画・スクリーンショット・ダウンロードしたファイルを残す。
// 使い方: サーバーとクライアントを起動してから  node e2e/run.cjs [reservation|documents]
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
      /\/api\/(chat|approval)$/.test(request.url()) &&
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

const scenarios = {
  // 予約: MCP の空き状況でフォームが作られ、送信すると承認フォームが出る。そこで値を直して承認すると SQLite に保存される。
  async reservation() {
    const app = await open('reservation')
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

    // 承認フォームで、ネストした項目(連絡先のお名前)と明細(コースの事前注文)を直してから承認する。
    const inputs = approval.locator('input')
    for (let i = 0; i < (await inputs.count()); i++) {
      if ((await inputs.nth(i).inputValue()) !== '山田 太郎') continue
      await inputs.nth(i).fill('')
      await inputs.nth(i).pressSequentially('山田 花子', { delay: 30 })
      log('[edit] お名前: 山田 太郎 -> 山田 花子')
    }
    // 明細: 1 行目の数量を 3 に減らし、行を追加して、同じ店のもう 1 つのコースを 1 つ入れる。
    const otherCourse = { '月コース 12,000円': '花コース 18,000円', 'おまかせ 15,000円': '鴨鍋コース 9,800円', 'おばんざい膳 4,500円': '季節の会席 7,000円' }
    const firstCourse = await approval.getByLabel('コース 1').inputValue()
    await approval.getByLabel('数量 1').fill('3')
    await approval.getByRole('button', { name: '行を追加' }).click()
    await approval.getByLabel('コース 2').pressSequentially(otherCourse[firstCourse] ?? firstCourse, { delay: 20 })
    await approval.getByLabel('数量 2').fill('1')
    log(`[edit] コースの事前注文: ${firstCourse} x3, ${otherCourse[firstCourse] ?? firstCourse} x1`)
    await app.screenshot('approval-edited')
    await approval.getByRole('button', { name: '承認して実行' }).click()
    log('[click] 承認して実行')
    await app.idle()
    await app.screenshot('saved')

    // 保存された行を SQLite から直接読む。
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(path.join(__dirname, '..', 'server', 'data', 'reservations.db'), { readOnly: true })
    const row = db.prepare('SELECT * FROM reservations ORDER BY id DESC LIMIT 1').get()
    const courses = db.prepare('SELECT course, quantity FROM reservation_courses WHERE reservation_id = ?').all(row?.id ?? 0)
    log(`[sqlite] reservations: ${JSON.stringify(row)}`)
    log(`[sqlite] reservation_courses: ${JSON.stringify(courses)}`)
    if (row?.name !== '山田 花子' || courses.length !== 2) throw new Error('承認フォームで直した内容が保存されていない')
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
