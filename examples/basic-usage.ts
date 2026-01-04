/**
 * Basic Usage Example
 * Demonstrates how to use the Liquidity Depth Analyzer for MEV trading
 */

import { ethers } from 'ethers';
import {
  LiquidityDepthAnalyzer,
  UniswapV2Adapter,
  UniswapV3Adapter,
  CONFIG_PROFILES,
  AbortReason,
  Token,
} from '../src';

// Common token definitions
const TOKENS: Record<string, Token> = {
  WETH: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    decimals: 18,
  },
  USDC: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6,
  },
  USDT: {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    decimals: 6,
  },
  DAI: {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    symbol: 'DAI',
    decimals: 18,
  },
};

// Pool addresses
const POOLS = {
  WETH_USDC_V2: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc', // Uniswap V2
  WETH_USDC_V3_500: '0x88e6A0c2dDD26FEeb64F039a2c41296FcB3f5640', // Uniswap V3 0.05%
  WETH_USDC_V3_3000: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', // Uniswap V3 0.3%
};

async function main() {
  // Setup provider (replace with your RPC URL)
  const provider = new ethers.JsonRpcProvider(
    process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo'
  );

  // Create analyzer with standard MEV settings
  const analyzer = new LiquidityDepthAnalyzer(CONFIG_PROFILES.standard.getConfig());

  // Register adapters
  analyzer.registerAdapter('uniswap-v2', new UniswapV2Adapter({ provider }));
  analyzer.registerAdapter('uniswap-v3', new UniswapV3Adapter({ provider }));

  console.log('=== Liquidity Depth Analyzer ===\n');
  console.log('Configuration:', analyzer.getConfig());
  console.log();

  // Example 1: Analyze a simple swap
  console.log('--- Example 1: Simple Swap Analysis ---');
  const swapAmount = ethers.parseEther('10'); // 10 WETH

  try {
    const result = await analyzer.analyzeTrade({
      poolAddress: POOLS.WETH_USDC_V2,
      adapterKey: 'uniswap-v2',
      tokenIn: TOKENS.WETH,
      tokenOut: TOKENS.USDC,
      amountIn: swapAmount,
    });

    if (result.shouldExecute) {
      console.log('✅ Trade is viable!');
      console.log(`   Spot Price: ${result.spotPrice.toFixed(4)} USDC/WETH`);
      console.log(`   Effective Price: ${result.effectivePrice.toFixed(4)} USDC/WETH`);
      console.log(`   Price Impact: ${result.slippage.priceImpactBps} bps`);
      console.log(`   Expected Output: ${ethers.formatUnits(result.slippage.estimatedOutput, 6)} USDC`);
      console.log(`   Min Output: ${ethers.formatUnits(result.slippage.minOutput, 6)} USDC`);
      console.log(`   Depth Multiplier: ${result.depthMultiplier.toFixed(2)}x`);
      console.log(`   Confidence: ${result.confidence}%`);
    } else {
      console.log(`❌ Trade aborted: ${result.abortReason}`);
      console.log(`   Reason: ${result.abortMessage}`);
    }
  } catch (error) {
    console.log('Error analyzing trade:', error);
  }
  console.log();

  // Example 2: Quick viability check
  console.log('--- Example 2: Quick Viability Check ---');
  const largeSwap = ethers.parseEther('1000'); // 1000 WETH

  try {
    const viability = await analyzer.quickViabilityCheck({
      poolAddress: POOLS.WETH_USDC_V2,
      adapterKey: 'uniswap-v2',
      tradeSize: largeSwap,
    });

    if (viability.viable) {
      console.log('✅ Large swap is viable for further analysis');
    } else {
      console.log(`❌ Large swap not viable: ${viability.reason}`);
    }
  } catch (error) {
    console.log('Error checking viability:', error);
  }
  console.log();

  // Example 3: MEV opportunity with profit threshold
  console.log('--- Example 3: MEV Opportunity Analysis ---');
  const mevAmount = ethers.parseEther('5');
  const expectedProfit = ethers.parseEther('0.01'); // Expected 0.01 WETH profit

  // Use MEV-specific config
  const mevAnalyzer = new LiquidityDepthAnalyzer(CONFIG_PROFILES.mevSandwich.getConfig());
  mevAnalyzer.registerAdapter('uniswap-v2', new UniswapV2Adapter({ provider }));

  try {
    const mevResult = await mevAnalyzer.analyzeTrade({
      poolAddress: POOLS.WETH_USDC_V2,
      adapterKey: 'uniswap-v2',
      tokenIn: TOKENS.WETH,
      tokenOut: TOKENS.USDC,
      amountIn: mevAmount,
      expectedProfit,
    });

    if (mevResult.shouldExecute) {
      console.log('✅ MEV opportunity is profitable!');
      console.log(`   Estimated Profit: ${ethers.formatEther(mevResult.estimatedProfit || 0n)} WETH`);
      console.log(`   Price Impact: ${mevResult.slippage.priceImpactBps} bps`);
    } else {
      console.log(`❌ MEV opportunity rejected: ${mevResult.abortReason}`);
      if (mevResult.abortReason === AbortReason.LOW_PROFIT) {
        console.log('   Profit does not survive slippage');
      }
    }
  } catch (error) {
    console.log('Error analyzing MEV opportunity:', error);
  }
  console.log();

  // Example 4: Multi-hop route analysis
  console.log('--- Example 4: Multi-hop Route Analysis ---');
  // WETH -> USDC -> DAI route
  const routeResult = await analyzer.analyzeRoute({
    segments: [
      {
        poolAddress: POOLS.WETH_USDC_V2,
        poolType: 0 as any, // UNISWAP_V2
        tokenIn: TOKENS.WETH,
        tokenOut: TOKENS.USDC,
      },
      // Add second hop if needed
    ],
    adapterKeys: ['uniswap-v2'],
    amountIn: ethers.parseEther('1'),
  });

  if (routeResult.shouldExecute) {
    console.log('✅ Route is viable!');
    console.log(`   Total Price Impact: ${routeResult.totalPriceImpactBps} bps`);
    console.log(`   Expected Output: ${routeResult.expectedOutput}`);
    console.log(`   Min Output: ${routeResult.minOutput}`);
  } else {
    console.log(`❌ Route rejected: ${routeResult.abortReason}`);
  }
  console.log();

  // Example 5: Compare different config profiles
  console.log('--- Example 5: Config Profile Comparison ---');
  const profiles = ['conservative', 'standard', 'aggressive'] as const;

  for (const profile of profiles) {
    const config = CONFIG_PROFILES[profile];
    console.log(`${profile.charAt(0).toUpperCase() + profile.slice(1)}:`);
    console.log(`   Max Price Impact: ${config.getConfig().maxPriceImpactBps} bps`);
    console.log(`   Max Slippage: ${config.getConfig().maxSlippageBps} bps`);
    console.log(`   Min Depth Multiplier: ${config.getConfig().minDepthMultiplier}x`);
  }
}

main().catch(console.error);
