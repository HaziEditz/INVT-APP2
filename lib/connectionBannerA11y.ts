/**
 * React Native Android rejects unknown accessibilityRole values at runtime
 * (JSApplicationIllegalArgumentException). Keep banner roles in this allow-list.
 */
export const CONNECTION_BANNER_ALERT_ROLE = 'alert' as const;
/** Status-like syncing copy — "status" is NOT a valid RN Android role. */
export const CONNECTION_BANNER_SYNCING_ROLE = 'summary' as const;
