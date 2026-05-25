import { type IncomingMessage, type ServerResponse } from 'node:http';
import { getAuthToken } from '../middleware/auth.js';

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CMR Login</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#111;color:#e0e0e0;display:flex;justify-content:center;align-items:center;height:100vh}
.card{background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:32px;width:360px}
h2{margin-bottom:16px;font-size:20px}
input{width:100%;background:#0a0a0a;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:10px;font-size:14px;margin:8px 0}
button{width:100%;background:#2563eb;color:#fff;border:none;border-radius:4px;padding:10px 16px;cursor:pointer;font-size:14px;margin-top:12px}
button:hover{background:#1d4ed8}
.error{color:#ef4444;font-size:13px;margin-top:8px}
</style>
</head>
<body>
<div class="card">
<h2>CMR Login</h2>
<form method="POST" action="/web/login">
<input name="token" type="password" placeholder="Auth token" autofocus>
<button type="submit">Login</button>
</form>
<div class="error" id="err"></div>
</div>
<script>
if(window.location.search.includes('error'))document.getElementById('err').textContent='Invalid token'
</script>
</body>
</html>`;

export function handleLoginRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '';
  if (url !== '/web/login') return false;

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(LOGIN_HTML);
    return true;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const params = new URLSearchParams(body);
      if (params.get('token') === getAuthToken()) {
        res.writeHead(302, {
          Location: '/web',
          'Set-Cookie': `cmr_token=${encodeURIComponent(getAuthToken() ?? '')}; HttpOnly; Path=/; SameSite=Strict`,
        });
        res.end();
      } else {
        res.writeHead(302, { Location: '/web/login?error=1' });
        res.end();
      }
    });
    return true;
  }

  return false;
}
