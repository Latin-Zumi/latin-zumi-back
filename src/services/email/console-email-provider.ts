import type { EmailProvider, PasswordResetEmail } from './email-provider.js';

export class ConsoleEmailProvider implements EmailProvider {
  async sendPasswordReset(message: PasswordResetEmail): Promise<void> {
    console.info(`[password-reset] ${message.to}: ${message.resetUrl}`);
  }
}
