/**
 * OpenAPI Specification
 * Auto-generated documentation for DeFi Bot API
 */

import type { OpenAPIV3 } from 'openapi-types';

export const openApiSpec: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'DeFi Trading Automation Bot API',
    version: '1.0.0',
    description: `
# DeFi Trading Automation Bot

A non-custodial DeFi trading automation platform using session key delegation.

## Authentication

All authenticated endpoints require a valid session token obtained via SIWE (Sign-In With Ethereum).
Include the token in the Authorization header:

\`\`\`
Authorization: Bearer <token>
\`\`\`

## Rate Limits

- **Public endpoints**: 100 requests/minute
- **Authenticated endpoints**: 200 requests/minute
- **Trading endpoints**: 60 requests/minute

## WebSocket

Connect to \`/ws\` for real-time updates.
Use subprotocol authentication: \`['defi-bot', 'auth-token-<jwt>']\`
    `,
    contact: {
      name: 'API Support',
      url: 'https://github.com/BarisSozen/claude',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development server',
    },
    {
      url: 'https://api.defi-bot.example.com',
      description: 'Production server',
    },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication endpoints (SIWE)' },
    { name: 'Delegations', description: 'Session key delegation management' },
    { name: 'Trades', description: 'Trade execution and history' },
    { name: 'Opportunities', description: 'Arbitrage opportunity discovery' },
    { name: 'Wallet', description: 'Wallet balances and positions' },
    { name: 'Strategies', description: 'Automated strategy configuration' },
    { name: 'Executor', description: 'Continuous executor control' },
    { name: 'Admin', description: 'System administration' },
    { name: 'Health', description: 'System health and status' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        description: 'Returns system health status including database and Redis connectivity',
        responses: {
          200: {
            description: 'System is healthy',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/HealthResponse',
                },
              },
            },
          },
          503: {
            description: 'System is degraded',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/HealthResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/nonce': {
      get: {
        tags: ['Auth'],
        summary: 'Get SIWE nonce',
        description: 'Get a nonce for Sign-In With Ethereum message',
        parameters: [
          {
            name: 'address',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'Ethereum wallet address',
          },
        ],
        responses: {
          200: {
            description: 'Nonce returned',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    nonce: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/verify': {
      post: {
        tags: ['Auth'],
        summary: 'Verify SIWE signature',
        description: 'Verify the signed SIWE message and create a session',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message', 'signature'],
                properties: {
                  message: { type: 'string', description: 'SIWE message' },
                  signature: { type: 'string', description: 'Signature hex' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Authentication successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string', description: 'JWT session token' },
                    expiresAt: { type: 'string', format: 'date-time' },
                    walletAddress: { type: 'string' },
                  },
                },
              },
            },
          },
          401: { description: 'Invalid signature' },
        },
      },
    },
    '/api/auth/session': {
      get: {
        tags: ['Auth'],
        summary: 'Get current session',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Session details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    userId: { type: 'string' },
                    walletAddress: { type: 'string' },
                    expiresAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          401: { description: 'Not authenticated' },
        },
      },
    },
    '/api/delegations': {
      get: {
        tags: ['Delegations'],
        summary: 'List delegations',
        description: 'Get all session key delegations for the authenticated wallet',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'List of delegations',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Delegation' },
                },
              },
            },
          },
          401: { description: 'Not authenticated' },
        },
      },
      post: {
        tags: ['Delegations'],
        summary: 'Create delegation',
        description: 'Create a new session key delegation with specified permissions',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CreateDelegationRequest',
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Delegation created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Delegation' },
              },
            },
          },
          400: { description: 'Invalid request' },
          401: { description: 'Not authenticated' },
        },
      },
    },
    '/api/delegations/{id}': {
      get: {
        tags: ['Delegations'],
        summary: 'Get delegation',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Delegation details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Delegation' },
              },
            },
          },
          404: { description: 'Delegation not found' },
        },
      },
      delete: {
        tags: ['Delegations'],
        summary: 'Revoke delegation',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Delegation revoked' },
          404: { description: 'Delegation not found' },
        },
      },
    },
    '/api/trades': {
      get: {
        tags: ['Trades'],
        summary: 'List trades',
        description: 'Get trade history for the authenticated wallet',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'delegationId',
            in: 'query',
            schema: { type: 'string' },
          },
          {
            name: 'status',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['pending', 'submitted', 'confirmed', 'failed', 'reverted'],
            },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50, maximum: 200 },
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          200: {
            description: 'List of trades',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    trades: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Trade' },
                    },
                    total: { type: 'integer' },
                    hasMore: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Trades'],
        summary: 'Execute trade',
        description: 'Execute a trade using a session key delegation',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ExecuteTradeRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Trade executed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TradeResult' },
              },
            },
          },
          400: { description: 'Trade validation failed' },
          401: { description: 'Not authenticated' },
        },
      },
    },
    '/api/opportunities': {
      get: {
        tags: ['Opportunities'],
        summary: 'List opportunities',
        description: 'Get current arbitrage opportunities',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'chainId',
            in: 'query',
            schema: { type: 'integer' },
          },
          {
            name: 'minProfitUsd',
            in: 'query',
            schema: { type: 'number', default: 0 },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20 },
          },
        ],
        responses: {
          200: {
            description: 'List of opportunities',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Opportunity' },
                },
              },
            },
          },
        },
      },
    },
    '/api/wallet/balances': {
      get: {
        tags: ['Wallet'],
        summary: 'Get wallet balances',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'chainId',
            in: 'query',
            schema: { type: 'integer' },
          },
        ],
        responses: {
          200: {
            description: 'Token balances',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TokenBalance' },
                },
              },
            },
          },
        },
      },
    },
    '/api/executor/start': {
      post: {
        tags: ['Executor'],
        summary: 'Start executor',
        description: 'Start the continuous trading executor',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['delegationId'],
                properties: {
                  delegationId: { type: 'string' },
                  strategies: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Executor started' },
          400: { description: 'Invalid delegation' },
        },
      },
    },
    '/api/executor/stop': {
      post: {
        tags: ['Executor'],
        summary: 'Stop executor',
        description: 'Stop the continuous trading executor',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Executor stopped' },
        },
      },
    },
    '/api/executor/status': {
      get: {
        tags: ['Executor'],
        summary: 'Get executor status',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Executor status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ExecutorStatus' },
              },
            },
          },
        },
      },
    },
    '/api/admin/metrics': {
      get: {
        tags: ['Admin'],
        summary: 'Get system metrics',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'System metrics',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SystemMetrics' },
              },
            },
          },
          403: { description: 'Admin access required' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtained from /api/auth/verify',
      },
    },
    schemas: {
      HealthResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['healthy', 'degraded'],
          },
          timestamp: { type: 'string', format: 'date-time' },
          services: {
            type: 'object',
            properties: {
              database: { type: 'boolean' },
              redis: { type: 'boolean' },
              rustCore: { type: 'boolean' },
            },
          },
          version: { type: 'string' },
        },
      },
      Delegation: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          walletAddress: { type: 'string' },
          sessionKeyAddress: { type: 'string' },
          chainId: { type: 'integer' },
          allowedProtocols: {
            type: 'array',
            items: { type: 'string' },
          },
          allowedTokens: {
            type: 'array',
            items: { type: 'string' },
          },
          maxTradeAmountUsd: { type: 'number' },
          dailyLimitUsd: { type: 'number' },
          dailyUsedUsd: { type: 'number' },
          expiresAt: { type: 'string', format: 'date-time' },
          status: {
            type: 'string',
            enum: ['active', 'paused', 'expired', 'revoked'],
          },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateDelegationRequest: {
        type: 'object',
        required: ['chainId', 'allowedProtocols', 'maxTradeAmountUsd', 'dailyLimitUsd', 'expiresAt'],
        properties: {
          chainId: { type: 'integer', description: 'Target chain ID (1=Ethereum, 42161=Arbitrum)' },
          allowedProtocols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Allowed protocol identifiers',
          },
          allowedTokens: {
            type: 'array',
            items: { type: 'string' },
            description: 'Allowed token addresses (empty = all)',
          },
          maxTradeAmountUsd: { type: 'number', minimum: 0 },
          dailyLimitUsd: { type: 'number', minimum: 0 },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      Trade: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          delegationId: { type: 'string', format: 'uuid' },
          chainId: { type: 'integer' },
          protocol: { type: 'string' },
          action: { type: 'string' },
          tokenIn: { type: 'string' },
          tokenOut: { type: 'string' },
          amountIn: { type: 'string' },
          amountOut: { type: 'string' },
          txHash: { type: 'string' },
          status: {
            type: 'string',
            enum: ['pending', 'submitted', 'confirmed', 'failed', 'reverted'],
          },
          gasCostWei: { type: 'string' },
          gasCostUsd: { type: 'number' },
          profitUsd: { type: 'number' },
          createdAt: { type: 'string', format: 'date-time' },
          confirmedAt: { type: 'string', format: 'date-time' },
        },
      },
      ExecuteTradeRequest: {
        type: 'object',
        required: ['delegationId', 'protocol', 'action', 'tokenIn', 'tokenOut', 'amountIn'],
        properties: {
          delegationId: { type: 'string', format: 'uuid' },
          protocol: { type: 'string' },
          action: {
            type: 'string',
            enum: ['swap', 'supply', 'borrow', 'repay', 'withdraw'],
          },
          tokenIn: { type: 'string' },
          tokenOut: { type: 'string' },
          amountIn: { type: 'string', description: 'Amount in wei/smallest unit' },
          minAmountOut: { type: 'string' },
          slippageBps: { type: 'integer', default: 50 },
          useFlashbots: { type: 'boolean', default: false },
        },
      },
      TradeResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          tradeId: { type: 'string' },
          txHash: { type: 'string' },
          amountOut: { type: 'string' },
          gasCostWei: { type: 'string' },
          error: { type: 'string' },
        },
      },
      Opportunity: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: {
            type: 'string',
            enum: ['cross-exchange', 'triangular', 'flash-loan'],
          },
          tokenPair: { type: 'string' },
          buyDex: { type: 'string' },
          sellDex: { type: 'string' },
          profitUsd: { type: 'number' },
          profitPercent: { type: 'number' },
          requiredCapitalUsd: { type: 'number' },
          confidence: { type: 'number' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      TokenBalance: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          symbol: { type: 'string' },
          decimals: { type: 'integer' },
          balance: { type: 'string' },
          balanceUsd: { type: 'number' },
        },
      },
      ExecutorStatus: {
        type: 'object',
        properties: {
          running: { type: 'boolean' },
          delegationId: { type: 'string' },
          activeStrategies: {
            type: 'array',
            items: { type: 'string' },
          },
          tradesExecuted: { type: 'integer' },
          profitUsd: { type: 'number' },
          startedAt: { type: 'string', format: 'date-time' },
        },
      },
      SystemMetrics: {
        type: 'object',
        properties: {
          uptime: { type: 'integer' },
          totalTrades: { type: 'integer' },
          totalProfitUsd: { type: 'number' },
          activeDelegations: { type: 'integer' },
          wsConnections: { type: 'integer' },
          rpcLatency: {
            type: 'object',
            additionalProperties: { type: 'number' },
          },
        },
      },
    },
  },
};

/**
 * Get OpenAPI spec as JSON string
 */
export function getOpenApiSpec(): string {
  return JSON.stringify(openApiSpec, null, 2);
}
