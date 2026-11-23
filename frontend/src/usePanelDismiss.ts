// While a panel is open, close it on a click outside `containerRef` or on the Escape key.
// Used by the filter strips (Price / Type / More panels).
import { useEffect, type RefObject } from 'react'

export function usePanelDismiss(isOpen: boolean, containerRef: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!isOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // Cleanup: stop listening when the panel closes or the strip goes away.
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, containerRef, close])
}
