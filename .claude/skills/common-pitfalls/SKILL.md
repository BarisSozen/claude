---
name: common-pitfalls
description: Prevents common development pitfalls learned from production issues. Covers TanStack Query, Drizzle ORM, Express APIs, React patterns, WebSocket, blockchain RPC, and session key security. Auto-triggered during code review.
---

# Common Pitfalls Prevention

This skill captures lessons learned from production issues. Review this before implementing any of these areas.

**65 Production Patterns** organized by category:
- Core Development (1-16)
- Type Safety & Financial (17-18)
- Blockchain Infrastructure (19-22)
- Frontend Patterns (23-29)
- API & Backend (30-35)
- DeFi Trading (36-48)
- Data & Integration (49-59)
- Business Logic (60-65)

## 1. TanStack Query v5 Patterns

### Correct Usage
```typescript
// ✅ CORRECT: Full URL path in queryKey
const { data } = useQuery({
  queryKey: ['/api/strategies', strategyId],
  queryFn: () => api.get(`/api/strategies/${strategyId}`),
});

// ✅ CORRECT: Invalidate after mutation
const mutation = useMutation({
  mutationFn: (data) => api.post('/api/strategies', data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['strategies'] });
  },
});

// ✅ CORRECT: Type responses with schema types
import type { Strategy } from '@shared/schema';
const { data } = useQuery<{ data: Strategy[] }>(...);
```

### Anti-Patterns
```typescript
// ❌ WRONG: Short queryKey
queryKey: ['strategy']  // Won't dedupe properly

// ❌ WRONG: Forgetting to invalidate
onSuccess: () => { navigate('/'); }  // Stale cache!

// ❌ WRONG: Using isLoading for mutations
mutation.isLoading  // Use isPending in v5
```

## 2. Drizzle ORM Patterns

### Critical Rules
```typescript
// ❌ NEVER change primary key types
// serial → varchar or varchar → uuid BREAKS migrations

// ✅ Array columns - correct syntax
allowedTokens: text('allowed_tokens').array()  // CORRECT
// ❌ WRONG: array(text('allowed_tokens'))

// ✅ Always create insert/select types
export type Strategy = typeof strategies.$inferSelect;
export type NewStrategy = typeof strategies.$inferInsert;

// ✅ Use drizzle-zod for validation
import { createInsertSchema } from 'drizzle-zod';
export const insertStrategySchema = createInsertSchema(strategies);
```

### Migration Safety
```bash
# Safe schema sync
npm run db:push

# If data-loss warning and you're sure
npm run db:push --force

# NEVER in production without backup
```

## 3. Express API Conventions

### Route Structure
```typescript
// Public routes
GET  /api/resource          // List
GET  /api/resource/:id      // Get one

// Admin routes (with auth middleware)
POST   /api/admin/resource      // Create (201)
PATCH  /api/admin/resource/:id  // Update (200)
DELETE /api/admin/resource/:id  // Delete (204)

// ✅ Always validate before storage
router.post('/', validateBody(schema), async (req, res) => {
  const validated = req.body; // Already validated by middleware
});
```

### Status Codes
| Operation | Success | Not Found | Invalid |
|-----------|---------|-----------|---------|
| GET | 200 | 404 | 400 |
| POST | 201 | - | 400 |
| PATCH | 200 | 404 | 400 |
| DELETE | 204 | 404 | - |

## 4. Storage Interface Pattern

```typescript
// ✅ Define interface for all storage operations
interface IStorage {
  // Strategies
  getStrategies(): Promise<Strategy[]>;
  getStrategy(id: string): Promise<Strategy | undefined>;
  createStrategy(data: NewStrategy): Promise<Strategy>;
  updateStrategy(id: string, data: Partial<Strategy>): Promise<Strategy | undefined>;
  deleteStrategy(id: string): Promise<boolean>;
}

// ✅ Implement for different backends
class DbStorage implements IStorage { ... }  // PostgreSQL
class MemStorage implements IStorage { ... } // Testing
```

## 5. Blockchain RPC Error Handling

### Critical Patterns
```typescript
// ✅ Wrap ALL contract calls
async function getQuote(tokenIn: Address, tokenOut: Address) {
  try {
    const quote = await quoter.quoteExactInput(...);
    return quote;
  } catch (error) {
    // Low-liquidity tokens WILL fail - this is expected
    console.warn(`Quote failed for ${tokenIn}->${tokenOut}:`, error.message);
    return null; // Continue processing other tokens
  }
}

// ✅ Validate before calling contracts
if (!isAddress(tokenAddress)) {
  throw new Error('Invalid token address');
}

// ✅ Handle "execution reverted" gracefully
if (error.message.includes('execution reverted')) {
  // Pool doesn't exist or insufficient liquidity
  return null;
}

// ✅ Multicall with individual error handling
const results = await multicall({
  contracts: tokens.map(t => ({ ... })),
  allowFailure: true, // CRITICAL
});
results.forEach((result, i) => {
  if (result.status === 'success') {
    // Use result.result
  } else {
    // Log and skip this token
  }
});
```

## 6. WebSocket Patterns

```typescript
// Server
const wss = new WebSocketServer({ server: httpServer }); // Same port

wss.on('connection', (ws) => {
  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // Validate message type
    } catch {
      ws.send(JSON.stringify({ error: 'Invalid message' }));
    }
  });
});

// Heartbeat interval
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Client - reconnection logic
function connect() {
  const ws = new WebSocket(url);
  ws.onclose = () => setTimeout(connect, 1000 * Math.min(attempt++, 30));
}
```

## 7. React Component Patterns

```tsx
// ✅ Define helpers before use or as exports
function formatPrice(price: number) { ... }

export default function Component() {
  // ✅ Check data exists before accessing
  if (!data) return <Loading />;

  // ✅ useEffect for side effects only
  useEffect(() => {
    fetchData();
  }, []);

  // ✅ data-testid on interactive elements
  return <button data-testid="submit-btn">Submit</button>;
}

// ❌ WRONG: Defining function in render
return <button onClick={() => {
  function doSomething() { } // Don't define here
  doSomething();
}}>

// ✅ Navigation with router, not window
import { Link, useLocation } from 'wouter';
<Link to="/dashboard">Go</Link>
// ❌ window.location.href = '/dashboard'
```

## 8. Environment Variables

```typescript
// Frontend (Vite)
const apiUrl = import.meta.env.VITE_API_URL;  // ✅ VITE_ prefix required
// ❌ process.env.API_URL won't work in frontend

// Backend
const dbUrl = process.env.DATABASE_URL;

// ❌ NEVER log secrets
console.log('Config:', config);  // May contain secrets!
// ✅ Log safely
console.log('Config loaded for:', config.environment);
```

## 9. Price Discovery Service

```typescript
// ✅ Try multiple DEXes with fallback
const DEXES = ['uniswapV3', 'uniswapV2', 'curve', 'sushiswap'];

async function getPrice(token: Address): Promise<number | null> {
  for (const dex of DEXES) {
    try {
      const price = await fetchPrice(dex, token);
      if (isValidPrice(price, token)) return price;
    } catch {
      continue; // Try next DEX
    }
  }
  return null;
}

// ✅ Proper quote amounts per token
const QUOTE_AMOUNTS: Record<string, bigint> = {
  WETH: 1n * 10n ** 18n,  // 1 WETH
  WBTC: 1n * 10n ** 8n,   // 1 WBTC
  USDC: 1000n * 10n ** 6n, // 1000 USDC
};

// ✅ Cache with TTL
const priceCache = new Map<string, { price: number; timestamp: number }>();
const CACHE_TTL = 10_000; // 10 seconds
```

## 10. Session Key Security

```typescript
// ❌ NEVER store private keys
localStorage.setItem('privateKey', key);  // CATASTROPHIC

// ✅ Use session keys with limited permissions
interface SessionKey {
  address: Address;
  permissions: Permission[];
  expiresAt: Date;
  maxPerTrade: bigint;
}

// ✅ AES-256-GCM for any stored credentials
import { createCipheriv, randomBytes } from 'crypto';
const iv = randomBytes(16);
const cipher = createCipheriv('aes-256-gcm', key, iv);

// ✅ Audit logging for all key operations
await auditLog.create({
  action: 'SESSION_KEY_CREATED',
  userId,
  metadata: { permissions, expiresAt },
});
```

---

## 11-16. (See sections 1-10 above for core patterns)

---

## 17. TypeScript Type Safety Patterns

```typescript
// ✅ Use strict mode in tsconfig.json
{ "compilerOptions": { "strict": true } }

// ❌ NEVER use 'any'
function process(data: any) { }  // BAD
// ✅ Use 'unknown' and narrow
function process(data: unknown) {
  if (isValidData(data)) { /* now typed */ }
}

// ✅ Infer types from Drizzle schema
type Strategy = typeof strategies.$inferSelect;
type NewStrategy = typeof strategies.$inferInsert;
type StrategyInput = z.infer<typeof strategySchema>;

// ✅ Generic utility types for API responses
type ApiResponse<T> = { success: true; data: T } | { success: false; error: string };

// ✅ Discriminated unions for state machines
type TradeState =
  | { status: 'pending' }
  | { status: 'executing'; txHash: string }
  | { status: 'success'; receipt: Receipt }
  | { status: 'failed'; error: string };

// ✅ Type guards for runtime validation
function isStrategy(obj: unknown): obj is Strategy {
  return typeof obj === 'object' && obj !== null && 'id' in obj;
}
```

## 18. Decimal/BigInt Financial Calculations

```typescript
// ❌ NEVER use JavaScript floats for money
const total = 0.1 + 0.2;  // 0.30000000000000004 - WRONG!

// ✅ Use BigInt for token amounts (always in smallest unit)
const amountWei = 1000000000000000000n;  // 1 ETH in wei
const amountUsdc = 1000000n;  // 1 USDC (6 decimals)

// ✅ Use Decimal.js for price calculations
import Decimal from 'decimal.js';
const price = new Decimal('1234.5678');
const total = price.mul('100').toFixed(2);

// ✅ Format only at display layer
function formatTokenAmount(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals);
}

// ✅ Rounding rules
// - Floor for user benefits (they receive)
// - Ceil for fees (protocol receives)
const userReceives = amount.mul(rate).floor();
const protocolFee = amount.mul(feeRate).ceil();
```

## 19. Gas Estimation & Transaction Building

```typescript
// ✅ Always estimate gas before sending
const gasEstimate = await contract.estimateGas.swap(...args);

// ✅ Add 10-20% buffer to gas estimates
const gasLimit = gasEstimate.mul(120).div(100);  // 20% buffer

// ✅ EIP-1559 gas pricing
const feeData = await provider.getFeeData();
const tx = {
  maxFeePerGas: feeData.maxFeePerGas,
  maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  gasLimit,
};

// ✅ Simulate before execution
try {
  await contract.callStatic.swap(...args);  // Dry run
  const tx = await contract.swap(...args);  // Real execution
} catch (e) {
  // Would revert - don't send
}

// ✅ Handle gas price spikes
if (feeData.maxFeePerGas > MAX_ACCEPTABLE_GAS) {
  throw new Error('Gas too high, waiting...');
}
```

## 20. Multi-Chain Configuration

```typescript
// ✅ Chain-specific configuration
const CHAIN_CONFIG: Record<ChainId, ChainConfig> = {
  ethereum: {
    chainId: 1,
    rpcUrl: process.env.ETHEREUM_RPC_URL,
    blockTime: 12,
    confirmations: 2,
    nativeToken: 'ETH',
    nativeDecimals: 18,  // Always 18 for gas tokens
  },
  polygon: {
    chainId: 137,
    rpcUrl: process.env.POLYGON_RPC_URL,
    blockTime: 2,
    confirmations: 5,  // More confirmations for faster chains
    nativeToken: 'MATIC',
    nativeDecimals: 18,
  },
};

// ✅ Separate RPC clients per chain
const clients: Record<ChainId, PublicClient> = {};
for (const [chain, config] of Object.entries(CHAIN_CONFIG)) {
  clients[chain] = createPublicClient({ transport: http(config.rpcUrl) });
}
```

## 21. Error Boundary & Fallback UI

```tsx
// ✅ Wrap major components in error boundaries
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log to server - detailed info
    logError({ error, componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      // User-friendly message - never show raw stack
      return <ErrorFallback onRetry={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}

// ✅ Graceful degradation
function Dashboard() {
  const { data, error, isLoading } = useQuery(...);

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorCard message="Unable to load data" onRetry={refetch} />;
  if (!data) return <EmptyState />;

  return <DashboardContent data={data} />;
}
```

## 22. Rate Limiting & Retry Logic

```typescript
// ✅ Exponential backoff
async function fetchWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429) {  // Rate limited
        const delay = Math.pow(2, attempt) * 1000;  // 1s, 2s, 4s
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

// ✅ Circuit breaker pattern
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > 30000) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker open');
      }
    }
    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'closed';
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= 5) this.state = 'open';
      throw error;
    }
  }
}

// ✅ Fallback RPC endpoints
const RPC_ENDPOINTS = [
  'https://eth-mainnet.alchemyapi.io/v2/KEY',
  'https://mainnet.infura.io/v3/KEY',
  'https://rpc.ankr.com/eth',
];
```

## 23. Caching Strategies

```typescript
// ✅ Server-side cache for expensive computations
const priceCache = new Map<string, { value: number; expires: number }>();

function getCachedPrice(token: string): number | null {
  const cached = priceCache.get(token);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }
  return null;
}

function setCachedPrice(token: string, value: number, ttlMs = 10000) {
  priceCache.set(token, { value, expires: Date.now() + ttlMs });
}

// ✅ TTL based on data freshness needs
const CACHE_TTL = {
  tokenPrice: 10_000,      // 10s - prices change fast
  poolReserves: 5_000,     // 5s - critical for swaps
  gasPrice: 15_000,        // 15s
  userBalance: 30_000,     // 30s
  tokenMetadata: 3600_000, // 1 hour - rarely changes
};

// ❌ Never cache user-specific sensitive data
cache.set(`user:${userId}:privateKey`, key);  // NEVER!
```

## 24. Logging & Monitoring Patterns

```typescript
// ✅ Structured logging (JSON format)
const logger = {
  info: (message: string, context?: object) => {
    console.log(JSON.stringify({
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      ...context,
    }));
  },
  error: (message: string, error: Error, context?: object) => {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      ...context,
    }));
  },
};

// ✅ Include context
logger.info('Trade executed', {
  userId: 'user123',
  txHash: '0x...',
  chain: 'ethereum',
  profit: '12.34',
});

// ❌ NEVER log secrets
logger.info('Config', { apiKey: process.env.API_KEY });  // NEVER!
```

## 25. Date/Time Handling

```typescript
// ✅ Store all dates in UTC
const createdAt = new Date().toISOString();  // "2024-01-15T10:30:00.000Z"

// ✅ Use date-fns for manipulation
import { format, formatDistanceToNow, parseISO } from 'date-fns';

// ✅ Display in user's local timezone
const displayDate = format(parseISO(createdAt), 'PPpp');  // "Jan 15, 2024, 10:30 AM"

// ✅ Relative time for recent events
const relative = formatDistanceToNow(parseISO(createdAt), { addSuffix: true });
// "5 minutes ago"

// ✅ ISO 8601 for APIs
const apiDate = new Date().toISOString();
```

## 26. Form Validation Patterns

```typescript
// ✅ Zod schemas for all forms
const createStrategySchema = z.object({
  name: z.string().min(1, 'Name required').max(100),
  type: z.enum(['cross-exchange', 'triangular']),
  minProfit: z.number().positive('Must be positive'),
});

// ✅ React Hook Form with Zod
const form = useForm<z.infer<typeof createStrategySchema>>({
  resolver: zodResolver(createStrategySchema),
});

// ✅ Validate on blur and submit
<input {...register('name')} onBlur={() => trigger('name')} />

// ✅ Show errors inline
{errors.name && <span className="text-red-500">{errors.name.message}</span>}

// ✅ Disable submit while validating/submitting
<button disabled={isSubmitting || !isValid}>Submit</button>

// ✅ Server-side validation as backup
router.post('/', validateBody(createStrategySchema), handler);
```

## 27. Optimistic Updates

```typescript
// ✅ Update UI immediately, rollback on error
const mutation = useMutation({
  mutationFn: updateStrategy,
  onMutate: async (newData) => {
    await queryClient.cancelQueries({ queryKey: ['strategy', id] });
    const previous = queryClient.getQueryData(['strategy', id]);

    // Optimistic update
    queryClient.setQueryData(['strategy', id], newData);

    return { previous };
  },
  onError: (err, newData, context) => {
    // Rollback on error
    queryClient.setQueryData(['strategy', id], context.previous);
    toast.error('Update failed');
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['strategy', id] });
  },
});
```

## 28. Responsive Layout Patterns

```css
/* ✅ Mobile-first breakpoints */
.container { padding: 1rem; }

@media (min-width: 768px) {
  .container { padding: 2rem; }
}

/* ✅ Touch-friendly button sizes (min 44px) */
.btn { min-height: 44px; min-width: 44px; }

/* ✅ Horizontal scroll for data tables on mobile */
.table-container { overflow-x: auto; }

/* ✅ Stack columns on mobile */
.grid { display: grid; grid-template-columns: 1fr; }
@media (min-width: 768px) {
  .grid { grid-template-columns: repeat(3, 1fr); }
}
```

## 29. Accessibility (a11y) Basics

```tsx
// ✅ Semantic HTML
<nav>...</nav>
<main>...</main>
<button>Click me</button>  // Not <div onClick>

// ✅ ARIA labels
<button aria-label="Close dialog">×</button>
<input aria-describedby="email-error" />

// ✅ Keyboard navigation
<button onKeyDown={(e) => e.key === 'Enter' && handleClick()}>

// ✅ Focus indicators
button:focus { outline: 2px solid blue; outline-offset: 2px; }

// ✅ Color contrast (WCAG AA: 4.5:1 for text)
// Use tools like axe-core to verify
```

## 30. API Versioning Strategy

```typescript
// ✅ Version in URL path
app.use('/api/v1', v1Routes);
app.use('/api/v2', v2Routes);

// ✅ Deprecation notices
res.setHeader('Deprecation', 'true');
res.setHeader('Sunset', 'Sat, 01 Jun 2025 00:00:00 GMT');

// ✅ Document breaking changes
// CHANGELOG.md
// ## v2.0.0
// - BREAKING: Changed response format for /strategies
```

## 31. Background Job Patterns

```typescript
// ✅ Cleanup on process exit
const intervals: NodeJS.Timeout[] = [];

function startJob(fn: () => void, ms: number) {
  const id = setInterval(fn, ms);
  intervals.push(id);
  return id;
}

process.on('SIGTERM', () => {
  intervals.forEach(clearInterval);
  process.exit(0);
});

// ✅ Handle overlapping executions
let isRunning = false;
async function scanForOpportunities() {
  if (isRunning) return;
  isRunning = true;
  try {
    await scan();
  } finally {
    isRunning = false;
  }
}
```

## 32-36. DEX & Trading Patterns

```typescript
// ✅ Slippage tolerance (default 0.5% = 50 bps)
const slippageBps = 50;
const minAmountOut = amountOut.mul(10000 - slippageBps).div(10000);

// ✅ Deadline for transactions (20 minutes typical)
const deadline = Math.floor(Date.now() / 1000) + 1200;

// ✅ Handle different DEX ABIs
const ROUTER_ABI = {
  uniswapV2: UniswapV2RouterABI,
  uniswapV3: UniswapV3RouterABI,
  curve: CurveRouterABI,
};

// ✅ Calculate price impact
const priceImpact = (reserveIn * amountIn) / (reserveOut * amountOut) - 1;
if (priceImpact > 0.03) {  // >3% impact
  throw new Error('Price impact too high');
}

// ✅ sqrtPriceX96 to human-readable (Uniswap V3)
const price = (sqrtPriceX96 ** 2n * 10n ** 18n) / (2n ** 192n);
```

## 37-40. Oracle & Price Feeds

```typescript
// ✅ Chainlink aggregator with staleness check
const STALENESS_THRESHOLD = 3600;  // 1 hour

async function getChainlinkPrice(feedAddress: Address): Promise<number> {
  const [, answer, , updatedAt] = await priceFeed.latestRoundData();

  if (Date.now() / 1000 - Number(updatedAt) > STALENESS_THRESHOLD) {
    throw new Error('Price feed stale');
  }

  return Number(answer) / 1e8;  // Chainlink uses 8 decimals
}

// ✅ Multiple oracle comparison
const prices = await Promise.all([
  getChainlinkPrice(feed),
  getUniswapTWAP(pool),
  getCoingeckoPrice(tokenId),
]);
const median = prices.sort()[1];
```

## 41-43. Transaction Management

```typescript
// ✅ Wait for confirmations
const receipt = await tx.wait(2);  // 2 confirmations

// ✅ Parse logs from receipt
const logs = receipt.logs.map(log => {
  try {
    return contract.interface.parseLog(log);
  } catch {
    return null;
  }
}).filter(Boolean);

// ✅ Nonce management
class NonceManager {
  private pending = new Map<Address, number>();

  async getNextNonce(address: Address, provider: Provider): Promise<number> {
    const onChain = await provider.getTransactionCount(address, 'pending');
    const local = this.pending.get(address) ?? onChain;
    const next = Math.max(onChain, local);
    this.pending.set(address, next + 1);
    return next;
  }
}
```

## 44-46. Risk & Position Management

```typescript
// ✅ Risk limits
const LIMITS = {
  maxPerTrade: parseUnits('10000', 6),  // $10k
  maxDailyVolume: parseUnits('100000', 6),  // $100k
  maxDrawdown: 0.05,  // 5%
  maxLeverage: 3,
};

// ✅ Position tracking
interface Position {
  entryPrice: Decimal;
  size: bigint;
  unrealizedPnl: Decimal;
  realizedPnl: Decimal;
}

function calculatePnl(position: Position, currentPrice: Decimal): Decimal {
  return currentPrice.sub(position.entryPrice).mul(position.size.toString());
}

// ✅ Circuit breaker
if (dailyLoss > LIMITS.maxDrawdown * portfolioValue) {
  await pauseTrading();
  await notifyAdmin('Circuit breaker triggered');
}
```

## 47-50. Advanced DeFi Patterns

```typescript
// ✅ Flash loan callback
function executeOperation(
  assets: address[],
  amounts: uint256[],
  premiums: uint256[],
  initiator: address,
  params: bytes
) external returns (bool) {
  // Decode params
  const { path, minProfit } = abi.decode(params);

  // Execute arbitrage
  const profit = await executeArbitrage(path);

  // Verify profitability
  require(profit >= minProfit + premiums[0], 'Unprofitable');

  // Repay flash loan
  return true;
}

// ✅ Token approval management
async function ensureApproval(token: Address, spender: Address, amount: bigint) {
  const allowance = await token.allowance(owner, spender);
  if (allowance < amount) {
    await token.approve(spender, MaxUint256);  // Infinite approval
  }
}
```

## 51-53. Cross-Chain & Account Abstraction

```typescript
// ✅ Bridge transaction tracking
interface BridgeTransfer {
  sourceTxHash: string;
  sourceChain: ChainId;
  destChain: ChainId;
  status: 'pending' | 'confirmed' | 'failed';
  destTxHash?: string;
}

// ✅ ERC-4337 UserOperation
const userOp = {
  sender: smartAccount.address,
  nonce: await smartAccount.getNonce(),
  initCode: '0x',
  callData: smartAccount.interface.encodeFunctionData('execute', [...]),
  callGasLimit: 100000n,
  verificationGasLimit: 100000n,
  preVerificationGas: 50000n,
  maxFeePerGas: feeData.maxFeePerGas,
  maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  paymasterAndData: '0x',  // Or paymaster address for gas sponsorship
  signature: '0x',
};
```

## 54-58. Data & Performance

```typescript
// ✅ Database query optimization
// Index frequently filtered columns
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_created ON trades(created_at DESC);

// ✅ Avoid N+1 queries
// ❌ BAD
for (const strategy of strategies) {
  strategy.trades = await db.query('SELECT * FROM trades WHERE strategy_id = ?', [strategy.id]);
}
// ✅ GOOD
const trades = await db.query('SELECT * FROM trades WHERE strategy_id IN (?)', [strategyIds]);
const tradesByStrategy = groupBy(trades, 'strategyId');

// ✅ Cursor-based pagination for real-time data
const { data, nextCursor } = await fetchTrades({ after: cursor, limit: 20 });
```

## 59-65. Business Logic

```typescript
// ✅ Commission calculation (basis points)
const COMMISSION_BPS = 30;  // 0.3%
const commission = tradeAmount.mul(COMMISSION_BPS).div(10000);

// ✅ Audit logging
await auditLog.create({
  action: 'TRADE_EXECUTED',
  userId,
  before: previousState,
  after: newState,
  timestamp: new Date(),
  metadata: { txHash, chain },
});

// ✅ Feature flags
const features = {
  newDashboard: process.env.FEATURE_NEW_DASHBOARD === 'true',
  flashLoans: users.includes(userId),  // Per-user rollout
};

if (features.newDashboard) {
  return <NewDashboard />;
}
```

---

## Quick Reference Checklist

Before submitting code, verify:

### Core
- [ ] TanStack Query keys use full URL paths
- [ ] Mutations invalidate relevant queries
- [ ] Drizzle types exported for all models
- [ ] API routes return correct status codes
- [ ] All RPC calls wrapped in try/catch
- [ ] WebSocket has heartbeat/reconnection
- [ ] React components handle loading/error states
- [ ] No secrets in logs or frontend code

### Type Safety
- [ ] No `any` types - use `unknown` and narrow
- [ ] Types inferred from schema ($inferSelect, z.infer)
- [ ] Type guards for runtime validation

### Financial
- [ ] BigInt for all token amounts
- [ ] Decimal.js for price calculations
- [ ] Proper rounding (floor/ceil)
- [ ] Amounts in smallest unit (wei)

### Blockchain
- [ ] Gas estimation with buffer
- [ ] EIP-1559 gas pricing
- [ ] Transaction simulation before send
- [ ] Nonce management for concurrent txs
- [ ] Confirmations appropriate per chain

### Security
- [ ] Session keys have expiry and limits
- [ ] AES-256-GCM for stored credentials
- [ ] Audit logging for sensitive operations
- [ ] Rate limiting with exponential backoff
- [ ] Circuit breaker for failing services

### UX
- [ ] Error boundaries on major components
- [ ] Loading states for async operations
- [ ] Touch-friendly button sizes (44px)
- [ ] Accessible (ARIA labels, keyboard nav)
