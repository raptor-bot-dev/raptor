# Reference_docs.md

Pointers to useful references. Keep this list short.

## In-repo
- C:\RaptorBot\raptor\MUST_READ
- `MUST-READ/DEPLOYMENT.md` (deploy notes)
- `MUST-READCLAUDE.md` (agent rules and constraints)
- `MUST-READ/Architecture.md` (system design)
- `MUST-READ/Changelog.md` (what changed)
- `MUST-READ/Project_status.md` (milestones)
- `MUST-READ/PROMPT.md` (build prompt)
- `MUST-READ/DESIGN.md` (NEW UI and UX Flow)

## External (keep links in code comments or docs if needed)
- Telegram Bot API + grammy docs (message formatting / parse_mode HTML)
- Solscan (tx links)
- Birdeye Solana Charts (mind-based chart link)
- Solana web3.js / @solana/spl-token docs (ATA, token transfers)

## Solana RPC WebSocket
- [Solana WebSocket Methods](https://solana.com/docs/rpc/websocket) - Overview of all WS methods
- [logsSubscribe](https://solana.com/docs/rpc/websocket/logssubscribe) - Subscribe to transaction logs
- [SPL Token Basics](https://spl.solana.com/token) - Token accounts, mints, decimals

## Helius RPC
- [Helius WebSocket Overview](https://www.helius.dev/docs/rpc/websocket) - Endpoint format, stability
- [Helius WebSocket Methods](https://www.helius.dev/docs/api-reference/rpc/websocket-methods) - Method index
- [Helius logsSubscribe](https://www.helius.dev/docs/api-reference/rpc/websocket/logssubscribe) - Includes 10-min inactivity timer + ping guidance
- [Helius RPC Endpoints](https://www.helius.dev/docs/api-reference/endpoints) - HTTP/WSS URLs
- [Helius Enhanced WebSockets](https://www.helius.dev/docs/enhanced-websockets) - Optional enhanced features

**Helius Critical Notes:**
- 10-minute inactivity timer - MUST send pings every 60s (recommend 30s)
- Endpoint format: `wss://mainnet.helius-rpc.com/?api-key=<KEY>`
- logsSubscribe supports only ONE pubkey per call

## Jupiter Aggregator API
- [Jupiter Get Quote](https://dev.jup.ag/docs/swap/get-quote) - Quote endpoint documentation
- [Jupiter API Reference](https://dev.jup.ag/api-reference) - Full API docs (note: check for deprecations)
- [Jupiter Quote Endpoint](https://dev.jup.ag/api-reference/swap/quote) - Detailed quote params

**Jupiter Critical Notes:**
- Endpoint: `https://api.jup.ag/swap/v1/quote`
- Required params: inputMint, outputMint, amount, slippageBps
- `outAmount` is best-case; `otherAmountThreshold` accounts for slippage
- Use `restrictIntermediateTokens=true` for better routes
- Set `maxAccounts=64` for optimal routing

## Anchor Events
- [Anchor Events](https://www.anchor-lang.com/docs/features/events) - Base64 `Program Data:` log decoding
- [Anchor Events Source](https://github.com/coral-xyz/anchor/blob/master/docs/content/docs/features/events.mdx) - Reference implementation

## Supabase/Postgres
- [Supabase DB Overview](https://supabase.com/docs/guides/database/overview) - General database usage
- [Postgres Realtime](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) - Optional cache sync

## PumpFun Protocol

### Official Resources
- [pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs) - Official protocol documentation
- Pinned Pump IDL (vendored): `vendor/pump-public-docs/idl/pump.json` (commit `f0ef005c386adeeb783c27fdcc4ddd9d49b255c5`)
- Program ID: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- Global State: `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`

### Bonding Curve Parameters
- Virtual Token Reserves: ~1.073B tokens
- Virtual SOL Reserves: 30 SOL
- Graduation Threshold: ~85 SOL real reserves
- Fee: 1% on buy and sell

### Key Protocol Updates (2025)
- **August 2025**: Volume accumulator PDAs added (`global_volume_accumulator`, `user_volume_accumulator`)
- **September 2025**: Fee config PDA added (`fee_config` + `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`)
- **Late 2025**: Creator vault PDA added (replaced SysvarRent in account list)
- **November 2025**: Mayhem mode (`create_v2` instruction with `is_mayhem_mode` boolean)
  - BondingCurve struct: 81 -> 82 bytes
  - RAPTOR skips mayhem mode tokens (low quality launches)

### Token Program
- pump.fun uses **Token-2022** (not legacy SPL Token)
- All ATA derivations must use `TOKEN_2022_PROGRAM_ID`

### Third-Party APIs
- [PumpPortal API](https://pumpportal.fun/) - Trading API with Lightning mode
- [Bitquery Pump.fun API](https://docs.bitquery.io/docs/blockchain/Solana/Pumpfun/) - Bonding curve data
- [bloXroute PumpFun API](https://docs.bloxroute.com/solana/trader-api/api-endpoints/pump.fun/swap) - Swap endpoints
