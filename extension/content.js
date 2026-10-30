// Floating "Import to JobSweep" button. Does nothing until clicked.
;(function () {
  if (window.__jobsweep) return
  window.__jobsweep = true
  const btn = document.createElement('button')
  btn.textContent = '⬇ Import to JobSweep'
  Object.assign(btn.style, {
    position: 'fixed', right: '20px', bottom: '20px', zIndex: 2147483647, padding: '10px 16px', borderRadius: '12px', border: '1px solid #8a7140',
    background: 'linear-gradient(180deg,#e7cf94,#c9a961 55%,#8a7140)', color: '#1a1407', font: '600 13px Segoe UI, system-ui, sans-serif',
    boxShadow: '0 8px 24px -8px rgba(0,0,0,.5)', cursor: 'pointer'
  })
  const say = (t, ok) => {
    btn.textContent = t
    btn.style.filter = ok === false ? 'grayscale(1)' : ''
    setTimeout(() => {
      btn.textContent = '⬇ Import to JobSweep'
      btn.style.filter = ''
    }, 4000)
  }
  btn.addEventListener('click', async () => {
    btn.textContent = 'Importing…'
    const job = jobsweepExtract()
    chrome.runtime.sendMessage({ type: 'import', job }, (res) => {
      if (!res || res.error) return say(res && res.error ? res.error : 'JobSweep not reachable', false)
      say(res.assistOnly ? '✓ Imported (assist mode)' : '✓ Imported', true)
    })
  })
  document.documentElement.appendChild(btn)
})()
