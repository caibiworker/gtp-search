import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { SearchQuery, Settings, OrganizePlanItem } from '@shared/types'
import { getDb } from '../db'
import {
  stats,
  versionsOf,
  toggleFav,
  markOpened,
  renameSong,
  songById,
  getSetting,
  setSetting,
  rebuildGroups
} from '../db/queries'
import { normForKey, pinyinInitials } from '../scan/parse'
import { buildBlob } from '../scan/text'
import { searchAll, searchIndex } from '../search/index'
import type { Scanner } from '../scan/scanner'
import { detectGuitarPro, openSong, revealSong } from '../fs/open'
import { buildPlan, runPlan } from '../fs/organize'
import { readRootPaths, ensureRoot, listRoots, addRoot, removeRoot } from '../scan/scanner'

export function registerIpc(scanner: Scanner): void {
  ipcMain.handle('scan:start', async () => {
    if (scanner.isRunning()) return null
    return scanner.scan()
  })

  ipcMain.handle('scan:progress', () => scanner.current())

  ipcMain.handle('search:query', (_e, q: SearchQuery) => searchAll(getDb(), q))

  ipcMain.handle('stats:get', () => stats(getDb()))

  ipcMain.handle('roots:list', () => listRoots(getDb()))

  /** 加一个谱库目录，加完立刻清点它。 */
  ipcMain.handle('roots:add', async (_e, dir: string) => {
    const db = getDb()
    addRoot(db, dir)
    if (!scanner.isRunning()) await scanner.scan()
    return listRoots(db)
  })

  /** 移掉一个目录，连带清掉它的索引。源文件不动。 */
  ipcMain.handle('roots:remove', (_e, id: number) => {
    const db = getDb()
    removeRoot(db, id)
    return listRoots(db)
  })

  ipcMain.handle(
    'song:versions',
    (_e, artistNorm: string, titleNorm: string) =>
      versionsOf(getDb(), artistNorm, titleNorm)
  )

  ipcMain.handle('song:open', async (_e, songId: number) => {
    const db = getDb()
    const song = songById(db, songId)
    if (!song) return { ok: false, message: '这条记录不在了' }
    const gp = getSetting(db, 'gpPath') || detectGuitarPro()
    const res = await openSong(song.absPath, gp)
    if (res.ok) {
      markOpened(db, song.id, song.artistNorm, song.titleNorm)
      searchIndex.reloadFlags(db)
    }
    return res
  })

  ipcMain.handle('song:reveal', (_e, songId: number) => {
    const song = songById(getDb(), songId)
    if (song) revealSong(song.absPath)
  })

  ipcMain.handle('song:fav', (_e, artistNorm: string, titleNorm: string) => {
    const db = getDb()
    const next = toggleFav(db, artistNorm, titleNorm)
    searchIndex.reloadFlags(db)
    return next
  })

  ipcMain.handle(
    'song:rename',
    (_e, songId: number, title: string, artist: string) => {
      const db = getDb()
      renameSong(
        db,
        songId,
        title,
        artist,
        normForKey(title),
        normForKey(artist),
        pinyinInitials(title + ' ' + artist),
        buildBlob(title, artist)
      )
      rebuildGroups(db)
      searchIndex.build(db)
    }
  )

  ipcMain.handle('organize:plan', (_e, target: string, mode: 'all' | 'category') =>
    buildPlan(getDb(), target, mode)
  )

  ipcMain.handle('organize:run', async (_e, target: string, items: OrganizePlanItem[]) => {
    const res = await runPlan(getDb(), target, items)
    setSetting(getDb(), 'lastOrganizeTarget', target)
    return res
  })

  ipcMain.handle('settings:get', (): Settings => {
    const db = getDb()
    return {
      gpPath: getSetting(db, 'gpPath') || detectGuitarPro(),
      rootPaths: readRootPaths(db),
      lastOrganizeTarget: getSetting(db, 'lastOrganizeTarget') || '',
      watchRoots: getSetting(db, 'watchRoots') === '1'
    }
  })

  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>): Settings => {
    const db = getDb()
    if (typeof patch.gpPath === 'string') setSetting(db, 'gpPath', patch.gpPath)
    if (typeof patch.lastOrganizeTarget === 'string') {
      setSetting(db, 'lastOrganizeTarget', patch.lastOrganizeTarget)
    }
    if (typeof patch.watchRoots === 'boolean') {
      setSetting(db, 'watchRoots', patch.watchRoots ? '1' : '0')
    }
    return {
      gpPath: getSetting(db, 'gpPath') || detectGuitarPro(),
      rootPaths: readRootPaths(db),
      lastOrganizeTarget: getSetting(db, 'lastOrganizeTarget') || '',
      watchRoots: getSetting(db, 'watchRoots') === '1'
    }
  })

  ipcMain.handle('dialog:folder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('scan:rebuild', async () => {
    if (scanner.isRunning()) return null
    return scanner.scan()
  })
}
