/** Window size in CSS px (= display points for the full-screen overlay), kept current on resize. */
import { useEffect, useState } from 'react'
import type { Size } from './layout'

const read = (): Size => ({ width: window.innerWidth, height: window.innerHeight })

export function useViewport(): Size {
  const [size, setSize] = useState<Size>(read)
  useEffect(() => {
    const onResize = () => setSize(read())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}
