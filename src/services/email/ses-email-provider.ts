import {
  SendEmailCommand,
} from '@aws-sdk/client-sesv2';
import type { EmailProvider, PasswordResetEmail } from './email-provider.js';

interface SesClient {
  send(command: SendEmailCommand): Promise<unknown>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function buildResetEmailHtml(message: PasswordResetEmail): string {
  const nombre = escapeHtml(message.nombre);
  const resetUrl = escapeHtml(message.resetUrl);
  const { expiresInMinutes } = message;
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Restablecé tu contraseña de Latin Zumi</h2>
      <p>Hola ${nombre},</p>
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
      <p>Confirmá tu nueva contraseña usando el siguiente enlace:</p>
      <p>
        <a href="${resetUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none;">
          Restablecer contraseña
        </a>
      </p>
      <p>Si no solicitaste este cambio, podés ignorar este correo.</p>
      <p>El enlace vence en ${expiresInMinutes} minutos y es de un solo uso.</p>
      <p>Saludos,<br/>El equipo de Latin Zumi</p>
    </div>
  `;
}

function buildResetEmailText(message: PasswordResetEmail): string {
  const { nombre, resetUrl, expiresInMinutes } = message;
  return [
    `Hola ${nombre},`,
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta de Latin Zumi.',
    'Confirmá tu nueva contraseña usando el siguiente enlace:',
    resetUrl,
    '',
    'Si no solicitaste este cambio, podés ignorar este correo.',
    `El enlace vence en ${expiresInMinutes} minutos y es de un solo uso.`,
    '',
    'Saludos,',
    'El equipo de Latin Zumi',
  ].join('\n');
}

export class SesEmailProvider implements EmailProvider {
  constructor(
    private readonly client: SesClient,
    private readonly from: string,
  ) {}

  async sendPasswordReset(message: PasswordResetEmail): Promise<void> {
    const command = new SendEmailCommand({
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: {
            Data: 'Restablecé tu contraseña de Latin Zumi',
            Charset: 'UTF-8',
          },
          Body: {
            Html: { Data: buildResetEmailHtml(message), Charset: 'UTF-8' },
            Text: { Data: buildResetEmailText(message), Charset: 'UTF-8' },
          },
        },
      },
    });

    try {
      await this.client.send(command);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      const status =
        typeof error === 'object' &&
        error !== null &&
        '$metadata' in error &&
        typeof error.$metadata === 'object' &&
        error.$metadata !== null &&
        'httpStatusCode' in error.$metadata &&
        typeof error.$metadata.httpStatusCode === 'number'
          ? error.$metadata.httpStatusCode
          : undefined;
      throw new Error(
        `SES SendEmail falló: ${name}${status ? ` (HTTP ${status})` : ''}`,
      );
    }
  }
}
