import type { ListMode, Stats } from '../../../shared/types'
import { fmtNum } from '../format'

interface Props {
  mode: ListMode
  category: string | null
  stats: Stats | null
  onMode: (m: ListMode) => void
  onCategory: (c: string | null) => void
}

export default function Sidebar({ mode, category, stats, onMode, onCategory }: Props): React.JSX.Element {
  const item = (
    label: string,
    count: number,
    on: boolean,
    click: () => void
  ): React.JSX.Element => (
    <button className="side-item" data-on={on ? '1' : '0'} onClick={click}>
      <span>{label}</span>
      <span className="n">{fmtNum(count)}</span>
    </button>
  )

  return (
    <div className="sidebar">
      <div className="side-title">曲库</div>
      {item('全部', stats?.groups ?? 0, mode === 'all' && !category, () => {
        onMode('all')
        onCategory(null)
      })}
      {item('收藏', stats?.favs ?? 0, mode === 'fav', () => onMode('fav'))}
      {item('最近打开', stats?.recent ?? 0, mode === 'recent', () => onMode('recent'))}
      {item('文件缺失', stats?.missing ?? 0, mode === 'missing', () => onMode('missing'))}

      <div className="side-divider" />
      <div className="side-title">分类</div>
      {item('不限', stats?.groups ?? 0, mode === 'category' && !category, () => {
        onMode(category ? 'category' : 'all')
        onCategory(null)
      })}
      {(stats?.categories ?? []).map((c) =>
        item(c.name, c.count, category === c.name, () => {
          onMode('category')
          onCategory(c.name)
        })
      )}
    </div>
  )
}
