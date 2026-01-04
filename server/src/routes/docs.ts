/**
 * API Documentation Routes
 * OpenAPI/Swagger specification
 */

import { Router } from 'express';

const router = Router();

/**
 * OpenAPI 3.0 Specification
 */
const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'DeFi Bot API',
    description: 'Non-custodial DeFi automation platform API',
    version: '1.0.0',
    contact: {
      name: 'API Support',
    },
    license: {
      name: 'MIT',
    },
  },
  servers: [
    {
      url: '/api',
      description: 'API Server',
    },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication endpoints (SIWE)' },
    { name: 'Delegations', description: 'Session key delegation management' },
    { name: 'Trades', description: 'Trade execution and history' },
    { name: 'Opportunities', description: 'Arbitrage opportunity scanning' },
    { name: 'Executor', description: 'Automated executor management' },
    { name: 'Wallet', description: 'Wallet information and quotes' },
    { name: 'Health', description: 'Service health and metrics' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Session token from SIWE authentication',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string' },
          timestamp: { type: 'number' },
        },
      },
      Address: {
        type: 'string',
        pattern: '^0x[a-fA-F0-9]{40}$',
        example: '0x1234567890123456789012345678901234567890',
      },
      ChainId: {
        type: 'string',
        enum: ['ethereum', 'arbitrum', 'base', 'polygon'],
      },
      DelegationStatus: {
        type: 'string',
        enum: ['active', 'paused', 'revoked', 'expired'],
      },
      TradeAction: {
        type: 'string',
        enum: ['swap', 'supply', 'borrow', 'repay', 'withdraw'],
      },
      Delegation: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          walletAddress: { $ref: '#/components/schemas/Address' },
          sessionKeyAddress: { $ref: '#/components/schemas/Address' },
          chainId: { $ref: '#/components/schemas/ChainId' },
          status: { $ref: '#/components/schemas/DelegationStatus' },
          allowedProtocols: { type: 'array', items: { type: 'string' } },
          allowedTokens: { type: 'array', items: { $ref: '#/components/schemas/Address' } },
          validFrom: { type: 'string', format: 'date-time' },
          validUntil: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateDelegation: {
        type: 'object',
        required: ['walletAddress', 'sessionKeyAddress', 'encryptedSessionKey', 'chainId', 'allowedProtocols', 'allowedTokens', 'validUntil'],
        properties: {
          walletAddress: { $ref: '#/components/schemas/Address' },
          sessionKeyAddress: { $ref: '#/components/schemas/Address' },
          encryptedSessionKey: { type: 'string', minLength: 100 },
          chainId: { $ref: '#/components/schemas/ChainId' },
          allowedProtocols: { type: 'array', items: { type: 'string' }, minItems: 1 },
          allowedTokens: { type: 'array', items: { $ref: '#/components/schemas/Address' }, minItems: 1 },
          validUntil: { type: 'string', format: 'date-time' },
          limits: {
            type: 'object',
            properties: {
              maxPerTrade: { type: 'string' },
              maxDailyVolume: { type: 'string' },
              maxWeeklyVolume: { type: 'string' },
            },
          },
        },
      },
      Trade: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          delegationId: { type: 'string', format: 'uuid' },
          txHash: { type: 'string' },
          chainId: { $ref: '#/components/schemas/ChainId' },
          protocol: { type: 'string' },
          action: { $ref: '#/components/schemas/TradeAction' },
          tokenIn: { $ref: '#/components/schemas/Address' },
          tokenOut: { $ref: '#/components/schemas/Address' },
          amountIn: { type: 'string' },
          amountOut: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'confirmed', 'failed'] },
          profit: { type: 'string' },
          gasUsed: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Opportunity: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['arbitrage', 'liquidation', 'flash_loan'] },
          chainId: { $ref: '#/components/schemas/ChainId' },
          tokenPair: { type: 'string' },
          buyDex: { type: 'string' },
          sellDex: { type: 'string' },
          estimatedProfit: { type: 'string' },
          priceImpact: { type: 'number' },
          status: { type: 'string', enum: ['detected', 'executing', 'executed', 'expired'] },
          detectedAt: { type: 'string', format: 'date-time' },
        },
      },
      HealthStatus: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
          timestamp: { type: 'number' },
          services: {
            type: 'object',
            properties: {
              database: { type: 'boolean' },
              redis: { type: 'boolean' },
              websocket: { type: 'object', properties: { clients: { type: 'number' } } },
            },
          },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: 'Missing or invalid authentication',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      RateLimited: {
        description: 'Rate limit exceeded',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
    },
  },
  paths: {
    '/auth/nonce': {
      post: {
        tags: ['Auth'],
        summary: 'Get SIWE nonce',
        description: 'Generate a nonce for Sign-In With Ethereum authentication',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['walletAddress'],
                properties: {
                  walletAddress: { $ref: '#/components/schemas/Address' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Nonce generated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        nonce: { type: 'string' },
                      },
                    },
                    timestamp: { type: 'number' },
                  },
                },
              },
            },
          },
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/auth/verify': {
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
                  signature: { type: 'string', description: 'Signature of the message' },
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
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        token: { type: 'string' },
                        expiresAt: { type: 'string', format: 'date-time' },
                      },
                    },
                    timestamp: { type: 'number' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout',
        description: 'Invalidate the current session',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Logged out successfully' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/delegations': {
      get: {
        tags: ['Delegations'],
        summary: 'List delegations',
        description: 'Get all delegations for the authenticated user',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'List of delegations',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Delegation' } },
                    timestamp: { type: 'number' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Delegations'],
        summary: 'Create delegation',
        description: 'Create a new session key delegation',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateDelegation' },
            },
          },
        },
        responses: {
          201: {
            description: 'Delegation created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/Delegation' },
                    timestamp: { type: 'number' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/delegations/{id}': {
      get: {
        tags: ['Delegations'],
        summary: 'Get delegation',
        description: 'Get a specific delegation by ID',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'Delegation details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/Delegation' },
                    timestamp: { type: 'number' },
                  },
                },
              },
            },
          },
          404: { description: 'Delegation not found' },
        },
      },
      patch: {
        tags: ['Delegations'],
        summary: 'Update delegation',
        description: 'Update a delegation',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Delegation updated' },
          404: { description: 'Delegation not found' },
        },
      },
      delete: {
        tags: ['Delegations'],
        summary: 'Revoke delegation',
        description: 'Revoke a delegation',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Delegation revoked' },
          404: { description: 'Delegation not found' },
        },
      },
    },
    '/delegations/{id}/pause': {
      post: {
        tags: ['Delegations'],
        summary: 'Pause delegation',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Delegation paused' },
        },
      },
    },
    '/delegations/{id}/resume': {
      post: {
        tags: ['Delegations'],
        summary: 'Resume delegation',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Delegation resumed' },
        },
      },
    },
    '/trades/execute': {
      post: {
        tags: ['Trades'],
        summary: 'Execute trade',
        description: 'Execute a trade using a delegation',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['delegationId', 'action', 'tokenIn', 'tokenOut', 'amountIn'],
                properties: {
                  delegationId: { type: 'string', format: 'uuid' },
                  action: { $ref: '#/components/schemas/TradeAction' },
                  tokenIn: { $ref: '#/components/schemas/Address' },
                  tokenOut: { $ref: '#/components/schemas/Address' },
                  amountIn: { type: 'string' },
                  minAmountOut: { type: 'string' },
                  slippageTolerance: { type: 'number', minimum: 0, maximum: 1 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Trade executed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/Trade' },
                    timestamp: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/trades/history': {
      get: {
        tags: ['Trades'],
        summary: 'Trade history',
        description: 'Get trade history for the authenticated user',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'delegationId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'Trade history',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Trade' } },
                    pagination: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer' },
                        limit: { type: 'integer' },
                        offset: { type: 'integer' },
                      },
                    },
                    timestamp: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/opportunities': {
      get: {
        tags: ['Opportunities'],
        summary: 'List opportunities',
        description: 'Get current arbitrage opportunities',
        responses: {
          200: {
            description: 'List of opportunities',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Opportunity' } },
                    timestamp: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/opportunities/scan': {
      post: {
        tags: ['Opportunities'],
        summary: 'Trigger scan',
        description: 'Manually trigger an opportunity scan',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Scan initiated' },
        },
      },
    },
    '/executor/status': {
      get: {
        tags: ['Executor'],
        summary: 'Executor status',
        description: 'Get the status of the automated executor',
        responses: {
          200: {
            description: 'Executor status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        running: { type: 'boolean' },
                        lastScan: { type: 'string', format: 'date-time' },
                        tradesExecuted: { type: 'integer' },
                        totalProfit: { type: 'string' },
                      },
                    },
                    timestamp: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/wallet/balance': {
      get: {
        tags: ['Wallet'],
        summary: 'Get balances',
        description: 'Get token balances for a wallet',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'chainId', in: 'query', schema: { $ref: '#/components/schemas/ChainId' } },
        ],
        responses: {
          200: { description: 'Wallet balances' },
        },
      },
    },
    '/wallet/quote': {
      get: {
        tags: ['Wallet'],
        summary: 'Get quote',
        description: 'Get a swap quote',
        parameters: [
          { name: 'tokenIn', in: 'query', required: true, schema: { $ref: '#/components/schemas/Address' } },
          { name: 'tokenOut', in: 'query', required: true, schema: { $ref: '#/components/schemas/Address' } },
          { name: 'amountIn', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'chainId', in: 'query', schema: { $ref: '#/components/schemas/ChainId' } },
        ],
        responses: {
          200: { description: 'Quote details' },
        },
      },
    },
  },
};

/**
 * GET /api/docs
 * OpenAPI specification
 */
router.get('/', (req, res) => {
  res.json(openApiSpec);
});

/**
 * GET /api/docs/swagger
 * Swagger UI HTML
 */
router.get('/swagger', (req, res) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>DeFi Bot API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'StandaloneLayout'
    });
  </script>
</body>
</html>
  `;
  res.type('html').send(html);
});

export default router;
