const memoryStorage = new Map<string, string>()

function storageAvailable(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    const storage = window.localStorage
    const probeKey = '__typstr_storage_probe__'
    storage.setItem(probeKey, '1')
    storage.removeItem(probeKey)
    return storage
  } catch {
    return null
  }
}

export const safeStorage = {
  getItem(key: string): string | null {
    const storage = storageAvailable()
    if (storage) {
      try {
        return storage.getItem(key)
      } catch {
        return memoryStorage.get(key) ?? null
      }
    }
    return memoryStorage.get(key) ?? null
  },

  setItem(key: string, value: string): void {
    const storage = storageAvailable()
    if (storage) {
      try {
        storage.setItem(key, value)
        return
      } catch {
        // Fall through to memory storage.
      }
    }
    memoryStorage.set(key, value)
  },

  removeItem(key: string): void {
    const storage = storageAvailable()
    if (storage) {
      try {
        storage.removeItem(key)
      } catch {
        // Still remove from memory fallback below.
      }
    }
    memoryStorage.delete(key)
  },
}
