# DeFi/MEV Battle-Tested Expert Skill

**MANDATORY CONSULTATION**: This skill MUST be consulted for ANY DeFi bot development, MEV strategy implementation, or automated trading system. Real-world failures and lessons learned here prevent catastrophic losses.

## Trigger Keywords
- arbitrage, MEV, searcher, bot, automated trading
- backtest, simulation, paper trading
- flash loan, sandwich, frontrun
- slippage, price impact, execution
- reorg, race condition, mempool
- market making, liquidity provision

---

## 1. CRITICAL PITFALL #1: "Arbitrage is Risk-Free" MYTH

**Reality**: Theoretical 0% risk, practical tail risk = DEATH

### Hidden Risks in "Risk-Free" Arbitrage:

```
❌ Execution Risk
- Transaction reverts after gas spent
- Partial fills leave you with unwanted inventory
- Contract bugs in target protocols

❌ Reorg Risk (CRITICAL)
- Your profitable tx can be uncle'd
- 1-2 block reorgs happen DAILY on Ethereum
- Your "profit" disappears, gas cost remains

❌ Gas Spike Risk
- Base fee can 10x mid-execution
- Priority fee auctions drain profits
- Failed tx still costs full gas

❌ Latency Risk
- Block already mined before your tx lands
- State changed between simulation and execution
- Other searchers front-ran you
```

### Real Numbers:
```typescript
// What you see in backtest:
const theoreticalProfit = 0.05; // 5% clean profit

// What actually happens:
const executionCosts = {
  gasOnSuccess: 0.01,      // 1% gas
  failureRate: 0.30,       // 30% of txs fail
  gasOnFailure: 0.01,      // Still pay gas
  reorgRate: 0.02,         // 2% get reorg'd
  slippageSlip: 0.005,     // 0.5% unexpected slippage
};

// Real expected value:
// 0.70 * (0.05 - 0.01) - 0.30 * 0.01 - 0.02 * 0.04 = 0.0238
// 47% of theoretical profit GONE before MEV competition
```

---

## 2. CRITICAL PITFALL #2: Backtest Overconfidence

**80% of bots that fail in production looked great in backtests**

### Why Backtests Lie:

```
❌ Historical State ≠ Future Block State
- You're simulating against KNOWN state
- Live: state changes between blocks
- Mempool competition invisible in historical data

❌ Gas & Latency are Ex-Post Unknowable
- You backtest with actual gas prices
- Live: you must PREDICT gas prices
- Priority fee auctions are adversarial games

❌ Survivorship Bias
- You only see successful historical arbitrages
- Failed attempts not recorded on-chain
- "Found" opportunities may have been contested

❌ Market Impact Ignored
- Your own txs change the market
- Liquidity dries up when you need it most
- Large trades move price against you
```

### Correct Approach:
```typescript
// BAD: Backtest with perfect information
async function badBacktest(historicalData) {
  for (const block of historicalData) {
    const profit = simulateWithPerfectState(block);
    totalProfit += profit;
  }
  return totalProfit; // LIES
}

// GOOD: Block simulation with realistic conditions
async function realisticTest(pendingBlock) {
  // 1. Simulate against PENDING state (not confirmed)
  // 2. Add realistic latency (50-200ms)
  // 3. Assume 30% failure rate
  // 4. Assume 20% of "opportunities" are bait
  // 5. Add gas price uncertainty (±30%)

  const simResult = await simulateOnPendingState(pendingBlock);
  const adjustedProfit = simResult.profit
    * 0.70  // success rate
    * 0.80  // not bait
    - estimatedGas * 1.30; // gas uncertainty

  return adjustedProfit;
}
```

---

## 3. CRITICAL PITFALL #3: AMM ≠ Order Book

**Wrong slippage model = silent bleeding**

### Uniswap V3 Specific Gotchas:

```typescript
// V3 Tick Liquidity is NON-UNIFORM
// Liquidity can be ZERO between ticks!

interface V3Reality {
  // What you expect:
  linearSlippage: false,

  // What actually happens:
  tickCrossing: 'each tick = separate fee payment',
  liquidityGaps: 'can skip ticks with 0 liquidity',
  concentratedLiquidity: 'most liquidity in narrow range',

  // Price impact is STEP FUNCTION not curve:
  // Small trade: 0.01% impact
  // Medium trade: 0.5% impact (crossed tick)
  // Large trade: 5% impact (crossed multiple ticks)
}

// Fee Tier Selection MATTERS ENORMOUSLY
const feeTiers = {
  '0.01%': 'stablecoins only, ultra-tight spread',
  '0.05%': 'correlated pairs (ETH/stETH)',
  '0.30%': 'most pairs, default choice',
  '1.00%': 'exotic pairs, low liquidity',
};

// WRONG: Using 0.3% pool for stablecoin swap
// You're paying 6x more fees than necessary

// WRONG: Using 0.05% pool for volatile pair
// Pool doesn't exist or has no liquidity
```

### Curve-Specific Gotchas:
```typescript
// Curve StableSwap has DIFFERENT math
// A-factor determines curve shape

interface CurveReality {
  amplificationFactor: number, // A = 100 typical

  // Low A: more like constant-product (Uniswap V2)
  // High A: more like constant-sum (1:1 swap)

  // Price impact is MUCH LOWER for stables
  // But MUCH HIGHER at depegs

  depegRisk: 'curve pools can trap you during depegs',
}

// USDC depeg example (March 2023):
// Expected: swap USDC→DAI at 0.99
// Reality: pool drained, 10%+ slippage
```

---

## 4. CRITICAL PITFALL #4: MEV Underestimation

**Public mempool = free alpha donation**

### The MEV Food Chain:
```
Your transaction → Public Mempool → Searchers see it
                                  ↓
              Sandwich Attack (you're the meat)
                                  ↓
                    Your "profit" becomes their profit
```

### Private Orderflow is TABLE STAKES:
```typescript
// If you're not using private submission, you have NO edge

const submissionMethods = {
  // PUBLIC (you will be extracted)
  publicRPC: 'eth_sendRawTransaction', // NEVER for arb

  // PRIVATE (minimum viable)
  flashbotsProtect: 'protect.flashbots.net', // Free, basic
  mevBlocker: 'rpc.mevblocker.io', // Free, good

  // COMPETITIVE (for serious searchers)
  flashbotsBundle: 'relay.flashbots.net', // Bundle submission
  mevShare: 'share MEV with users', // Required for some flow

  // BUILDER DIRECT (advanced)
  builderAPI: 'direct to block builders', // Lowest latency
};
```

### MEV-Share Reality:
```typescript
// New paradigm: users get kickbacks
// Searchers must share profits

interface MEVShareEconomics {
  userShare: '50-90% of MEV',
  searcherShare: '10-50% of MEV',

  // This means:
  // Your arbitrage opportunity is SMALLER
  // Competition is HIGHER
  // Only ultra-efficient searchers survive
}
```

---

## 5. MUST-READ RESOURCES (10 articles = 1 year experience)

### Tier 1: Foundational (READ FIRST)
```
📚 Paradigm Research
- "Liquidity Book" - AMM math from first principles
- "MEV... Wat Do?" - MEV taxonomy
- Every post on research.paradigm.xyz

📚 Flashbots Docs
- "MEV-Share" - orderflow auction design
- "Searching Post-Merge" - new MEV landscape
- docs.flashbots.net (entire site)
```

### Tier 2: Practical Failures (LEARN FROM OTHERS' LOSSES)
```
Search Twitter/X for:
- "post-mortem"
- "we lost money because"
- "unexpected behavior"
- "exploit" + protocol name

Real lessons come from lost money.
```

### Tier 3: Code Study (Skip star count, check content)
```
GitHub search for:
- MEV searcher bots (with reorg handling)
- Uniswap V3 math libraries
- Bundle simulation code

README keywords that indicate quality:
✅ "reorg handling"
✅ "race condition"
✅ "bundle simulation"
✅ "private mempool"

❌ "simple arbitrage"
❌ "guaranteed profit"
❌ "no risk"
```

### Tier 4: Follow These Accounts
```
@bertcmiller - MEV searcher, practical insights
@hasufl - DeFi economics, mechanism design
@samczsun - Security, exploits, real failures
@0xfoobar - Technical MEV, searcher perspective
@barnabe_monnot - PBS, MEV-Boost internals
```

---

## 6. ARCHITECTURE PRINCIPLES (Non-Negotiable)

### Separation of Concerns:
```typescript
// CRITICAL: Execution engine SEPARATE from strategy

class Architecture {
  // Strategy Layer (what to do)
  strategyEngine: {
    findOpportunities(): Opportunity[],
    evaluateRisk(): RiskAssessment,
    calculateSize(): PositionSize,
  };

  // Execution Layer (how to do it)
  executionEngine: {
    buildTransaction(): Transaction,
    simulateBundle(): SimResult,
    submitPrivate(): TxHash,
    handleReorg(): void,
  };

  // Risk Layer (when to stop)
  riskEngine: {
    killSwitch(): void,          // MUST EXIST
    capitalAtRiskLimit(): USD,   // MUST BE SET
    maxLossPerHour(): USD,       // CIRCUIT BREAKER
    maxConsecutiveLosses(): number,
  };
}
```

### Kill Switch Requirements:
```typescript
// NON-NEGOTIABLE: Every bot needs these

interface KillSwitchConfig {
  // Automatic triggers
  maxDrawdown: '5% of capital',
  maxHourlyLoss: '$100',
  maxDailyLoss: '$500',
  consecutiveLosses: 5,
  gasSpike: '10x normal',

  // Manual override
  emergencyStop: 'hardware button or separate process',

  // State preservation
  onKill: 'log state, close positions, notify',
}

// BAD: "I'll add kill switch later"
// GOOD: Kill switch is FIRST feature implemented
```

---

## 7. SIMULATION-FIRST DEVELOPMENT

### Not Paper Trading - Block Simulation:
```typescript
// Paper trading: fake orders against real market
// Block simulation: real orders against simulated state

interface SimulationApproach {
  // Level 1: Unit test math
  testAMMFormulas(): void,
  testSlippageCalc(): void,

  // Level 2: State fork simulation
  forkMainnet(): LocalFork,
  simulateTrade(fork): SimResult,

  // Level 3: Pending block simulation
  getPendingBlock(): Block,
  simulateInPending(): SimResult,

  // Level 4: Bundle simulation
  buildBundle(): Bundle,
  simulateBundle(): BundleSimResult,

  // Level 5: Competition simulation
  assumeCompetitors(): number,
  simulateAuction(): AuctionResult,
}
```

### Foundry/Anvil Fork Testing:
```bash
# Fork mainnet at specific block
anvil --fork-url $ETH_RPC --fork-block-number 18500000

# Run simulation
forge script SimulateArb --rpc-url http://localhost:8545
```

---

## 8. REAL FAILURE MODES (From Production)

### Failure Mode 1: State Staleness
```typescript
// You simulated against block N
// You submit to block N+1
// State changed → tx reverts → gas lost

// Solution:
const maxStateAge = 1; // blocks
const stateCheck = async () => {
  const currentBlock = await getBlockNumber();
  if (currentBlock > simulationBlock + maxStateAge) {
    return ABORT; // Don't submit stale tx
  }
};
```

### Failure Mode 2: Sandwich Bait
```typescript
// "Opportunity" placed by searcher
// You take it → get sandwiched → lose more than "profit"

// Solution:
const isBait = (opportunity) => {
  // Check if opportunity appeared in mempool recently
  // Check if liquidity is suspicious
  // Check if profit is "too good"
  return suspiciousScore > THRESHOLD;
};
```

### Failure Mode 3: Gas Price Prediction
```typescript
// You bid 10 gwei priority fee
// Block lands with 50 gwei minimum
// Your tx not included → opportunity gone

// Solution:
const dynamicGas = async () => {
  const pending = await getPendingBlock();
  const competitorBids = analyzeCompetitorGas(pending);
  const minViableBid = percentile(competitorBids, 80);

  if (minViableBid > profitableThreshold) {
    return SKIP; // Not worth competing
  }
  return minViableBid * 1.1; // Slight overbid
};
```

### Failure Mode 4: Partial Execution
```typescript
// Multi-leg arb: leg 1 executes, leg 2 reverts
// You're stuck with unwanted tokens

// Solution:
const atomicExecution = {
  // All legs in single transaction
  useFlashLoan: true, // Revert entire tx if unprofitable

  // Or: use smart contract that checks final state
  checkInvariant: 'finalBalance >= initialBalance + minProfit',
};
```

---

## 9. CHECKLIST BEFORE GOING LIVE

```
□ Kill switch implemented and tested
□ Capital-at-risk limits set
□ Private mempool submission configured
□ Reorg handling implemented
□ State staleness checks added
□ Gas price prediction tested
□ Failure rate factored into expected value
□ Simulation matches production (within 20%)
□ Logs capture ALL failure modes
□ Alert system for anomalies
□ Manual emergency stop accessible
□ Tested with real money (small amount) for 1 week
```

---

## 10. EXPECTED VALUE CALCULATION (Realistic)

```typescript
// The formula that actually matters:

function realExpectedValue(opportunity: Opportunity): number {
  const {
    grossProfit,
    gasOnSuccess,
    failureRate,
    gasOnFailure,
    reorgRate,
    competitionRate,
    baitRate,
  } = analyzeOpportunity(opportunity);

  // Success case
  const successProfit = grossProfit - gasOnSuccess;
  const successProb = (1 - failureRate) * (1 - reorgRate) * (1 - competitionRate) * (1 - baitRate);

  // Failure cases
  const failureCost = gasOnFailure;
  const failureProb = failureRate;

  const reorgCost = gasOnSuccess; // Already paid gas
  const reorgProb = reorgRate * (1 - failureRate);

  // Expected value
  const EV = (successProb * successProfit)
           - (failureProb * failureCost)
           - (reorgProb * reorgCost);

  // If EV < 0, DO NOT EXECUTE
  // If EV < minThreshold, probably not worth the risk

  return EV;
}

// Example with realistic numbers:
// Gross profit: $100
// Gas (success): $5
// Gas (failure): $5
// Failure rate: 30%
// Reorg rate: 2%
// Competition rate: 50%
// Bait rate: 5%

// Success prob: 0.70 * 0.98 * 0.50 * 0.95 = 0.326
// EV = 0.326 * $95 - 0.30 * $5 - 0.014 * $5 = $29.27

// Your "$100 opportunity" is actually worth ~$29
// And that's BEFORE accounting for your infrastructure costs
```

---

**REMEMBER**: The graveyard of DeFi bots is full of developers who thought they found an edge but didn't account for these realities. Read the post-mortems. Learn from others' losses. The market is adversarial - assume everyone is trying to extract value from you.
