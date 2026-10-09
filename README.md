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

## Telegram control bot (optional)

A private bot that sends you trade alerts and lets you control the bot from your phone.

1. In Telegram, open **@BotFather** → `/newbot` → copy the token into
   `TELEGRAM_CONTROL_BOT_TOKEN` in `apps/backend/.env`.
2. Restart the backend, open your new bot and send `/start`. It replies with your
   chat ID; put it in `TELEGRAM_CONTROL_CHAT_ID` and restart again.

It only ever answers that chat. Commands: `/status`, `/positions` (each with a
Close button), `/pnl`, `/pause`, `/resume`, `/panic` (close everything and pause;
asks first). Every trade event (orders placed, TP hit, stop moved, closed with
PnL, rejections, errors) arrives as a message.

**Approve each trade**: turn on *Ask me on Telegram before each trade* in
Settings → Automation. The bot sends the exact orders with Approve / Reject
buttons; no answer within the timeout means no trade. After you approve, the
trade is re-sized at the current price before orders are placed.

## Follow-up messages

With *Follow the group's follow-up messages* on (Settings → Automation, on by
default), the bot acts on instructions the group posts after a signal:

| Message | What the bot does |
|---|---|
| "Close RLC", "#RLC close now", "Exit all" (as a reply) | Cancels the trade's orders and closes at market |
| "Move SL to entry", "SL to breakeven" | Moves the stop to the average entry |
| "New SL 0.8100" | Moves the stop, **only if it reduces risk** |
| "RLC signal cancelled", "Don't enter ETH" | Cancels unfilled entries (the whole trade if nothing filled) |
| An edit of the original signal | New TPs are applied; a new SL only if tighter |
| An incomplete post edited into a full signal | Traded as a new signal |

Safety rules: a message is only treated as a follow-up if it is not a complete
signal; it only affects trades from the **same group**; it must name the coin or
be a Telegram reply to the signal (except "SL to entry" when that group has one
open trade). Info posts like "TP1 hit ✅" are ignored. The Signals page shows
what was done with every follow-up.

## Real-time execution

Each active Binance account keeps a user-data WebSocket open. When Binance
reports a fill, the affected trade is re-synced within about a quarter second
(TPs placed, stop moved to breakeven), instead of waiting for the 5-second
check, which still runs as a safety net.

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
