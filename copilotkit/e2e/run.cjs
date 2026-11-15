// 本物の Claude 呼び出しで CopilotKit のサンプルを通しで操作し、動画・スクリーンショット・ログを docs/evidence/copilotkit/ に残す。
// 使い方(リポジトリのルートで):  pnpm --filter copilotkit-web build && node copilotkit/e2e/run.cjs [approve|cancel|bypass]
// エージェントランタイムとゲートウェイは、シナリオごとにこのスクリプトが起動して止める(予約はメモリ上なので、毎回空から始まる)。
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const root = path.join(__dirname, '..')
const evidence = path.join(root, '..', 'docs', 'evidence', 'copilotkit')
const AGENT_PORT = 8000
const GATEWAY = 'http://127.0.0.1:8080'

function prepare(name) {
  const dir = path.join(evidence, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    if (
      await fetch(url).then(
        (response) => response.ok,
        () => false,
      )
    )
      return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${url} が起動しない`)
}

/** エージェントランタイムとゲートウェイを起動する。エージェントの出力のうち、承認と保存の行だけを agent-log.txt に残す。 */
async function start(dir) {
  const agentLog = path.join(dir, 'agent-log.txt')
  fs.writeFileSync(agentLog, '')
  const agent = spawn('node', ['src/server.ts'], { cwd: path.join(root, 'agent'), env: { ...process.env, COPILOTKIT_TELEMETRY_DISABLED: 'true' } })
  let rest = ''
  agent.stdout.on('data', (chunk) => {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop()
    for (const line of lines) if (/^\[(gate|reservations)\]/.test(line)) fs.appendFileSync(agentLog, `${line}\n`)
  })
  agent.stderr.resume()
  const binary = path.join(dir, 'gateway.bin')
  execFileSync('go', ['build', '-o', binary, '.'], { cwd: path.join(root, 'gateway') })
  const gateway = spawn(binary, ['-static', path.join(root, 'web', 'dist')], { stdio: 'ignore' })
  await waitFor(`http://127.0.0.1:${AGENT_PORT}/healthz`)
  await waitFor(`${GATEWAY}/healthz`)
  return {
    agentLog: () => fs.readFileSync(agentLog, 'utf8'),
    stop() {
      agent.kill()
      gateway.kill()
      fs.rmSync(binary)
    },
  }
}

async function open(name) {
  const dir = prepare(name)
  const servers = await start(dir)
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1000, height: 900 },
    deviceScaleFactor: 2,
    locale: 'ja-JP',
    recordVideo: { dir, size: { width: 1000, height: 900 } },
  })
  const page = await context.newPage()
  const log = (line) => {
    console.log(line)
    fs.appendFileSync(path.join(dir, 'log.txt'), `${line}\n`)
  }
  page.on('pageerror', (error) => log(`[pageerror] ${error.message}`))
  // ブラウザが話す相手はゲートウェイだけであることを、リクエストの記録で残す。
  page.on('request', (request) => request.url().includes('/api/') && log(`[${request.method()} ${request.url()}]`))
  await page.goto(GATEWAY)

  let shot = 0
  return {
    page,
    log,
    servers,
    async say(text) {
      const box = page.locator('textarea').first()
      await box.waitFor()
      await box.pressSequentially(text, { delay: 15 })
      await box.press('Enter')
      log(`[say] ${text}`)
    },
    /** 画面の文字が 5 秒変わらなくなるまで待つ(応答の終わり)。 */
    async idle() {
      let last = ''
      for (let same = 0; same < 5; ) {
        await page.waitForTimeout(1000)
        const text = await page.locator('main').textContent()
        same = text === last ? same + 1 : 0
        last = text
      }
    },
    async screenshot(label) {
      shot += 1
      await page.screenshot({ path: path.join(dir, `${String(shot).padStart(2, '0')}-${label}.png`) })
    },
    async close() {
      log(`[chat]\n${await page.locator('main').ariaSnapshot()}`)
      log(`[agent]\n${servers.agentLog()}`)
      await context.close() // 動画はここで書き出される
      fs.renameSync(await page.video().path(), path.join(dir, `${name}.webm`))
      await browser.close()
      servers.stop()
    },
  }
}

function check(app, label, ok) {
  app.log(`[check] ${ok ? 'OK' : 'NG'}: ${label}`)
  if (!ok) process.exitCode = 1
}

/** 予約を依頼し、承認カードが押せる状態になるまで進める。 */
async function requestReservation(app) {
  await app.say('2026-11-20 の夜、4人で京都の和食を予約したい。名前は山田です。')
  const card = app.page.locator('form.approval')
  await card.waitFor({ timeout: 180_000 })
  await card.locator('button.primary:not([disabled])').waitFor({ timeout: 60_000 })
  await app.screenshot('approval')
  return card
}

const scenarios = {
  /** 人数を 4 から 3 に直して承認する。3 名で保存されること。 */
  async approve() {
    const app = await open('approve')
    const card = await requestReservation(app)
    await card.locator('input[type=number]').fill('3')
    app.log('[fill] 人数 <- 3')
    await app.screenshot('edited')
    await card.locator('button.primary').click()
    app.log('[click] 承認して予約')
    await app.idle()
    await app.screenshot('saved')
    const agent = app.servers.agentLog()
    check(app, 'canUseTool が許可した', /canUseTool .* -> 許可/.test(agent))
    check(app, '直した人数(3 名)で保存された', /\[reservations\] 保存 .*"partySize":3/.test(agent))
    await app.close()
  },

  /** 承認カードでキャンセルする。何も保存されないこと。 */
  async cancel() {
    const app = await open('cancel')
    const card = await requestReservation(app)
    await card.getByRole('button', { name: 'キャンセル' }).click()
    app.log('[click] キャンセル')
    await app.idle()
    await app.screenshot('cancelled')
    const agent = app.servers.agentLog()
    check(app, '回答が「承認なし」として記録された', /confirm_reservation の回答: 承認なし/.test(agent))
    check(app, '何も保存されていない', !agent.includes('[reservations] 保存'))
    await app.close()
  },

  /** 承認を飛ばすよう指示した Claude に、保存のツールを直接呼ばせる。canUseTool が断ること(ブラウザは使わない)。 */
  async bypass() {
    const dir = prepare('bypass')
    const output = execFileSync('node', [path.join(__dirname, 'bypass.ts')], {
      cwd: path.join(root, 'agent'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const lines = output.split('\n').filter((line) => !/^\[(ag-ui|ClaudeAdapter)\]/.test(line))
    const ok = lines.some((line) => /canUseTool .* -> 拒否/.test(line)) && !lines.some((line) => line.includes('[reservations] 保存'))
    lines.push(`[check] ${ok ? 'OK' : 'NG'}: canUseTool が断り、何も保存されていない`)
    if (!ok) process.exitCode = 1
    fs.writeFileSync(path.join(dir, 'output.txt'), `${lines.join('\n')}\n`)
    console.log(lines.join('\n'))
  },
}

;(async () => {
  const names = process.argv[2] ? [process.argv[2]] : Object.keys(scenarios)
  for (const name of names) await scenarios[name]()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
