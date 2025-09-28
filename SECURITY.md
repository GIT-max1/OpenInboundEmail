
# OpenInboundEmail — Security Guide (detailed)

This document collects detailed security guidance, operational recommendations, and recovery procedures for OpenInboundEmail. It explains the security model implemented in the codebase, why certain design decisions were taken, what threats remain, and how to operate the service safely in production.

The project ships as a self-hosted monorepo. The guidance below assumes control of the deployment host. For high-security or regulated environments adopt a centralized secrets manager and host-level hardening beyond the recommendations here.

---

## High-level changes in this release

- Admin store encryption now uses AES-256-GCM (AEAD) when `ADMIN_STORE_KEY` is configured. This prevents undetected ciphertext tampering.
- Admin store reads/writes are atomic. The `data/` directory is created with strict permissions (0o700). Admin files are written as 0o600 and rotated via a temporary file + rename.
- Backups prefer `age` (modern, minimal dependency) when `AGE_RECIPIENT` is provided. If `age` is not available the script will try OpenSSL AES-256-GCM, and only fall back to AES-256-CBC if absolutely necessary.
- Message raw payloads are stored as Base64 in the DB to preserve attachments and avoid encoding corruption.
- Mail spool directories and files are created with restrictive permissions (0o700 directories, 0o600 files) and written atomically.
- The web inbox no longer injects unsanitized HTML into the DOM. HTML can be viewed only in a sandboxed iframe behind an explicit action.
- If admin store decryption fails, the server surfaces a distinct error (`ADMIN_STORE_DECRYPTION_FAILED`) and refuses to silently reinitialize credentials.

---

## Threat model and goals

Primary threats addressed:

- Remote attackers attempting to gain administrative access via token theft or XSS.
- Tampering with the persisted admin token store.
- Exfiltration of sensitive backups.
- Malicious email payloads (HTML/JS) trying to execute in the admin UI.

Assumptions:

- The operator controls the host and can protect files in `/etc` and service accounts.
- For high-assurance requirements, integrate a secrets manager and external key storage (not local env files).

---

## Secrets & key management (recommended)

1) Prefer an external secrets manager for production. Examples: HashiCorp Vault, AWS Secrets Manager, Azure Key Vault.

2) If you use local secrets, put them in a file managed by the OS with strict ownership and permissions:

	- `/etc/openinbound.env`
	- `chown root:root /etc/openinbound.env`
	- `chmod 600 /etc/openinbound.env`

	Systemd unit should reference this file via `EnvironmentFile=`.

3) Admin store (`apps/server/data/admin.enc`):

	- Prefer storing the admin token only inside a secrets manager.
	- If using `ADMIN_STORE_KEY`, keep the key out of environment logs and avoid placing it in process command-lines. Store the key in the env file above and restrict access.

4) Backups & recipient keys:

	- Configure `AGE_RECIPIENT` with an operator public key and use `age` to encrypt archives.
	- If you cannot use `age`, use OpenSSL AES-256-GCM. Verify your OpenSSL supports GCM.
	- Do not store unencrypted backups on disk in production.

5) Rotation & automation:

	- Automate rotation via a secrets manager. The included `tools/rotate-admin-token.ts` prints to stdout — do not rely on STDOUT for storage in production; instead pipe output to your secrets API.

---

## Admin store decryption failure & recovery

If you see `ADMIN_STORE_DECRYPTION_FAILED` when the service tries to read the admin store, follow these steps:

1. Verify you are using the exact key that was used to create the encrypted store. Keys are sensitive to whitespace and newlines.
2. If you used an env file for `ADMIN_STORE_KEY`, ensure the file has correct permissions and the systemd unit reads it before starting the service.
3. If the key is irretrievably lost, you cannot recover the previous token. Recovery options:
	 - Restore a previously taken operator backup of `admin.enc` from a secure backup that is known-good.
	 - If no backup exists, you must create a new admin account. Be aware: re-creating credentials requires updating any systems that relied on the old token.
4. After recovery or rotation, rotate any dependent secrets (cloud DNS tokens, third-party integrations) and update the secret manager.

Operator safety: the server intentionally fails loudly on decryption errors to prevent accidental reinitialization and reduces the chance of an attacker creating a new admin when an operator's key is wrong.

---

## Mail HTML handling and XSS defenses

- The UI does not inject raw HTML into the admin page DOM. Instead, administrators may opt-in to view HTML in a sandboxed iframe with `sandbox` enabled, reducing the risk of script execution.
- If you require inline sanitized HTML inside the app (instead of the iframe), sanitize server-side with a vetted library (e.g. DOMPurify) and limit allowed tags/attributes. Do not rely only on client-side sanitization.
- Because email can contain remote resources, displaying HTML in an iframe mitigates automatic loading of third-party trackers but is not bulletproof; prefer manual review for high-risk messages.

---

## Backup & restore guidance

1) Backup encryption:

	- Preferred: use `age` with `AGE_RECIPIENT` and store the recipient in your ops vault. Example:

		age -r <recipient> -o openinbound-data-YYYYMMDD.age openinbound-data-YYYYMMDD.tar.gz

	- Fallback: OpenSSL AES-256-GCM (AEAD). Verify OpenSSL version supports `-aes-256-gcm`.

2) Backup retention & verification:

	- Keep a rotation policy (7/30/90 day tiers depending on your compliance needs).
	- Periodically verify restores: decrypt a random older archive and validate file integrity.

3) Where to store backups:

	- Prefer cold storage or object storage with server-side encryption + IAM rules (S3 with SSE and restricted bucket policy), rather than unstructured host files.

4) Restore steps:

	- Use `age -d` or OpenSSL decrypt with the correct key. Do not attempt to guess keys; incorrect decryption may overwrite operational files if scripts are not careful.

---

## Runtime and systemd hardening checklist

The example `deploy/openinbound.service` already includes baseline hardening. Add the following before production rollout:

1) Protect environment file and service user:

	- `chown root:root /etc/openinbound.env`
	- `chmod 600 /etc/openinbound.env`
	- Create a dedicated system user `inbound` with no interactive shell.

2) Tighten the systemd unit:

	- Add or confirm these options where applicable:
		- `PrivateTmp=true`
		- `NoNewPrivileges=true`
		- `ProtectSystem=full`
		- `ProtectHome=yes`
		- `ProtectKernelModules=yes`
		- `ProtectControlGroups=yes`
		- `RestrictAddressFamilies=AF_INET AF_INET6` (restrict to required families)
		- `CapabilityBoundingSet=CAP_NET_BIND_SERVICE`

3) Use an ExecStart wrapper that drops privileges explicitly and avoids shell interpolation — prefer absolute paths.

4) Ensure network-level protections (firewall rules, fail2ban for abusive connections) and monitor SMTP connection metrics.

---

## Data handling & retention

- Database: move raw message payloads to object storage if you expect high volume. Storing large binaries in SQLite can cause performance and backup issues.
- Implement server-side retention policies (e.g. purge messages older than N days) and consider archiving older messages to encrypted object storage.

---

## Recommended developer improvements (future work)

1) Integrate a secrets manager so tokens never live in files on disk in production.
2) Replace fallback encryption with `age` as default and require `AGE_RECIPIENT` for production backups.
3) Add a secure admin login flow that issues short-lived httpOnly cookies and disables localStorage recommendations in docs.
4) Add automated test for backup/restore and admin store decryption validation.

---

## Reporting and responsible disclosure

If you discover a security issue, open an issue titled `SECURITY:` and include steps to reproduce. For sensitive reports, email the maintainer privately and mark the issue as private if your hosting provider supports it.

---

## Appendix: Quick commands & examples

Protect env file example:

```sh
sudo chown root:root /etc/openinbound.env
sudo chmod 600 /etc/openinbound.env
```

Backup encrypt with age:

```sh
AGE_RECIPIENT="age1..." age -r "$AGE_RECIPIENT" -o /backups/openinbound-20250928.age /tmp/openinbound-data-20250928.tar.gz
```

Decrypt with age:

```sh
age -d -i /path/to/private-key -o out.tar.gz in.age
```

OpenSSL decrypt (if used):

```sh
openssl enc -d -aes-256-gcm -pbkdf2 -in openinbound.tar.gz.enc -out openinbound.tar.gz -pass env:ADMIN_STORE_KEY
```

---

This document should be reviewed and adapted to your organization's security policies before production deployment.
