## Smart Health Links (SHL) Feature Specification

This document defines the plan to add Smart Health Links (SHL) support to this library and a companion Medplum-powered demo. It is split in two parts:

1. SHL feature in `kill-the-clipboard`
2. Medplum SHL demo project (Next.js Patient Portal)

References:

- [SHL Design Overview](https://docs.smarthealthit.org/smart-health-links/design/)
- [SHL Protocol Specification](https://docs.smarthealthit.org/smart-health-links/spec)
- [SHL User Stories](https://docs.smarthealthit.org/smart-health-links/user-stories/)

Constraints and conventions:

- Use pnpm for development and scripts
- Library remains universal (browser and Node.js)
- For this phase, do not support the `application/smart-api-access` format
- Focus initial scope on manifest-based SHLinks (no `U` flag direct-file optimization in v1)
- Passcode-protected links (`P` flag) are supported as server-side access control; the passcode is never included in the payload/URI and does not replace the encryption key


## Part 1 — SHL feature in `kill-the-clipboard`

### Goals

- Provide ergonomic APIs to produce and consume SHLinks per spec, including:
  - Constructing SHLink payloads and URIs
  - Encrypting files (JWE compact) using a 32-byte symmetric key from payload
  - Emitting a manifest that references encrypted files by URL or embeds them
  - Resolving SHLink URIs on the viewing side: fetch manifest, fetch/decrypt/verify files
  - Decoding two file types: `application/smart-health-card` and `application/fhir+json`
- Interoperate with existing SHC APIs in this library for signing/verifying JWS
- Ship in a way that works in both browser and Node runtimes without polyfill churn

### Non-goals (v1)

- No `application/smart-api-access` entries
- No `U` flag (direct single encrypted file without manifest)
- No certificate chain validation (x5c/PKI) beyond JWK-based verification already documented for SHC

### Terminology

- **SHLink Payload**: Minified JSON with `url`, `key`, optional `exp`, `flag`, `label`, and version `v`
- **SHLink URI**: `shlink:/` + base64url-encoded payload JSON (optionally prefixed with a viewer URL ending with `#` per spec)
- **Manifest**: JSON document referenced by payload `url` describing one or more encrypted files  
- **Encrypted File**: JWE (compact) containing compressed plaintext file, encrypted with payload `key`

### Architecture Notes

Based on the [official SHL specification](https://docs.smarthealthit.org/smart-health-links/spec/), the implementation separates concerns into two main classes:

- **SHL Class**: Immutable representation of the SHLink "pointer" itself - handles payload construction, URI generation, and provides access to the encryption key and manifest URL. This aligns with the spec's definition of the SHLink as a pointer containing the necessary information to access encrypted content.

- **SHLManifestBuilder Class**: Manages the actual content referenced by the SHL - handles file encryption and manifest building.

This separation ensures that the SHLink payload/URI (the "pointer") is independent of the manifest and file management (the "content"), following the SHL specification's clear distinction between these concerns.

It's also necessary to implement a server-side request handler that serves the manifest its encrypted files. A POST request handler must process a `SHLManifestRequestV1` and return a `SHLManifestV1`. This is left for the demo applications (see Part 2).

#### Manifest URL Construction

The SHL class automatically constructs the manifest URL by combining:
1. **Base URL**: The `baseManifestURL` parameter (e.g., 'https://shl.example.org/manifests/')
2. **Path Entropy**: 32 random bytes encoded as base64url (43 characters) for security
3. **Manifest Path**: Optional `manifestPath` parameter (e.g., '/manifest.json')

The final manifest URL follows the pattern: `${baseManifestURL}/${pathEntropy}/${manifestPath}`

For example: `https://shl.example.org/manifests/abc123def456.../manifest.json`

This approach ensures each SHL has a unique, unpredictable manifest URL while maintaining a consistent structure that servers can easily parse and route.

#### Persistence and serving model (short‑lived URLs)

- The server SHALL persist the SHL content as the state of `SHLManifestBuilder` (the "builder state"), not as an `SHLManifestV1` document. On each POST to the manifest URL, the server will load the builder state, then call `buildManifest({ embeddedLengthMax })` to produce a fresh `SHLManifestV1` response with up‑to‑date short‑lived file URLs (`location`).
- The builder state includes the immutable `SHL` core fields and the list of paths of encrypted files (ciphertexts) that have already been persisted to storage. Short‑lived URLs (e.g., S3 signed URLs) MUST NOT be stored; they are minted per request by calling `getFileURL(storagePath)`.
- The `embeddedLengthMax` value MAY differ per client request. The server MUST honor the provided value for that single response only.
- On file addition (`addHealthCard`, `addFHIRResource`), the implementation SHALL: encrypt the file (JWE compact, A256GCM, optional zip=DEF), upload/persist the ciphertext with `uploadFile(...)` exactly once, and retain in the builder state: `type`, `ciphertextLength`, and the returned `storagePath`.
- On manifest build, for each file: if `ciphertextLength <= embeddedLengthMax` and ciphertext is present in the builder state, embed it; otherwise generate a short‑lived URL by calling `getFileURL(storagePath)` and return a `location` descriptor.
- Canonical identifier: The server should extract the 43‑character base64url entropy segment from the manifest URL path to use as the primary key for persisting and retrieving the builder state and related metadata (e.g., passcode hashes). This entropy segment is generated automatically by the SHL class and embedded in the manifest URL.

### Cryptographic profile (v1)

- File encryption: JWE Compact Serialization with direct symmetric key
  - Protected header: `{ alg: "dir", enc: "A256GCM", cty: <content-type>, zip: "DEF" }`
  - Content types we produce/consume: `application/smart-health-card`, `application/fhir+json`
  - Key: 32 random bytes (256-bit) base64url-encoded in payload `key`
- Compression: Optional raw DEFLATE (`zip: "DEF"`) before encrypting; inflate after decrypting

#### Passcode (P flag)

- The passcode is a user-supplied secret used only for server-side access control when fetching the manifest. It does not derive or replace the encryption key and is not present in the payload or manifest. Clients supply the passcode to the server when challenged.

### Data structures (types)

TypeScript type signatures to be introduced (names may evolve slightly during implementation):

```ts
export type SHLFlag = 'L' | 'P' | 'LP';

// SHLink Payload (v1)
export interface SHLinkPayloadV1 {
  url: string;                 // Manifest URL for this SHLink
  key: string;                 // Symmetric key (43 characters, base64url-encoded)
  exp?: number;                // Optional expiration time in Epoch seconds
  flag?: SHLFlag;              // Optional flag string (concatenated single-character flags)
  label?: string;              // Optional short description (max 80 characters)
  v?: 1;                       // Optional version (defaults to 1)
}

export type SHLFileContentType =
  | 'application/smart-health-card'
  | 'application/fhir+json';

// Manifest request (v1)
export interface SHLManifestRequestV1 {
  recipient: string;            // Required recipient display string
  passcode?: string;            // Conditional when 'P' flag is present
  embeddedLengthMax?: number;   // Optional upper bound for embedded payload sizes
}

// Manifest (v1)
export interface SHLManifestV1EmbeddedDescriptor {
  contentType: SHLFileContentType;
  embedded: string;              // JWE Compact serialized encrypted file
}

export interface SHLManifestV1LocationDescriptor {
  contentType: SHLFileContentType;
  location: string;             // HTTPS URL to encrypted JWE file
}

export type SHLManifestFileDescriptor = SHLManifestV1EmbeddedDescriptor | SHLManifestV1LocationDescriptor;

export interface SHLManifestV1 {
  files: SHLManifestFileDescriptor[];
}

// Files
export interface SHLFileJWE {
  type: SHLFileContentType;
  jwe: string;
}

// Resolved SHL content containing the manifest and all decrypted files.
export interface SHLResolvedContent {
  /** The fetched manifest */
  manifest: SHLManifestV1;
  /** Smart Health Cards extracted from application/smart-health-card files */
  smartHealthCards: SmartHealthCard[];
  /** FHIR resources extracted from application/fhir+json files */
  fhirResources: Resource[];
}

// Serialized builder state persisted in DB (NOT the manifest response)
export interface SerializedSHLManifestBuilderFile {
    /** Content type. */
    type: SHLFileContentType;
    /** Storage path or object key where ciphertext is persisted (for signing on demand). */
    storagePath: string;
    /** Total JWE compact length, used to decide embedding vs. location quickly. */
    ciphertextLength: number;
}

export interface SerializedSHLManifestBuilder {
  shl: SHLinkPayloadV1;
  files: SerializedSHLManifestBuilderFile[];
}

```

### Public API surface (proposed)

New module exports to add to `src/index.ts` (signatures only here):

```ts
// Creation-side utilities

/**
 * Immutable SHL class representing a Smart Health Link payload and URI.
 * This class only handles the SHLink "pointer" - the payload containing url, key, flags, etc.
 * Use SHLManifestBuilder to manage the manifest and files referenced by this SHL.
 * 
 * Note: This class uses a static factory pattern. Use `SHL.generate()` to create new instances
 * rather than calling the constructor directly.
 */
export class SHL {
  private readonly _manifestURL: string;
  private readonly _key: string;
  private readonly _expirationDate?: Date;
  private readonly _flag?: SHLFlag;
  private readonly _label?: string;
  private readonly v: 1;

  /**
   * Create an immutable SHL representing a Smart Health Link payload and URI.
   * Generates manifest path and encryption symmetric key automatically.
   * 
   * @param params.baseManifestURL - Base URL for constructing manifest URLs (e.g., 'https://shl.example.org/manifests/')
   * @param params.manifestPath - Optional manifestPath for constructing manifest URLs (e.g., '/manifest.json')
   * @param params.expirationDate - Optional expiration date for the SHLink, will fill the `exp` field in the SHLink payload.
   * @param params.flag - Optional flag for the SHLink: `L` (long-term), `P` (passcode), `LP` (long-term + passcode).
   * @param params.label - Optional label that provides a short description of the data behind the SHLink. Max length of 80 chars.
   */
  static generate(params: {
    baseManifestURL: string,
    manifestPath?: string,
    expirationDate?: Date,
    flag?: SHLFlag,
    label?: string,
  }): SHL;

  /** Generate the SHLink URI respecting the "Construct a SHLink Payload" section of the spec. */
  generateSHLinkURI(): string;

  /** Get the full manifest URL that servers must handle (POST requests as per spec). */
  get url(): string;

  /** Get the base64url-encoded encryption key for files (43 characters). */
  get key(): string;

  /** Get the expiration date if set. */
  get expirationDate(): Date | undefined;

  /** Get the SHL flags if set. */
  get flag(): SHLFlag | undefined;

  /** Get the label if set. */
  get label(): string | undefined;

  /** Get the version (always 1 for v1). */
  get version(): 1;

  /** Check if this SHL requires a passcode (has 'P' flag). */
  get requiresPasscode(): boolean;

  /** Check if this SHL is long-term (has 'L' flag). */
  get isLongTerm(): boolean;

  /** Get the SHL payload object for serialization. */
  get payload(): SHLinkPayloadV1;

  /** Get the expiration date as Unix timestamp if set. */
  get exp(): number | undefined;

  /**
   * Static factory method to create an SHL from a parsed payload.
   * Used internally by SHLViewer to reconstruct SHL objects from parsed SHLink URIs.
   * @internal
   */
  static fromPayload(payload: SHLinkPayloadV1): SHL;

  // Note: The implementation does not expose getters for baseManifestURL or manifestPath
  // as these are internal implementation details. The manifest URL is constructed
  // automatically and accessible via the `url` getter.

  // Private methods...
}

/**
 * Class that builds the manifest and files for a Smart Health Link.
 * This class handles file encryption and manifest building.
 */
export class SHLManifestBuilder {
  private readonly shl: SHL;
  private readonly uploadFile: (content: string, contentType?: SHLFileContentType) => Promise<string>;
  private readonly getFileURL: (path: string) => string;
  private readonly files: SerializedSHLManifestBuilderFile[] = [];

  /**
   * Create a manifest builder for the given SHL.
   * 
   * @param params.shl - The immutable SHL instance this builder manages
   * @param params.uploadFile - Function to upload encrypted files to the server. Returns the path of the file in the server to be used by `getFileURL`.
   * @param params.getFileURL - Function to get the URL of a file that is already uploaded to the server. Per spec, this URL SHALL be short-lived and intended for single use.
   */
  constructor(params: {
    shl: SHL;
    uploadFile: (content: string, contentType?: SHLFileContentType) => Promise<string>;
    getFileURL: (path: string) => string;
  });

  /** Add a SMART Health Card file to the manifest. Encrypts and uploads the file as JWE to the server. */
  addHealthCard(params: {
    /** SMART Health Card JWS string or SmartHealthCard object */
    shc: SmartHealthCard;
    /** Optional: Enable compression (default: false, as SHC is already compressed by default) */
    enableCompression?: boolean;
  }): Promise<void>;

  /** Add a FHIR JSON file to the manifest. Encrypts and uploads the file as JWE to the server. */
  addFHIRResource(params: {
    /** FHIR resource object */
    content: Resource;
    /** Optional: Enable compression (default: true) */
    enableCompression?: boolean;
  }): Promise<void>;
  
  /** Get the current list of files in the manifest. */
  get files(): SerializedSHLManifestBuilderFile[];

  /** Build the manifest as JSON. Considers embedded vs location files based on size thresholds. */
  buildManifest(params: { embeddedLengthMax?: number }): Promise<SHLManifestV1>;

  /**
   * Return serialized builder state for persistence (NOT SHLManifestV1).
   * Server stores this JSON in DB and reconstructs the builder on demand.
   */
  serialize(): SerializedSHLManifestBuilder;

  /**
   * Reconstruct a builder from serialized state.
   */
  static deserialize(params: {
    data: SerializedSHLManifestBuilder;
    uploadFile: (content: string, contentType?: SHLFileContentType) => Promise<string>;
    getFileURL: (path: string) => string;
  }): SHLManifestBuilder;

  // Encrypt a file into JWE (A256GCM, zip=DEF) using the SHL's encryption key
  private encryptFile(params: {
    content: string;
    type: SHLFileContentType;
    enableCompression?: boolean;
  }): Promise<SHLFileJWE>;

  // Any other private methods...
}

// Viewing-side utilities

/**
 * SHL Viewer handles parsing and resolving Smart Health Links.
 * This class processes SHLink URIs and fetches/decrypts the referenced content.
 */
export class SHLViewer {
  private readonly fetchImpl: (url: string, options?: RequestInit) => Promise<Response>;

  /**
   * Create an SHL viewer.
   * 
   * @param params.shlinkURI - The SHLink URI to parse
   * @param params.fetch - Optional fetch implementation (defaults to global fetch)
   */
  constructor(params?: {
    shlinkURI: string;
    fetch?: (url: string, options?: RequestInit) => Promise<Response>;
  });

  /** 
   * Get SHLink object from SHLink URI
   */
  get shl(): SHL;

  /**
   * Resolve a SHLink URI by fetching and decrypting all referenced content.
   * Throws errors if the SHLink is invalid, expired, or the passcode is incorrect.
   * 
   * @param params.passcode - Optional passcode for P-flagged SHLinks
   * @param params.recipient - Required recipient identifier for manifest requests
   * @param params.embeddedLengthMax - Optional max length for embedded content preference
   * @param params.shcReaderConfig - Optional configuration for Smart Health Card verification (e.g. public key)
   */
  async resolveSHLink(params: {
    passcode?: string;
    recipient: string;
    embeddedLengthMax?: number;
    shcReaderConfig?: SmartHealthCardReaderConfigParams;
  }): Promise<SHLResolvedContent>;

  /**
   * Fetch a manifest from the given URL.
   * Handles passcode challenges automatically if passcode is provided.
   */
  private async fetchManifest(params: {
    url: string;
    recipient: string;
    passcode?: string;
    embeddedLengthMax?: number;
  }): Promise<SHLManifestV1>;

  /**
   * Fetch and decrypt a file using the provided key.
   */
  private async fetchAndDecryptFile(params: {
    url: string;
    key: string;
    passcode?: string;
  }): Promise<Uint8Array>;


  // Any other private methods...
}
```

### Flags handling (v1)

- Supported: `L` (long-term) — resolving apps MAY poll the manifest for changes;
- Supported: `P` (passcode) — server-side access control; client supplies passcode out-of-band when challenged; passcode does not affect file encryption
- Unsupported in v1: `U` (direct-file)

### Errors

Introduce SHL-specific error types extending existing hierarchy in `src/index.ts`:

```ts
export class SHLError extends Error { /* code: 'SHL_ERROR' */ }
export class SHLManifestError extends SHLError { /* code: 'SHL_MANIFEST_ERROR' */ }
export class SHLNetworkError extends SHLError { /* code: 'SHL_NETWORK_ERROR' */ }
export class SHLFormatError extends SHLError { /* code: 'SHL_FORMAT_ERROR' */ }
export class SHLAuthError extends SHLError { /* code: 'SHL_AUTH_ERROR' */ }
export class SHLInvalidPasscodeError extends SHLAuthError { /* code: 'SHL_INVALID_PASSCODE_ERROR' */ }
export class SHLResolveError extends SHLError { /* code: 'SHL_RESOLVE_ERROR' */ }
export class SHLDecryptionError extends SHLResolveError { /* code: 'SHL_DECRYPTION_ERROR' */ }
export class SHLManifestNotFoundError extends SHLResolveError { /* code: 'SHL_MANIFEST_NOT_FOUND_ERROR' */ }
export class SHLManifestRateLimitError extends SHLResolveError { /* code: 'SHL_RATE_LIMIT_ERROR' */ }
export class SHLExpiredError extends SHLResolveError { /* code: 'SHL_EXPIRED_ERROR' */ }
export class SHLViewerError extends SHLError { /* code: 'SHL_VIEWER_ERROR' */ }
```

Guidelines:

- **SHLManifestBuilder Class (manifest/file operations)**:
  - Manifest structure issues → `SHLManifestError`
  - HTTP errors fetching manifest/files → `SHLNetworkError`
- **SHLViewer Class (viewing-side operations)**:
  - URI parsing failures → `SHLFormatError`
  - HTTP errors fetching manifest/files → `SHLNetworkError`
  - Invalid passcode → `SHLInvalidPasscodeError`
  - JWE decrypt/auth failures → `SHLDecryptionError`
  - SHL Manifest URL not found → `SHLManifestNotFoundError`
  - Rate limit exceeded → `SHLManifestRateLimitError`
  - Expired SHLinks → `SHLExpiredError`
  - Viewer initialization errors → `SHLViewerError`
  - Generic viewing errors → `SHLResolveError`

### Runtime compatibility

- Use `jose` for JWE (A256GCM, dir) and rely on WebCrypto in both browser and Node 18+
- Use `CompressionStream`/`DecompressionStream`
- Ensure no Node-only APIs leak into browser bundles

### Size, performance, and thresholds

- Default to embedded files when ciphertext JWE length ≤ 16 KiB to minimize round-trips; otherwise use `location` in the manifest
- For QR of SHLink URIs, a simple byte-mode QR with error correction level `M` is recommended; a dedicated SHL QR helper can be added later (v2)

### Documentation

- README: Add a section "Smart Health Links (SHL)" with minimal examples
- API docs via typedoc: include all new classes (SHL, SHLManifestBuilder, SHLViewer) and types

### Security considerations

- SHLink encryption provides confidentiality at rest/transport independent of hosting provider
- Resolving apps must treat SHL payload/manifest as untrusted until decryption passes

### Tests

- Features must be unit and integration tested

## Part 2 — Next.js Patient Portal with SHL sharing (Medplum SHL demo project)

### Overview

Build a small Next.js app that authenticates a patient against Medplum and produces a SHLink representing demographics, allergies, conditions, medications, labs, and vitals.

The app will also act as the SHL hosting server for the manifest and encrypted file(s).

### Architecture

- Next.js (App Router; server components preferred)
- Server-side routes to build and serve:
  - Create SHL: `POST /shl`
  - Retrieve Manifest: `POST /shl/manifests/:pathEntropy/manifest.json` (where `:pathEntropy` is the 43‑character base64url entropy segment extracted from the manifest URL; this value SHOULD be used as the database key)
- Client-side route to resolve the SHLink (handles a viewer-prefixed SHLink URI)
- Storage:
  - `MedplumClient` for FHIR datastore access
  - [Medplum `createBinary`](https://www.medplum.com/docs/fhir-datastore/binary-data) to store encrypted files (S3-compatible storage); `getFileURL` MUST mint short‑lived signed URLs per request
  - Supabase + Prisma ORM for storing passcode hashes and serialized SHL builder state (`SerializedSHLManifestBuilder`)
- Vercel for hosting

### Sharing flow

Flow to create an SHLink:

1. Patient logs in (standard Medplum auth flow)
2. Patient clicks “Share as Smart Health Link”
3. Patient sets a passcode
4. Server receives request at POST `/shl` and creates:
  - FHIR `Bundle` assembled from Medplum queries (Patient + Allergies + Conditions + Medications + Observations)`
  - A SMART Health Card JWS signed on the server using ES256 private key in env var (at Vercel)
5. Server uses `kill-the-clipboard` SHL APIs to:
  - Create SHL instance using `SHL.generate()` with `baseManifestURL` and optional `manifestPath`
  - Create SHL manifest with the SHL and the files
6. Server returns the SHLink URI to the browser
7. UI renders QR of the SHLink URI and a copyable link (viewer-prefixed URI)

Notes:
- CORS: allow cross-origin POST (manifest) and GET (files); do not expose sensitive headers
- Caching: respond `Cache-Control: no-store` on manifest; file URLs may be short‑lived and single‑use

### Viewing flow

Flow to resolve and display an SHLink:

1. User visits a viewer-prefixed URIs like `https://viewer.example/#shlink:/...`.
2. Client code parses the SHLink URI and gets the SHL object using `SHLViewer.shl`
3. Client code checks if the SHLink requires a passcode using `shl.requiresPasscode`
4. If the SHLink requires a passcode, the client code prompts the user for the passcode
5. Client code prompts the user for a `recipient` string, the viewing user's name
6. Client code calls `SHLViewer.resolveSHLink()` to resolve the SHLink (the method issues a `POST` to manifest `url` with JSON body `SHLManifestRequestV1` containing `recipient` and a hardcoded `embeddedLengthMax` of 4 KiB).
7. Client code handles any exceptions and displays an error message to the user (expired, not found, invalid passcode, rate limit, and generic network/decryption errors)
8. After `SHLViewer.resolveSHLink()` returns, the client code displays the SHL content to the user. Display the FHIR resources in a friendly human-readable way and SMART Health Card(s) to the user.
9. If `L` flag is set, the client code will poll the manifest for changes.

### Non-goals (v1)

- No rate limiting on manifest requests

### Key management

- Server-side only ES256 private key for SHC signing: `SHC_PRIVATE_KEY`
- ES256 public key (SPKI) `SHC_PUBLIC_KEY` (for `kid` derivation and verification in viewers)
- Passcode hashing with Argon2; constant-time comparison; global pepper from `SHL_PASSCODE_PEPPER`

### Configuration

- Env vars (Vercel):
  - `SHC_PRIVATE_KEY`
  - `SHC_PUBLIC_KEY`
  - `SHL_MANIFEST_BASE_URL` (e.g., `https://example.org/shl/manifests/`) to use as `baseManifestURL` parameter
  - Medplum credentials as required by the SDK


### Security considerations (demo)

- Treat this as sample code; do not include real PHI outside controlled environments
- Serve all SHL resources over HTTPS only
- Do not log payload keys or decrypted content
- Do not log passcodes

### Future work (post-v1)

- Introduce server‑push or webhook mechanism for `L` flag updates
- Introduce rate limiting on manifest requests  
