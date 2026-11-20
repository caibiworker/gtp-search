import { useEffect, useState } from 'react'
import type { OrganizePlan, OrganizeResult } from '../../../shared/types'
import { fmtBytes, fmtNum } from '../format'

export default function OrganizePage(): React.JSX.Element {
  const api = window.api
  const [target, setTarget] = useState('')
  const [groupMode, setGroupMode] = useState<'all' | 'category'>('all')
  const [plan, setPlan] = useState<OrganizePlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<OrganizeResult | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void api.settings().then((s) => setTarget(s.lastOrganizeTarget || ''))
  }, [api])

  const pickTarget = async (): Promise<void> => {
    const p = await api.pickFolder()
    if (!p) return
    setTarget(p)
    setPlan(null)
    setResult(null)
    await api.saveSettings({ lastOrganizeTarget: p })
  }

  const preview = async (): Promise<void> => {
    if (!target) {
      setMsg('先选一个目标目录。')
      return
    }
    setBusy(true)
    setMsg('')
    setResult(null)
    try {
      setPlan(await api.planOrganize(target, groupMode))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const run = async (): Promise<void> => {
    if (!plan) return
    setBusy(true)
    setMsg('')
    try {
      setResult(await api.runOrganize(plan.target, plan.items))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="plain">
      <div className="sec-title">整理 · 把谱子按乐手归到一个新目录</div>
      <p className="note">
        只复制，不动源文件。目录结构是 <em>目标\乐手\文件名</em>。目标里已有同名文件时，
        这一项会标出来并跳过，不覆盖。先预演看清楚，再开始。
      </p>

      <div className="field">
        <label>目标目录</label>
        <span className="val">{target || '还没选'}</span>
        <button className="btn" onClick={() => void pickTarget()}>
          选目录
        </button>
      </div>

      <div className="field">
        <label>怎么分</label>
        <button
          className="btn"
          data-primary={groupMode === 'all' ? '1' : undefined}
          onClick={() => {
            setGroupMode('all')
            setPlan(null)
          }}
        >
          乐手
        </button>
        <button
          className="btn"
          data-primary={groupMode === 'category' ? '1' : undefined}
          onClick={() => {
            setGroupMode('category')
            setPlan(null)
          }}
        >
          分类 / 乐手
        </button>
      </div>

      <div className="plan-head" style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => void preview()} disabled={busy}>
          {busy && !plan ? '正在算…' : '预演'}
        </button>
        {plan ? (
          <>
            <button className="btn" data-primary="1" onClick={() => void run()} disabled={busy}>
              {busy ? '复制中…' : `开始复制 ${fmtNum(plan.items.length - plan.conflicts)} 份`}
            </button>
            <span className="plan-stat">
              计划 {fmtNum(plan.items.length)} · 冲突 {fmtNum(plan.conflicts)} · 跳过{' '}
              {fmtNum(plan.skipped)} · {fmtBytes(plan.totalBytes)}
            </span>
          </>
        ) : null}
      </div>

      {msg ? (
        <div className="errline" style={{ borderTop: '1px solid var(--line)' }}>
          {msg}
        </div>
      ) : null}

      {result ? (
        <div className="note" style={{ margin: '10px 0' }}>
          复制完成 <em>{fmtNum(result.copied)}</em> 份，失败 {fmtNum(result.failed)} 份。清单在{' '}
          <em>{result.logPath}</em>
        </div>
      ) : null}

      {plan ? (
        <div className="plan-list">
          {plan.items.slice(0, 400).map((it, i) => (
            <div className="plan-row" key={i} data-conflict={it.conflict ? '1' : '0'}>
              <span className="src" title={it.src}>
                {it.src}
              </span>
              <span className="dst" title={it.dst}>
                {it.conflict ? '冲突 → ' : '→ '}
                {it.dst}
              </span>
            </div>
          ))}
          {plan.items.length > 400 ? (
            <div className="plan-row" style={{ color: 'var(--fg-faint)' }}>
              其余 {fmtNum(plan.items.length - 400)} 项不列出，执行时照样处理。
            </div>
          ) : null}
        </div>
      ) : null}

      {result && result.errors.length > 0 ? (
        <div className="plan-list" style={{ marginTop: 12 }}>
          {result.errors.slice(0, 40).map((e, i) => (
            <div className="plan-row" key={i} data-conflict="1">
              <span className="src">{e.src}</span>
              <span className="dst">{e.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

