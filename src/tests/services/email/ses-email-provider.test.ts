import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { describe, expect, it, vi } from 'vitest';
import { SesEmailProvider } from '../../../services/email/ses-email-provider.js';

const message = {
  to: 'ana@example.test',
  nombre: 'Ana Pérez',
  resetUrl: 'https://frontend.example.test/restablecer-contrasena?token=sample-token',
  expiresInMinutes: 60,
};

describe('SesEmailProvider', () => {
  it('sends the configured sender, recipient and Spanish HTML and text bodies', async () => {
    const send = vi.fn(async (_command: SendEmailCommand) => ({ MessageId: 'message-id' }));
    const provider = new SesEmailProvider({ send }, 'Latin Zumi <no-reply@example.com>');

    await expect(provider.sendPasswordReset(message)).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledOnce();
    const [command] = send.mock.calls[0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toMatchObject({
      FromEmailAddress: 'Latin Zumi <no-reply@example.com>',
      Destination: { ToAddresses: ['ana@example.test'] },
      Content: {
        Simple: {
          Subject: {
            Data: 'Restablecé tu contraseña de Latin Zumi',
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: expect.stringContaining('El enlace vence en 60 minutos'),
              Charset: 'UTF-8',
            },
            Text: {
              Data: expect.stringContaining('El enlace vence en 60 minutos'),
              Charset: 'UTF-8',
            },
          },
        },
      },
    });
    expect(command.input.Content?.Simple?.Body?.Html?.Data).toContain(message.resetUrl);
    expect(command.input.Content?.Simple?.Body?.Text?.Data).toContain(message.resetUrl);
  });

  it('escapes user-controlled values in the HTML email', async () => {
    const send = vi.fn(async (_command: SendEmailCommand) => ({ MessageId: 'message-id' }));
    const provider = new SesEmailProvider({ send }, 'Latin Zumi <no-reply@example.com>');

    await provider.sendPasswordReset({
      ...message,
      nombre: '<img src=x onerror="alert(1)">',
      resetUrl: 'https://frontend.example.test/reset?x="&y',
    });

    const [command] = send.mock.calls[0];
    const html = command.input.Content?.Simple?.Body?.Html?.Data ?? '';
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('href="https://frontend.example.test/reset?x=&quot;&amp;y"');
    expect(html).not.toContain('<img src=x');
  });

  it('sanitizes SDK errors without including the reset token or link', async () => {
    const sdkError = Object.assign(
      new Error(`Sensitive link ${message.resetUrl}`),
      { name: 'MessageRejected', $metadata: { httpStatusCode: 400 } },
    );
    const send = vi.fn(async (_command: SendEmailCommand) => {
      throw sdkError;
    });
    const provider = new SesEmailProvider({ send }, 'Latin Zumi <no-reply@example.com>');

    await expect(provider.sendPasswordReset(message)).rejects.toThrow(
      'SES SendEmail falló: MessageRejected (HTTP 400)',
    );
    await expect(provider.sendPasswordReset(message)).rejects.not.toThrow(
      message.resetUrl,
    );
  });
});
