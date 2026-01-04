---
name: defi-registry-manager
description: Manages expansion of tokens, pools, chains, and DEXes across the codebase. Use when adding new tokens, protocols, chains, or updating existing DeFi registry data. Triggers on add token, new coin, add protocol, new DEX, add chain, new network, update address.
---

# DeFi Registry Manager

Manages expansion of tokens, pools, chains, and DEXes across the codebase. Use when adding new tokens, protocols, chains, or updating existing DeFi registry data.

## Trigger Phrases
- "add token", "new token", "add coin"
- "add protocol", "new DEX", "add exchange"
- "add chain", "new network", "support chain"
- "update address", "fix token address"

## Registry Locations

### Tokens - ALL must be updated together:

| File | Purpose | Format |
|------|---------|--------|
| `client/src/constants/protocols.ts` | Frontend token list | `TOKENS[chainId]` array |
| `rust-core/crates/core/src/tokens.rs` | Rust core tokens | `TOKENS` LazyLock HashMap |
| `server/src/services/wallet.ts` | Wallet service tokens | `COMMON_TOKENS` + `TOKEN_SYMBOLS` |
| `shared/schema.ts` | Shared decimals map | `TOKEN_DECIMALS` record |

### Protocols/DEXes:

| File | Purpose |
|------|---------|
| `client/src/constants/protocols.ts` | `PROTOCOLS` array |
| `server/src/services/arbitrage.ts` | `DEXES` array for scanning |
| `server/src/services/price-oracle.ts` | Price oracle adapters |

### Chains:

| File | Purpose |
|------|---------|
| `client/src/constants/protocols.ts` | `CHAINS` array + `ChainId` type |
| `rust-core/crates/core/src/lib.rs` | `ChainId` enum |
| `server/src/config/env.ts` | RPC URLs per chain |
| `shared/schema.ts` | `ChainId` type |

## Adding a New Token - Checklist

```
[ ] 1. Verify token address on block explorer (checksum format)
[ ] 2. Confirm decimals (CRITICAL: USDC/USDT=6, WBTC=8, most=18)
[ ] 3. Update client/src/constants/protocols.ts - TOKENS[chainId]
[ ] 4. Update rust-core/crates/core/src/tokens.rs - chain_tokens.insert()
[ ] 5. Update server/src/services/wallet.ts - COMMON_TOKENS[chainId]
[ ] 6. Update server/src/services/wallet.ts - TOKEN_SYMBOLS (lowercase)
[ ] 7. Update shared/schema.ts - TOKEN_DECIMALS (if not standard 18)
[ ] 8. Run: grep -r "TOKEN_ADDRESS_HERE" to find any hardcoded refs
```

## Token Template

```typescript
// Frontend (protocols.ts)
{
  address: '0x...', // Checksum address
  symbol: 'TOKEN',
  name: 'Token Name',
  decimals: 18,
  chains: ['ethereum'],
}

// Rust (tokens.rs)
tokens.insert("TOKEN", Token::new(
    "0x...".parse().unwrap(),
    "TOKEN", "Token Name", 18, ChainId::Ethereum
));

// Wallet service (wallet.ts) - COMMON_TOKENS
'0x...', // TOKEN

// Wallet service (wallet.ts) - TOKEN_SYMBOLS
'0x...lowercase': 'TOKEN',
```

## Adding a New Protocol/DEX - Checklist

```
[ ] 1. Add to client/src/constants/protocols.ts - PROTOCOLS array
[ ] 2. Add router address to shared/schema.ts - PROTOCOL_ADDRESSES
[ ] 3. Add to server/src/services/arbitrage.ts - DEXES (if scannable)
[ ] 4. Create adapter in server/src/services/price-oracle.ts (if needed)
[ ] 5. Update validation.ts if protocol needs specific validation
```

## Adding a New Chain - Checklist

```
[ ] 1. Add ChainId to shared/schema.ts
[ ] 2. Add ChainId enum variant to rust-core/crates/core/src/lib.rs
[ ] 3. Add to client/src/constants/protocols.ts - CHAINS array
[ ] 4. Add RPC URL to server/src/config/env.ts
[ ] 5. Add chain config to server/src/services/trade-executor.ts
[ ] 6. Add tokens for new chain in all token files
[ ] 7. Add protocol addresses for new chain
```

## Common Token Addresses (Ethereum Mainnet)

| Token | Address | Decimals |
|-------|---------|----------|
| WETH | 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 | 18 |
| USDC | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 | 6 |
| USDT | 0xdAC17F958D2ee523a2206206994597C13D831ec7 | 6 |
| DAI | 0x6B175474E89094C44Da98b954EedeAC495271d0F | 18 |
| WBTC | 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 | 8 |

## Validation Commands

After making changes, run these to verify consistency:

```bash
# Check all files have same token count for a chain
grep -c "ethereum" client/src/constants/protocols.ts
grep -c "Ethereum" rust-core/crates/core/src/tokens.rs

# Verify address consistency
grep -ri "0xA0b86991" --include="*.ts" --include="*.rs"

# Check for typos in addresses
grep -ri "0x6B175474E89094C44Da98b954" --include="*.ts" --include="*.rs"
```

## Critical Rules

1. **ALWAYS verify decimals** - Wrong decimals = catastrophic bugs
2. **Use checksum addresses** - Mixed case for EIP-55 compliance
3. **Update ALL files** - Partial updates cause runtime errors
4. **Test after changes** - Run build for both client and Rust core
5. **Lowercase in TOKEN_SYMBOLS** - Keys must be lowercase addresses
