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

## PumpFun Protocol

### Official Resources
- [pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs) - Official protocol documentation
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
