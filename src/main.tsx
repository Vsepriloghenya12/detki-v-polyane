import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/marck-script'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    if (import.meta.env.PROD) {
      const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      await registration.update()
      return
    }

    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map(registration => registration.unregister()))

    if ('caches' in window) {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.filter(name => name.startsWith('detki-v-polyane-')).map(name => caches.delete(name)))
    }
  })
}
