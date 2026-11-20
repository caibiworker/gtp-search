import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ListMode,
  RootInfo,
  ScanProgress,
  SongGroup,
  SortKey,
  Stats
} from '../../shared/types'
import SongTable from './components/SongTable'
import Sidebar from './components/Sidebar'
import DetailPanel from './components/DetailPanel'
import OrganizePage from './pages/OrganizePage'
import SettingsPage from './pages/SettingsPage'
import { fmtDate, fmtElapsed, fmtNum } from './format'

type View = 'library' | 'organize' | 'settings'

/** 索引那边最多给 500 条，界面不用分页。 */
const RESULT_CAP = 500

const IDLE: ScanProgress = {
  phase: 'idle',
  scanned: 0,
  total: 0,
  inserted: 0,
  elapsedMs: 0,
  message: ''
}

export default function App(): React.JSX.Element {
  const api = window.api

  const [view, setView] = useState<View>('library')
  /** 输入框里看见的字，跟着手打走，不等防抖。 */
  const [text, setText] = useState('')
  /** 真正拿去查的字。中文输入法还在合成的时候不往前走。 */
  const [q, setQ] = useState('')
  const [composing, setComposing] = useState(false)

  const [mode, setMode] = useState<ListMode>('all')
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('recent')

  const [rows, setRows] = useState<SongGroup[]>([])
  const [total, setTotal] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const [stats, setStats] = useState<Stats | null>(null)
  const [roots, setRoots] = useState<RootInfo[]>([])
  const [progress, setProgress] = useState<ScanProgress>(IDLE)

  const searchRef = useRef<HTMLInputElement>(null)
  const loadId = useRef(0)

  // 防抖 120ms；合成期间按住不动，上屏之后再算
  useEffect(() => {
    if (composing) return
    const t = setTimeout(() => setQ(text), 120)
    return () => clearTimeout(t)
  }, [text, composing])

  const query = useMemo(
    () => ({ text: q.trim(), mode, category, sort }),
    [q, mode, category, sort]
  )

  const tokens = useMemo(() => q.trim().toLowerCase().split(/\s+/).filter(Boolean), [q])

  const refreshMeta = useCallback(async (): Promise<void> => {
    try {
      const [s, r] = await Promise.all([api.stats(), api.roots()])
      setStats(s)
      setRoots(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  useEffect(() => {
    void refreshMeta()
  }, [refreshMeta])

  const runQuery = useCallback(
    async (keepSelection: boolean): Promise<void> => {
      const id = ++loadId.current
      setErr('')
      try {
        const r = await api.search({ ...query, limit: RESULT_CAP, offset: 0 })
        if (id !== loadId.current) return
        setRows(r.rows)
        setTotal(r.total)
        setElapsed(r.elapsedMs)
        if (keepSelection) {
          setSelectedKey((cur) => (cur && r.rows.some((x) => x.key === cur) ? cur : null))
        } else {
          setSelectedKey(null)
        }
      } catch (e) {
        if (id !== loadId.current) return
        setErr(e instanceof Error ? e.message : String(e))
      }
    },
    [api, query]
  )

  useEffect(() => {
    void runQuery(false)
  }, [runQuery])

  // 扫描进度：完成时刷新统计，其他时候列表自己会重查
  useEffect(() => {
    const off = api.onScanProgress((p) => {
      setProgress(p)
      if (p.phase === 'done') {
        void refreshMeta()
        void runQuery(true)
      }
    })
    void api.scanProgress().then(setProgress).catch(() => undefined)
    return off
  }, [api, refreshMeta, runQuery])

  const selected = useMemo(() => rows.find((r) => r.key === selectedKey) ?? null, [rows, selectedKey])

  const openGroup = useCallback(
    (g: SongGroup): void => {
      void api.open(g.reprId).then((r) => {
        if (!r.ok) setErr(r.message)
        else if (mode === 'recent') void runQuery(true)
      })
    },
    [api, mode, runQuery]
  )

  // 键盘：上下选、回车开、Esc 清、Ctrl+F 聚焦搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setView('library')
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (e.key === 'Escape') {
        if (document.activeElement === searchRef.current) {
          setText('')
          setQ('')
        } else {
          setSelectedKey(null)
        }
        return
      }
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (view !== 'library') return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const idx = rows.findIndex((r) => r.key === selectedKey)
        const next =
          e.key === 'ArrowDown'
            ? rows[Math.min(rows.length - 1, idx < 0 ? 0 : idx + 1)]
            : rows[Math.max(0, idx < 0 ? 0 : idx - 1)]
        if (next) setSelectedKey(next.key)
        return
      }
      if (e.key === 'Enter' && selected) {
        e.preventDefault()
        openGroup(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, selectedKey, selected, view, openGroup])

  const scanning = progress.phase !== 'idle' && progress.phase !== 'done'

  const rescan = async (): Promise<void> => {
    await api.rebuild()
    await refreshMeta()
    await runQuery(true)
  }

  /** 第一次用：挑一个装着谱子的文件夹，加进来就自动清点。 */
  const addFirstRoot = useCallback(async (): Promise<void> => {
    const dir = await api.pickFolder()
    if (!dir) return
    setErr('')
    setProgress({ ...IDLE, phase: 'walk', message: '正在清点这个目录' })
    try {
      await api.addRoot(dir)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
    await refreshMeta()
    await runQuery(false)
  }, [api, refreshMeta, runQuery])

  const rootsChanged = useCallback((): void => {
    void refreshMeta()
    void runQuery(true)
  }, [refreshMeta, runQuery])

  const emptyLibrary = roots.length === 0

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          谱库
        </div>
        <div className="search-slot">
          <input
            ref={searchRef}
            className="search-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onFocus={() => setView('library')}
            placeholder="搜曲名、乐手、拼音首字母"
            spellCheck={false}
          />
          <span className="search-hint">
            {q.trim() ? `找到 ${fmtNum(total)} 首` : `${fmtNum(total)} 组`}
            {elapsed > 0 ? ` · ${elapsed} ms` : ''}
          </span>
        </div>
        <nav className="nav">
          <button data-on={view === 'library' ? '1' : '0'} onClick={() => setView('library')}>
            曲库
          </button>
          <button data-on={view === 'organize' ? '1' : '0'} onClick={() => setView('organize')}>
            整理
          </button>
          <button data-on={view === 'settings' ? '1' : '0'} onClick={() => setView('settings')}>
            设置
          </button>
        </nav>
      </header>

      <div className="body">
        {view === 'library' ? (
          <>
            <Sidebar
              mode={mode}
              category={category}
              stats={stats}
              onMode={(m) => {
                setMode(m)
                if (m !== 'category') setCategory(null)
              }}
              onCategory={(c) => setCategory(c)}
            />
            <main className="page">
              {scanning ? (
                <div className="scanline">
                  <span>
                    {progress.phase === 'walk'
                      ? '清点文件'
                      : progress.phase === 'parse'
                        ? '解析入库'
                        : '归并'}
                  </span>
                  <span className="bar">
                    <i
                      style={{
                        width: `${progress.total > 0 ? Math.min(100, (progress.scanned / progress.total) * 100) : 8}%`
                      }}
                    />
                  </span>
                  <span>
                    {fmtNum(progress.scanned)} /{' '}
                    {progress.total > 0 ? fmtNum(progress.total) : '?'}
                  </span>
                  <span>{progress.message}</span>
                  <span style={{ marginLeft: 'auto' }}>{fmtElapsed(progress.elapsedMs)}</span>
                </div>
              ) : null}
              {err ? <div className="errline">{err}</div> : null}
              {emptyLibrary && !scanning ? (
                <div className="welcome">
                  <div className="welcome-title">还没有谱库目录</div>
                  <p className="welcome-text">
                    挑一个装着 Guitar Pro 谱子的文件夹，或者它的上一层。子文件夹会一起扫，只读，
                    不改里面任何文件。
                  </p>
                  <button className="btn" data-primary="1" onClick={() => void addFirstRoot()}>
                    选目录
                  </button>
                  <p className="welcome-hint">
                    支持 .gp3 .gp4 .gp5 .gp .gtp .gpx，五万份大约十秒。
                  </p>
                </div>
              ) : (
                <SongTable
                  rows={rows}
                  total={total}
                  selectedKey={selectedKey}
                  sort={sort}
                  tokens={tokens}
                  onSort={setSort}
                  onSelect={(g) => setSelectedKey(g.key)}
                  onOpen={openGroup}
                />
              )}
            </main>
            {selected ? (
              <DetailPanel
                group={selected}
                onFavChanged={(key, fav) =>
                  setRows((prev) => prev.map((r) => (r.key === key ? { ...r, fav } : r)))
                }
                onOpened={() => {
                  if (mode === 'recent') void runQuery(true)
                }}
              />
            ) : null}
          </>
        ) : null}

        {view === 'organize' ? (
          <div className="page">
            <OrganizePage />
          </div>
        ) : null}

        {view === 'settings' ? (
          <div className="page">
            <SettingsPage
              stats={stats}
              roots={roots}
              scanning={scanning}
              onRescan={() => void rescan()}
              onRootsChanged={rootsChanged}
            />
          </div>
        ) : null}
      </div>

      <footer className="footer">
        <span>
          共 <b>{fmtNum(stats?.groups ?? 0)}</b> 组
        </span>
        <span>
          <b>{fmtNum(stats?.files ?? 0)}</b> 册
        </span>
        <span>
          重复 <b>{fmtNum(stats?.dupGroups ?? 0)}</b> 组 / {fmtNum(stats?.dupFiles ?? 0)} 份
        </span>
        {stats && stats.missing > 0 ? (
          <span style={{ color: 'var(--danger)' }}>缺 {fmtNum(stats.missing)}</span>
        ) : null}
        <span className="grow">
          {scanning
            ? `${progress.message || progress.phase}`
            : `上次清点 ${fmtDate(stats?.lastScanAt ?? null)}`}
        </span>
      </footer>
    </div>
  )
}
