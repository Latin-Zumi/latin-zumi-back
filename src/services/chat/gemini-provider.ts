import { GoogleGenAI } from '@google/genai';
import { AppError } from '../../utils/AppError.js';
import type { ChatGroundingContext, ChatHistoryEntry, ChatProvider, ChatProviderReply, ChatProviderRequest } from './chat-provider.js';

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
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async generateReply(input: ChatProviderRequest): Promise<ChatProviderReply> {
    if (!this.apiKey) {
      throw new AppError('El proveedor de IA no está configurado', 503);
    }

    try {
      const ai = new GoogleGenAI({ apiKey: this.apiKey });
      const response = await ai.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
      });

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
      const message = error instanceof Error ? error.message : 'Error del proveedor de IA';
      throw new AppError(`No fue posible generar la respuesta del asistente: ${message}`, 503);
    }
  }
}

export function createGeminiProvider(apiKey: string, model: string): ChatProvider {
  return new GeminiChatProvider(apiKey, model);
}

export function normalizeHistory(history: ChatHistoryEntry[] | undefined): ChatHistoryEntry[] | undefined {
  if (!history) return undefined;
  return history.slice(-10).map((entry) => ({
    role: entry.role === 'assistant' ? 'assistant' : 'user',
    content: String(entry.content ?? '').slice(0, 2000),
  }));
}
