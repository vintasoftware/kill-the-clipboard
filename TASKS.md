## Smart Health Links (SHL) Implementation Task List

Brief task list derived from our internal spec in `SHL_SPEC.md` and aligned with the official SHL protocol spec: [SHL Protocol Specification](https://docs.smarthealthit.org/smart-health-links/spec).

Constraints: use pnpm; library must work in both browser and Node.js.

### Completed Tasks

- [x] Draft SHL feature specification in `SHL_SPEC.md`
- [x] Align v1 scope to spec (support flags `L`, `P`; omit `U` and `application/smart-api-access`)
- [x] Add SHL types: `SHLinkPayloadV1`, `SHLFlag`, manifest types (`SHLManifestV1*`), `SHLResolvedContent`
- [x] Implement SHL error types (`SHLError`, `SHLManifestError`, `SHLNetworkError`, `SHLFormatError`, `SHLAuthError`, `SHLInvalidPasscodeError`, `SHLResolveError`, `SHLDecryptionError`, `SHLManifestNotFoundError`, `SHLManifestRateLimitError`, `SHLExpiredError`)
- [x] Implement `SHL` class scaffolding (payload construction, URI generation, getters)
- [x] Implement `SHLManifestBuilder` scaffolding (encrypt JWE A256GCM dir, optional `zip: "DEF"`, upload hooks, manifest builder with embedded vs location threshold ≤ 16 KiB)
- [x] Implement `SHLViewer` scaffolding (parse URI, manifest POST per spec, passcode handling, decrypt files, long‑term `L` polling)
- [x] Prepare initial implementation scaffolding and API boundaries in `src/index.ts`
- [x] Implement JWE encryption/decryption with A256GCM and optional DEFLATE compression
- [x] Implement SHLink URI parsing and validation
- [x] Implement manifest fetching with passcode handling
- [x] Implement file fetching and decryption
- [x] Add crypto/compression helpers using `jose` and `CompressionStream`/`DecompressionStream`; ensure Node 18+ compatibility without browser‑unfriendly APIs
- [x] Public exports wired in `src/index.ts`
- [x] Documentation: JS Docs for SHL classes and types, similar to SHC classes
- [x] Documentation: include SHL classes and types in typedoc output

### In Progress Tasks

### Future Tasks

- **Library (kill-the-clipboard) v1**
  - [ ] Documentation: README section "Smart Health Links (SHL)" with minimal examples
  - [ ] Tests: unit and integration for create/share/resolve flows (including passcode, expired, not found, decrypt/auth failures)

- **Demo (Next.js + Medplum) v1**
  - [ ] Scaffold Next.js (App Router) patient portal app
  - [ ] API routes: `POST /shl` (create SHL) and `POST /shl/manifests/:entropy/manifest.json` (serve manifest)
  - [ ] Generate SMART Health Card JWS on server using ES256 (`SHC_PRIVATE_KEY`); derive `kid` from `SHC_PUBLIC_KEY`
  - [ ] Assemble FHIR `Bundle` from Medplum queries (Patient, Allergies, Conditions, Medications, Observations)
  - [ ] Storage: Medplum `createBinary` for encrypted files (S3‑compatible); Supabase for passcode hashes and manifests; generate short‑lived single‑use file URLs
  - [ ] Create SHL payload + manifest using library; return viewer‑prefixed SHLink URI to client
  - [ ] Viewer route: parse SHLink, prompt for passcode when `P` flag present, prompt for `recipient`, resolve and display SHC(s) and FHIR resources
  - [ ] CORS and `Cache-Control` headers (manifest `no-store`; files short‑lived)
  - [ ] Vercel deployment configuration and environment variables
  - [ ] Security: avoid logging keys, passcodes, or decrypted PHI; HTTPS only
