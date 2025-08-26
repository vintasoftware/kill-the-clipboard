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

### In Progress Tasks


### Future Tasks

- **Library (kill-the-clipboard) v1**
  - [ ] Public exports wired in `src/index.ts`
  - [ ] Tests: unit and integration for create/share/resolve flows (including passcode, expired, not found, decrypt/auth failures)
  - [ ] Documentation: README section "Smart Health Links (SHL)" with minimal examples
  - [ ] API docs: include SHL classes and types in typedoc output

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

### Implementation Plan

- **Phase 1: Library v1**
  - Define types and error classes
  - Implement `SHL` → `SHLManifestBuilder` → `SHLViewer`
  - Add crypto/compression utilities and exports
  - Add tests (positive/negative cases), README, and typedoc

- **Phase 2: Demo v1**
  - Scaffold app and routes; configure storage and keys
  - Implement SHC signing and FHIR Bundle assembly
  - Wire SHL creation and manifest/file serving
  - Build viewer UX (passcode + recipient prompts, long‑term polling)
  - Deploy and validate end‑to‑end

### Relevant Files

- `SHL_SPEC.md` — Feature spec and scope (✅)
- `src/index.ts` — New SHL classes, types, error exports
- `test/index.test.ts` — Unit/integration tests for SHL APIs
- `README.md` — Add SHL overview and examples
- `typedoc.json` — Ensure new APIs are included
- `vitest.config.ts` — Test setup (browser/Node compat as needed)
- `rollup.config.js` — Build config; ensure universal output
- `demo/` — Minimal demo; separate Next.js demo app to be created per plan

### Environment Configuration (Demo)

- `SHC_PRIVATE_KEY` — ES256 private key (PEM/SPKI as needed)
- `SHC_PUBLIC_KEY` — ES256 public key (for `kid` derivation/verification)
- `SHL_BASE_URL` — Base URL for manifest paths (e.g., `https://example.org/shl/manifests/`)
- `SHL_PASSCODE_PEPPER` — Global pepper used with Argon2
- Medplum credentials — For FHIR datastore access
- Supabase credentials — For manifests and passcode hashes


