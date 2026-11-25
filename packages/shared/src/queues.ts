export const HOLD_EXPIRY_QUEUE = 'hold-expiry';
export const NIGHT_AUDIT_QUEUE = 'night-audit';
export const CHANNEL_PUSH_QUEUE = 'channel-push';
export const EMAIL_QUEUE = 'email';
export const CHANNEL_INBOUND_QUEUE = 'channel-inbound';

export const QUEUE_NAMES = [HOLD_EXPIRY_QUEUE, NIGHT_AUDIT_QUEUE, CHANNEL_PUSH_QUEUE, EMAIL_QUEUE, CHANNEL_INBOUND_QUEUE] as const;
