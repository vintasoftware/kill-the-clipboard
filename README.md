# Kill the Clipboard TypeScript Library

![Tests Badge](https://github.com/vintasoftware/kill-the-clipboard/actions/workflows/test-coverage.yml/badge.svg)

JavaScript/TypeScript universal (browser and node) library to generate QR codes containing medical records for patients to share with providers. Implements both the [SMART Health Cards Framework](https://smarthealth.cards/) and [SMART Health Links Specification](https://hl7.org/fhir/uv/smart-health-cards-and-links/links-specification.html) for handling FHIR-based medical records, enabling patients to "Kill the Clipboard" by sharing health data via secure, verifiable QR codes.

This aligns with the [CMS Interoperability Framework](https://www.cms.gov/health-technology-ecosystem/interoperability-framework) call to action for Patient Facing Apps to "Kill the Clipboard":

> We pledge to empower patients to retrieve their health records from CMS Aligned Networks or personal health record apps and share them with providers via **QR codes or SMART Health Cards/Links using FHIR bundles**. When possible, we will return visit records to patients in the same format. We commit to seamless, secure data exchange—eliminating the need for patients to repeatedly recall and write out their medical history. We are committed to "kill the clipboard," one encounter at a time.

**This is a recently released library. While it's well tested, verify the functionality before using in production. Please report any issues or suggestions to the [GitHub Issues](https://github.com/vintasoftware/kill-the-clipboard/issues) page. For sensitive security reports, please contact us at contact at vinta.com.br**

## Features

**SMART Health Cards (SHC)**
- Follows [SMART Health Cards Framework v1.4.0](https://spec.smarthealth.cards/)
- JWS generation
- File generation (.smart-health-card files)
- QR code generation with optional chunking support
- Decoding / Verification support

**SMART Health Links (SHL)**
- Implements [SMART Health Links Specification v1.0.0 STU 1](https://hl7.org/fhir/uv/smart-health-cards-and-links/links-specification.html)
- SHL URI generation per SHL specification
- `SHLManifestBuilder` for producing manifests with embedded and location file entries
- `SHLViewer` to resolve SHLs, fetch manifests, and decrypt content
- QR code generation
- Passcode flow supported at the application level (see SHL demo)

**Great Developer Experience**
- TypeScript support with full type definitions
- Comprehensive test suite
- Proper error handling hierarchy  
- Built both for Node.js and browser environments

## SMART Health Links Demo

<a href="https://kill-the-clipboard.vercel.app/"><img height="200" alt="Kill the Clipboard JavaScript / TypeScript library - SMART Health Links demo screenshot" src="https://github.com/user-attachments/assets/c3f6e30c-c932-4c81-879c-cd0bb0cba922" /></a>

Demo for SMART Health Link generation and view. Supports sharing International Patient Summary (IPS) FHIR data: allergies, medications, vitals, etc. via a passcode-protected SMART Health Link: https://kill-the-clipboard.vercel.app/

## SMART Health Cards Demo

<a href="https://vintasoftware.github.io/kill-the-clipboard/demo/shc/"><img height="200" alt="Kill the Clipboard JavaScript / TypeScript library - SMART Health Cards demo screenshot" src="https://github.com/user-attachments/assets/5e820583-9a23-4ff4-aa37-112254c8bfa5" /></a>

Interactive browser demo that showcases QR code generation and camera-based scanning: https://vintasoftware.github.io/kill-the-clipboard/demo/shc/

## Installation

```bash
npm install kill-the-clipboard
# or
pnpm add kill-the-clipboard
# or  
yarn add kill-the-clipboard
```

## Usage

### SMART Health Cards Quick Start

**Security warning**: Issue/sign on a secure backend only; never expose the ES256 private key in browsers.

Use `SHCIssuer` on the server. Use `SHCReader` in the browser or server to verify and render QR.

Typical flow: client sends FHIR Bundle → server returns JWS/.smart-health-card or QR data.

```typescript
import { SHCIssuer, SHCReader } from 'kill-the-clipboard';

// Configure issuer with your details and ES256 key pair
// SECURITY: Use issuer on a secure backend only; never include privateKey in client-side code.
const issuer = new SHCIssuer({
  issuer: 'https://your-healthcare-org.com',
  privateKey: privateKeyPKCS8String, // ES256 private key in PKCS#8 format
  publicKey: publicKeySPKIString, // ES256 public key in SPKI format
});

// Configure reader for verification (only needs public key)
const reader = new SHCReader({
  publicKey: publicKeySPKIString, // ES256 public key in SPKI format
});

// Create FHIR Bundle
const fhirBundle = {
  resourceType: 'Bundle',  
  type: 'collection',
  entry: [
    {
      fullUrl: 'https://example.org/fhir/Patient/123',
      resource: {
        resourceType: 'Patient',
        id: '123', 
        name: [{ family: 'Doe', given: ['John'] }],
        birthDate: '1990-01-01',
      },
    },
    {
      fullUrl: 'https://example.org/fhir/Immunization/456',
      resource: {
        resourceType: 'Immunization',
        id: '456',
        status: 'completed',
        vaccineCode: {
          coding: [{
            system: 'http://hl7.org/fhir/sid/cvx',
            code: '207',
            display: 'COVID-19 vaccine', 
          }],
        },
        patient: { reference: 'Patient/123' },
        occurrenceDateTime: '2023-01-15',
      },
    },
  ],
};

// Issue a new SMART Health Card
const healthCard = await issuer.issue(fhirBundle);
console.log('Health Card JWS:', healthCard.asJWS());

// Generate QR codes
const qrCodes = await healthCard.asQR();
console.log('QR code data URL:', qrCodes[0]);

// Generate numeric QR codes (shc:/ prefixed strings)
const qrNumericStrings = healthCard.asQRNumeric();
console.log('Numeric QR code:', qrNumericStrings[0]);

// Create downloadable .smart-health-card file
const blob = await healthCard.asFileBlob();
console.log('File blob created, type:', blob.type);

// Verify and read the health card
const verifiedHealthCard = await reader.fromJWS(healthCard.asJWS());
const verifiedBundle = await verifiedHealthCard.asBundle();
console.log('Verified FHIR Bundle:', verifiedBundle);

// Read from file content
const fileContent = await healthCard.asFileContent();
const healthCardFromFile = await reader.fromFileContent(fileContent);
console.log('Bundle from file:', await healthCardFromFile.asBundle());

// Read from QR numeric data (simulate scanning QR codes)
const healthCardFromQR = await reader.fromQRNumeric(qrNumericStrings);
console.log('Bundle from QR:', await healthCardFromQR.asBundle());
```

#### Usage with the VCI Directory Snapshot

The library can optionally consult the VCI directory snapshot to obtain a canonical collection of issuer metadata (JWKS and CRLs). This is useful when you want an authoritative, ready-made source of issuer keys without assembling or maintaining your own `Directory` object. In order to bundle it directly into your `SHCReader` object, you may provide the `useVciDirectory: true` parameter to its constructor. When using this, you don't need to provide a public key, as it'll also be fetched automatically.

Example usage:

```typescript
import { SHCReader } from 'kill-the-clipboard';

const reader = new SHCReader({
  useVciDirectory: true,
});
```

#### Usage with a generic Directory object

Optionally, you may also provide your own `Directory` object to the `SHCReader` constructor, through the `issuerDirectory` parameter. For more information on how to build a `Directory` instance, please check the [Directories section](#directories).
 
### SMART Health Links Quick Start

SHLs enable encrypted, link-based sharing of health information. The flow involves:

- Server issues an SHL (creates state, attributes an ID to the SHL, persists SHL builder data, hosts a manifest endpoint, and stores encrypted files)
- Client resolves the SHL using `SHLViewer`, providing the recipient identifier and (if applicable) a passcode

Server responsibilities are required for a functional SHL implementation. Refer to the demo code in `demo/shl/` for a full working example (manifest endpoint, storage handlers, and passcode handling). In summary, the SHL generation and resolution flow involves:

- On the server side, during SHL creation:
    1. Create an `SHL` instance with `SHL.generate({ baseManifestURL, manifestPath, expirationDate?, label?, flag? })`
    2. Attribute a server-generated ID to the SHL (useful to identify the SHL and related models in the database)
    2. Use `SHLManifestBuilder` with implementations for `uploadFile`, `getFileURL`, and `loadFile` that persist encrypted files and return retrievable URLs
    3. Add content: `addFHIRResource({ content, enableCompression? })`, `addHealthCard({ shc, enableCompression? })`
    4. Persist the builder state via `toDBAttrs()`
    5. Return the SHL URI to clients via `shl.toURI()`
- On the client side, during SHL resolution:
    1. Create a `SHLViewer` instance with the SHL URI
    2. Resolve the SHL using `resolveSHL({ recipient, passcode?, embeddedLengthMax?, shcReaderConfig? })`
- On the server side, after client resolves the SHL:
    1. Implement a POST manifest endpoint at `baseManifestURL + manifestPath`
    2. On each manifest request, load the builder state from the database, reconstruct the builder with `fromDBAttrs()`, call `buildManifest({ embeddedLengthMax? })`, and return the manifest JSON

#### Complete SHL End-to-End Example

Here's a condensed single-file example demonstrating the complete SHL workflow from creation to resolution:

```typescript
import { 
  SHL, 
  SHLManifestBuilder, 
  SHLViewer
} from 'kill-the-clipboard';

// Mock storage for this example
const uploadedFiles = new Map<string, string>();
const uploadFile = async (content: string) => {
  const path = `file-${uploadedFiles.size + 1}`;
  uploadedFiles.set(path, content);
  return path;
};
const getFileURL = async (path: string) => `https://files.example.org/${path}`;
const loadFile = async (path: string) => uploadedFiles.get(path);

// 1. [Server side] Generate an SHL
const shl = SHL.generate({
  id: 'some-uuid', // Optional: server-generated ID for database
  baseManifestURL: 'https://shl.example.org/manifests/',
  manifestPath: '/manifest.json',
  label: 'Complete Test Card',
});

// 2. [Server side] Create manifest builder with mocked file handling
const builder = new SHLManifestBuilder({
  shl,
  uploadFile: uploadFile,
  getFileURL: getFileURL,
  loadFile: loadFile,
});

// 3. [Server side] Add a FHIR bundle as content
const fhirBundle = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      fullUrl: 'https://example.org/fhir/Patient/123',
      resource: {
        resourceType: 'Patient',
        id: '123',
        name: [{ family: 'Doe', given: ['John'] }],
        birthDate: '1990-01-01',
      },
    },
  ],
};
await builder.addFHIRResource({ content: fhirBundle });

// 4. [Server side] Persist the manifest builder state in the database
const builderAttrs = builder.toDBAttrs();
await storeBuilderAttrs('some-uuid', builderAttrs); // Implement your own function

// 5. [Server side] Generate the SHL URI for sharing
const shlinkURI = shl.toURI();
console.log('Share this SHL:', `https://viewer.example/#${shlinkURI}`);

// 6. [Server side] Implement manifest and file serving
const fetchImpl = async (url: string, init?: RequestInit) => {
  // Handle manifest requests
  if (init?.method === 'POST' && url === shl.url) {
    // Load the builder state from the database
    const builderAttrs = await loadBuilderAttrs('some-uuid');  // Implement your own function

    // Reconstruct the builder
    const builder = SHLManifestBuilder.fromDBAttrs({
      attrs: builderAttrs,
      uploadFile: uploadFile,
      getFileURL: getFileURL,
      loadFile: loadFile,
    });

    // Build the manifest
    const body = JSON.parse(init.body);
    const manifest = await builder.buildManifest({
      embeddedLengthMax: body.embeddedLengthMax,
    });

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(manifest),
    };
  }

  // Handle file requests (could be an S3-like storage instead)
  const fileId = url.split('/').pop();
  if (init?.method === 'GET' && fileId && uploadedFiles.has(fileId)) {
    return {
      ok: true,
      status: 200,
      text: async () => uploadedFiles.get(fileId),
    };
  }

  return { ok: false, status: 404, text: async () => '' };
};

// 7. Use SHLViewer to resolve the SHL (client-side)
const viewer = new SHLViewer({ 
  shlinkURI: `https://viewer.example/#${shlinkURI}`, 
  // Note: No need to pass fetch implementation if you have a real server-side implementation:
  fetch: fetchImpl
});
const resolved = await viewer.resolveSHL({
  recipient: 'alice@example.org',
  embeddedLengthMax: 4096 // Files smaller than this will be embedded
});

// 8. Access the resolved content
console.log('Resolved FHIR resources:', resolved.fhirResources);
```

This example above demonstrates the complete lifecycle: SHL generation, content addition, manifest builder persistence in server-side database, manifest serving, and client-side resolution. In a real application, you would implement persistence for the manifest builder state and serve the manifest endpoint from your backend server.

### Directories
A `Directory` is a lightweight, serializable collection of issuer metadata used by this library: each entry contains an issuer URL, its JWK descriptors (public keys) and optional CRL entries (revoked resource ids).

It provides a local/cached source of JWKS + CRL data so verification and lookup code can resolve public keys and revocation information without hitting network endpoints repeatedly.

It can be built through the following methods:

1. Build from a JSON manifest: `Directory.fromJSON`
2. Build by fetching from issuer endpoints: `Directory.fromURLs`
3. Build by loading the VCI snapshot: `Directory.fromVCI`

#### Building a Directory from VCI Snapshot
`Directory.fromVCI` is a convenience helper that fetches the VCI Directory snapshot published by The Commons Project and returns a Directory instance built from that snapshot.

Use it when you want a quick, canonical directory of issuer metadata (JWKS + CRLs) without manually assembling or maintaining a directory JSON.

```typescript
import { Directory } from 'kill-the-clipboard'

// top-level async context or inside an async function
try {
  const directory = await Directory.fromVCI()
  const issuers = directory.getIssuers()
  console.log('Loaded issuers:', issuers.length)
} catch (err) {
  console.error('Failed to load VCI Directory:', err)
}
```

### Error Handling

The library provides granular error handling with specific error codes for different failure scenarios. Check each method documentation for the specific errors that can be thrown.

## API Reference Documentation

Available at [https://vintasoftware.github.io/kill-the-clipboard/](https://vintasoftware.github.io/kill-the-clipboard/).

### Generating Documentation

To generate and view the full API documentation locally:

```bash
# Generate documentation
pnpm docs:build

# The documentation will be generated in the ./docs directory
# Open docs/index.html in your browser to view the complete API reference
```

## Advanced Usage

### SMART Health Cards Advanced Usage

```typescript
import { 
  SHCIssuer,
  SHCReader,
  FHIRBundleProcessor, 
  VerifiableCredentialProcessor,
  JWSProcessor,
  QRCodeGenerator 
} from 'kill-the-clipboard';

// High-level API with SHC object
const issuer = new SHCIssuer(config);
const healthCard = await issuer.issue(fhirBundle, {
  includeAdditionalTypes: ['https://smarthealth.cards#covid19'],
});

// SHC provides various output formats
const qrCodes = await healthCard.asQR({
  enableChunking: false,
  encodeOptions: {
    errorCorrectionLevel: 'L',
    scale: 4,
  },
});

const bundle = await healthCard.asBundle({ optimizeForQR: true, strictReferences: true });
const fileContent = await healthCard.asFileContent();

// Use individual processors for more control
const bundleProcessor = new FHIRBundleProcessor();
const vcProcessor = new VerifiableCredentialProcessor();
const jwsProcessor = new JWSProcessor();

// Process FHIR Bundle (standard processing)
const processedBundle = bundleProcessor.process(fhirBundle);
bundleProcessor.validate(processedBundle);

// Or process with QR code optimizations (shorter resource references, removes unnecessary fields)
// Use 'strictReferences' option. When true, missing references throw an error.
// When false, original references are preserved if target resource is not found in bundle.
const optimizedBundle = bundleProcessor.processForQR(fhirBundle, { strictReferences: true });
bundleProcessor.validate(optimizedBundle);

// Create Verifiable Credential
const vc = vcProcessor.create(processedBundle, {
  fhirVersion: '4.0.1',
  includeAdditionalTypes: [
    'https://smarthealth.cards#immunization',
    'https://smarthealth.cards#covid19',
  ],
});

// Create JWT payload
const jwtPayload = {
  iss: 'https://your-org.com',
  nbf: Math.floor(Date.now() / 1000),
  vc: vc.vc,
};

// Sign to create JWS
const jws = await jwsProcessor.sign(jwtPayload, privateKey, publicKey, {
  enableCompression: true, // Enable compression per SMART Health Cards spec
});

// Verify JWS
const verified = await jwsProcessor.verify(jws, publicKey);

// Generate QR codes
const qrGenerator = new QRCodeGenerator({
  // maxSingleQRSize auto-derived from errorCorrectionLevel if not specified:
  // L: 1195, M: 927, Q: 670, H: 519 (V22 limits from SMART Health Cards QR FAQ)
  // See: https://github.com/smart-on-fhir/health-cards/blob/main/FAQ/qr.md
  enableChunking: false, // Use single QR mode (recommended)
  encodeOptions: {
    errorCorrectionLevel: 'L', // L per SMART Health Cards spec
    scale: 4, // QR code scale factor
    margin: 1, // Quiet zone size
    color: { dark: '#000000ff', light: '#ffffffff' },
    // Optional: version, maskPattern, width
  }
});

const qrDataUrls = await qrGenerator.generateQR(jws);
console.log('Generated QR code data URL:', qrDataUrls[0]);

// Scan QR codes (simulate scanning with numeric data)
const scannedData = ['shc:/56762959532654603460292540772804336028702864716745...'];
const reconstructedJWS = await qrGenerator.decodeQR(scannedData);

// Manual JWS chunking and numeric conversion
const chunks = qrGenerator.chunkJWS(jws); // Returns array of shc:/ prefixed strings
const numericData = qrGenerator.encodeJWSToNumeric(jws);
const decodedJWS = qrGenerator.decodeNumericToJWS(numericData);
```

### SMART Health Cards File Operations

```typescript
import { SHCIssuer, SHCReader } from 'kill-the-clipboard';

const issuer = new SHCIssuer(config);
const reader = new SHCReader({ publicKey: config.publicKey });

// Issue a health card
const healthCard = await issuer.issue(fhirBundle);

// Create SMART Health Card file content (JSON wrapper with verifiableCredential array)
const fileContent = await healthCard.asFileContent();
console.log('File content:', fileContent); // JSON string with { verifiableCredential: [jws] }

// Create downloadable Blob (browser-compatible)
const blob = await healthCard.asFileBlob();
console.log('Blob type:', blob.type); // 'application/smart-health-card'

// Trigger download in browser (example implementation)
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'vaccination-card.smart-health-card';
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);

// Verify health card from file content
const verifiedFromFile = await reader.fromFileContent(fileContent);
console.log('Valid health card bundle:', await verifiedFromFile.asBundle());

// Verify health card from Blob (e.g., from file input)
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file && file.name.endsWith('.smart-health-card')) {
    try {
      const verified = await reader.fromFileContent(file);
      console.log('Valid health card:', await verified.asBundle());
      
      // Or get QR codes from the verified health card
      const qrCodes = await verified.asQR();
      console.log('QR code data URL:', qrCodes[0]);
    } catch (error) {
      console.error('Invalid health card file:', error.message);
    }
  }
});
```

### Generating ES256 Key Pairs for SMART Health Cards

```typescript
// Generate ES256 key pair for testing (Node.js 18+)
import crypto from 'crypto';
import { exportPKCS8, exportSPKI } from 'jose';

// Requires Node.js 18+ for crypto.webcrypto.subtle
const { publicKey, privateKey } = await crypto.webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);

const privateKeyPKCS8 = await exportPKCS8(privateKey);
const publicKeySPKI = await exportSPKI(publicKey);

// Use these keys in SHCIssuer config
const config = {
  issuer: 'https://your-org.com',
  privateKey: privateKeyPKCS8,
  publicKey: publicKeySPKI,
};
```

## Security notes and limitations

- **Secure backend only**: Issue/sign SHCs on a secure backend; never expose ES256 private keys in browsers. SHLs are not signed; encrypt SHL files (JWE) and serve manifests/files from a secure backend.
- **No X.509 Certificate Validation**: SHC verification uses a provided public key or the issuer's JWKS. X.509 certificate chain validation (x5c/PKI-based trust) is not implemented. If you require PKI-based trust, implement certificate validation out of band or extend the verification flow.
- **Untrusted Content**: Treat SHC content as untrusted until signature verification succeeds, and treat SHL payloads/manifests as untrusted until decryption succeeds.
- **Passcode Security**: The SHL `P` flag is server-side access control only. Passcodes are never part of encryption and are not present in payloads/manifests.
- **HTTPS Only**: All SHL manifest and file URLs must be served over HTTPS to prevent interception.
- **Short-Lived file URLs**: File location URLs should be short-lived and single-use to minimize exposure window.
- **No Logging**: Never log encryption keys, passcodes, or decrypted content in server logs.
- **No Built-in Rate Limiting**: Manifest endpoint rate limiting must be implemented separately.

### Production Deployment Requirements

- **Proper Database**: Use a production database (PostgreSQL, MySQL, etc.) for manifest builder persistence.
- **Secure Passcode Storage**: Implement proper password hashing with salt and pepper (Argon2 recommended).
- **Access Control**: Implement proper authentication and authorization for manifest endpoints.
- **Rate Limiting**: Add rate limiting and abuse protection for manifest and file endpoints.
- **Monitoring**: Implement logging and monitoring while avoiding sensitive data exposure.
- **Backup Strategy**: Ensure encrypted files and DB records are properly backed up.
- **Key Rotation**: Plan for encryption key rotation and migration strategies.

## Future Work

- **No `application/smart-api-access`**: SMART on FHIR API access tokens are not supported in content types.
- **No Built-in Automatic Refresh for SHLs with `L` Flag**: Long-term SHLs (`L` flag) require manual implementation of polling or push notifications for updates.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License  

MIT License - see [LICENSE](LICENSE) file for details.

## Commercial Support

[![alt text](https://avatars2.githubusercontent.com/u/5529080?s=80&v=4 "Vinta Logo")](https://www.vinta.com.br/)

This project is maintained by [Vinta Software](https://www.vinta.com.br/). We offer design and development services for healthcare companies. If you need any commercial support, feel free to get in touch: contact@vinta.com.br
