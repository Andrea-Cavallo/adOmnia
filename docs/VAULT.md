# Vault and local credentials

One page for what adOmnia encrypts, where the keys live, when the vault locks,
and what the model does not protect. Code: `internal/vault`; database-specific
behaviour: [DATABASE-CONNECTIONS.md](DATABASE-CONNECTIONS.md).

## Two independent protections

adOmnia has two encryption paths, and they are not the same vault:

| Path | What it protects | Algorithm | Key |
| --- | --- | --- | --- |
| **Vault (age)** | API tokens, keys and passwords explicitly protected by the user, legacy `vault:age:` references, encrypted workspace exports | [age](https://age-encryption.org/) passphrase mode (`filippo.io/age`), whose recipient derives the key with scrypt | Passphrase chosen by the user; derived identity exists **only in memory** while the vault is unlocked |
| **Automatic local seal** | Database DSNs and passwords stored by the Database panel (`vault:local:v1:`) | AES-256-GCM, random 96-bit nonce, `vault:local:v1:` associated data | 32-byte random master key in the OS keychain (Windows Credential Manager/DPAPI, macOS Keychain, Linux Secret Service via `go-keyring`) |

The local seal is automatic: it needs no passphrase and keeps working after the
vault locks. A database credential can additionally use the optional **Protect**
passphrase, which stores an age reference and therefore requires unlocking.

## Vault lifecycle

- **Unlock.** The passphrase derives the age identity. The identity is held in
  memory only; it is never written to disk, settings or logs.
- **Auto-lock.** Default **30 minutes** of inactivity, configurable from **1 to
  120 minutes** in *Settings → Vault*. Activity that opens a protected reference
  resets the timer. `SetTimeoutMinutes` clamps out-of-range values.
- **Lock.** Forgets the in-memory identity and cancels the timer generation, so a
  callback already scheduled cannot unlock or reuse a newer vault session.
  *Lock vault on minimize* is a separate preference and locks on window minimize.
- **Restart.** A new process starts locked; age references require the passphrase
  again. The automatic local seal does not.
- **Writes.** Secrets are encrypted before they reach bbolt. Decryption happens
  only in the backend when a request/connection needs the value; the renderer
  receives the reference, not the plaintext, unless the UI explicitly asks for a
  value it must show.

## Local seal key and fallback

The master key is 32 random bytes. Preferred storage is the OS keychain under
service `adomnia.database`, user `master-v1`. If the keychain is unavailable on
first installation, adOmnia writes a restricted fallback file
`database-master.key` in the platform config directory (`%APPDATA%\adomnia` on
Windows):

- Windows: the file is protected with DPAPI for the current user.
- macOS/Linux: the key is wrapped with AES-256-GCM under a key derived from
  `/etc/machine-id` (or `/var/lib/dbus/machine-id`) and the user id; the file is
  created with `0600` permissions in a `0700` directory. When no machine id is
  readable (some macOS setups), the fallback stays a `0600` plaintext key file
  and the UI shows the credential warning.
- After a keychain was initialized, a later keychain failure is an error: adOmnia
  never silently replaces an unreadable key, because that would destroy every
  credential sealed with it. The UI shows the fallback state.
- Sealed values are bound to that key and installation. Moving the database to
  another machine or user account makes them unreadable; this is intended.

## What the vault protects

- Secrets at rest: a stolen disk image, backup, synced data folder or bbolt file
  does not reveal protected values without the passphrase or the OS account key.
- Accidental disclosure through exports: workspace export encrypts the payload
  with age instead of writing plaintext.
- Secrets left in the renderer: the backend resolves them at use time.

## What it does not protect

- **A compromised user session.** Malware running as your OS user can ask the
  keychain or read process memory while the vault is unlocked, exactly as your
  own user can.
- **Memory while unlocked.** The age identity and resolved values exist in
  process memory. A memory dump, debugger or swap file can expose them.
- **Screen capture and logs.** Values shown in a form, clipboard or terminal are
  outside the vault. adOmnia never logs plaintext secrets, but the surrounding
  system may.
- **Providers you send data to.** The vault governs storage, not what an AI
  provider, database, broker or HTTP endpoint receives after you send it.
- **OS keychain compromise.** The local seal trusts the operating system's
  credential store. An attacker who can read that store can open local seals
  without the vault passphrase.
- **Passphrase recovery.** There is no backdoor and no recovery code for age
  references. Losing the passphrase means losing those values. Losing the local
  master key means losing the sealed database credentials.

## Operational notes

- Do not copy `database-master.key` between machines or check it into Git.
- Keep the vault passphrase out of the repository and out of shell history.
- An encrypted workspace export is portable only with its passphrase; a local
  seal is not portable at all.
- The vault is local-first: no key, passphrase or plaintext leaves the machine
  for escrow, recovery or telemetry.
