# PSD2 / Berlin Group module

The PSD2 module prepares and sends Berlin Group NextGenPSD2 1.3.12 requests. It is local-first: certificate files remain on disk, private keys are parsed only by the Go backend, and certificate passwords must be stored as encrypted `vault:` references. Plaintext passwords are rejected by the composer.

## MVP capabilities

- Inspect QWAC/QSEAL PEM and PKCS#12 files, including `organizationIdentifier`, PSP roles, NCA, subject, issuer and validity.
- Use the selected QWAC as the request's mTLS client certificate.
- Generate `Digest`, `Signature` and `TPP-Signature-Certificate` with RSA-SHA256.
- Build and validate headers for AIS consent creation, PIS payment initiation and funds confirmation.
- Generate `X-Request-ID` as UUID v4 and reject incomplete requests before network I/O.

## Example

1. Open an HTTP request and select **Headers / PSD2 · Berlin Group 1.3.12**.
2. Enable PSD2 and choose an operation.
3. Select the QWAC and QSEAL files. Use `vault:<ciphertext>` for their passwords when applicable.
4. Inspect both certificates and check roles, NCA and validity.
5. Choose **Build headers**, then fill any required values reported by the builder.
6. Add a non-empty JSON body and send the request.

For a signed request the backend computes:

```text
Digest: SHA-256=<base64(sha256(body))>
Signature: keyId="...",algorithm="rsa-sha256",headers="(request-target) digest x-request-id",signature="..."
TPP-Signature-Certificate: <base64 DER leaf certificate>
```

The MVP intentionally does not implement AIS/PIS flow orchestration, ASPSP mocks, conformance validation, VOP, OCSP or CRL checks. ASPSP-specific signing-header profiles can later be added behind the existing `JWSSigner` and `HeaderBuilder` interfaces.
