---
name: common-pitfalls
description: Prevents common development pitfalls learned from production issues. Covers TanStack Query, Drizzle ORM, Express APIs, React patterns, WebSocket, blockchain RPC, and session key security. Auto-triggered during code review.
---

# Common Pitfalls Prevention

This skill captures lessons learned from production issues. Review this before implementing any of these areas.

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

## Quick Reference Checklist

Before submitting code, verify:

- [ ] TanStack Query keys use full URL paths
- [ ] Mutations invalidate relevant queries
- [ ] Drizzle types exported for all models
- [ ] API routes return correct status codes
- [ ] All RPC calls wrapped in try/catch
- [ ] WebSocket has heartbeat/reconnection
- [ ] React components handle loading/error states
- [ ] No secrets in logs or frontend code
- [ ] Prices validated against expected ranges
- [ ] Session keys have expiry and limits
