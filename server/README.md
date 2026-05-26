Server setup and hardening notes

Run in the `server/` folder:

```powershell
cd "c:\Users\aguia\Documents\Plano de contas\server"
npm install
npm start
```

Environment variables (recommended):
- JWT_SECRET: strong secret for signing JWTs (required in production)
- API_ORIGIN: optional; set to your frontend origin to restrict CORS (e.g. https://app.example.com)
- NODE_ENV: set to 'production' in production to enable secure cookies
- COOKIE_SECURE: set to 'true' to force secure cookies even if NODE_ENV not 'production'
- PORT: optional port (default 3000)

The server includes basic hardening:
- helmet() middleware
- rate-limiting on /api/login and /api/refresh
- Joi input validation for sensitive endpoints
- refresh token cookie uses HttpOnly, SameSite=Lax and Secure (when enabled)

For production: run behind HTTPS and set JWT_SECRET and NODE_ENV=production.
