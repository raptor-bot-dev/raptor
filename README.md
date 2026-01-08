# RAPTOR

Collective MEV Hunting Platform for BSC and Base.

## Structure

```
raptor/
├── apps/
│   ├── bot/           # Telegram bot (Grammy)
│   ├── executor/      # MEV execution engine (ethers.js)
│   └── api/           # Vercel API routes
├── contracts/         # Solidity smart contracts (Foundry)
├── packages/
│   ├── shared/        # Shared types and utilities
│   └── database/      # Supabase migrations and types
```

## Setup

### Prerequisites

- Node.js 20+
- pnpm 8+
- Foundry (for contracts)

### Installation

```bash
# Install dependencies
pnpm install

# Build shared packages
pnpm build

# Copy environment file
cp .env.example .env
# Edit .env with your credentials
```

### Environment Variables

See `.env.example` for required variables:

- `TELEGRAM_BOT_TOKEN` - Telegram Bot API token
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Supabase service role key
- `BSC_RPC_URL` / `BASE_RPC_URL` - RPC endpoints
- `EXECUTOR_PRIVATE_KEY` - Hot wallet private key

### Database Setup

1. Create a new Supabase project
2. Run the migration in `packages/database/migrations/001_initial.sql`
3. Update `.env` with your Supabase credentials

### Running

```bash
# Development - Bot
pnpm --filter @raptor/bot dev

# Development - Executor
pnpm --filter @raptor/executor dev

# Build all
pnpm build
```

### Contracts

```bash
cd contracts

# Install Foundry dependencies
forge install

# Build
forge build

# Test
forge test

# Deploy (example for BSC)
NETWORK=bsc forge script script/Deploy.s.sol --broadcast --rpc-url $BSC_RPC_URL
```

## Architecture

### Telegram Bot
- User registration and authentication
- Deposit/withdraw commands
- Balance and position tracking
- Real-time notifications

### Execution Engine
- Monitors launchpads (four.meme, BasePump)
- Token analysis and scoring
- Automated position management
- Take-profit and stop-loss execution

### Smart Contracts
- `RaptorVault` - Pooled deposit vault
- `ExecutionEngine` - On-chain execution helper
- `TokenAnalyzer` - Token safety checks

## Security

- Hot wallet should hold minimal funds
- All user funds are in the vault contract
- Executor has limited permissions
- Emergency pause functionality

## License

MIT
