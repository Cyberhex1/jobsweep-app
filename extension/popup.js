const $ = (id) => document.getElementById(id)
const status = (t, cls) => {
  $('status').textContent = t
  $('status').className = 'status ' + (cls || '')
}
chrome.storage.local.get(['port', 'token']).then(({ port, token }) => {
  if (port && token) $('code').value = `${port}-${token}`
  chrome.runtime.sendMessage({ type: 'ping' }, (r) => (r && r.ok ? status('Connected to JobSweep.', 'ok') : status(r && r.error ? r.error : 'JobSweep app is not running.', 'bad')))
})
$('save').onclick = async () => {
  const m = /^(\d+)-([a-f0-9]+)$/i.exec($('code').value.trim())
  if (!m) return status('That doesn’t look like a pairing code.', 'bad')
  await chrome.storage.local.set({ port: Number(m[1]), token: m[2] })
  chrome.runtime.sendMessage({ type: 'ping' }, (r) => (r && r.ok ? status('Paired!', 'ok') : status(r && r.error ? r.error : 'Could not reach JobSweep.', 'bad')))
}
$('import').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  status('Reading this page…')
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extract.js'] })
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => jobsweepExtract() })
  chrome.runtime.sendMessage({ type: 'import', job: result }, (r) => (r && !r.error ? status(`Imported “${r.title}”${r.assistOnly ? ' (assist mode)' : ''}.`, 'ok') : status(r ? r.error : 'Failed', 'bad')))
}
