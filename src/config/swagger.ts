export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Latin Zumi API',
    version: '1.0.0',
    description: 'Documentación de los endpoints de Latin Zumi.',
  },
  paths: {
    '/auth/login': {
      post: {
        summary: 'Iniciar sesión',
        operationId: 'login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['identifier', 'password'],
                properties: {
                  identifier: { type: 'string', example: 'ana.perez' },
                  password: { type: 'string', format: 'password' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Sesión creada. El token se muestra una sola vez.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  example: {
                    data: {
                      access_token: '<token-bearer>',
                      token_type: 'Bearer',
                      expires_at: '2026-10-26T19:00:00.000Z',
                      password_change_required: false,
                    },
                  },
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        access_token: { type: 'string' },
                        token_type: { type: 'string', example: 'Bearer' },
                        expires_at: { type: 'string', format: 'date-time' },
                        password_change_required: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Payload de login inválido.' },
          '401': { description: 'Username/email o contraseña incorrectos.' },
          '429': { description: 'Demasiados intentos; intenta más tarde.' },
        },
      },
    },
    '/auth/change-password': {
      post: {
        summary: 'Cambiar contraseña',
        operationId: 'changePassword',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['current_password', 'new_password'],
                properties: {
                  current_password: { type: 'string', format: 'password' },
                  new_password: {
                    type: 'string',
                    format: 'password',
                    minLength: 15,
                    maxLength: 128,
                  },
                },
              },
            },
          },
        },
        responses: {
          '204': { description: 'Contraseña actualizada; las otras sesiones se revocan.' },
          '400': { description: 'La nueva contraseña debe tener de 15 a 128 caracteres.' },
          '401': { description: 'Sesión inválida o contraseña actual incorrecta.' },
          '403': { description: 'Se requiere cambiar la contraseña antes de consultar datos.' },
        },
      },
    },
    '/auth/logout': {
      post: {
        summary: 'Cerrar sesión actual',
        operationId: 'logout',
        security: [{ bearerAuth: [] }],
        responses: {
          '204': { description: 'Sesión revocada.' },
          '401': { description: 'Sesión inválida o vencida.' },
        },
      },
    },
    '/users': {
      post: {
        summary: 'Registrar usuario y crear su billetera',
        operationId: 'createUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'email', 'password'],
                example: {
                  username: 'ana.perez',
                  email: 'ana@example.com',
                  password: 'una-clave-segura',
                  currency: 'COP',
                },
                properties: {
                  username: {
                    type: 'string',
                    minLength: 3,
                    maxLength: 30,
                    pattern: '^[a-zA-Z0-9._-]+$',
                  },
                  email: { type: 'string', format: 'email', maxLength: 254 },
                  password: {
                    type: 'string',
                    format: 'password',
                    minLength: 15,
                    maxLength: 128,
                  },
                  currency: {
                    type: 'string',
                    minLength: 3,
                    maxLength: 3,
                    default: 'COP',
                    example: 'COP',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Usuario registrado y billetera creada con saldo cero.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  example: {
                    data: {
                      user: {
                        id: '20000000-0000-4000-8000-000000000003',
                        username: 'ana.perez',
                        email: 'ana@example.com',
                      },
                      account: {
                        id: '10000000-0000-4000-8000-000000000003',
                        user_id: '20000000-0000-4000-8000-000000000003',
                        currency: 'COP',
                        account_type: 'user',
                        allow_negative: false,
                        balance: '0',
                      },
                    },
                  },
                  properties: {
                    data: {
                      type: 'object',
                      required: ['user', 'account'],
                      properties: {
                        user: {
                          type: 'object',
                          required: ['id', 'username', 'email'],
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            username: { type: 'string' },
                            email: { type: 'string', format: 'email' },
                          },
                        },
                        account: {
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
                            user_id: { type: 'string', format: 'uuid' },
                            currency: { type: 'string', example: 'COP' },
                            account_type: { type: 'string', example: 'user' },
                            allow_negative: { type: 'boolean', example: false },
                            balance: {
                              type: 'string',
                              description: 'Saldo inicial serializado como texto.',
                              example: '0',
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'El payload de registro no cumple la validación.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Datos de registro inválidos' },
                  },
                },
              },
            },
          },
          '409': {
            description: 'El username o email ya está registrado.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Username o email ya registrado' },
                  },
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
                  properties: {
                    error: { type: 'string', example: 'Error interno del servidor' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/accounts/{id}': {
      get: {
        summary: 'Consultar una cuenta',
        operationId: 'getAccount',
        security: [{ bearerAuth: [] }],
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
            description:
              'Datos y saldo de la cuenta consultada. Si aún no tiene movimientos, el saldo es "0".',
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
                          description:
                            'Saldo decimal serializado como texto; es "0" cuando la cuenta aún no tiene movimientos.',
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
            description: 'La cuenta no existe o no pertenece al titular autenticado.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string', example: 'Cuenta no encontrada' } },
                },
              },
            },
          },
          '401': { description: 'Se requiere un Bearer token válido.' },
          '403': { description: 'Debes actualizar tu contraseña antes de consultar datos.' },
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
        security: [{ bearerAuth: [] }],
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
            description:
              'Saldo de la cuenta consultada. Si aún no tiene movimientos, el saldo es "0".',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  example: {
                    data: {
                      account_id: '10000000-0000-4000-8000-000000000001',
                      currency: 'USD',
                      balance: '125.00000000',
                    },
                  },
                  properties: {
                    data: {
                      type: 'object',
                      required: ['account_id', 'currency', 'balance'],
                      properties: {
                        account_id: { type: 'string', format: 'uuid' },
                        currency: { type: 'string', example: 'USD' },
                        balance: {
                          type: 'string',
                          description:
                            'Saldo decimal serializado como texto; es "0" cuando la cuenta aún no tiene movimientos.',
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
            description: 'La cuenta no existe o no pertenece al titular autenticado.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { error: { type: 'string', example: 'Cuenta no encontrada' } },
                },
              },
            },
          },
          '401': { description: 'Se requiere un Bearer token válido.' },
          '403': { description: 'Debes actualizar tu contraseña antes de consultar datos.' },
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
    '/transactions/{id}': {
      get: {
        summary: 'Consultar una transacción',
        operationId: 'getTransaction',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Identificador UUID de la transacción.',
            schema: {
              type: 'string',
              format: 'uuid',
              example: '30000000-0000-4000-8000-000000000001',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Actividad de la transacción limitada a los asientos del titular autenticado.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  example: {
                    data: {
                      id: '30000000-0000-4000-8000-000000000001',
                      description: 'Depósito de demostración en USD',
                      occurred_at: '2026-01-15T12:00:00.000Z',
                      entries: [
                        {
                          id: '2',
                          account_id: '10000000-0000-4000-8000-000000000001',
                          amount: '125.00000000',
                          direction: 'credit',
                          currency: 'USD',
                          created_at: '2026-01-15T12:00:00.000Z',
                        },
                      ],
                    },
                  },
                  properties: {
                    data: {
                      type: 'object',
                      required: [
                        'id',
                        'description',
                        'occurred_at',
                        'entries',
                      ],
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        description: { type: 'string', nullable: true },
                        occurred_at: { type: 'string', format: 'date-time' },
                        entries: {
                          type: 'array',
                          items: {
                            type: 'object',
                            required: [
                              'id',
                              'account_id',
                              'amount',
                              'direction',
                              'currency',
                              'created_at',
                            ],
                            properties: {
                              id: { type: 'string' },
                              account_id: { type: 'string', format: 'uuid' },
                              amount: {
                                type: 'string',
                                description: 'Importe decimal serializado como texto.',
                                example: '125.00000000',
                              },
                              direction: {
                                type: 'string',
                                enum: ['debit', 'credit'],
                              },
                              currency: { type: 'string', example: 'USD' },
                              created_at: { type: 'string', format: 'date-time' },
                            },
                          },
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
                  properties: {
                    error: { type: 'string', example: 'ID de transacción inválido' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'No existe una transacción con ese identificador.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Transacción no encontrada' },
                  },
                },
              },
            },
          },
          '401': { description: 'Se requiere un Bearer token válido.' },
          '403': { description: 'Debes actualizar tu contraseña antes de consultar datos.' },
          '500': {
            description: 'Error interno del servidor.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Error interno del servidor' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque session token',
      },
    },
  },
} as const;
