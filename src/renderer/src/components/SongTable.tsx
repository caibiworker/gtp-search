import { useEffect, useRef, useState } from 'react'
import type { SongGroup, SortKey } from '../../../shared/types'
import { useElementSize, useVirtual } from '../hooks/useVirtual'

const ROW_H = 24

interface Props {
  rows: SongGroup[]
  total: number
  selectedKey: string | null
  sort: SortKey
  tokens: string[]
  onSort: (k: SortKey) => void
  onSelect: (g: SongGroup) => void
  onOpen: (g: SongGroup) => void
}

/** 把命中的片段挑出来，只换字色，不加底色。拼音命中的段落对不上原文，跳过。 */
function Highlight({ text, tokens }: { text: string; tokens: string[] }): React.JSX.Element {
  const s = text || '（未命名）'
  if (tokens.length === 0) return <>{s}</>

  const low = s.toLowerCase()
  const spans: { start: number; end: number }[] = []
  for (const tok of tokens) {
    if (!tok) continue
    let from = 0
    while (from < low.length) {
      const at = low.indexOf(tok, from)
      if (at < 0) break
      spans.push({ start: at, end: at + tok.length })
      from = at + tok.length
    }
  }
  if (spans.length === 0) return <>{s}</>

  spans.sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const sp of spans) {
    const last = merged[merged.length - 1]
    if (last && sp.start <= last.end) last.end = Math.max(last.end, sp.end)
    else merged.push({ ...sp })
  }

  const out: React.ReactNode[] = []
  let cur = 0
  merged.forEach((sp, i) => {
    if (sp.start > cur) out.push(s.slice(cur, sp.start))
    out.push(
      <mark key={i} className="hl">
        {s.slice(sp.start, sp.end)}
      </mark>
    )
    cur = sp.end
  })
  if (cur < s.length) out.push(s.slice(cur))
  return <>{out}</>
}

export default function SongTable({
  rows,
  total,
  selectedKey,
  sort,
  tokens,
  onSort,
  onSelect,
  onOpen
}: Props): React.JSX.Element {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportRef, viewportH] = useElementSize<HTMLDivElement>()
  const raf = useRef(0)
  const { start, end, totalHeight } = useVirtual(rows.length, ROW_H, viewportH, scrollTop)

  // 换了一批结果，回到顶部
  useEffect(() => {
    const el = viewportRef.current
    if (el) el.scrollTop = 0
    setScrollTop(0)
  }, [rows, viewportRef])

  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const top = e.currentTarget.scrollTop
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => setScrollTop(top))
  }

  // 键盘选中的行滚进视野
  useEffect(() => {
    if (!selectedKey) return
    const idx = rows.findIndex((r) => r.key === selectedKey)
    const el = viewportRef.current
    if (idx < 0 || !el) return
    const y = idx * ROW_H
    if (y < el.scrollTop) el.scrollTop = y
    else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight
  }, [selectedKey, rows, viewportRef])

  const head = (label: string, k: SortKey, extra?: React.CSSProperties): React.JSX.Element => (
    <button data-on={sort === k ? '1' : '0'} onClick={() => onSort(k)} style={extra}>
      {label}
      {sort === k ? ' ↑' : ''}
    </button>
  )

  return (
    <>
      <div className="table-head">
        <span style={{ width: 54, flex: 'none' }}>{head('库存号', 'stock')}</span>
        <span style={{ flex: 1, minWidth: 0 }}>{head('曲名', 'title')}</span>
        <span style={{ width: 220, flex: 'none' }}>{head('乐手', 'artist')}</span>
        <span style={{ width: 96, flex: 'none' }}>分类</span>
        <span style={{ width: 56, flex: 'none', textAlign: 'right', paddingRight: 6 }}>
          {head('版本', 'size')}
        </span>
      </div>

      <div className="table-scroll" ref={viewportRef} onScroll={onScroll}>
        <div className="table-inner" style={{ height: totalHeight }}>
          {rows.slice(start, end).map((g, i) => (
            <div
              key={g.key}
              className="row"
              data-sel={g.key === selectedKey ? '1' : '0'}
              style={{ position: 'absolute', left: 0, right: 0, top: (start + i) * ROW_H }}
              onClick={() => onSelect(g)}
              onDoubleClick={() => onOpen(g)}
            >
              <span className="c-no">{g.stockNo}</span>
              <span className="c-title">
                {g.fav ? <i className="fav" /> : null}
                <Highlight text={g.title} tokens={tokens} />
                {g.missingCount > 0 ? <i className="missing">缺</i> : null}
              </span>
              <span className="c-artist">{g.artist || '—'}</span>
              <span className="c-cat">{g.category || '—'}</span>
              <span className="c-count">{g.versionCount > 1 ? g.versionCount : ''}</span>
            </div>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            {tokens.length ? (
              <>
                <b>没找到。</b>
                试试用拼音首字母，比如 zjl
              </>
            ) : (
              <>
                <b>这里还没有谱子。</b>
                去设置里加一个装着 Guitar Pro 文件的目录。
              </>
            )}
          </div>
        ) : null}
        {total > rows.length ? (
          <div className="empty" style={{ padding: '8px 12px' }}>
            只显示前 {rows.length} 首，还有 {total - rows.length} 首没列出来。再输几个字缩小一点。
          </div>
        ) : null}
      </div>
    </>
  )
}
