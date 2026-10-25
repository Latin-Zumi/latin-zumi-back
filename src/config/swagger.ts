export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Latin Zumi API',
    version: '1.0.0',
    description: 'Documentación de los endpoints de Latin Zumi.',
  },
  paths: {
    '/accounts/{id}': {
      get: {
        summary: 'Consultar una cuenta',
        operationId: 'getAccount',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Identificador UUID de la cuenta.',
            schema: {
              type: 'string',
              format: 'uuid',
              example: '10000000-0000-4000-8000-000000000001',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Datos y saldo de la cuenta consultada.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  example: {
                    data: {
                      id: '10000000-0000-4000-8000-000000000001',
                      user_id: '20000000-0000-4000-8000-000000000001',
                      currency: 'USD',
                      account_type: 'user',
                      allow_negative: false,
                      balance: '125.00000000',
                    },
                  },
                  properties: {
                    data: {
                      type: 'object',
                      required: [
                        'id',
                        'user_id',
                        'currency',
                        'account_type',
                        'allow_negative',
                        'balance',
                      ],
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        user_id: { type: 'string', format: 'uuid', nullable: true },
                        currency: { type: 'string', example: 'USD' },
                        account_type: { type: 'string', example: 'user' },
                        allow_negative: { type: 'boolean', example: false },
                        balance: {
                          type: 'string',
                          description: 'Saldo decimal serializado como texto.',
                          example: '125.00000000',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'El identificador no es un UUID válido.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string', example: 'ID de cuenta inválido' } },
                },
              },
            },
          },
          '404': {
            description: 'No existe una cuenta con ese identificador.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string', example: 'Cuenta no encontrada' } },
                },
              },
            },
          },
          '500': {
            description: 'Error interno del servidor.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string', example: 'Error interno del servidor' } },
                },
              },
            },
          },
        },
      },
    },
    '/accounts/{id}/balance': {
      get: {
        summary: 'Consultar el saldo de una cuenta',
        operationId: 'getAccountBalance',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Identificador UUID de la cuenta.',
            schema: {
              type: 'string',
              format: 'uuid',
              example: '10000000-0000-4000-8000-000000000001',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Saldo de la cuenta consultada.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      type: 'object',
                      required: ['account_id', 'currency', 'balance'],
                      properties: {
                        account_id: { type: 'string', format: 'uuid' },
                        currency: { type: 'string', example: 'USD' },
                        balance: {
                          type: 'string',
                          description: 'Saldo decimal serializado como texto.',
                          example: '125.00000000',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'El identificador no es un UUID válido.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string', example: 'ID de cuenta inválido' } },
                },
              },
            },
          },
          '404': {
            description: 'No existe una cuenta con ese identificador.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string', example: 'Cuenta no encontrada' } },
                },
              },
            },
          },
          '500': {
            description: 'Error interno del servidor.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string', example: 'Error interno del servidor' } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
