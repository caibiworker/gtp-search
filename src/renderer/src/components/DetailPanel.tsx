import { useEffect, useState } from 'react'
import type { SongFile, SongGroup } from '../../../shared/types'
import { fmtBytes, fmtDate } from '../format'

interface Props {
  group: SongGroup
  onFavChanged: (key: string, fav: boolean) => void
  onOpened: (key: string) => void
}

export default function DetailPanel({ group, onFavChanged, onOpened }: Props): React.JSX.Element {
  const [versions, setVersions] = useState<SongFile[]>([])
  const [msg, setMsg] = useState('')
  const api = window.api

  useEffect(() => {
    let alive = true
    setVersions([])
    setMsg('')
    api
      .versions(group.artistNorm, group.titleNorm)
      .then((v) => {
        if (alive) setVersions(v)
      })
      .catch(() => {
        if (alive) setMsg('读版本列表失败')
      })
    return () => {
      alive = false
    }
  }, [group.key, group.artistNorm, group.titleNorm, api])

  const open = async (id: number): Promise<void> => {
    const r = await api.open(id)
    if (r.ok) onOpened(group.key)
    else setMsg(r.message)
  }

  const fav = group.fav

  return (
    <aside className="detail">
      <div className="detail-head">
        <h1 className="detail-title">{group.title || '（未命名）'}</h1>
        <div className="detail-artist">{group.artist || '乐手未知'}</div>
        <div className="detail-meta">
          {group.category || '未分类'} · {group.versionCount} 个版本 · {fmtBytes(group.totalSize)}
        </div>
      </div>

      <div className="detail-actions">
        <button className="btn" data-primary="1" onClick={() => void open(group.reprId)}>
          打开
        </button>
        <button className="btn" onClick={() => void api.reveal(group.reprId)}>
          找文件
        </button>
        <button
          className="btn"
          onClick={() => {
            void api
              .toggleFav(group.artistNorm, group.titleNorm)
              .then((next) => onFavChanged(group.key, next))
          }}
        >
          {fav ? '取消收藏' : '收藏'}
        </button>
      </div>

      {msg ? <div className="errline">{msg}</div> : null}

      <div className="detail-body">
        <div className="detail-sec">版本 · 双击打开</div>
        {versions.length === 0 ? (
          <div className="empty" style={{ padding: '14px 16px' }}>
            正在读…
          </div>
        ) : null}
        {versions.map((v) => (
          <div
            key={v.id}
            className="version"
            data-missing={v.missing ? '1' : '0'}
            onDoubleClick={() => void open(v.id)}
          >
            <div className="version-name" title={v.relPath}>
              {v.filename}
            </div>
            <div className="version-sub">
              <span>{v.ext.replace('.', '').toUpperCase()}</span>
              <span>{fmtBytes(v.size)}</span>
              <span>{fmtDate(v.mtime)}</span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
