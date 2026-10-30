import type { EmailProvider, PasswordResetEmail } from './email-provider.js';
import { AppError } from '../../utils/AppError.js';

function buildResetEmailHtml(message: PasswordResetEmail): string {
  const { nombre, resetUrl } = message;
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
      <p>El enlace vence en 30 minutos y es de un solo uso.</p>
      <p>Saludos,<br/>El equipo de Latin Zumi</p>
    </div>
  `;
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendPasswordReset(message: PasswordResetEmail): Promise<void> {
    if (!this.apiKey) {
      throw new AppError('El proveedor de email no está configurado', 503);
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: 'Restablecé tu contraseña de Latin Zumi',
        html: buildResetEmailHtml(message),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const error = new Error(
        'No se pudo enviar el email de recuperación',
      ) as Error & { status?: number; body?: string };
      error.status = response.status;
      error.body = errorBody.slice(0, 500);
      throw error;
    }
  }
}
