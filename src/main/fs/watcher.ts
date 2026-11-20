import chokidar, { type FSWatcher } from 'chokidar'
import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import { GP_EXT, parseFilename } from '../scan/parse'
import { fixMojibake } from '../scan/encoding'
import { buildBlob } from '../scan/text'
import { rebuildGroups, upsertSongs, type SongRow } from '../db/queries'
import { ensureRoot } from '../scan/scanner'
import { searchIndex } from '../search/index'

export interface WatcherHandle {
  close: () => Promise<void>
}

/**
 * 监听两个源库。新谱子落地后 3 秒内出现在列表里。
 * 关掉增量写库的抖，避免解压一个包就重建十几次聚合表。
 */
export function startWatcher(
  db: Database.Database,
  roots: string[],
  onChange: (file: string) => void
): WatcherHandle {
  let timer: NodeJS.Timeout | null = null
  const pending = new Map<string, string>() // absPath -> rootPath

  const flush = (): void => {
    if (pending.size === 0) return
    const entries = [...pending.entries()]
    pending.clear()
    const rows: SongRow[] = []
    for (const [absPath, rootPath] of entries) {
      try {
        const st = fs.statSync(absPath)
        if (!st.isFile()) continue
        const relPath = path.relative(rootPath, absPath)
        const rootId = ensureRoot(db, rootPath)
        const parsed = parseFilename(relPath, path.basename(absPath))
        rows.push({
          rootId,
          relPath,
          absPath,
          filename: fixMojibake(path.basename(absPath)),
          ext: path.extname(absPath).toLowerCase(),
          size: st.size,
          mtime: Math.floor(st.mtimeMs),
          title: parsed.title,
          artist: parsed.artist,
          album: parsed.album,
          titleNorm: parsed.titleNorm,
          artistNorm: parsed.artistNorm,
          pinyinInit: parsed.pinyinInit,
          searchBlob: buildBlob(parsed.title, parsed.artist),
          category: parsed.category,
          styleTags: parsed.styleTags,
          versionTags: parsed.versionTags,
          difficulty: parsed.difficulty,
          metaSource: 'watcher'
        })
      } catch {
        // 文件可能刚被移走，忽略
      }
    }
    if (rows.length) {
      const tx = db.transaction(() => {
        upsertSongs(db, rows)
        rebuildGroups(db)
      })
      tx()
      searchIndex.build(db)
      onChange(rows[0].absPath)
    }
  }

  const schedule = (absPath: string, rootPath: string): void => {
    pending.set(absPath, rootPath)
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 1200)
  }

  const watcher: FSWatcher = chokidar.watch(roots, {
    ignoreInitial: true,
    depth: 12,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 120 }
  })

  watcher.on('add', (p) => {
    const ext = path.extname(p).toLowerCase()
    if (!GP_EXT.has(ext)) return
    const root = roots.find((r) => p.toLowerCase().startsWith(r.toLowerCase()))
    if (root) schedule(p, root)
  })

  watcher.on('unlink', (p) => {
    const ext = path.extname(p).toLowerCase()
    if (!GP_EXT.has(ext)) return
    db.prepare('UPDATE songs SET missing = 1 WHERE abs_path = ?').run(p)
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 1200)
    onChange(p)
  })

  return {
    close: async () => {
      if (timer) clearTimeout(timer)
      await watcher.close()
    }
  }
}
