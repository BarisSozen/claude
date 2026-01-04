# DeFi Bot - Non-Custodial Trading Automation

A comprehensive non-custodial DeFi automation bot that executes arbitrage, flash loans, and yield strategies on behalf of users using delegated session keys.

## Features

- **Non-Custodial Design**: Your funds stay in your wallet. We use delegated session keys for trading.
- **Multi-DEX Support**: Uniswap V3, Sushiswap, Curve, Balancer integration
- **Arbitrage Strategies**: Cross-exchange and triangular arbitrage detection
- **Flash Loans**: Aave V3 flash loan integration for capital-efficient trades
- **Risk Management**: Circuit breakers, price impact limits, slippage protection
- **Real-time Updates**: WebSocket for live price and opportunity updates
- **Full Audit Trail**: Complete history of all delegations and trades

## Architecture

```
/server          - Node.js backend with TypeScript
  /routes        - REST API endpoints
  /services      - Business logic (delegation, trading, etc.)
  /middleware    - Auth, validation, rate limiting
  /db            - Drizzle ORM schema

/client          - React frontend with TypeScript
  /components    - UI components
  /pages         - Page components
  /hooks         - Custom React hooks
  /store         - Zustand state management

/shared          - Shared TypeScript types
```

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- Docker (optional)

### Using Docker

```bash
# Copy environment file
cp .env.example .env

# Edit .env with your RPC URLs and encryption key

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f
```

### Manual Setup

```bash
# Install server dependencies
cd server
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npm run db:push

# Start server
npm run dev

# In another terminal, install client dependencies
cd client
npm install

# Start client
npm run dev
```

## API Endpoints

### Authentication
- `POST /api/auth/nonce` - Get SIWE nonce
- `POST /api/auth/verify` - Verify signature and create session
- `POST /api/auth/logout` - Invalidate session

### Delegations
- `GET /api/delegations` - List user's delegations
- `POST /api/delegations` - Create new delegation
- `PATCH /api/delegations/:id` - Update delegation
- `DELETE /api/delegations/:id` - Revoke delegation
- `POST /api/delegations/:id/pause` - Pause delegation
- `POST /api/delegations/:id/resume` - Resume delegation

### Trading
- `GET /api/opportunities` - Get current arbitrage opportunities
- `POST /api/opportunities/scan` - Trigger manual scan
- `POST /api/trades/execute` - Execute a trade
- `GET /api/trades/history` - Get trade history

### Executor
- `GET /api/executor/status` - Get executor status
- `POST /api/executor/start` - Start executor
- `POST /api/executor/stop` - Stop executor
- `PATCH /api/executor/config` - Update config

### Wallet
- `GET /api/wallet/balance` - Get wallet balances
- `GET /api/wallet/quote` - Get swap quote
- `GET /api/wallet/eth-price` - Get ETH price

## Security

### Non-Custodial Design
- Session keys are generated client-side
- Private keys are encrypted with AES-256-GCM
- Server only decrypts when executing authorized trades
- Users can revoke delegations at any time

### Authentication
- Sign-In With Ethereum (SIWE)
- Session tokens with expiration
- Rate limiting on all endpoints

### Risk Controls
- Maximum price impact limits
- Daily/weekly volume limits
- Circuit breaker for consecutive losses
- Emergency pause functionality

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| DATABASE_URL | PostgreSQL connection string | Yes |
| REDIS_URL | Redis connection string | Yes |
| ETH_RPC_URL | Ethereum RPC endpoint | Yes |
| ENCRYPTION_KEY | 32-byte hex encryption key | Yes |
| CORS_ORIGIN | Frontend URL for CORS | Yes |

## Testing

```bash
cd server
npm run test
```

## Production Deployment

1. Use dedicated RPC nodes (not public endpoints)
2. Enable SSL/TLS for all connections
3. Set up monitoring with Grafana
4. Configure backup strategy for database
5. Set up alerting for circuit breaker triggers

## License

MIT

## Disclaimer

This software is for educational purposes. Trading cryptocurrencies carries risk. Always understand the risks involved before using any trading automation.
