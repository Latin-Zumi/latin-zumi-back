import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { ConsoleEmailProvider } from './console-email-provider.js';
import { ResendEmailProvider } from './resend-email-provider.js';

export interface PasswordResetEmail {
  to: string;
  nombre: string;
  resetUrl: string;
}

export interface EmailProvider {
  sendPasswordReset(message: PasswordResetEmail): Promise<void>;
}

export function getEmailProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER === 'resend') {
    return new ResendEmailProvider(env.RESEND_API_KEY ?? '', env.EMAIL_FROM);
  }

  // En producción no se acepta el provider de consola: evita "enviar" correos
  // que nadie recibe y deja el fallo visible.
  if (env.NODE_ENV === 'production') {
    throw new AppError(
      'El envío de correos no está configurado',
      503,
      'EMAIL_NOT_CONFIGURED',
    );
  }

  return new ConsoleEmailProvider();
}
