// Tiny fake employer site for engine tests.
import { createServer, type Server } from 'node:http'

const page = (body: string) => `<!doctype html><html><head><title>Acme Careers</title></head><body style="font-family:sans-serif">${body}</body></html>`

export function startSite(): Promise<{ url: string; server: Server; submissions: Record<string, string>[]; accounts: Record<string, string>[] }> {
  const submissions: Record<string, string>[] = []
  const accounts: Record<string, string>[] = []
  let loggedIn = false
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const send = (h: string) => res.writeHead(200, { 'content-type': 'text/html' }).end(page(h))
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const form = Object.fromEntries(new URLSearchParams(body))
        if (u.pathname === '/register') {
          accounts.push(form)
          loggedIn = true
          res.writeHead(302, { location: '/apply' }).end()
        } else if (u.pathname === '/submit') {
          submissions.push(form)
          send('<h1>Thank you for applying!</h1><p>We have received your application.</p>')
        } else res.writeHead(404).end()
      })
      return
    }
    switch (u.pathname) {
      case '/job':
        return send('<h1>Operations Analyst</h1><p>Great job.</p><a href="/apply" class="btn">Apply Now</a>')
      case '/secure-job':
        return send('<h1>Analyst</h1><a href="/login">Apply</a>')
      case '/login':
        return send(`<h2>Sign in</h2><form><label for="em">Email Address</label><input id="em" type="email"><label for="pw">Password</label><input id="pw" type="password"><button type="button">Sign In</button></form><a href="/register">Create Account</a>`)
      case '/register':
        return send(`<h2>Create Account</h2><form method="post" action="/register">
          <label for="e">Email</label><input id="e" name="email" type="email" required>
          <label for="p1">Password</label><input id="p1" name="password" type="password" required>
          <label for="p2">Verify Password</label><input id="p2" name="password2" type="password" required>
          <label><input type="checkbox" name="terms" required> I agree to the terms</label>
          <button type="submit">Create Account</button></form>`)
      case '/apply':
        return send(`<h2>Your information</h2><form action="/apply2" method="get">
          <div class="field"><label for="fn">First Name *</label><input id="fn" name="first" required></div>
          <div class="field"><label for="ln">Last Name *</label><input id="ln" name="last" required></div>
          <div class="field"><label for="em">Email *</label><input id="em" name="email" type="email" required></div>
          <div class="field"><label for="ph">Phone</label><input id="ph" name="phone" type="tel"></div>
          <div class="field"><label for="li">LinkedIn Profile</label><input id="li" name="linkedin"></div>
          <div class="field"><label for="cv">Resume/CV *</label><input id="cv" name="cv" type="file" accept=".pdf,.doc,.docx"></div>
          <button type="submit">Next</button></form>`)
      case '/apply2': {
        const prev = [...u.searchParams.entries()].map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`).join('')
        return send(`<h2>Questions</h2><form action="/submit" method="post">${prev}
          <fieldset><legend>Are you legally authorized to work in the United States? *</legend>
            <label><input type="radio" name="auth" value="yes" required> Yes</label><label><input type="radio" name="auth" value="no"> No</label></fieldset>
          <div class="field"><label for="sp">Will you now or in the future require sponsorship? *</label><select id="sp" name="sponsor" required><option value="">Select...</option><option>Yes</option><option>No</option></select></div>
          <div class="field"><label for="g">Gender</label><select id="g" name="gender"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select></div>
          <div class="field"><label for="why">Why do you want to work here? *</label><textarea id="why" name="why" required></textarea></div>
          <div class="field"><label for="sal">Desired salary</label><input id="sal" name="salary"></div>
          <button type="submit">Submit Application</button></form>`)
      }
      default:
        res.writeHead(404).end()
    }
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server, submissions, accounts })))
}
