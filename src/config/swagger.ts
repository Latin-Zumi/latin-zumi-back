const adminPathDocs = {
  '/admin/metrics': { get: { tags: ['admin'], security: [{ bearerAuth: [] }], summary: 'Consultar métricas administrativas', parameters: [{ name: 'period', in: 'query', schema: { type: 'string', enum: ['day','month'] } }], responses: { '200': { description: 'Métricas del periodo.' }, '403': { description: 'Se requiere rol admin.' } } } },
  '/admin/settings': {
    get: { tags: ['admin'], security: [{ bearerAuth: [] }], summary: 'Consultar parámetros', responses: { '200': { description: 'Spread y tasas de interés.' } } },
    patch: { tags: ['admin'], security: [{ bearerAuth: [] }], summary: 'Actualizar parámetros', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { exchange_spread_percent: { type: 'number', minimum: 0, maximum: 10 }, interest_rates: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 50 } } } } } } }, responses: { '200': { description: 'Parámetros actualizados.' }, '400': { description: 'INVALID_SETTINGS.' } } },
  },
  '/admin/settings/history': { get: { tags: ['admin'], security: [{ bearerAuth: [] }], summary: 'Consultar historial de parámetros', responses: { '200': { description: 'Cambios paginados.' } } } },
  '/admin/users': { get: { tags: ['admin'], security: [{ bearerAuth: [] }], summary: 'Listar usuarios', parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }, { name: 'estado', in: 'query', schema: { type: 'string', enum: ['activo','bloqueado'] } }, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } }], responses: { '200': { description: 'Usuarios paginados.' } } } },
  '/admin/users/{id}': {
    get: { tags: ['admin'], security: [{ bearerAuth: [] }], summary: 'Consultar usuario y actividad', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Usuario, saldos y movimientos recientes.' }, '404': { description: 'USER_NOT_FOUND.' } } },
    patch: { tags: ['admin'], security: [{ bearerAuth: [] }], summary: 'Cambiar estado de usuario', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['estado'], properties: { estado: { type: 'string', enum: ['activo','bloqueado'] } } } } } }, responses: { '200': { description: 'Usuario actualizado.' }, '422': { description: 'CANNOT_BLOCK_SELF.' } } },
  },
  '/internal/accrue-interest': { post: { tags: ['admin'], summary: 'Procesar intereses pendientes', parameters: [{ name: 'X-Internal-Secret', in: 'header', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Días procesados y movimientos generados.' }, '401': { description: 'Secreto interno inválido.' } } } },
};

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Latin Zumi API',
    version: '1.0.0',
    description: 'Documentación de los endpoints de Latin Zumi.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'health', description: 'Estado y disponibilidad del servicio.' },
    { name: 'auth', description: 'Registro, sesión y recuperación de acceso.' },
    { name: 'users', description: 'Usuarios y perfiles.' },
    { name: 'wallet', description: 'Wallets, transferencias, depósitos y cambios de moneda.' },
    { name: 'accounts', description: 'Cuentas, saldos e ingresos/retiros.' },
    { name: 'transactions', description: 'Historial del ledger.' },
    { name: 'chat', description: 'Asistente de inteligencia artificial.' },
    { name: 'admin', description: 'Administración de usuarios, parámetros e intereses.' },
  ],
  paths: {
    ...adminPathDocs,
    '/health': {
      get: {
        tags: ['health'],
        summary: 'Comprobar que la API está activa',
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'El proceso de la API está respondiendo.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: {
                    status: { type: 'string', enum: ['ok'], example: 'ok' },
                  },
                  example: { status: 'ok' },
                },
              },
            },
          },
        },
      },
    },
    '/health/ready': {
      get: {
        tags: ['health'],
        summary: 'Comprobar disponibilidad de la API y PostgreSQL',
        operationId: 'getReadiness',
        responses: {
          '200': {
            description: 'La API responde y PostgreSQL acepta consultas.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status', 'db'],
                  properties: {
                    status: { type: 'string', enum: ['ok'], example: 'ok' },
                    db: { type: 'string', enum: ['ok'], example: 'ok' },
                  },
                  example: { status: 'ok', db: 'ok' },
                },
              },
            },
          },
          '503': {
            description: 'La API está activa, pero PostgreSQL no está disponible.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status', 'db'],
                  properties: {
                    status: { type: 'string', enum: ['error'], example: 'error' },
                    db: {
                      type: 'string',
                      enum: ['unavailable'],
                      example: 'unavailable',
                    },
                  },
                  example: { status: 'error', db: 'unavailable' },
                },
              },
            },
          },
        },
      },
    },
    '/chat/messages': {
      post: {
        tags: ['chat'],
        summary: 'Enviar un mensaje al asistente de LATIN ZUMI',
        operationId: 'postChatMessage',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', minLength: 1, maxLength: 2000, example: '¿Cuánto dinero tengo en mis cuentas?' },
                  conversationId: { type: 'string', format: 'uuid', example: 'd4d49d78-1e1d-4f1d-b678-d1f7a4fca5f6' },
                  history: {
                    type: 'array',
                    maxItems: 10,
                    items: {
                      type: 'object',
                      required: ['role', 'content'],
                      properties: {
                        role: { type: 'string', enum: ['user', 'assistant'] },
                        content: { type: 'string', maxLength: 2000 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Respuesta del asistente generada con contexto seguro del usuario.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      type: 'object',
                      required: ['message', 'conversationId', 'suggestions'],
                      properties: {
                        message: { type: 'string' },
                        conversationId: { type: 'string', format: 'uuid' },
                        suggestions: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Payload inválido o mensaje fuera de rango.' },
          '401': { description: 'Se requiere autenticación válida.' },
          '503': { description: 'El servicio del asistente IA no está disponible.' },
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['auth'],
        summary: 'Registrar usuario e iniciar sesión',
        description:
          'Crea usuario, wallet, cuenta inicial y sesión en una transacción. La moneda inicial se deriva del país.',
        operationId: 'register',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['nombre', 'email', 'pais', 'password'],
                properties: {
                  nombre: { type: 'string', minLength: 2, maxLength: 50, example: 'Ana Pérez' },
                  email: { type: 'string', format: 'email', maxLength: 254 },
                  pais: { type: 'string', enum: ['Argentina', 'Colombia', 'Otro'] },
                  password: { type: 'string', format: 'password', minLength: 8, maxLength: 128 },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Registro completado y sesión creada.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['token', 'user', 'password_change_required'],
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/AuthUser' },
                    password_change_required: { type: 'boolean', example: false },
                  },
                },
              },
            },
          },
          '400': { description: 'Datos de registro inválidos.' },
          '409': { description: 'Email ya registrado.' },
          '429': { description: 'Demasiados intentos; intenta más tarde.' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Iniciar sesión',
        description:
          'Devuelve un token opaco y el usuario. El 403 por cambio de contraseña lo devuelven las rutas protegidas, no este endpoint.',
        operationId: 'login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['identifier', 'password'],
                properties: {
                  identifier: { type: 'string', example: 'usuario.registrado' },
                  password: { type: 'string', format: 'password', maxLength: 128 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'Sesión creada. El token es opaco, se muestra una sola vez y vence en una hora.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['token', 'user', 'password_change_required'],
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/AuthUser' },
                    password_change_required: { type: 'boolean', example: false },
                  },
                  example: {
                    token: '<token-bearer>',
                    user: {
                      id: '20000000-0000-4000-8000-000000000001',
                      nombre: 'Ana Pérez',
                      email: 'ana@example.com',
                      pais: 'Argentina',
                      moneda_preferida: 'ARS',
                      roles: ['user'],
                      estado: 'activo',
                      foto_url: null,
                    },
                    password_change_required: false,
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
    '/auth/google': {
      post: {
        tags: ['auth'],
        summary: 'Iniciar sesión o registrarse con Google',
        description:
          'Verifica un ID token de Firebase con email verificado y proveedor google.com. Vincula por email o crea usuario, wallet y cuenta inicial.',
        operationId: 'loginGoogle',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['idToken'],
                properties: {
                  idToken: { type: 'string', minLength: 20, maxLength: 8192 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Sesión creada para el usuario verificado por Google.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['token', 'user', 'password_change_required'],
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/AuthUser' },
                    password_change_required: { type: 'boolean', example: false },
                  },
                },
              },
            },
          },
          '400': { description: 'Payload de Google inválido.' },
          '401': { description: 'Token inválido, email no verificado o proveedor distinto de Google.' },
          '403': { description: 'La cuenta del usuario no está habilitada.' },
          '409': { description: 'El email está vinculado a otra cuenta de Google.' },
          '429': { description: 'Demasiados intentos; intenta más tarde.' },
          '503': { description: 'El acceso con Google no está configurado.' },
        },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['auth'],
        summary: 'Solicitar recuperación de contraseña',
        description:
          'Genera un token de un solo uso, válido por 30 minutos por defecto, y envía el enlace. Responde con el mismo mensaje exista o no el email.',
        operationId: 'forgotPassword',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email', maxLength: 254, example: 'ana@example.com' },
                },
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Solicitud procesada; no revela si el email está registrado.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['message'],
                  properties: {
                    message: {
                      type: 'string',
                      example: 'Si el email está registrado, te enviamos instrucciones para restablecer la contraseña.',
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Email inválido.' },
          '429': { description: 'Demasiados intentos; intenta más tarde.' },
          '503': { description: 'El envío de correos no está configurado.' },
        },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['auth'],
        summary: 'Restablecer contraseña con token',
        description:
          'Consume el token de un solo uso recibido por correo y actualiza la contraseña; revoca todas las sesiones del usuario.',
        operationId: 'resetPassword',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'password'],
                properties: {
                  token: { type: 'string', minLength: 32, maxLength: 128, description: 'Token recibido por el correo, en base64url.' },
                  password: { type: 'string', format: 'password', minLength: 8, maxLength: 128 },
                },
              },
            },
          },
        },
        responses: {
          '204': { description: 'Contraseña actualizada; las sesiones previas quedaron revocadas.' },
          '400': { description: 'Token vencido, usado o inválido, o contraseña fuera de rango.' },
          '429': { description: 'Demasiados intentos; intenta más tarde.' },
        },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['auth'],
        summary: 'Cambiar contraseña',
        description:
          'Mantiene la sesión actual y revoca las demás. Esta ruta está exenta del bloqueo password_change_required y no devuelve 403 por ese estado.',
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
                    minLength: 8,
                    maxLength: 128,
                  },
                },
              },
            },
          },
        },
        responses: {
          '204': { description: 'Contraseña actualizada; las otras sesiones se revocan.' },
          '400': { description: 'BAD_REQUEST o PASSWORD_UNCHANGED: payload inválido o contraseña igual a la actual.' },
          '401': { description: 'UNAUTHORIZED o INVALID_CURRENT_PASSWORD: sesión inválida o contraseña actual incorrecta.' },
          '409': { description: 'PASSWORD_NOT_SET o CONFLICT: cuenta sin contraseña o cambio concurrente.' },
          '429': { description: 'Demasiados intentos; intenta más tarde.' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['auth'],
        summary: 'Cerrar sesión actual',
        operationId: 'logout',
        security: [{ bearerAuth: [] }],
        responses: {
          '204': { description: 'Sesión revocada.' },
          '401': { description: 'Sesión inválida o vencida.' },
        },
      },
    },
    '/users/lookup': {
      get: {
        tags: ['users'],
        summary: 'Buscar destinatario por email', operationId: 'lookupUser', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'email', in: 'query', required: true, schema: { type: 'string', format: 'email' } }],
        responses: { '200': { description: 'Nombre del usuario encontrado.', content: { 'application/json': { schema: { type: 'object', example: { nombre: 'Mateo Ríos' } } } } }, '400': { description: 'Email inválido.' }, '401': { description: 'Sesión inválida.' }, '404': { description: 'Destinatario no encontrado.' } },
      },
    },
    '/users/me': {
      patch: {
        tags: ['users'],
        summary: 'Completar o actualizar el perfil del usuario autenticado',
        description:
          'Actualiza nombre y país y mantiene alineada la moneda preferida de la wallet con el usuario. No renombra cuentas con saldo.',
        operationId: 'updateMe',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['pais'],
                properties: {
                  nombre: { type: 'string', minLength: 2, maxLength: 50 },
                  pais: { type: 'string', enum: ['Argentina', 'Colombia', 'Otro'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Perfil actualizado.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['user'],
                  properties: {
                    user: { $ref: '#/components/schemas/AuthUser' },
                  },
                },
              },
            },
          },
          '400': { description: 'Datos de perfil inválidos.' },
          '401': { description: 'Se requiere una sesión válida.' },
          '403': { description: 'La sesión debe completar un cambio de contraseña.' },
          '404': { description: 'No se encontró el usuario o su wallet/cuenta.' },
        },
      },
    },
    '/wallet/transfers': {
      post: {
        tags: ['wallet'],
        summary: 'Transferir entre usuarios', operationId: 'transfer', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 200 } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['recipient_email','currency','amount'], properties: { recipient_email: { type: 'string', format: 'email' }, currency: { type: 'string', enum: ['USD','COP','ARS','EUR'] }, amount: { type: 'string', pattern: '^\\d{1,12}(?:\\.\\d{1,2})?$' }, note: { type: 'string', maxLength: 140 } } } } } },
        responses: { '200': { description: 'Transferencia registrada; devuelve movimiento, destinatario y saldos.' }, '400': { description: 'Payload o clave inválidos.' }, '401': { description: 'Sesión inválida.' }, '404': { description: 'Destinatario no encontrado.' }, '409': { description: 'IDEMPOTENCY_CONFLICT: clave idempotente reutilizada.' }, '422': { description: 'Fondos insuficientes, transferencia propia o importe inválido.' }, '503': { description: 'No aplica para transferencias sin conversión.' } },
      },
    },
    '/wallet/deposits': {
      post: {
        tags: ['wallet'],
        summary: 'Registrar un depósito en la wallet',
        description:
          'Acredita un ingreso en la moneda enviada por el usuario autenticado. No hay pasarela: se registra contra la cuenta interna `external`. El depósito es de prueba y no representa una transferencia bancaria.',
        operationId: 'deposit',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 200 }, example: 'deposito-orden-123' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currency', 'amount'],
                properties: {
                  currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] },
                  amount: { type: 'string', pattern: '^\\d{1,12}(?:\\.\\d{1,2})?$', description: 'Importe positivo en la moneda enviada, hasta dos decimales.' },
                },
              },
              example: { currency: 'USD', amount: '100.00' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Depósito registrado o respuesta original de una repetición idempotente.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['transaction', 'source', 'balances'],
                  properties: {
                    transaction: {
                      type: 'object',
                      required: ['id', 'type', 'status', 'currency', 'amount', 'created_at', 'description', 'counterparty', 'exchange'],
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        type: { type: 'string', enum: ['deposit'] },
                        status: { type: 'string', enum: ['completed'] },
                        currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'], description: 'Moneda en la que se acreditó el depósito.' },
                        amount: { type: 'string' },
                        created_at: { type: 'string', format: 'date-time' },
                        description: { type: 'string' },
                        counterparty: { type: 'object', nullable: true, properties: { nombre: { type: 'string' }, email: { type: 'string', format: 'email' } } },
                        exchange: { type: 'object', nullable: true, properties: { to_currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] }, to_amount: { type: 'string' }, rate: { type: 'string' } } },
                      },
                    },
                    source: {
                      type: 'object',
                      required: ['currency', 'amount', 'rate'],
                      properties: {
                        currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] },
                        amount: { type: 'string' },
                        rate: { type: 'string', description: 'Tasa aplicada; "1" cuando no hay conversión.' },
                      },
                    },
                    balances: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          wallet_id: { type: 'string', format: 'uuid' },
                          currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] },
                          balance: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Payload o Idempotency-Key inválidos.' },
          '401': { description: 'Se requiere una sesión válida.' },
          '403': { description: 'Debes actualizar tu contraseña antes de operar.' },
          '404': { description: 'La wallet no existe o no tiene cuenta para la moneda del depósito.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'La clave idempotente ya se usó con otra solicitud.' },
          '422': { description: 'El importe es inválido o supera el máximo.' },
        },
      },
    },
    '/wallet/rates': {
      get: {
        tags: ['wallet'],
        summary: 'Consultar tasas y costos de la wallet',
        description:
          'Devuelve las tasas de cambio contra USD (sin comisión), el spread de cotización y las tasas de interés por moneda. No persiste cotizaciones.',
        operationId: 'getWalletRates',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Tasas vigentes para las cuatro monedas.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      type: 'object',
                      required: ['base', 'rates', 'observed_at', 'exchange_spread_percent', 'interest_rates'],
                      properties: {
                        base: { type: 'string', enum: ['USD'], example: 'USD' },
                        rates: {
                          type: 'object',
                          required: ['USD', 'ARS', 'COP', 'EUR'],
                          properties: {
                            USD: { type: 'string', example: '1' },
                            ARS: { type: 'string', example: '1450.25' },
                            COP: { type: 'string', example: '4100.5' },
                            EUR: { type: 'string', example: '0.92' },
                          },
                        },
                        observed_at: { type: 'string', format: 'date-time', example: '2026-11-04T18:00:00.000Z' },
                        exchange_spread_percent: { type: 'string', example: '0.00' },
                        interest_rates: {
                          type: 'array',
                          items: {
                            type: 'object',
                            required: ['currency', 'annual_percent'],
                            properties: {
                              currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] },
                              annual_percent: { type: 'string', example: '0.00' },
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
          '401': { description: 'Se requiere una sesión válida.' },
          '403': { description: 'Debes actualizar tu contraseña antes de operar.' },
          '429': { description: 'Demasiadas consultas; intenta más tarde.' },
          '503': { description: 'No hay una tasa vigente disponible.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/wallet/exchange/quote': {
      get: {
        tags: ['wallet'],
        summary: 'Cotizar un cambio de moneda',
        description:
          'Fija la tasa de cambio entre dos monedas distintas durante 60 segundos y devuelve el importe convertido. La cotización queda asociada al titular que la pidió.',
        operationId: 'getExchangeQuote',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'from', in: 'query', required: true, schema: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] }, example: 'ARS' },
          { name: 'to', in: 'query', required: true, schema: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] }, example: 'USD' },
          { name: 'amount', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d{1,12}(?:\\.\\d{1,2})?$' }, example: '100000.00' },
        ],
        responses: {
          '200': {
            description: 'Cotización creada con la tasa fijada y el vencimiento a los 60 segundos.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['quote_id', 'from', 'to', 'from_amount', 'rate', 'to_amount', 'expires_at'],
                  properties: {
                    quote_id: { type: 'string', format: 'uuid' },
                    from: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] },
                    to: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] },
                    from_amount: { type: 'string' },
                    rate: { type: 'string' },
                    to_amount: { type: 'string', description: 'Importe convertido con redondeo HALF_UP a 2 decimales.' },
                    expires_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '400': { description: 'Monedas iguales o importe inválido.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '401': { description: 'Se requiere una sesión válida.' },
          '410': { description: 'La cotización venció.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '422': { description: 'El importe convertido redondea a cero.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '429': { description: 'Demasiadas cotizaciones; intenta más tarde.' },
          '503': { description: 'No hay una tasa vigente disponible.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/wallet/exchanges': {
      post: {
        tags: ['wallet'],
        summary: 'Ejecutar un cambio de moneda con una cotización',
        description:
          'Ejecuta el cambio fijado por la cotización: debita la moneda de origen del usuario y acredita la convertida en la moneda destino, creando la cuenta destino si no existía. La cotización se consume en la misma operación.',
        operationId: 'exchange',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 200 }, example: 'cambio-orden-123' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['quote_id'],
                properties: { quote_id: { type: 'string', format: 'uuid' } },
              },
              example: { quote_id: '40000000-0000-4000-8000-000000000401' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Cambio ejecutado o respuesta original de una repetición idempotente.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['transaction', 'balances'],
                  properties: {
                    transaction: {
                      type: 'object',
                      required: ['id', 'type', 'status', 'currency', 'amount', 'created_at', 'description', 'counterparty', 'exchange'],
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        type: { type: 'string', enum: ['exchange'] },
                        status: { type: 'string', enum: ['completed'] },
                        currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] },
                        amount: { type: 'string' },
                        created_at: { type: 'string', format: 'date-time' },
                        description: { type: 'string' },
                        counterparty: { type: 'object', nullable: true, properties: { nombre: { type: 'string' }, email: { type: 'string', format: 'email' } } },
                        exchange: { type: 'object', required: ['to_currency', 'to_amount', 'rate'], properties: { to_currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] }, to_amount: { type: 'string' }, rate: { type: 'string' } } },
                      },
                    },
                    balances: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          wallet_id: { type: 'string', format: 'uuid' },
                          currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] },
                          balance: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Payload o Idempotency-Key inválidos.' },
          '401': { description: 'Se requiere una sesión válida.' },
          '403': { description: 'Debes actualizar tu contraseña antes de operar.' },
          '404': { description: 'La cotización o la wallet no existen.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'La cotización ya fue usada o la clave idempotente reutilizada.' },
          '410': { description: 'La cotización venció.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '422': { description: 'Fondos insuficientes, importe convertido demasiado pequeño o demasiado grande.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '503': { description: 'No hay una tasa vigente disponible.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/wallet/transactions': {
      get: {
        tags: ['wallet'],
        summary: 'Consultar actividad de la wallet', operationId: 'getWalletTransactions', security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'type', in: 'query', required: false, schema: { type: 'string', enum: ['deposit', 'transfer_sent', 'transfer_received', 'withdrawal', 'exchange', 'interest'] } },
          { name: 'currency', in: 'query', required: false, schema: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] } },
          { name: 'from', in: 'query', required: false, schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', required: false, schema: { type: 'string', format: 'date-time' } },
          { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: { '200': { description: 'Actividad paginada del titular autenticado.' }, '400': { description: 'Filtros inválidos.' }, '401': { description: 'Sesión inválida.' } },
      },
    },
    '/accounts': {
      get: {
        tags: ['accounts'],
        summary: 'Listar las cuentas activas del usuario autenticado',
        operationId: 'getAccounts',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description:
              'Cuentas user activas del titular autenticado. El arreglo está vacío si no tiene cuentas; el saldo de una cuenta sin movimientos es "0".',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  example: {
                    data: [
                      {
                        id: '10000000-0000-4000-8000-000000000001',
                        user_id: '20000000-0000-4000-8000-000000000001',
                        wallet_id: '40000000-0000-4000-8000-000000000001',
                        currency: 'USD',
                        account_type: 'user',
                        allow_negative: false,
                        balance: '325.00000000',
                      },
                      {
                        id: '10000000-0000-4000-8000-000000000005',
                        user_id: '20000000-0000-4000-8000-000000000001',
                        wallet_id: '40000000-0000-4000-8000-000000000001',
                        currency: 'ARS',
                        account_type: 'user',
                        allow_negative: false,
                        balance: '170000.00000000',
                      },
                    ],
                  },
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: [
                          'id',
                          'user_id',
                          'wallet_id',
                          'currency',
                          'account_type',
                          'allow_negative',
                          'balance',
                        ],
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          user_id: { type: 'string', format: 'uuid' },
                          wallet_id: {
                            type: 'string',
                            format: 'uuid',
                            description: 'ID de la wallet lógica a la que pertenece la cuenta.',
                          },
                          currency: {
                            type: 'string',
                            enum: ['USD', 'COP', 'ARS', 'EUR'],
                          },
                          account_type: { type: 'string', example: 'user' },
                          allow_negative: { type: 'boolean', example: false },
                          balance: {
                            type: 'string',
                            description:
                              'Saldo decimal serializado como texto; es "0" cuando la cuenta aún no tiene movimientos.',
                            example: '325.00000000',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'Se requiere una sesión válida.' },
          '403': {
            description: 'Debes actualizar tu contraseña antes de consultar datos.',
          },
          '500': {
            description: 'Error interno del servidor.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    code: {
                      type: 'string',
                      example: 'INTERNAL_ERROR',
                    },
                    message: {
                      type: 'string',
                      example: 'Error interno del servidor',
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
  components: {
    schemas: {
      ErrorResponse: {
        type: 'object',
        required: ['code', 'message'],
        properties: { code: { type: 'string', example: 'INSUFFICIENT_FUNDS' }, message: { type: 'string', example: 'Saldo disponible insuficiente' } },
      },
      AuthUser: {
        type: 'object',
        required: [
          'id',
          'nombre',
          'email',
          'pais',
          'moneda_preferida',
          'roles',
          'estado',
          'foto_url',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          nombre: { type: 'string' },
          email: { type: 'string', format: 'email' },
          pais: {
            type: 'string',
            nullable: true,
            enum: ['Argentina', 'Colombia', 'Otro'],
          },
          moneda_preferida: {
            type: 'string',
            enum: ['USD', 'COP', 'ARS', 'EUR'],
          },
          roles: {
            type: 'array',
            items: { type: 'string' },
            example: ['user'],
          },
          estado: {
            type: 'string',
            enum: ['activo', 'inactivo', 'bloqueado'],
          },
          foto_url: { type: 'string', nullable: true },
        },
      },
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque session token',
      },
    },
  },
} as const;

