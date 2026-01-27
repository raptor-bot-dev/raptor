# RAPTOR Audit Research Notes

Collected references for TP/SL engine, WS monitoring, and pricing behavior.

## Helius WebSocket (logsSubscribe)
- Source: https://www.helius.dev/docs/api-reference/rpc/websocket/logssubscribe
- Notes:
  - logsSubscribe supports a **single pubkey** filter (Helius doc uses “single Pubkey”).
  - WebSockets have a **10-minute inactivity timer**; docs recommend health checks + pings every minute.
- Impact: keep heartbeat <60s and resubscribe carefully; use one pubkey per subscription.

## Solana RPC WebSocket logsSubscribe
- Source: https://solana.com/docs/rpc/websocket/logssubscribe
- Notes: Confirms standard Solana `logsSubscribe` RPC method and parameters. No conflicts with current use.

## Jupiter Price API v3 (Beta)
- Source: https://dev.jup.ag/docs/price/v3
- Notes:
  - Example endpoint: `https://api.jup.ag/price/v3?ids=<mint1>,<mint2>`
  - `usdPrice` is the primary returned price (per docs snippet).
- Impact: current code uses Jupiter price API v2; consider aligning to v3 for long-term stability.

## Jupiter Swap Quote API
- Source: https://dev.jup.ag/api-reference/swap/quote
- Notes: `slippageBps` and `outAmount` are the key fields; matches current usage.

## Anchor Events (Program Data)
- Source: https://www.anchor-lang.com/docs/features/events
- Notes: Anchor event logs are emitted as base64 `Program Data:` lines.
- Impact: log parsing should ignore non-Anchor logs and safely decode base64.

## pump.fun (Pump Program)
- Source: https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/PUMP_PROGRAM_README.md
- Notes:
  - Bonding curve formula is based on Uniswap V2 and uses **synthetic x/y reserves**.
  - Each coin has a bonding curve PDA derived from `["bonding-curve", mint]`.
  - Global config includes `initial_virtual_token_reserves` and `initial_virtual_sol_reserves`.
  - Program ID: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (mainnet/devnet).
- Impact: confirms how to identify bonding curve accounts and the reserve-based price model.

## PumpSwap (Pump AMM) Pool Accounts
- Source: https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/PUMP_SWAP_README.md
- Notes:
  - Pool PDA seeds: `["pool", index, creator, baseMint, quoteMint]`.
  - `pool_base_token_account` and `pool_quote_token_account` are **ATAs** of the pool account.
  - Canonical pool index for pump fun migration is `0`.
- Impact: reserve-based pricing should subscribe to these pool ATA accounts.

## SPL Token / Token-2022
- Source: https://www.solana-program.com/docs/token-2022
- Notes: Token-2022 is documented as a **separate program** from legacy SPL Token.
- Impact: ATA derivations and token program IDs must use Token-2022 where applicable (pump.fun uses Token-2022).
- Follow-up: need a concrete ATA derivation reference in Token-2022 docs (current static HTML is JS-rendered).

## pump.fun Breaking Changes (Nov 2025)
- Source: https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/README.md
- Notes:
  - New `create_v2` instruction.
  - Bonding curve and pool account size increased (bonding curve 82 bytes, pool 244 bytes).
- Impact: parser must handle create_v2 and new struct sizes (already partially implemented).

## Research Gaps / To Validate
- Jupiter price API coverage for **pre‑graduation** pump.fun tokens (may return 0 or stale).
- Token-2022 ATA derivation canonical reference (docs are JS-rendered; may need GitHub source or SPL Token-2022 spec).
