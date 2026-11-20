import { useEffect, useState } from 'react'
import type { RootInfo, Stats } from '../../../shared/types'
import { fmtDate, fmtNum } from '../format'

interface Props {
  stats: Stats | null
  roots: RootInfo[]
  scanning: boolean
  onRescan: () => void
  onRootsChanged: () => void
}

export default function SettingsPage({
  stats,
  roots,
  scanning,
  onRescan,
  onRootsChanged
}: Props): React.JSX.Element {
  const api = window.api
  const [gpPath, setGpPath] = useState('')
  const [saved, setSaved] = useState('')
  const [watch, setWatch] = useState(false)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    void api.settings().then((s) => {
      setGpPath(s.gpPath)
      setWatch(s.watchRoots)
    })
  }, [api])

  const save = async (): Promise<void> => {
    await api.saveSettings({ gpPath })
    setSaved('已保存')
    setTimeout(() => setSaved(''), 1500)
  }

  const addDir = async (): Promise<void> => {
    const dir = await api.pickFolder()
    if (!dir) return
    setBusy('正在清点这个目录…')
    try {
      await api.addRoot(dir)
      onRootsChanged()
    } catch (e) {
      setBusy(e instanceof Error ? e.message : String(e))
      return
    }
    setBusy('')
  }

  const drop = async (r: RootInfo): Promise<void> => {
    setBusy('正在删索引…')
    await api.removeRoot(r.id)
    onRootsChanged()
    setBusy('')
  }

  const toggleWatch = async (next: boolean): Promise<void> => {
    setWatch(next)
    await api.saveSettings({ watchRoots: next })
    setSaved(next ? '下次启动开始盯着' : '下次启动不再盯着')
    setTimeout(() => setSaved(''), 2200)
  }

  return (
    <div className="plain">
      <div className="sec-title">设置</div>

      <div className="field">
        <label>Guitar Pro</label>
        <input
          className="gp-input"
          value={gpPath}
          onChange={(e) => setGpPath(e.target.value)}
          placeholder="留空则用系统的默认关联程序打开"
          spellCheck={false}
        />
        <button className="btn" onClick={() => void save()}>
          保存
        </button>
        <span className="plan-stat">{saved}</span>
      </div>

      <div className="sec-title">谱库目录 · 只读，不会改动里面的文件</div>
      {roots.length === 0 ? (
        <div className="note">还没登记目录。点下面的按钮挑一个装着 Guitar Pro 谱子的文件夹。</div>
      ) : null}
      {roots.map((r) => (
        <div className="field" key={r.id}>
          <span className="dot" data-on={r.online ? '1' : '0'} />
          <span className="val" title={r.path}>
            {r.path}
          </span>
          <span className="plan-stat">
            {r.online ? `${fmtNum(r.fileCount)} 份` : '目录不在了'} ·{' '}
            {r.lastScanAt ? fmtDate(r.lastScanAt) : '没清点过'}
          </span>
          <button className="btn" onClick={() => void drop(r)} disabled={busy !== ''}>
            移出
          </button>
        </div>
      ))}

      <div className="plan-head" style={{ marginTop: 14 }}>
        <button className="btn" data-primary="1" onClick={() => void addDir()} disabled={busy !== ''}>
          添加目录
        </button>
        <button className="btn" onClick={onRescan} disabled={scanning}>
          {scanning ? '正在清点…' : '重新清点全部'}
        </button>
        <span className="plan-stat">{busy}</span>
      </div>

      <div className="field" style={{ marginTop: 10 }}>
        <label>实时监听</label>
        <button
          className="btn"
          data-primary={watch ? '1' : undefined}
          onClick={() => void toggleWatch(!watch)}
        >
          {watch ? '已开' : '已关'}
        </button>
        <span className="plan-stat">
          打开后源目录里新加的谱子会自己进来，但五万多个文件上开着会吃资源。改完重启生效。
        </span>
      </div>

      <div className="sec-title">入库情况</div>
      <div className="field">
        <label>谱子文件</label>
        <span className="val">{fmtNum(stats?.files ?? 0)}</span>
      </div>
      <div className="field">
        <label>归并成歌</label>
        <span className="val">{fmtNum(stats?.groups ?? 0)}</span>
      </div>
      <div className="field">
        <label>重复</label>
        <span className="val">
          {fmtNum(stats?.dupGroups ?? 0)} 组 / {fmtNum(stats?.dupFiles ?? 0)} 份
        </span>
      </div>
      <div className="field">
        <label>文件缺失</label>
        <span className="val">{fmtNum(stats?.missing ?? 0)}</span>
      </div>
      <div className="field">
        <label>上次清点</label>
        <span className="val">{fmtDate(stats?.lastScanAt ?? null)}</span>
      </div>

      <p className="note" style={{ marginTop: 18 }}>
        索引放在 %APPDATA%\gtpsearch\gtpsearch.db。删掉它只会让索引重来，源文件不受影响。
      </p>
    </div>
  )
}
