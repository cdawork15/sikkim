import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { OtpDelivery } from './otp.js';

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

/**
 * Delivers one-time sign-in codes by email through Amazon SES.
 *
 * Email only: SMS codes fall back to a warning log, because SES does not send
 * SMS. Credentials are resolved from the default AWS provider chain (the EC2
 * instance role), so no access keys are stored in configuration. The recipient
 * address and the code itself are never written to the log.
 */
export function sesDelivery(
  fromAddress: string,
  region: string,
  log: Logger,
): OtpDelivery {
  const client = new SESClient({ region });
  return async ({ channel, destination, code }) => {
    if (channel !== 'email') {
      log.warn(
        { event: 'otp_sms_unconfigured', channel },
        'SMS code delivery is not configured; only email is sent',
      );
      return;
    }
    await client.send(
      new SendEmailCommand({
        Source: fromAddress,
        Destination: { ToAddresses: [destination] },
        Message: {
          Subject: { Data: 'Your Sikkim Experiences sign-in code' },
          Body: {
            Text: {
              Data:
                `Your sign-in code is ${code}. It expires in 10 minutes.\n\n` +
                'If you did not request this, you can ignore this email.',
            },
          },
        },
      }),
    );
    log.info({ event: 'otp_email_sent' }, 'Sign-in code emailed');
  };
}
