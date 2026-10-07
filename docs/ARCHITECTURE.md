# Architecture

## Phase 1 Scope

Phase 1 establishes the backend foundation only:

- TypeScript strict mode
- Express application structure
- MongoDB and Mongoose connection lifecycle
- Environment variable validation
- Structured logging
- Centralized error handling
- Request validation architecture
- Graceful shutdown
- Security middleware

Telegram integration, Binance Futures execution, WebSockets, Redis, multi-account execution logic, and the dashboard are intentionally deferred.

## Future Data Flow

```text
Telegram
  -> Telegram Listener
  -> Source Verification
  -> Duplicate Protection
  -> Signal Document
  -> Signal Parser
  -> Signal Validator
  -> Risk Engine
  -> Execution Engine
  -> Binance Accounts
  -> Order Monitor
  -> MongoDB
  -> Dashboard
```

## Component Responsibilities

**Telegram** sends trading messages from configured channels or users.

**Signal Listener** will receive Telegram updates and isolate transport-specific concerns from business logic.

**Signal Parser** will convert raw Telegram messages into structured trade signal candidates.

**Signal Validator** will reject incomplete, unsupported, stale, or malformed signals before risk checks.

**Risk Engine** will apply platform, account, symbol, leverage, exposure, and position sizing rules.

**Execution Engine** will coordinate order intent creation and route approved execution plans to one or more exchange accounts.

**Binance Accounts** will represent user-owned Binance Futures accounts. The design must support multiple accounts without binding HTTP controllers directly to exchange logic.

**Order Monitor** will reconcile exchange order state, fills, errors, and position changes after execution.

**MongoDB** stores application state, audit history, configuration metadata, and analytics data.

**Dashboard** will display configuration, signal history, execution state, account status, and analytics.

## Source of Truth

Binance will remain the source of truth for order execution, order status, fills, balances, and positions. MongoDB stores application state, audit history, operational metadata, and analytics data, but it must not be treated as the authoritative exchange ledger.

## Backend Boundaries

HTTP controllers should remain thin and should not contain Telegram or Binance-specific execution logic. Future Telegram and Binance functionality should live in isolated modules and services that can be tested independently and reused by jobs, workers, WebSocket handlers, or API routes.

Multi-account execution should be modeled around exchange account records and service interfaces rather than global singleton clients. This avoids coupling the platform to a single Binance account and keeps future routing, account isolation, credential handling, and audit trails manageable.

## Phase 2 Database Model

Phase 2 adds the production MongoDB entity architecture. It intentionally does not implement Telegram ingestion, Binance API calls, trading execution, or the dashboard.

### Core Entities

**User** owns configuration, Telegram sources, Binance accounts, signals, trades, statistics, and logs.

**BinanceAccount** stores one user-owned Binance Futures account. API credentials are stored only as encrypted fields (`apiKeyEncrypted` and `apiSecretEncrypted`). The encryption boundary is represented by a service abstraction so raw credentials are not persisted or coupled to a hardcoded secret.

**TelegramSource** represents a configured Telegram channel, group, supergroup, or private chat that can produce trading messages for a user.

**Signal** preserves the original Telegram message in `rawText` and stores parsed trade intent: symbol, side, entry type, leverage, stop loss, take-profit targets, parsing state, validation state, and lifecycle status. A unique compound index on `telegramSourceId + telegramMessageId` prevents one Telegram message from creating duplicate signals.

**Trade** represents the normalized trade produced from one validated signal.

**TradeExecution** represents execution of one signal/trade on one Binance account. One signal can produce multiple trade executions because the same signal can be routed to multiple Binance accounts. A unique compound index on `signalId + binanceAccountId` prevents duplicate execution records for the same account.

**Order** stores Binance order state for a trade execution, including exchange order IDs, client order IDs, order type, position side, quantity, price, stop price, reduce-only flag, fill data, status, and realized PnL.

**OrderEvent** stores important Binance order status transitions and raw exchange event payloads for audit and reconciliation.

**BotSettings** stores per-user risk and automation controls such as enabled state, max leverage, max daily loss, max open trades, entry deviation, default risk, default margin, breakeven behavior, and symbol allow/block lists.

**DailyStatistics** stores per-user daily analytics. A unique compound index on `userId + date` ensures one statistics row per user per date.

**SystemLog** stores operational audit events by user, severity level, category, message, metadata, and creation time.

### Entity Relationships

```text
User
  -> BinanceAccount
  -> TelegramSource
  -> BotSettings
  -> DailyStatistics
  -> SystemLog

TelegramSource
      |
      v
Signal
      |
      v
Trade
      |
      v
TradeExecution
      |
      v
Order
      |
      v
OrderEvent
```

`Signal -> TradeExecution` is also indexed through `signalId` because one signal can fan out to multiple Binance accounts. `TradeExecution` is the per-account execution boundary, while `Trade` is the higher-level trade record produced from the signal.

### Validation Boundaries

Mongoose schemas enforce structural validation: required fields, enum values, positive leverage, positive prices, positive quantities, non-negative fees/stat counters, take-profit allocation between 0 and 100, and total take-profit allocation not exceeding 100%.

Directional business rules are kept in the validation service layer:

- LONG take-profit targets must be above entry and stop loss must be below entry.
- SHORT take-profit targets must be below entry and stop loss must be above entry.

This keeps persistence validation predictable while allowing parser, market-price, entry-range, and risk-engine context to evolve without overloading the database schema.

## Phase 3 Telegram Ingestion

Phase 3 adds the Telegram listener boundary only. It receives Telegram Bot API updates, accepts only configured active Telegram sources, prevents duplicate message ingestion, and stores the raw message as a `Signal` document.

It intentionally does not parse trading signals, validate TP/SL business rules, execute trades, call Binance, manage TP/SL orders, or implement dashboard UI.

```text
Telegram
   |
   v
Telegram Listener
   |
   v
Source Verification
   |
   v
Duplicate Protection
   |
   v
Signal Document
   |
   v
parseStatus = PENDING
```

The listener supports text messages and media captions. Unsupported update types, messages without text/captions, and messages from unconfigured or inactive Telegram chats are ignored without creating a signal.

`TelegramSource.chatId` is the source verification key. When a source matches and is active, the raw Telegram message text is stored in `Signal.rawText`, the source is linked through `telegramSourceId`, and the owning user is linked through `userId`.

Initial stored signal state for Phase 3:

- `status = RECEIVED`
- `parseStatus = PENDING`
- `validationStatus = PENDING`

The unique `telegramSourceId + telegramMessageId` index remains the idempotency boundary. If Telegram retries an update, duplicate-key errors are handled as expected duplicate delivery and logged as ignored rather than crashing the listener.

The listener starts in polling mode only when `TELEGRAM_BOT_TOKEN` is configured. If the token is missing in development, the backend still starts and logs a warning. The token is never exposed through routes or logs.

## Phase 4 Signal Execution

Phase 4 connects ingestion to Binance Futures execution and position management.

### Telegram transports

`TELEGRAM_MODE=user` (default) listens as the user's own Telegram account through
MTProto (GramJS), so signals can be read from groups the user is only a member of.
`TELEGRAM_MODE=bot` keeps the Bot API (grammY) listener. Both produce the same
`TelegramUpdate` shape, and chat IDs use the Bot API's marked format, so
`TelegramSource.chatId` works in either mode. A stored signal is handed to the
trading pipeline through the module's `onSignalStored` hook.

### Pipeline (`modules/trading`)

```text
Signal stored -> parse -> age check -> BotSettings risk rules -> tradable accounts
   -> plan (per Binance environment) -> Trade -> executeOnAccount (per account)
```

Risk rules: bot enabled, symbol allow/block lists, daily loss limit, max open
trades per account, live trading switch (`BINANCE_ALLOW_LIVE`). Every rejection is
stored on the Signal (`rejectionReason`) and in `SystemLog`.

### Planning (`binance.planner.ts`)

Pure function from signal + market rules to orders. Position size is fixed margin
(`BotSettings.defaultMargin`) x leverage (signal leverage capped at `maxLeverage`,
else `defaultLeverage`). Entry ranges are split into `entryOrderCount` limit orders
from the near edge; legs price has already reached merge into one market order.
Quantities and prices are rounded to the symbol's step and tick sizes, and the
number of legs shrinks until every order meets the minimum quantity and notional.

### Execution (`binance.executor.ts`)

Per account: require One-way Mode and no existing position or open orders in the
symbol, set margin type and leverage, place the stop loss as a close-position
`STOP_MARKET` through the Algo Order API (`/fapi/v1/algoOrder`, required for
conditional orders since 2025-12-09), then place entries. Client order IDs are
`tfb-<executionId>-<role><n>`, so every exchange order maps back to its execution.

### Position management (`binance.position-manager.ts`)

A reconcile loop (`POSITION_SYNC_INTERVAL_MS`) treats Binance as the source of
truth. Each sync refreshes stored orders and the position, then:

- no fill yet: cancel on entry timeout, all entries gone, or price reaching TP1/SL;
- position open: guarantee a stop loss exists (or close at market if price is
  already past it), resize reduce-only take profits whenever filled entry quantity
  changes, and after the first TP cancel remaining entries and move the stop to the
  average entry;
- position flat after fills (confirmed on two consecutive syncs): cancel leftovers,
  compute realized PnL and fees from account trades, close the execution, update
  `Trade`, `Signal`, and `DailyStatistics`.

Because each sync reads the exchange, missed ticks and restarts self-heal.

## Phase 5 Dashboard

`apps/dashboard` is a Next.js (App Router) client that talks to the backend API
with `credentials: "include"`; it holds no secrets and no server-side data access.

### API (`apps/backend/src/routes/index.ts`)

- **Auth**: single owner. Passwords are scrypt hashes (set via `npm run setup`).
  Login sets an httpOnly, SameSite=Lax cookie holding an HMAC-signed session
  (`AUTH_SECRET`, 7 days). `requireAuth` guards every route except health and login.
  CORS allows only `DASHBOARD_ORIGIN`, with credentials.
- **Reads**: summary, daily stats series, logs, signals (cursor-paginated) and
  signal detail with per-account orders, open positions, trade history.
- **Writes**: settings (Zod-validated), Telegram sources, Binance accounts
  (credentials verified against Binance before being encrypted and stored),
  signal preview, manual close and close-all.

### Live updates

`services/eventBus.ts` is an in-process emitter. `writeSystemLog` publishes every
audit entry, and the position manager publishes a `positions` tick after each sync
and after manual closes. `GET /api/events` streams these as Server-Sent Events
(compression is disabled for that route); the dashboard invalidates the matching
React Query caches, so views refetch only when something changed.

### Manual close

`PositionManager.closeExecution` sets `manualCloseRequested`, then runs the normal
sync: cancel every bot order for the trade, market-close the position, and let the
usual zero-position confirmation finalize it with `closeReason = MANUAL`. All work
on one execution is serialized (`runExclusive`), so a dashboard close never races
the background sync loop. Open executions also record `positionQuantity`,
`markPrice` and `unrealizedPnL` on each sync for live PnL.
