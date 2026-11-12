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
  page.on('request', (request) => request.url().endsWith('/api/chat') && log(`[POST /api/chat] ${request.postDataJSON().message}`))
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
  // フォームを出してもらい、入力して送信し、次の応答を受け取る。
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
      const value = /090|電話|tel/i.test(hint)
        ? '090-1234-5678'
        : /@|mail/i.test(hint)
          ? 'taro@example.com'
          : /山田|太郎/.test(hint)
            ? '山田 太郎'
            : '窓際の席を希望'
      await field.pressSequentially(value, { delay: 30 })
      log(`[fill] "${hint.trim()}" <- ${value}`)
    }
    for (const chip of ['祇園・東山', '個室']) {
      const button = page.locator('.surface').getByRole('button', { name: chip, exact: true })
      if (await button.count()) {
        await button.first().click()
        log(`[click] ${chip}`)
      }
    }
    await app.screenshot('filled')

    const submit = page
      .locator('.surface')
      .getByRole('button')
      .filter({ hasNotText: /キャンセル|クリア|リセット|やめる/ })
      .last()
    log(`[click] ${await submit.textContent()}`)
    await submit.click()
    await app.idle()
    await app.screenshot('after-action')
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
