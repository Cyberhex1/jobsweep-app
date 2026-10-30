// Sends imports to the JobSweep desktop app on this computer (127.0.0.1 only).
async function pairing() {
  const { port, token } = await chrome.storage.local.get(['port', 'token'])
  return port && token ? { port, token } : null
}

async function send(path, body) {
  const p = await pairing()
  if (!p) throw new Error('Not paired — open the JobSweep extension and paste your pairing code')
  const r = await fetch(`http://127.0.0.1:${p.port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-jobsweep-token': p.token },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || (r.status === 401 ? 'Pairing code is wrong' : `Error ${r.status}`))
  return data
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'import') send('/import', msg.job).then(reply, (e) => reply({ error: e.message }))
  else if (msg.type === 'ping') send('/ping').then(reply, (e) => reply({ error: e.message }))
  return true
})
