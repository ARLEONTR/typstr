import { useEffect, useState } from 'react'
import * as Y from 'yjs'

type SaveStatus = 'saved' | 'unsaved'

export function useSaveStatus(ytext: Y.Text): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('saved')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const observer = () => {
      setStatus('unsaved')
      if (timer) clearTimeout(timer)
      // Hocuspocus maxDebounce is 3s, so move back to "saved" after 3.5s.
      timer = setTimeout(() => setStatus('saved'), 3500)
    }

    ytext.observe(observer)
    return () => {
      ytext.unobserve(observer)
      if (timer) clearTimeout(timer)
    }
  }, [ytext])

  return status
}
