import { useEffect, useRef, useState } from 'react'

/** 搜索防抖 200ms。 */
export function useDebounced<T>(value: T, delay = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

export interface VirtualRange {
  start: number
  end: number
  totalHeight: number
}

/** 固定行高的虚拟滚动。五万条也只渲染一屏。 */
export function useVirtual(count: number, rowH: number, viewport: number, scrollTop: number): VirtualRange {
  const overscan = 8
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan)
  const visible = Math.ceil(viewport / rowH) + overscan * 2
  const end = Math.min(count, start + visible)
  return { start, end, totalHeight: count * rowH }
}

export function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [h, setH] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setH(el.clientHeight))
    ro.observe(el)
    setH(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  return [ref, h]
}
