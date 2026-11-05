import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { GoogleGenAI, mcpToTool } from '@google/genai';
import { AppError } from '../../utils/AppError.js';
import type { ChatGroundingContext, ChatHistoryEntry, ChatProvider, ChatProviderReply, ChatProviderRequest } from './chat-provider.js';

export interface GeminiChatProviderOptions {
  authorizationHeader?: string;
  mcpServerUrl?: string;
}

function buildPrompt(input: ChatProviderRequest): string {
  const recentHistory = (input.history ?? []).slice(-6).map((entry) => `${entry.role}: ${entry.content}`).join('\n');
  const grounding: ChatGroundingContext | undefined = input.context;

  const accountSummary = grounding?.accounts?.length
    ? grounding.accounts.map((account) =>
        `- Tipo: ${account.account_type}; saldo: ${account.balance} ${account.currency}`,
      ).join('\n')
    : 'No hay cuentas activas disponibles para este usuario.';

  const recentTransactions = grounding?.recentTransactions?.length
    ? grounding.recentTransactions.map((tx) => {
        const entries = tx.entries.map((entry) => `${entry.direction}:${entry.amount} ${entry.currency}`).join(', ');
        return `- ${tx.occurred_at}: ${tx.description ?? 'sin descripción'} | ${entries}`;
      }).join('\n')
    : 'No hay movimientos recientes disponibles.';

  return `Eres un asistente de ayuda para LATIN ZUMI.

Reglas:
- Usa solo la información financiera segura que te doy en este contexto.
- Nunca inventes saldos, movimientos, cotizaciones ni propiedades de cuentas.
- Si falta información, dilo claramente y pide un dato adicional o explica la limitación.
- No ejecutes transferencias, retiros ni ingresos ni alteres el ledger.
- No tienes herramientas para ejecutar código, consultas SQL ni operaciones financieras. No intentes generarlas ni afirmar que las ejecutaste.
- Responde en español claro y útil para un usuario de LATIN ZUMI.
- Mantén la respuesta corta, práctica y enfocada en la pregunta del usuario.
- No compartas secretos, tokens ni credenciales.
- Si el usuario pregunta por el estado de sus cuentas, usa exclusivamente los saldos que te paso como contexto.

Contexto del usuario:
- cuentas:
${accountSummary}
- movimientos recientes:
${recentTransactions}
- historial reciente:
${recentHistory || 'Sin historial previo.'}

Pregunta del usuario:
${input.message}

Devuelve una respuesta útil como si fueras el asistente del backend, en un estilo conciso y natural.`;
}

export class GeminiChatProvider implements ChatProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly options: GeminiChatProviderOptions = {},
  ) {}

  async generateReply(input: ChatProviderRequest): Promise<ChatProviderReply> {
    if (!this.apiKey) {
      throw new AppError('El proveedor de IA no está configurado', 503);
    }

    let mcpClient: Client | undefined;
    let tools: unknown[] | undefined;

    if (this.options.authorizationHeader) {
      try {
        const mcpUrl = new URL(this.options.mcpServerUrl ?? 'http://127.0.0.1:3000');
        mcpUrl.pathname = '/mcp';
        const transport = new StreamableHTTPClientTransport(mcpUrl, {
          fetch: (resource, init) => {
            const headers = new Headers(init?.headers);
            headers.set('Authorization', this.options.authorizationHeader!);
            headers.set('Accept', 'application/json, text/event-stream');
            if (!headers.has('Content-Type') && init?.body) {
              headers.set('Content-Type', 'application/json');
            }
            return fetch(resource, { ...init, headers });
          },
        });
        mcpClient = new Client(
          { name: 'latin-zumi-chatbot', version: '1.0.0' },
          { versionNegotiation: { mode: 'auto' } },
        );
        await mcpClient.connect(transport);
        tools = [mcpToTool(mcpClient)];
      } catch {
        tools = undefined;
      }
    }

    try {
      const ai = new GoogleGenAI({ apiKey: this.apiKey });
      const request: any = {
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
      };
      if (tools && tools.length > 0) {
        request.config = { tools: tools as any };
      }
      const response = await ai.models.generateContent(request);

      const normalizedResponse = response as {
        text?: string;
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const text = typeof normalizedResponse.text === 'string'
        ? normalizedResponse.text
        : normalizedResponse.candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
            .map((part) => part.text ?? '')
            .join('\n') ?? '';

      const safeMessage = text.trim() || 'No puedo responder a esa consulta con la información disponible en este momento.';
      const suggestions = [
        '¿Cómo funciona LATIN ZUMI?',
        '¿Qué cuentas tengo activas?',
        '¿Cuáles fueron mis últimos movimientos?',
      ];

      return {
        message: safeMessage,
        conversationId: input.conversationId,
        suggestions,
      };
    } catch (error) {
      // El detalle queda en el log: puede traer datos internos del proveedor
      const detail = error instanceof Error ? error.message : 'Error del proveedor de IA';
      console.error(JSON.stringify({ event: 'chat_provider_error', detail }));
      throw new AppError('No fue posible generar la respuesta del asistente', 503);
    } finally {
      if (mcpClient) {
        await mcpClient.close().catch(() => undefined);
      }
    }
  }
}

export function createGeminiProvider(
  apiKey: string,
  model: string,
  options: GeminiChatProviderOptions = {},
): ChatProvider {
  return new GeminiChatProvider(apiKey, model, options);
}

export function normalizeHistory(history: ChatHistoryEntry[] | undefined): ChatHistoryEntry[] | undefined {
  if (!history) return undefined;
  return history.slice(-10).map((entry) => ({
    role: entry.role === 'assistant' ? 'assistant' : 'user',
    content: String(entry.content ?? '').slice(0, 2000),
  }));
}
