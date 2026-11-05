import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { ConsoleEmailProvider } from './console-email-provider.js';
import { SesEmailProvider } from './ses-email-provider.js';

export interface PasswordResetEmail {
  to: string;
  nombre: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface EmailProvider {
  sendPasswordReset(message: PasswordResetEmail): Promise<void>;
}

let sesClient: SESv2Client | undefined;

export function getEmailProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER === 'ses') {
    sesClient ??= new SESv2Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    return new SesEmailProvider(sesClient, env.SES_FROM_EMAIL);
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
