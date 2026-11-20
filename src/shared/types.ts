/**
 * 唯一的类型源。主进程和渲染进程都从这里取。
 * 不在这里放任何实现，只放形状。
 */

export type ScanPhase = 'idle' | 'walk' | 'parse' | 'write' | 'aggregate' | 'done' | 'error'

export interface RootInfo {
  id: number
  path: string
  label: string
  fileCount: number
  lastScanAt: number | null
  online: boolean
}

export interface SongFile {
  id: number
  rootId: number
  relPath: string
  absPath: string
  filename: string
  ext: string
  size: number
  mtime: number
  title: string
  artist: string
  album: string
  titleNorm: string
  artistNorm: string
  pinyinInit: string
  category: string
  styleTags: string[]
  versionTags: string[]
  difficulty: string
  metaSource: string
  metaConfirmed: boolean
  hash: string | null
  fav: boolean
  playCount: number
  lastOpenedAt: number | null
  createdAt: number
  missing: boolean
}

/** 列表里的一行：一首歌，不是一份文件。 */
export interface SongGroup {
  key: string
  stockNo: number
  artist: string
  title: string
  artistNorm: string
  titleNorm: string
  pinyinInit: string
  category: string
  versionCount: number
  totalSize: number
  maxMtime: number
  reprId: number
  reprExt: string
  fav: boolean
  playCount: number
  lastOpenedAt: number | null
  missingCount: number
}

export type ListMode = 'all' | 'fav' | 'recent' | 'missing' | 'category'
export type SortKey = 'title' | 'artist' | 'recent' | 'size' | 'stock'

export interface SearchQuery {
  text: string
  mode: ListMode
  category: string | null
  sort: SortKey
  limit: number
  offset: number
}

export interface SearchResult {
  total: number
  rows: SongGroup[]
  elapsedMs: number
}

export interface CategoryCount {
  name: string
  count: number
}

export interface Stats {
  files: number
  groups: number
  dupGroups: number
  dupFiles: number
  missing: number
  favs: number
  recent: number
  categories: CategoryCount[]
  lastScanAt: number | null
}

export interface ScanProgress {
  phase: ScanPhase
  scanned: number
  total: number
  inserted: number
  elapsedMs: number
  message: string
}

export interface ScanSummary {
  scanned: number
  inserted: number
  groups: number
  dupGroups: number
  dupFiles: number
  elapsedMs: number
  errors: number
}

export interface OrganizePlanItem {
  src: string
  dst: string
  artist: string
  title: string
  reason: string
  conflict: boolean
}

export interface OrganizePlan {
  target: string
  items: OrganizePlanItem[]
  skipped: number
  conflicts: number
  totalBytes: number
}

export interface OrganizeResult {
  copied: number
  failed: number
  logPath: string
  errors: { src: string; message: string }[]
}

export interface Settings {
  gpPath: string
  rootPaths: string[]
  lastOrganizeTarget: string
  /** 实时盯着源目录。默认关，5 万个文件上开着很吃资源。 */
  watchRoots: boolean
}

export interface Api {
  scanStart: (mode: 'full' | 'incremental') => Promise<ScanSummary | null>
  scanProgress: () => Promise<ScanProgress>
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void
  search: (q: SearchQuery) => Promise<SearchResult>
  stats: () => Promise<Stats>
  roots: () => Promise<RootInfo[]>
  addRoot: (dir: string) => Promise<RootInfo[]>
  removeRoot: (id: number) => Promise<RootInfo[]>
  versions: (artistNorm: string, titleNorm: string) => Promise<SongFile[]>
  open: (songId: number) => Promise<{ ok: boolean; message: string }>
  reveal: (songId: number) => Promise<void>
  toggleFav: (artistNorm: string, titleNorm: string) => Promise<boolean>
  renameSong: (songId: number, title: string, artist: string) => Promise<void>
  planOrganize: (target: string, mode: 'all' | 'category') => Promise<OrganizePlan>
  runOrganize: (target: string, items: OrganizePlanItem[]) => Promise<OrganizeResult>
  settings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  pickFolder: () => Promise<string | null>
  rebuild: () => Promise<ScanSummary | null>
}
