import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('jobsweep', {
  call: (path: string, ...args: unknown[]) => ipcRenderer.invoke('api', path, args),
  on: (cb: (event: string, payload: unknown) => void) => {
    const listener = (_e: unknown, event: string, payload: unknown) => cb(event, payload)
    ipcRenderer.on('event', listener)
    return () => ipcRenderer.removeListener('event', listener)
  }
})
