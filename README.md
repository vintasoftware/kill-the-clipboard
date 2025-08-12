# Kill the Clipboard JavaScript / TypeScript Library

JavaScript/TypeScript universal (browser and node) library to generate QR codes containing medical records for patients to share with providers. Implements the [SMART Health Cards Framework](https://smarthealth.cards/) for FHIR-based medical records, enabling patients to "Kill the Clipboard" by sharing health data via secure, verifiable QR codes.

Smart Health Links support is coming soon.

This aligns with the [CMS Interoperability Framework](https://www.cms.gov/health-technology-ecosystem/interoperability-framework) call to action for Patient Facing Apps to "Kill the Clipboard":

> We pledge to empower patients to retrieve their health records from CMS Aligned Networks or personal health record apps and share them with providers via **QR codes or Smart Health Cards/Links using FHIR bundles**. When possible, we will return visit records to patients in the same format. We commit to seamless, secure data exchange—eliminating the need for patients to repeatedly recall and write out their medical history. We are committed to "kill the clipboard," one encounter at a time.

⚠️ **This is a new library. While it's well tested, please verify the proper functionality before using in production. Please report any issues or suggestions to the [GitHub Issues](https://github.com/vintasoftware/kill-the-clipboard/issues) page.**

## Features

**Complete SMART Health Cards Implementation**
- Follows [SMART Health Cards Framework v1.4.0](https://spec.smarthealth.cards/)
- FHIR R4 Bundle processing and basic structural validation  
- ES256 cryptographic signing
- DEFLATE payload compression
- File generation (.smart-health-card files)
- QR code generation with optional chunking support
- Encoding and decoding support

**Smart Health Links**
- Support for Smart Health Links is coming soon.

**Great Developer Experience**
- TypeScript support with full type definitions
- Comprehensive test suite (100+ tests)
- Proper error handling hierarchy  
- Built for Node.js and browser environments
- Web-compatible file operations

## Installation

```bash
npm install kill-the-clipboard
# or
pnpm add kill-the-clipboard
# or  
yarn add kill-the-clipboard
```

## Usage

### Basic Usage

```typescript
import { SmartHealthCard } from 'kill-the-clipboard';

// Configure with your issuer details and ES256 key pair
const healthCard = new SmartHealthCard({
  issuer: 'https://your-healthcare-org.com',
  privateKey: privateKeyPKCS8String, // ES256 private key in PKCS#8 format
  publicKey: publicKeySPKIString,     // ES256 public key in SPKI format
});

// Create SMART Health Card from FHIR Bundle
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

// Generate signed SMART Health Card (JWS format)
const signedHealthCard = await healthCard.create(fhirBundle);
console.log('Health Card JWS:', signedHealthCard);

// Verify the health card and get the FHIR Bundle
const verifiedBundle = await healthCard.getBundle(signedHealthCard);
console.log('Verified FHIR Bundle:', verifiedBundle);

// Or use the full verify method to get the complete verifiable credential
const verifiedCredential = await healthCard.verify(signedHealthCard);
console.log('Complete credential:', verifiedCredential);

// Generate downloadable .smart-health-card file
const blob = await healthCard.createFileBlob(fhirBundle);
console.log('File blob created, type:', blob.type);
```

### Advanced Usage

```typescript
import { 
  SmartHealthCard,
  FhirBundleProcessor, 
  VerifiableCredentialProcessor,
  JWSProcessor,
  QRCodeGenerator 
} from 'kill-the-clipboard';

// Use individual processors for more control
const fhirProcessor = new FhirBundleProcessor();
const vcProcessor = new VerifiableCredentialProcessor();
const jwsProcessor = new JWSProcessor();

// Process FHIR Bundle (standard processing)
const processedBundle = fhirProcessor.process(fhirBundle);
fhirProcessor.validate(processedBundle);

// Or process with QR code optimizations (shorter resource references, removes unnecessary fields)
// Pass 'strict' as the second argument. When strict=true, missing references throw an error.
// When strict=false, original references are preserved if target resource is not found in bundle.
const optimizedBundle = fhirProcessor.processForQR(fhirBundle, true);
fhirProcessor.validate(optimizedBundle);

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
const jws = await jwsProcessor.sign(jwtPayload, privateKey, publicKey);

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
    scale: 4,                  // QR code scale factor
    margin: 1,                 // Quiet zone size
    color: { dark: '#000000ff', light: '#ffffffff' },
    // Optional: version, maskPattern, width
  }
});

const qrDataUrls = await qrGenerator.generateQR(jws);
console.log('Generated QR code data URL:', qrDataUrls[0]);

// Scan QR codes (simulate scanning with numeric data)
const scannedData = ['shc:/56762959532654603460292540772804336028702864716745...'];
const reconstructedJWS = await qrGenerator.scanQR(scannedData);

// Manual JWS chunking and numeric conversion
const chunks = qrGenerator.chunkJWS(jws); // Returns array of shc:/ prefixed strings
const numericData = qrGenerator.encodeJWSToNumeric(jws);
const decodedJWS = qrGenerator.decodeNumericToJWS(numericData);
```

### Error Handling

```typescript
import { 
  SmartHealthCard, 
  SmartHealthCardError,
  FhirValidationError,
  JWSError,
  QRCodeError 
} from 'kill-the-clipboard';

try {
  const jws = await healthCard.create(fhirBundle);
} catch (error) {
  if (error instanceof FhirValidationError) {
    console.error('FHIR Bundle validation failed:', error.message);
  } else if (error instanceof JWSError) {
    console.error('JWT/JWS processing failed:', error.message);
  } else if (error instanceof QRCodeError) {
    console.error('QR code processing failed:', error.message);
  } else if (error instanceof SmartHealthCardError) {
    console.error('SMART Health Card error:', error.message, error.code);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### File Operations

```typescript
import { SmartHealthCard } from 'kill-the-clipboard';

const healthCard = new SmartHealthCard(config);

// Create SMART Health Card file content (JSON wrapper with verifiableCredential array)
const fileContent = await healthCard.createFile(fhirBundle);
console.log('File content:', fileContent); // JSON string with { verifiableCredential: [jws] }

// Create downloadable Blob (web-compatible)
const blob = await healthCard.createFileBlob(fhirBundle);
console.log('Blob type:', blob.type); // 'application/smart-health-card'

// Trigger download in web browser (example implementation)
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'vaccination-card.smart-health-card';
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);

// Verify health card from file content
const verifiedFromFile = await healthCard.verifyFile(fileContent);

// Verify health card from Blob (e.g., from file input)
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file && file.name.endsWith('.smart-health-card')) {
    try {
      const verified = await healthCard.verifyFile(file);
      console.log('Valid health card:', verified.vc.credentialSubject.fhirBundle);
      
      // Or directly get the FHIR Bundle
      const bundle = await healthCard.getBundleFromFile(file);
      console.log('FHIR Bundle from file:', bundle);
    } catch (error) {
      console.error('Invalid health card file:', error.message);
    }
  }
});
```

### Generating ES256 Key Pairs

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

// Use these keys in SmartHealthCard config
const config = {
  issuer: 'https://your-org.com',
  privateKey: privateKeyPKCS8,
  publicKey: publicKeySPKI,
};
```

## API Reference

### `SmartHealthCard`

Main class for creating and verifying SMART Health Cards.

#### Constructor

```typescript
new SmartHealthCard(config: SmartHealthCardConfigParams)
```

**Configuration Parameters:**
```typescript
interface SmartHealthCardConfigParams {
  issuer: string // Issuer URL
  privateKey: CryptoKey | Uint8Array | string // ES256 private key
  publicKey: CryptoKey | Uint8Array | string // ES256 public key  
  expirationTime?: number | null // Optional expiration in seconds from now (default: null)
  enableQROptimization?: boolean // Enable FHIR Bundle optimization for QR codes (default: true)
  strictReferences?: boolean // Throw on missing references when optimizing for QR (default: true)
}
```

#### Methods

- `create(fhirBundle: FhirBundle, options?: VerifiableCredentialOptions): Promise<string>` - Creates a signed SMART Health Card JWS (supports additional VC types via `options.includeAdditionalTypes`)
- `verify(jws: string): Promise<VerifiableCredential>` - Verifies and decodes a SMART Health Card
- `getBundle(jws: string): Promise<FhirBundle>` - Verifies and returns the FHIR Bundle directly (convenience method)
- `createFile(fhirBundle: FhirBundle, options?: VerifiableCredentialOptions): Promise<string>` - Creates file content for .smart-health-card files (supports additional VC types via `options.includeAdditionalTypes`)
- `createFileBlob(fhirBundle: FhirBundle, options?: VerifiableCredentialOptions): Promise<Blob>` - Creates downloadable Blob (supports additional VC types via `options.includeAdditionalTypes`)
- `verifyFile(fileContent: string | Blob): Promise<VerifiableCredential>` - Verifies from file content
- `getBundleFromFile(fileContent: string | Blob): Promise<FhirBundle>` - Verifies file and returns FHIR Bundle directly (convenience method)

### `FhirBundleProcessor`

Processes and validates FHIR R4 Bundles according to SMART Health Cards specification.

- `process(bundle: FhirBundle): FhirBundle` - Processes Bundle (sets default type="collection")
- `processForQR(bundle: FhirBundle, strict: boolean): FhirBundle` - Processes Bundle with QR code optimizations (short resource-scheme URIs, removes unnecessary fields). When `strict` is true, missing `Reference.reference` targets throw `InvalidBundleReferenceError`; when false, original references are preserved when no target resource is found in bundle.
- `validate(bundle: FhirBundle): boolean` - Validates Bundle structure

### `VerifiableCredentialProcessor`

Creates and validates W3C Verifiable Credentials for SMART Health Cards.

- `create(fhirBundle: FhirBundle, options?): VerifiableCredential` - Creates W3C VC
- `validate(vc: VerifiableCredential): boolean` - Validates VC structure

### `JWSProcessor`

Handles JWT/JWS signing and verification with ES256 algorithm. Payloads are raw-DEFLATE compressed when `zip: "DEF"` is set.

- `sign(payload: SmartHealthCardJWT, privateKey, publicKey, enableCompression?: boolean): Promise<string>` - Signs JWT (compresses payload before signing and sets `zip: "DEF"` when `enableCompression` is true; default is true). The `kid` is derived from the public key using RFC7638 JWK Thumbprint as required by SMART Health Cards spec.
- `verify(jws: string, publicKey): Promise<SmartHealthCardJWT>` - Verifies JWS and returns payload
- To inspect headers without verification, use `jose.decodeProtectedHeader(jws)` from the `jose` library

### `QRCodeGenerator`

Generates and scans QR codes for SMART Health Cards with proper numeric encoding and SMART Health Cards specification compliance.

#### Configuration Options

- `maxSingleQRSize?: number` - Maximum size for single QR code (auto-derived from errorCorrectionLevel if not provided: L=1195, M=927, Q=670, H=519 per [V22 QR limits](https://github.com/smart-on-fhir/health-cards/blob/main/FAQ/qr.md))
- `enableChunking?: boolean` - Whether to support multi-chunk QR codes (deprecated per SMART Health Cards spec)
- `encodeOptions?: QREncodeOptions` - Options passed to the QR encoder:
  - `errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'` - Error correction level (default: 'L')
  - `scale?: number` - QR code scale factor (default: 4)
  - `margin?: number` - Quiet zone size (default: 1)
  - `color?: { dark?: string; light?: string }` - Module and background colors in hex format
  - `version?: number` - QR version 1-40 (auto-selected by default)
  - `maskPattern?: number` - Mask pattern 0-7
  - `width?: number` - Forces specific width for output

#### Methods

- `generateQR(jws: string): Promise<string[]>` - Generates QR code data URLs
- `scanQR(qrCodeData: string[]): Promise<string>` - Reconstructs JWS from QR data
- `encodeJWSToNumeric(jws: string): string` - Converts JWS to numeric format (Ord(c)-45)
- `decodeNumericToJWS(numericData: string): string` - Converts numeric data back to JWS string
- `chunkJWS(jws: string): string[]` - Splits JWS into balanced chunks for multi-QR encoding (returns `shc:/...` strings; chunked form uses `shc:/INDEX/TOTAL/DATA`)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License  

MIT License - see [LICENSE](LICENSE) file for details.

## Commercial Support

[![alt text](https://avatars2.githubusercontent.com/u/5529080?s=80&v=4 "Vinta Logo")](https://www.vinta.com.br/)

This project is maintained by [Vinta Software](https://www.vinta.com.br/). We offer design and development services for healthcare companies. If you need any commercial support, feel free to get in touch: contact@vinta.com.br
