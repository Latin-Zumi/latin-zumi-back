export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Latin Zumi API',
    version: '1.0.0',
    description: 'Documentación de los endpoints de Latin Zumi.',
  },
  paths: {
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
            schema: { type: 'string', format: 'uuid' },
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
