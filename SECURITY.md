# Security Hardening Summary

This project ships with secure defaults. To operate safely in production:

- Set an admin token and restrict CORS to your panel origin.
- Provide SMTP TLS key/cert so STARTTLS is required in prod.
- Keep the UI behind a protected origin; tokens are not stored server-side.

Environment variables:

ADMIN_TOKEN=change-me
FRONTEND_ORIGIN=https://admin.example.net
SMTP_TLS_KEY=/etc/ssl/private/smtp.key
SMTP_TLS_CERT=/etc/ssl/certs/smtp.crt
API_HOST_PROD=0.0.0.0
SMTP_PORT_PROD=25
SMTP_MAX_CONN_PER_IP=10

Notes:
- In production mode, mutating endpoints are blocked unless ADMIN_TOKEN is set and presented.
- MTA-STS policy is cached for 24h by clients; update DNS TXT id when changing.
- Artifact pack allows manual DNS updates without exposing provider credentials.
