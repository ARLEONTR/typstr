import { EventEmitter } from 'node:events'

const emitter = new EventEmitter()

export function emitSharingUpdate(projectId: string): void {
  emitter.emit(projectId)
}

export function subscribeToSharingUpdates(projectId: string, listener: () => void): () => void {
  emitter.on(projectId, listener)
  return () => {
    emitter.off(projectId, listener)
  }
}