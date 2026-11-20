import { promises as fs, statSync } from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import type { ScanProgress, ScanSummary, RootInfo } from '@shared/types'
import { walkRoot } from './walk'
import { parseFilename } from './parse'
import { fixMojibake } from './encoding'
import { buildBlob } from './text'
import { rebuildGroups, upsertSongs, type SongRow } from '../db/queries'
import { searchIndex } from '../search/index'

/**
 * 首次启动时预置的根目录，默认空——正常流程是用户在欢迎页自己挑。
 * 想在一台新机器上跳过这步，可以设环境变量 GTPSEARCH_SEED_ROOTS（分号分隔）。
 */
export const SUGGEST_ROOTS: string[] = (process.env.GTPSEARCH_SEED_ROOTS ?? '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

export function readRootPaths(db: Database.Database): string[] {
  const rows = db.prepare('SELECT path FROM roots ORDER BY id').all() as { path: string }[]
  return rows.map((r) => r.path)
}

/** 首次启动：表里没有根目录时，把本机存在的建议目录塞进去。 */
export function seedRoots(db: Database.Database): void {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM roots').get() as { n: number }).n
  if (n > 0) return
  for (const p of SUGGEST_ROOTS) {
    try {
      if (statSync(p).isDirectory()) ensureRoot(db, p)
    } catch {
      // 路径不存在就算了
    }
  }
}

export function ensureRoot(db: Database.Database, rootPath: string): number {
  const label = rootLabel(rootPath)
  const existing = db.prepare('SELECT id FROM roots WHERE path = ?').get(rootPath) as
    | { id: number }
    | undefined
  if (existing) {
    db.prepare('UPDATE roots SET label = ? WHERE id = ?').run(label, existing.id)
    return existing.id
  }
  const info = db.prepare('INSERT INTO roots (path, label) VALUES (?, ?)').run(rootPath, label)
  return Number(info.lastInsertRowid)
}

/** 加一个根目录。已经加过就原样返回。 */
export function addRoot(db: Database.Database, rootPath: string): number {
  return ensureRoot(db, rootPath)
}

/** 去掉根目录，连带清掉它的索引记录。源文件不动。 */
export function removeRoot(db: Database.Database, id: number): void {
  const run = db.transaction(() => {
    db.prepare('DELETE FROM songs WHERE root_id = ?').run(id)
    db.prepare('DELETE FROM roots WHERE id = ?').run(id)
  })
  run()
  rebuildGroups(db)
}

function rootLabel(p: string): string {
  const base = path.basename(p)
  if (/eguitar/i.test(p)) return 'eguitar 礼包'
  if (base === '谱集') return '欧美谱集'
  return base || p
}

export function listRoots(db: Database.Database): RootInfo[] {
  const rows = db
    .prepare(
      `SELECT r.id AS id, r.path AS path, r.label AS label, r.last_scan_at AS last,
              COUNT(s.id) AS n
       FROM roots r LEFT JOIN songs s ON s.root_id = r.id
       GROUP BY r.id ORDER BY r.id`
    )
    .all() as { id: number; path: string; label: string; last: number | null; n: number }[]

  return rows.map((r) => {
    let online = false
    try {
      online = statSync(r.path).isDirectory()
    } catch {
      online = false
    }
    return {
      id: r.id,
      path: r.path,
      label: r.label,
      fileCount: r.n,
      lastScanAt: r.last,
      online
    }
  })
}

type ProgressListener = (p: ScanProgress) => void

export class Scanner {
  private db: Database.Database
  private listeners = new Set<ProgressListener>()
  private progress: ScanProgress = {
    phase: 'idle',
    scanned: 0,
    total: 0,
    inserted: 0,
    elapsedMs: 0,
    message: ''
  }
  private startedAt = 0
  private running = false

  constructor(db: Database.Database) {
    this.db = db
  }

  onProgress(fn: ProgressListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  current(): ScanProgress {
    return this.progress
  }

  private emit(patch: Partial<ScanProgress>): void {
    this.progress = {
      ...this.progress,
      ...patch,
      elapsedMs: this.startedAt ? Date.now() - this.startedAt : 0
    }
    for (const fn of this.listeners) fn(this.progress)
  }

  async scan(): Promise<ScanSummary> {
    if (this.running) throw new Error('扫描正在进行')
    this.running = true
    const t0 = Date.now()
    this.startedAt = t0
    let scanned = 0
    let inserted = 0
    let errors = 0

    try {
      this.emit({ phase: 'walk', scanned: 0, total: 0, inserted: 0, message: '清点文件' })
      const paths = readRootPaths(this.db)

      for (const rootPath of paths) {
        const rootId = ensureRoot(this.db, rootPath)
        this.db.prepare('UPDATE songs SET missing = 1 WHERE root_id = ?').run(rootId)
        const walked = await walkRoot(rootPath, (n) => {
          this.emit({ scanned: n, message: `清点 ${n} 个文件` })
        })
        errors += walked.errors
        const total = walked.files.length
        this.emit({
          phase: 'parse',
          scanned: 0,
          total,
          message: `解析 ${rootPath}`
        })

        // 解析 + 分批入库。每批 500，一个事务。
        let batch: SongRow[] = []
        for (let i = 0; i < walked.files.length; i++) {
          const f = walked.files[i]
          const filename = fixMojibake(path.basename(f.absPath))
          const filenameRaw = path.basename(f.absPath)
          const parsed = parseFilename(f.relPath, filenameRaw)
          batch.push({
            rootId,
            relPath: f.relPath,
            absPath: f.absPath,
            filename,
            ext: path.extname(f.absPath).toLowerCase(),
            size: f.size,
            mtime: f.mtime,
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
            metaSource: 'filename'
          })
          scanned += 1
          if (batch.length >= 500) {
            const info = this.db.transaction(() => {
              upsertSongs(this.db, batch)
              return batch.length
            })()
            inserted += info
            batch = []
            this.emit({ scanned: i + 1, total, inserted, message: '写库' })
            await new Promise((r) => setImmediate(r))
          }
        }
        if (batch.length) {
          const info = this.db.transaction(() => {
            upsertSongs(this.db, batch)
            return batch.length
          })()
          inserted += info
          this.emit({ scanned: walked.files.length, total, inserted, message: '写库' })
        }

        this.db.prepare('UPDATE roots SET last_scan_at = ? WHERE id = ?').run(Date.now(), rootId)
      }

      this.emit({ phase: 'aggregate', message: '归并同名' })
      rebuildGroups(this.db)
      searchIndex.build(this.db)

      const groups = (
        this.db.prepare('SELECT COUNT(*) AS n FROM groups').get() as { n: number }
      ).n
      const dup = this.db
        .prepare(
          'SELECT COUNT(*) AS g, COALESCE(SUM(version_count),0) AS f FROM groups WHERE version_count > 1'
        )
        .get() as { g: number; f: number }

      const summary: ScanSummary = {
        scanned,
        inserted,
        groups,
        dupGroups: dup.g,
        dupFiles: Math.max(0, dup.f - dup.g),
        elapsedMs: Date.now() - t0,
        errors
      }
      this.emit({ phase: 'done', message: `入库 ${inserted} 条` })
      return summary
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.emit({ phase: 'error', message: msg })
      throw e
    } finally {
      this.running = false
      this.startedAt = 0
    }
  }

  isRunning(): boolean {
    return this.running
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p)
    return st.isDirectory()
  } catch {
    return false
  }
}
