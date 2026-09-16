export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  sendSms(to: string, body: string): Promise<void>;
}
