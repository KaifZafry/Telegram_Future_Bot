# Telegram Futures Trading Platform

Reads trade signals from a Telegram group and executes them automatically on
Binance USDⓈ-M Futures, then manages each position until it closes.

```text
Telegram group ──► parse ──► risk checks ──► plan ──► Binance orders ──► position manager
 (your account)                                         SL + split entries   TPs, breakeven, close
```

For a signal like:

```text
Coin #RLC/USDT
Position: LONG
Leverage:  Cross 20×
Entries:  0.8250 - 0.7900
Targets: 🎯 0.8650, 0.9150, 0.9750
Stop Loss: 0.7550
```

the bot:

1. Sets the symbol to **Cross 20x** (leverage is capped by your `maxLeverage`).
2. Places a **close-position stop loss** at 0.7550.
3. Splits the entry range into **3 limit buys** (0.8250 / 0.8075 / 0.7900). Any
   part of the range price has already reached fills at **market**.
4. As entries fill, places **reduce-only take profits** at each target, sized to
   the quantity actually filled (33/33/34% split).
5. When **TP1** fills: cancels the unfilled entries and **moves the SL to breakeven**.
6. When the position closes: cancels leftover orders and records PnL.

It refuses to trade when the message doesn't fully parse, the signal is older
than 2 minutes, price already passed TP1 or the SL, the account already holds
that symbol, or a risk limit is hit. Unfilled entries are cancelled after the
entry timeout, or if price reaches TP1 first.

## Setup

Requirements: Node.js 20+, and MongoDB (local, or a free
[MongoDB Atlas](https://www.mongodb.com/atlas) cluster).

```bash
npm install
cp apps/backend/.env.example apps/backend/.env
```

Then fill in `apps/backend/.env`:

1. **MongoDB**: set `MONGODB_URI`.
2. **Encryption key** for Binance API keys at rest:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   → `CREDENTIALS_ENCRYPTION_KEY`.
3. **Telegram login**: create an app at <https://my.telegram.org> (API development
   tools) and run `npm run telegram:login`. Copy the printed `TELEGRAM_*` lines
   into `.env`. The session string is equivalent to your Telegram password, so
   keep it secret.
4. **Find the group's chat ID**: `npm run telegram:chats` (optionally filter by
   name: `npm run telegram:chats -- vip`).
5. **Configure the bot**: `npm run setup` sets your margin per trade, leverage
   limits and breakeven behaviour, adds the Telegram group, and adds your Binance
   account (keys are verified, then stored encrypted).
6. **Dashboard login**: in `npm run setup`, choose **4) Dashboard password**, and set
   `AUTH_SECRET` in `apps/backend/.env` (same command as the encryption key) so
   logins survive restarts.
7. **Run**: `npm run dev` starts the bot API on <http://localhost:4000> and the
   dashboard on <http://localhost:3000>. Sign in with your setup email and password.

## Dashboard

A live web dashboard (Next.js, `apps/dashboard`) for watching and controlling the bot:

- **Overview**: today and all-time net PnL, unrealized PnL, win rate, equity curve,
  daily PnL, open positions, and a live activity feed. A setup checklist shows
  until the bot is fully configured.
- **Auto-trading switch** and an emergency **Close all** button in the header
  (both ask for confirmation).
- **Signals**: every Telegram message, what it was parsed as, why it was rejected,
  and the orders it created on each account. **Test a signal** previews the exact
  orders a message would place, using live prices, without trading.
- **Positions**: each open trade with a price ladder (SL, entries, average entry,
  mark, TPs), live unrealized PnL, all orders, and a **Close** button.
- **History**: closed, cancelled and failed trades with PnL and close reason; CSV export.
- **Settings**: margin, leverage, entry splitting, timeouts, risk limits and
  symbol lists; add Telegram sources (picked from your chats); add Binance
  accounts (keys verified, then stored encrypted).

Updates stream from the bot over Server-Sent Events, so the pages refresh by
themselves. The dashboard and API must share a site (e.g. `localhost:3000` +
`localhost:4000`, or `app.example.com` + `api.example.com`) for the login cookie to work;
set `DASHBOARD_ORIGIN` (API) and `NEXT_PUBLIC_API_URL` (dashboard) accordingly.

## Testnet first

Start with a **testnet** account (keys from <https://demo.binance.com>, Futures
demo trading → API Management). Live accounts are ignored unless
`BINANCE_ALLOW_LIVE=true`. For live trading, use an API key with **Futures
enabled, withdrawals disabled, and an IP whitelist**, and put the account in
**One-way Mode**.

## Try a signal without trading

```bash
npm run signal:dry-run -- --file signal.txt --margin 10
```

This prints the parsed signal and the exact orders the bot would place, using
live prices. It needs no keys and no database.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Run the bot (API, Telegram listener, position manager) and the dashboard |
| `npm run dev:api` / `npm run dev:dashboard` | Run just one of them |
| `npm run setup` | Interactive settings / Telegram source / Binance account wizard |
| `npm run telegram:login` | Create the Telegram user session |
| `npm run telegram:chats` | List your groups/channels with their chat IDs |
| `npm run signal:dry-run` | Show what a message would trade, without trading |
| `npm test` | Unit tests + full trade lifecycle tests against a simulated exchange |
| `npm run typecheck` / `npm run lint` / `npm run build` | Checks and build |

## Documentation

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the architecture and data model.
