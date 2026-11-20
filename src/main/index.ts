import { app, BrowserWindow, Menu, nativeTheme, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { getDb, closeDb } from './db'
import { Scanner, readRootPaths, seedRoots } from './scan/scanner'
import { registerIpc } from './ipc'
import { startWatcher, type WatcherHandle } from './fs/watcher'
import { getSetting } from './db/queries'
import { searchAll, searchIndex } from './search/index'
import { openSong, detectGuitarPro } from './fs/open'

let mainWindow: BrowserWindow | null = null
let watcher: WatcherHandle | null = null

/**
 * 命令行模式下 stdout 会被管道或文件接走，接收端先退出就会 EPIPE。
 * 不兜住的话 Electron 会弹一个「A JavaScript error occurred in the main process」
 * 的模态框，而那东西在无窗口模式里点不掉。
 */
process.stdout.on('error', () => undefined)
process.stderr.on('error', () => undefined)

/** 数据目录固定在 %APPDATA%\gtpsearch，开发版和安装版共用同一份索引。 */
app.setPath('userData', path.join(app.getPath('appData'), 'gtpsearch'))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 1000,
    minHeight: 620,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#ffffff',
    title: '谱库',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrap(): Promise<void> {
  const db = getDb()
  const scanner = new Scanner(db)
  registerIpc(scanner)

  scanner.onProgress((p) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan:progress', p)
    }
  })

  createWindow()

  seedRoots(db)
  const roots = readRootPaths(db)

  // 文件监听默认关：五万多个文件上开着 chokidar 会明显拖慢界面。
  // 想实时看新谱子的话，在设置里打开，重启生效。
  if (getSetting(db, 'watchRoots') === '1' && roots.length > 0) {
    watcher = startWatcher(db, roots, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scan:progress', {
          ...scanner.current(),
          phase: 'done',
          message: '有新的谱子进来了'
        })
      }
    })
  }

  // 库是空的、又已经有目录，就先扫一遍；没目录的话界面会引导用户去加。
  const count = (db.prepare('SELECT COUNT(*) AS n FROM songs').get() as { n: number }).n
  if (count === 0 && roots.length > 0) {
    setTimeout(() => {
      scanner.scan().catch((e) => {
        console.error('首扫失败', e)
      })
    }, 1200)
  } else if (count > 0) {
    // 窗口已经画出来了，这时候摊索引不会挡住首屏。
    setTimeout(() => {
      const info = searchIndex.build(db)
      console.log(
        `[search] ${info.count} 条 ${info.ms}ms 约 ${(info.bytes / 1048576).toFixed(1)} MB`
      )
    }, 60)
  }
}

/** 命令行模式：只清点，不开窗口，结果打到 stdout。用于验证和出报表。 */
const scanOnly = process.argv.includes('--scan-only')

/** 命令行模式：只截图，不开交互窗口。给自己核验界面用。 */
const shotMode = process.argv.includes('--shot')

/** 命令行模式：跑搜索验收用例，把结果打到 stdout。 */
const searchTest = process.argv.includes('--search-test')

/** 命令行模式：真的把一首谱子交给系统打开，用来验证双击行为。 */
const openTest = process.argv.includes('--open-test')

if (scanOnly || searchTest || openTest || shotMode) {
  // 无窗口模式里出错只能写日志，弹框会挂在那儿没人点得到
  const bail = (e: unknown): void => {
    try {
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e)
      fs.appendFileSync(path.join(process.cwd(), 'crash.log'), `\n${new Date().toISOString()} ${msg}\n`)
    } catch {
      // 连日志都写不了就随它去
    }
    process.exit(1)
  }
  process.on('uncaughtException', bail)
  process.on('unhandledRejection', bail)
}

if (scanOnly) {
  app.whenReady().then(async () => {
    const db = getDb()
    seedRoots(db)
    const scanner = new Scanner(db)
    scanner.onProgress((p) => {
      if (p.phase !== 'walk' && p.phase !== 'parse') return
      if (!process.stdout.writable) return
      try {
        process.stdout.write(`\r[${p.phase}] ${p.scanned}/${p.total} ${p.message}`.padEnd(90))
      } catch {
        // 控制台没了就算了，别把扫描带崩
      }
    })
    try {
      const summary = await scanner.scan()
      const one = <T>(sql: string): T => db.prepare(sql).get() as T
      const counts = one<{ songs: number; groups: number; cats: number }>(
        `SELECT (SELECT COUNT(*) FROM songs) AS songs,
                (SELECT COUNT(*) FROM groups) AS groups,
                (SELECT COUNT(DISTINCT category) FROM songs WHERE category <> '') AS cats`
      )
      const dup = one<{ g: number; f: number }>(
        `SELECT COUNT(*) AS g, COALESCE(SUM(n), 0) AS f FROM (
           SELECT COUNT(*) AS n FROM songs GROUP BY artist_norm, title_norm HAVING COUNT(*) > 1
         )`
      )
      const out = { ...summary, ...counts, dupGroups: dup.g, dupFiles: dup.f }
      fs.writeFileSync(
        path.join(process.cwd(), 'scan-result.json'),
        JSON.stringify(out, null, 2),
        'utf8'
      )
      console.log('\nSCAN_ONLY_RESULT ' + JSON.stringify(out))
    } catch (e) {
      console.error('\n扫描失败', e)
      process.exitCode = 1
    } finally {
      closeDb()
      app.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
    }
  })
} else if (searchTest) {
  app.whenReady().then(() => {
    const lines: string[] = []
    const say = (s: string): void => {
      lines.push(s)
      console.log(s)
    }
    const db = getDb()
    const info = searchIndex.build(db)
    say(`INDEX count=${info.count} ms=${info.ms} mb=${(info.bytes / 1048576).toFixed(1)}`)
    const cases: { q: string; want?: string; first?: string; note: string }[] = [
      { q: 'aimée', want: 'Aimee', note: '带变音符号' },
      { q: 'aimee', want: 'Aimee', note: '去变音符号' },
      { q: 'AIMEE', want: 'Aimee', note: '大写' },
      { q: 'zjl', want: '周杰伦', note: '首字母' },
      { q: 'zhoulun', want: '周杰伦', note: '全拼' },
      { q: 'ghsy', want: '光辉岁月', note: '首字母' },
      { q: 'beyond 海阔', want: '海阔天空', note: '两段命中不同字段' },
      { q: 'beatles', want: 'Beatles', note: 'Beatles (The)' },
      { q: 'guns n roses', want: 'Guns', note: '撇号' },
      { q: 'ＢＥＹＯＮＤ', want: 'eyond', note: '全角输入' },
      { q: 'hktk', want: '海阔天空', note: '首字母' },
      { q: '五月天 温柔', first: '温柔', note: '两段都要命中，且排第一' }
    ]
    for (const c of cases) {
      const r = searchAll(db, {
        text: c.q,
        mode: 'all',
        category: null,
        sort: 'recent',
        limit: 500,
        offset: 0
      })
      const hit = c.want
        ? r.rows.some((g) => (g.title + ' ' + g.artist).toLowerCase().includes(c.want!.toLowerCase()))
        : (r.rows[0]?.title ?? '').includes(c.first ?? '')
      say(`\n== ${c.q}  [${c.note}]  total=${r.total}  ${r.elapsedMs}ms  ${hit ? 'PASS' : 'FAIL'}`)
      r.rows.slice(0, 3).forEach((g, i) => {
        say(`   ${i + 1}. ${g.artist || '—'} / ${g.title}`)
      })
    }
    const t: number[] = []
    for (let i = 0; i < 20; i++) {
      t.push(
        searchAll(db, {
          text: 'be',
          mode: 'all',
          category: null,
          sort: 'recent',
          limit: 500,
          offset: 0
        }).elapsedMs
      )
    }
    t.sort((a, b) => a - b)
    say(`\nQUERY median=${t[10]}ms min=${t[0]}ms max=${t[19]}ms (n=20)`)
    fs.writeFileSync(path.join(process.cwd(), 'search-test.txt'), lines.join('\n'), 'utf8')
    closeDb()
    app.exit(0)
  })
} else if (openTest) {
  app.whenReady().then(async () => {
    const db = getDb()
    const row = db
      .prepare(`SELECT abs_path, title FROM songs WHERE ext = '.gp5' ORDER BY id LIMIT 1`)
      .get() as { abs_path: string; title: string } | undefined
    if (!row) {
      console.log('OPEN_RESULT {"ok":false,"message":"库里没有 .gp5"}')
      closeDb()
      app.exit(1)
      return
    }
    const gp = getSetting(db, 'gpPath') || detectGuitarPro()
    const r = await openSong(row.abs_path, gp)
    const out = { ...r, file: row.abs_path, gp }
    fs.writeFileSync(
      path.join(process.cwd(), 'open-result.json'),
      JSON.stringify(out, null, 2),
      'utf8'
    )
    console.log('OPEN_RESULT ' + JSON.stringify(out))
    // 留在后台一会儿，让 Guitar Pro 有时间把文件读完
    setTimeout(() => {
      closeDb()
      app.exit(0)
    }, 6000)
  })
} else if (shotMode) {
  app.whenReady().then(async () => {
    const db = getDb()
    registerIpc(new Scanner(db))
    const dir = path.join(app.getPath('userData'), 'shots')
    fs.mkdirSync(dir, { recursive: true })
    const win = new BrowserWindow({
      width: 1240,
      height: 800,
      show: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true
      }
    })
    await win.loadFile(path.join(__dirname, '../renderer/index.html'))
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    const shoot = async (name: string): Promise<void> => {
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(dir, name), img.toPNG())
      console.log('shot ' + name)
    }
    await wait(1600)
    await shoot('01-library.png')
    await win.webContents.executeJavaScript(
      `(() => { const r = document.querySelectorAll('.row'); if (r[3]) r[3].click(); return r.length })()`
    )
    await wait(700)
    await shoot('02-detail.png')
    await win.webContents.executeJavaScript(
      `(() => { const b = document.querySelectorAll('.nav button'); if (b[1]) b[1].click(); return b.length })()`
    )
    await wait(500)
    await shoot('03-organize.png')
    await win.webContents.executeJavaScript(
      `(() => { const b = document.querySelectorAll('.nav button'); if (b[2]) b[2].click(); return b.length })()`
    )
    await wait(500)
    await shoot('04-settings.png')
    await win.webContents.executeJavaScript(
      `(() => { const b = document.querySelectorAll('.nav button'); if (b[0]) b[0].click(); return b.length })()`
    )
    await wait(500)
    await win.webContents.executeJavaScript(
      `(() => {
         const i = document.querySelector('.search-input');
         if (!i) return false;
         i.focus();
         const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
         set.call(i, 'zjl 秘密');
         i.dispatchEvent(new Event('input', { bubbles: true }));
         return true
       })()`
    )
    await wait(900)
    await shoot('05-search.png')
    closeDb()
    app.exit(0)
  })
} else {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      }
    })

    app.whenReady().then(() => {
      Menu.setApplicationMenu(null)
      void bootstrap()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', async () => {
    if (watcher) await watcher.close()
    closeDb()
  })
}
