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
import { SmartHealthCardIssuer, SmartHealthCardReader } from 'kill-the-clipboard';

// Configure issuer with your details and ES256 key pair
const issuer = new SmartHealthCardIssuer({
  issuer: 'https://your-healthcare-org.com',
  privateKey: privateKeyPKCS8String, // ES256 private key in PKCS#8 format
  publicKey: publicKeySPKIString,     // ES256 public key in SPKI format
});

// Configure reader for verification (only needs public key)
const reader = new SmartHealthCardReader({
  publicKey: publicKeySPKIString,     // ES256 public key in SPKI format
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

### Advanced Usage

```typescript
import { 
  SmartHealthCardIssuer,
  SmartHealthCardReader,
  FHIRBundleProcessor, 
  VerifiableCredentialProcessor,
  JWSProcessor,
  QRCodeGenerator 
} from 'kill-the-clipboard';

// High-level API with SmartHealthCard object
const issuer = new SmartHealthCardIssuer(config);
const healthCard = await issuer.issue(fhirBundle, {
  includeAdditionalTypes: ['https://smarthealth.cards#covid19'],
});

// SmartHealthCard provides various output formats
const qrCodes = await healthCard.asQR({
  enableChunking: false,
  encodeOptions: {
    errorCorrectionLevel: 'L',
    scale: 4,
  },
});

const bundle = await healthCard.asBundle(true, true); // optimizeForQR, strictReferences
const fileContent = await healthCard.asFileContent();

// Use individual processors for more control
const fhirProcessor = new FHIRBundleProcessor();
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
  SmartHealthCardIssuer,
  SmartHealthCardReader,
  SmartHealthCardError,
  FhirValidationError,
  JWSError,
  QRCodeError 
} from 'kill-the-clipboard';

const issuer = new SmartHealthCardIssuer(config);
const reader = new SmartHealthCardReader({ publicKey: config.publicKey });

try {
  const healthCard = await issuer.issue(fhirBundle);
  const qrCodes = await healthCard.asQR();
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

try {
  const verifiedCard = await reader.fromJWS(jws);
  const bundle = await verifiedCard.asBundle();
} catch (error) {
  console.error('Verification failed:', error.message);
}

try {
  const qrNumeric = 'shc:/56762959532654603460292540772804336028...';
  const verifiedCard = await reader.fromQRNumeric(qrNumeric);
  const bundle = await verifiedCard.asBundle();
} catch (error) {
  console.error('QR numeric verification failed:', error.message);
}
```

### File Operations

```typescript
import { SmartHealthCardIssuer, SmartHealthCardReader } from 'kill-the-clipboard';

const issuer = new SmartHealthCardIssuer(config);
const reader = new SmartHealthCardReader({ publicKey: config.publicKey });

// Issue a health card
const healthCard = await issuer.issue(fhirBundle);

// Create SMART Health Card file content (JSON wrapper with verifiableCredential array)
const fileContent = await healthCard.asFileContent();
console.log('File content:', fileContent); // JSON string with { verifiableCredential: [jws] }

// Create downloadable Blob (web-compatible)
const blob = await healthCard.asFileBlob();
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

// Use these keys in SmartHealthCardIssuer config
const config = {
  issuer: 'https://your-org.com',
  privateKey: privateKeyPKCS8,
  publicKey: publicKeySPKI,
};
```

## API Reference

### High-Level API

#### `SmartHealthCardIssuer`

Issues new SMART Health Cards from FHIR Bundles.

##### Constructor

```typescript
new SmartHealthCardIssuer(config: SmartHealthCardConfigParams)
```

##### `config`
Type: `SmartHealthCardConfigParams`

Configuration object for the issuer.

###### `issuer`
Type: `String`  
Required: Yes

Issuer URL that identifies the organization issuing the health card.

###### `privateKey`
Type: `CryptoKey | Uint8Array | String`  
Required: Yes

ES256 private key for signing health cards. Can be a WebCrypto CryptoKey, raw bytes, or PEM-formatted string.

###### `publicKey` 
Type: `CryptoKey | Uint8Array | String`  
Required: Yes

ES256 public key corresponding to the private key. Used for key ID derivation per SMART Health Cards spec.

###### `expirationTime`
Type: `Number | null`  
Default: `null`

Optional expiration time in seconds from now. If null, health cards will not have an expiration.

###### `enableQROptimization`
Type: `Boolean`  
Default: `true`

Whether to optimize FHIR Bundle for QR codes by using short resource-scheme URIs and removing unnecessary fields.

###### `strictReferences`
Type: `Boolean`  
Default: `true`

If true, throws error for missing bundle references during optimization. If false, preserves original references when target resource is not found.

##### Methods

###### `issue(fhirBundle, [options])`

Issues a new SMART Health Card from a FHIR Bundle.

```typescript
issue(fhirBundle: FHIRBundle, options?: VerifiableCredentialParams): Promise<SmartHealthCard>
```

**Parameters:**

- `fhirBundle`: FHIR R4 Bundle containing medical data
- `options`: Optional Verifiable Credential parameters

**Returns:** Promise resolving to SmartHealthCard object

**Example:**
```typescript
const issuer = new SmartHealthCardIssuer(config);
const healthCard = await issuer.issue(fhirBundle, {
  includeAdditionalTypes: ['https://smarthealth.cards#covid19']
});
```

---

#### `SmartHealthCard`

Represents an issued SMART Health Card with various output formats.

##### Methods

###### `asQR([config])`

Generate QR code data URLs from the health card.

```typescript
asQR(config?: QRCodeConfigParams): Promise<string[]>
```

**Parameters:**
- `config`: Optional QR code generation configuration

**Returns:** Promise resolving to array of QR code data URLs

**Example:**
```typescript
const qrCodes = await healthCard.asQR({
  enableChunking: false,
  encodeOptions: {
    errorCorrectionLevel: 'L',
    scale: 4
  }
});
```

###### `asQRNumeric([config])`

Generate QR numeric strings from the health card.

```typescript
asQRNumeric(config?: QRCodeConfigParams): string[]
```

**Parameters:**
- `config`: Optional QR code generation configuration

**Returns:** Array of QR numeric strings in SMART Health Cards format (`shc:/...`)

**Example:**
```typescript
const qrNumericStrings = healthCard.asQRNumeric();
console.log(qrNumericStrings[0]); // "shc:/567629595326546034602925..."

// With chunking for large health cards
const chunkedStrings = healthCard.asQRNumeric({
  enableChunking: true,
  maxSingleQRSize: 500
});
```

###### `asBundle([optimizeForQR], [strictReferences])`

Return the FHIR Bundle from the health card.

```typescript
asBundle(optimizeForQR?: boolean, strictReferences?: boolean): Promise<FHIRBundle>
```

**Parameters:**
- `optimizeForQR`: Whether to apply QR code optimizations
- `strictReferences`: Whether to enforce strict reference validation

**Returns:** Promise resolving to FHIR Bundle

###### `asFileContent()`

Return JSON file content for .smart-health-card files.

```typescript
asFileContent(): Promise<string>
```

**Returns:** Promise resolving to JSON string with verifiableCredential array

###### `asFileBlob()`

Return downloadable Blob with correct MIME type.

```typescript
asFileBlob(): Promise<Blob>
```

**Returns:** Promise resolving to Blob with `application/smart-health-card` MIME type

###### `asJWS()`

Return the raw JWS string.

```typescript
asJWS(): string
```

**Returns:** JWS string

###### `getOriginalBundle()`

Return the original (unoptimized) FHIR Bundle.

```typescript
getOriginalBundle(): FHIRBundle
```

**Returns:** Original FHIR Bundle

---

#### `SmartHealthCardReader`

Reads and verifies SMART Health Cards from various sources.

##### Constructor

```typescript
new SmartHealthCardReader(config: SmartHealthCardReaderConfigParams)
```

##### `config`
Type: `SmartHealthCardReaderConfigParams`

Configuration object for the reader.

###### `publicKey`
Type: `CryptoKey | Uint8Array | String`  
Required: Yes

ES256 public key for verifying health card signatures.

###### `enableQROptimization`
Type: `Boolean`  
Default: `true`

Whether to optimize FHIR Bundle for QR codes when reading.

###### `strictReferences`
Type: `Boolean`  
Default: `true`

Whether to enforce strict reference validation during optimization.

##### Methods

###### `fromJWS(jws)`

Read and verify a SMART Health Card JWS.

```typescript
fromJWS(jws: string): Promise<SmartHealthCard>
```

**Parameters:**
- `jws`: JWS string to verify

**Returns:** Promise resolving to verified SmartHealthCard object

###### `fromFileContent(fileContent)`

Read and verify a SMART Health Card from file content.

```typescript
fromFileContent(fileContent: string | Blob): Promise<SmartHealthCard>
```

**Parameters:**
- `fileContent`: File content as string or Blob from .smart-health-card files

**Returns:** Promise resolving to verified SmartHealthCard object

###### `fromQRNumeric(qrNumeric)`

Read and verify a SMART Health Card from QR numeric data.

```typescript
fromQRNumeric(qrNumeric: string): Promise<SmartHealthCard>
fromQRNumeric(qrNumericChunks: string[]): Promise<SmartHealthCard>
```

**Parameters:**
- `qrNumeric`: Single QR code numeric string (format: `shc:/...`)
- `qrNumericChunks`: Array of chunked QR code numeric strings (format: `shc:/index/total/...`)

**Returns:** Promise resolving to verified SmartHealthCard object

**Example:**
```typescript
// Single QR code
const qrNumeric = 'shc:/56762959532654603460292540772804336028...';
const healthCard = await reader.fromQRNumeric(qrNumeric);

// Chunked QR codes
const chunkedQR = [
  'shc:/1/2/567629595326546034602925',
  'shc:/2/2/407728043360287028647167'
];
const healthCard = await reader.fromQRNumeric(chunkedQR);
```

---

### Lower-Level API

#### `FHIRBundleProcessor`

Processes and validates FHIR R4 Bundles according to SMART Health Cards specification.

##### Methods

###### `process(bundle)`

Processes a FHIR Bundle with standard processing.

```typescript
process(bundle: FHIRBundle): FHIRBundle
```

###### `processForQR(bundle, strict)`

Processes a FHIR Bundle with QR code optimizations (short resource-scheme URIs, removes unnecessary fields).

```typescript
processForQR(bundle: FHIRBundle, strict: boolean): FHIRBundle
```

**Parameters:**
- `bundle`: FHIR Bundle to process
- `strict`: When `strict` is true, missing `Reference.reference` targets throw `InvalidBundleReferenceError`; when false, original references are preserved when no target resource is found in bundle.

###### `validate(bundle)`

Validates a FHIR Bundle for basic compliance.

```typescript
validate(bundle: FHIRBundle): boolean
```

---

#### `VerifiableCredentialProcessor`

Creates and validates Verifiable Credentials for SMART Health Cards.

##### Methods

###### `create(fhirBundle, [options])`

Creates a Verifiable Credential from a FHIR Bundle.

```typescript
create(fhirBundle: FHIRBundle, options?: VerifiableCredentialParams): VerifiableCredential
```

###### `validate(vc)`

Validates a Verifiable Credential structure.

```typescript
validate(vc: VerifiableCredential): boolean
```

---

#### `JWSProcessor`

Handles JWT/JWS signing and verification with ES256 algorithm.

##### Methods

###### `sign(payload, privateKey, publicKey, [enableCompression])`

Signs a JWT payload using ES256 algorithm.

```typescript
sign(payload: SmartHealthCardJWT, privateKey: CryptoKey | Uint8Array | string, publicKey: CryptoKey | Uint8Array | string, enableCompression?: boolean): Promise<string>
```

**Parameters:**
- `payload`: JWT payload to sign
- `privateKey`: ES256 private key
- `publicKey`: ES256 public key (for key ID derivation)
- `enableCompression`: Whether to compress payload with raw DEFLATE (default: true). When `enableCompression` is true, compresses payload before signing and sets `zip: "DEF"`.

**Returns:** Promise resolving to JWS string

###### `verify(jws, publicKey)`

Verifies a JWS and returns the decoded payload.

```typescript
verify(jws: string, publicKey: CryptoKey | Uint8Array | string): Promise<SmartHealthCardJWT>
```

**Parameters:**
- `jws`: JWS string to verify
- `publicKey`: ES256 public key for verification

**Returns:** Promise resolving to decoded JWT payload

**Note:** To inspect headers without verification, use `jose.decodeProtectedHeader(jws)` from the `jose` library.

---

#### `QRCodeGenerator`

Generates and scans QR codes for SMART Health Cards with proper numeric encoding.

##### Constructor

```typescript
new QRCodeGenerator(config?: QRCodeConfigParams)
```

##### Methods

###### `generateQR(jws)`

Generates QR code data URLs from a JWS string.

```typescript
generateQR(jws: string): Promise<string[]>
```

**Parameters:**
- `jws`: JWS string to encode

**Returns:** Promise resolving to array of QR code data URLs

###### `scanQR(qrCodeData)`

Reconstructs JWS from QR code data.

```typescript
scanQR(qrCodeData: string[]): Promise<string>
```

**Parameters:**
- `qrCodeData`: Array of QR code numeric strings

**Returns:** Promise resolving to reconstructed JWS string

###### `encodeJWSToNumeric(jws)`

Converts JWS to SMART Health Cards numeric format.

```typescript
encodeJWSToNumeric(jws: string): string
```

###### `decodeNumericToJWS(numericData)`

Converts numeric data back to JWS string.

```typescript
decodeNumericToJWS(numericData: string): string
```

###### `chunkJWS(jws)`

Splits JWS into balanced chunks for multi-QR encoding.

```typescript
chunkJWS(jws: string): string[]
```

---

### Configuration Interfaces

#### `VerifiableCredentialParams`

Optional parameters for Verifiable Credential creation.

```typescript
interface VerifiableCredentialParams {
  fhirVersion?: string              // FHIR version (default: '4.0.1')
  includeAdditionalTypes?: string[] // Additional VC type URIs to include
}
```

**Properties:**

###### `fhirVersion`
Type: `String`  
Default: `'4.0.1'`

FHIR version string in semantic version format (e.g., '4.0.1').

###### `includeAdditionalTypes`
Type: `String[]`

Array of additional Verifiable Credential type URIs to include beyond the standard `https://smarthealth.cards#health-card`. Common values:
- `https://smarthealth.cards#immunization`
- `https://smarthealth.cards#covid19`
- `https://smarthealth.cards#laboratory`

**Example:**
```typescript
const vcOptions = {
  fhirVersion: '4.0.1',
  includeAdditionalTypes: [
    'https://smarthealth.cards#immunization',
    'https://smarthealth.cards#covid19'
  ]
};
```

---

#### `QRCodeConfigParams`

Configuration parameters for QR code generation.

```typescript
interface QRCodeConfigParams {
  maxSingleQRSize?: number    // Maximum JWS size for single QR code
  enableChunking?: boolean    // Whether to support multi-chunk QR codes
  encodeOptions?: QREncodeParams // QR encoding options
}
```

**Properties:**

###### `maxSingleQRSize`
Type: `Number`

Maximum JWS character length for single QR code. Auto-derived from `errorCorrectionLevel` if not provided:
- L: 1195 characters
- M: 927 characters  
- Q: 670 characters
- H: 519 characters

Based on Version 22 QR code limits from [SMART Health Cards QR FAQ](https://github.com/smart-on-fhir/health-cards/blob/main/FAQ/qr.md).

###### `enableChunking`
Type: `Boolean`  
Default: `false`

Whether to support multi-chunk QR codes. Note that chunked QR codes are deprecated per SMART Health Cards specification, but supported for compatibility.

###### `encodeOptions`
Type: `QREncodeParams`

Options passed to the underlying QR code encoder.

**Example:**
```typescript
const qrConfig = {
  maxSingleQRSize: 1195,
  enableChunking: false,
  encodeOptions: {
    errorCorrectionLevel: 'L',
    scale: 4,
    margin: 1,
    color: {
      dark: '#000000ff',
      light: '#ffffffff'
    }
  }
};
```

---

#### `QREncodeParams`

Detailed QR code encoding parameters.

```typescript
interface QREncodeParams {
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' // Error correction level
  version?: number        // QR version 1-40
  maskPattern?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 // Mask pattern
  margin?: number         // Quiet zone size
  scale?: number          // Scale factor for output
  width?: number          // Forces specific width
  color?: {
    dark?: string         // Color of dark modules (hex format)
    light?: string        // Color of light modules (hex format)
  }
}
```

**Properties:**

###### `errorCorrectionLevel`
Type: `'L' | 'M' | 'Q' | 'H'`  
Default: `'L'`

Error correction level per SMART Health Cards specification:
- **L (Low)**: ~7% error resistance, 1195 max characters (V22)
- **M (Medium)**: ~15% error resistance, 927 max characters (V22)  
- **Q (Quartile)**: ~25% error resistance, 670 max characters (V22)
- **H (High)**: ~30% error resistance, 519 max characters (V22)

###### `version`
Type: `Number`  
Range: 1-40

QR code version determining symbol size. Version 1 is 21x21 modules, Version 2 is 25x25, etc. Auto-selected by default based on data size.

###### `maskPattern`
Type: `Number`  
Range: 0-7

Mask pattern used to mask the QR code symbol. Auto-selected by default for optimal readability.

###### `scale`
Type: `Number`  
Default: `4`

Scale factor for output image. A value of 1 means 1 pixel per module.

###### `margin`
Type: `Number`  
Default: `1`

Quiet zone size (border) around the QR code in modules.

###### `width`
Type: `Number`

Forces specific width for output image in pixels. Takes precedence over `scale` if specified.

###### `color.dark`
Type: `String`  
Default: `'#000000ff'`

Color of dark modules in hex RGBA format (e.g., '#000000ff' for black).

###### `color.light`
Type: `String`  
Default: `'#ffffffff'`

Color of light modules in hex RGBA format (e.g., '#ffffffff' for white).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License  

MIT License - see [LICENSE](LICENSE) file for details.

## Commercial Support

[![alt text](https://avatars2.githubusercontent.com/u/5529080?s=80&v=4 "Vinta Logo")](https://www.vinta.com.br/)

This project is maintained by [Vinta Software](https://www.vinta.com.br/). We offer design and development services for healthcare companies. If you need any commercial support, feel free to get in touch: contact@vinta.com.br
