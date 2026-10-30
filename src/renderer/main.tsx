import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { api } from './lib/api'

window.addEventListener('error', (e) => void api.app.logError('window', e.error?.stack ?? e.message))
window.addEventListener('unhandledrejection', (e) => void api.app.logError('window', (e.reason as Error)?.stack ?? String(e.reason)))

createRoot(document.getElementById('root')!).render(<App />)
