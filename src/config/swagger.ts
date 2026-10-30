export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Latin Zumi API',
    version: '1.0.0',
    description: 'Documentación de los endpoints de Latin Zumi.',
  },
  paths: {
    '/health': {
      get: {
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
        summary: 'Buscar destinatario por email', operationId: 'lookupUser', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'email', in: 'query', required: true, schema: { type: 'string', format: 'email' } }],
        responses: { '200': { description: 'Nombre del usuario encontrado.', content: { 'application/json': { schema: { type: 'object', example: { nombre: 'Mateo Ríos' } } } } }, '400': { description: 'Email inválido.' }, '401': { description: 'Sesión inválida.' }, '404': { description: 'Destinatario no encontrado.' } },
      },
    },
    '/users/me': {
      patch: {
        summary: 'Completar o actualizar el perfil del usuario autenticado',
        description:
          'Actualiza nombre y país. Cambia la moneda de wallet/cuenta solo si la wallet no tiene movimientos; de lo contrario conserva la moneda real y alinea moneda_preferida.',
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
          '409': { description: 'PROFILE_CURRENCY_CONFLICT: no se pudo actualizar la moneda de la wallet.' },
        },
      },
    },
    '/wallet/transfers': {
      post: {
        summary: 'Transferir entre usuarios', operationId: 'transfer', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 200 } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['recipient_email','currency','amount'], properties: { recipient_email: { type: 'string', format: 'email' }, currency: { type: 'string', enum: ['USD','COP','ARS','EUR'] }, amount: { type: 'string', pattern: '^\\d{1,12}(?:\\.\\d{1,2})?$' }, note: { type: 'string', maxLength: 140 } } } } } },
        responses: { '200': { description: 'Transferencia registrada; devuelve movimiento, destinatario y saldos.' }, '400': { description: 'Payload o clave inválidos.' }, '401': { description: 'Sesión inválida.' }, '404': { description: 'Destinatario no encontrado.' }, '409': { description: 'IDEMPOTENCY_CONFLICT: clave idempotente reutilizada; TRANSFER_WALLET_STATE_CHANGED: cambió el estado de una wallet; TRANSFER_WALLET_CURRENCY_CHANGED: cambió la moneda destinataria. Reintentá la transferencia en los dos últimos casos.' }, '422': { description: 'Fondos insuficientes, transferencia propia o importe convertido demasiado pequeño.' }, '503': { description: 'Conversión no disponible.' } },
      },
    },
    '/wallet/deposits': {
      post: {
        summary: 'Registrar un depósito en la wallet',
        description:
          'Acredita un ingreso en la moneda principal de la wallet del usuario autenticado. Si la moneda del ingreso difiere de la principal, la conversión usa la tasa vigente. No hay pasarela: se registra contra la cuenta interna `external`. El depósito es de prueba y no representa una transferencia bancaria.',
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
                        currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'], description: 'Moneda principal de la wallet y monto acreditado.' },
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
          '404': { description: 'La wallet no existe o no tiene cuenta para la moneda principal.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'La clave idempotente ya se usó con otra solicitud.' },
          '422': { description: 'El importe convertido redondea a cero o supera el máximo.' },
          '503': { description: 'No hay una tasa de cambio vigente disponible.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/wallet/exchange/quote': {
      get: {
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
        summary: 'Consultar actividad de la wallet', operationId: 'getWalletTransactions', security: [{ bearerAuth: [] }],
        parameters: ['type','currency','from','to','page','limit'].map((name) => ({ name, in: 'query', required: false, schema: { type: name === 'page' || name === 'limit' ? 'integer' : 'string' } })),
        responses: { '200': { description: 'Actividad paginada del titular autenticado.' }, '400': { description: 'Filtros inválidos.' }, '401': { description: 'Sesión inválida.' } },
      },
    },
    '/users': {
      post: {
        deprecated: true,
        summary: 'Legado: crear usuario, wallet y cuenta sin iniciar sesión',
        operationId: 'createUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'email', 'password'],
                example: {
                  username: 'usuario.prueba',
                  email: 'usuario@example.com',
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
                    minLength: 8,
                    maxLength: 128,
                  },
                  currency: {
                    type: 'string',
                    minLength: 3,
                    maxLength: 3,
                    enum: ['USD', 'COP', 'ARS', 'EUR'],
                    default: 'COP',
                    example: 'COP',
                    description: 'Moneda de liquidación inicial de la wallet del usuario.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description:
              'Usuario registrado con una wallet lógica y una cuenta inicial en la moneda de liquidación, con saldo cero.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  example: {
                    data: {
                      user: {
                        id: '20000000-0000-4000-8000-000000000099',
                        username: 'usuario.prueba',
                        email: 'usuario@example.com',
                      },
                      account: {
                        id: '10000000-0000-4000-8000-000000000099',
                        user_id: '20000000-0000-4000-8000-000000000099',
                        currency: 'COP',
                        account_type: 'user',
                        allow_negative: false,
                        balance: '0',
                      },
                      wallet_id: '40000000-0000-4000-8000-000000000099',
                    },
                  },
                  properties: {
                    data: {
                      type: 'object',
                      required: ['user', 'account', 'wallet_id'],
                      properties: {
                        wallet_id: { type: 'string', format: 'uuid', description: 'ID de la wallet lógica, que puede contener cuentas de saldo por moneda.' },
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
                            currency: {
                              type: 'string',
                              enum: ['USD', 'COP', 'ARS', 'EUR'],
                              example: 'COP',
                            },
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
    '/accounts': {
      get: {
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
    '/accounts/{id}': {
      get: {
        summary: 'Consultar una cuenta activa del usuario',
        operationId: 'getAccount',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
              description:
                'Identificador UUID de una cuenta user activa del titular.',
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
                      wallet_id: '40000000-0000-4000-8000-000000000001',
                      currency: 'USD',
                      account_type: 'user',
                      allow_negative: false,
                      balance: '325.00000000',
                    },
                  },
                  properties: {
                    data: {
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
                        user_id: { type: 'string', format: 'uuid', nullable: true },
                        wallet_id: { type: 'string', format: 'uuid' },
                        currency: {
                          type: 'string',
                          enum: ['USD', 'COP', 'ARS', 'EUR'],
                          example: 'USD',
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
      post: {
        summary: 'Registrar un ingreso y convertirlo a la moneda principal de la wallet',
        deprecated: true,
        description:
          'Ruta legada de registro de ingresos con conversión a la moneda principal. Los nuevos consumidores deben usar `POST /wallet/deposits`.',
        operationId: 'createIncoming',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 200 }, example: 'ingreso-externo-123' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['source_currency', 'source_amount'],
                example: { source_currency: 'EUR', source_amount: '100.00' },
                properties: {
                  source_currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'] },
                  source_amount: { type: 'string', pattern: '^\\d{1,12}(?:\\.\\d{1,2})?$' },
                  destination_currency: { type: 'string', enum: ['USD', 'COP', 'ARS', 'EUR'], description: 'Opcional; si se envía debe coincidir con la moneda principal de la wallet.' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Ingreso contabilizado, o respuesta original de una repetición idempotente.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  example: { data: {
                    transaction_id: '30000000-0000-4000-8000-000000000123',
                    wallet_id: '20000000-0000-4000-8000-000000000123',
                    source: { currency: 'EUR', amount: '100.00' },
                    destination: { currency: 'ARS', amount: '123456.78' },
                    rate: '1234.56780000', rate_source: 'exchangeRate-api',
                    rate_observed_at: '2026-10-26T12:00:00.000Z', rounding: 'HALF_UP_2',
                  } },
                },
              },
            },
          },
          '400': { description: 'Payload, cuenta o clave inválidos; destino distinto de la moneda principal.' },
          '401': { description: 'Se requiere un Bearer token válido.' },
          '403': { description: 'Debes actualizar tu contraseña antes de operar.' },
          '404': { description: 'La cuenta no existe o no pertenece al titular autenticado.' },
          '409': { description: 'La clave idempotente ya se usó con otro ingreso.' },
          '422': { description: 'El importe convertido se redondearía a cero.' },
          '503': { description: 'No hay una tasa vigente disponible; puede reintentarse con la misma clave.' },
        },
      },
    },
    '/accounts/{id}/balance': {
      get: {
        summary: 'Consultar el saldo de una cuenta activa',
        operationId: 'getAccountBalance',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
              description:
                'Identificador UUID de una cuenta user activa del titular.',
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
                      wallet_id: '40000000-0000-4000-8000-000000000001',
                      currency: 'USD',
                      balance: '325.00000000',
                    },
                  },
                  properties: {
                    data: {
                      type: 'object',
                      required: ['account_id', 'wallet_id', 'currency', 'balance'],
                      properties: {
                        account_id: { type: 'string', format: 'uuid' },
                        wallet_id: { type: 'string', format: 'uuid', description: 'ID de la wallet lógica, que puede contener cuentas de saldo por moneda.' },
                        currency: {
                          type: 'string',
                          enum: ['USD', 'COP', 'ARS', 'EUR'],
                          example: 'USD',
                        },
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
    '/accounts/{id}/withdraw': {
      post: {
        summary: 'Retirar saldo de la cuenta autenticada',
        operationId: 'withdrawAccount',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              format: 'uuid',
              example: '10000000-0000-4000-8000-000000000001',
            },
          },
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', maxLength: 200 },
            example: 'retiro-orden-123',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount'],
                example: { amount: '50.00' },
                properties: {
                  amount: {
                    type: 'string',
                    pattern: '^\\d{1,12}(?:\\.\\d{1,2})?$',
                    description: 'Importe positivo en la moneda de la cuenta.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Retiro contabilizado o respuesta original de un reintento idempotente.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  example: {
                    data: {
                      transaction_id: '30000000-0000-4000-8000-000000000123',
                      account_id: '10000000-0000-4000-8000-000000000001',
                      amount: { currency: 'USD', amount: '50.00' },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'ID, importe o clave idempotente inválidos.' },
          '401': { description: 'Se requiere una sesión válida.' },
          '403': { description: 'Debes actualizar tu contraseña antes de operar.' },
          '404': { description: 'La cuenta no existe o no pertenece al titular autenticado.' },
          '409': { description: 'La clave idempotente ya se usó con otra solicitud u operación.' },
          '422': { description: 'El saldo disponible es insuficiente.' },
          '500': { description: 'Error interno del servidor.' },
        },
      },
    },
    '/transactions': {
      get: {
        summary: 'Listar el historial del usuario autenticado',
        operationId: 'getTransactions',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'page',
            in: 'query',
            description: 'Número de página, desde 1.',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Cantidad de resultados por página (máximo 100).',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: 'account_id',
            in: 'query',
            description: 'UUID de una cuenta activa del titular autenticado.',
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'from',
            in: 'query',
            description: 'Instante inicial inclusivo de occurred_at (ISO 8601).',
            schema: { type: 'string', format: 'date-time' },
          },
          {
            name: 'to',
            in: 'query',
            description: 'Instante final inclusivo de occurred_at (ISO 8601).',
            schema: { type: 'string', format: 'date-time' },
          },
        ],
        responses: {
          '200': {
            description: 'Página de transacciones y metadatos de paginación.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data', 'meta'],
                  example: {
                    data: [
                      {
                        id: '30000000-0000-4000-8000-000000000101',
                        idempotency_key: 'seed:portfolio:01:usd:movement-1',
                        description: 'Movimiento demo USD 1',
                        occurred_at: '2026-02-01T12:00:00.000Z',
                        entries: [
                          {
                            id: '2',
                            account_id: '10000000-0000-4000-8000-000000000001',
                            amount: '125.00000000',
                            direction: 'credit',
                            currency: 'USD',
                            created_at: '2026-02-01T12:00:00.000Z',
                          },
                        ],
                      },
                    ],
                    meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
                  },
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: [
                          'id',
                          'idempotency_key',
                          'description',
                          'occurred_at',
                          'entries',
                        ],
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          idempotency_key: { type: 'string' },
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
                                },
                                direction: {
                                  type: 'string',
                                  enum: ['debit', 'credit'],
                                },
                                currency: {
                                  type: 'string',
                                  enum: ['USD', 'COP', 'ARS', 'EUR'],
                                },
                                created_at: { type: 'string', format: 'date-time' },
                              },
                            },
                          },
                        },
                      },
                    },
                    meta: {
                      type: 'object',
                      required: ['page', 'limit', 'total', 'totalPages'],
                      properties: {
                        page: { type: 'integer', minimum: 1 },
                        limit: { type: 'integer', minimum: 1, maximum: 100 },
                        total: { type: 'integer', minimum: 0 },
                        totalPages: { type: 'integer', minimum: 0 },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Los filtros o parámetros de paginación son inválidos.' },
          '401': { description: 'Se requiere una sesión válida.' },
          '403': {
            description: 'Debes actualizar tu contraseña antes de consultar datos.',
          },
          '404': { description: 'Cuenta no encontrada.' },
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
              example: '30000000-0000-4000-8000-000000000101',
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
                      id: '30000000-0000-4000-8000-000000000101',
                      description: 'Movimiento demo USD 1',
                      occurred_at: '2026-02-01T12:00:00.000Z',
                      entries: [
                        {
                          id: '2',
                          account_id: '10000000-0000-4000-8000-000000000001',
                          amount: '125.00000000',
                          direction: 'credit',
                          currency: 'USD',
                          created_at: '2026-02-01T12:00:00.000Z',
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
                              currency: {
                                type: 'string',
                                enum: ['USD', 'COP', 'ARS', 'EUR'],
                                example: 'USD',
                              },
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

