# Medplum SMART Health Links (SHL) Demo

This is a Next.js demo application that demonstrates SMART Health Links (SHL) functionality using Medplum as the backend and the `kill-the-clipboard` library.

## What this demo implements

- **SMART Health Link Generator**: Creates SMART Health Links that point to a manifest; `U` flag unsupported
    - **Passcode protection (`P` flag)**: Server-enforced passcode prompted on the viewer; passcodes are stored as Argon2id hashes using OWASP recommended security parameters
    - **Persistent Manifest storage**: Complete SHL payloads, `SHLManifestBuilder` attributes, and passcode hashes stored inside FHIR `DocumentManifest` and `DocumentReference` resources in Medplum
    - **File storage**: Encrypted JWE files persisted to Medplum as `Binary` resources inside `DocumentReference` resources
    - **QR code rendering**: Rendering of SHL QR codes using `qr` library
- **SMART Health Link Viewer**: Resolves `shlink:/...`, prompts for passcode if needed, fetches manifest, decrypts files, and displays FHIR resources
    - **Manifest serving**: POST manifest endpoint; embeds JWEs ≤ 1 KiB, otherwise returns JWE file URLs
    - **Optional long-term flag (`L`)**: Flag is settable on creation; no polling implemented yet
    - **Failed attempt tracking**: Tracks failed passcode attempts and permanently invalidates SHLs after exceeding the configured limit (default: 100 attempts)
    - **Audit trail**: All SHL access attempts (successful and failed) are tracked using FHIR `AuditEvent` resources

## URL Paths

- **SHL Generator** (`/`): Create SHLs
- **SHL Generation API** (`/api/shl`): Server-side SHL generation
- **SHL Viewer** (`/viewer`): Resolve and display SHLs

## Important limitations

- No support for generating SHLs with `U` flag (single, direct file access, w/o manifest)
- No polling for SHLs with `L` flag
- No rate limiting for manifest requests

## Setup

### Prerequisites

- Node.js 20.19.0 or higher
- pnpm package manager
- Medplum project with client credentials and patient account created (see section below)
- In Medplum project, set up a proper Patient Access Policy (see section below)

### Medplum Client Credentials setup

See [Medplum Client Credentials documentation](https://www.medplum.com/docs/app/client-credentials) for more details. Go to the [app.medplum.com (administrative interface)](https://app.medplum.com), go to Project, create a Client application, and get the client ID and secret to set as environment variables (see below).

### Medplum Patient Access Policy setup

Ensure your Medplum project has the proper [Access Policy](https://www.medplum.com/docs/access/access-policies#patient-access) for Patients. Patient users must have access to all resource types this demo requires, especially `DocumentManifest` and `DocumentReference` to support SHL file serving. Check the file [`patient-access-policy.json`](./patient-access-policy.json) for the policy you can use in your project. Go to the [app.medplum.com (administrative interface)](https://app.medplum.com), create an Access Policy, and use the JSON tab to set the policy.

### Installation

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```

   Configure the following variables:
   ```env
   NEXT_PUBLIC_MEDPLUM_BASE_URL=https://api.medplum.com
   NEXT_PUBLIC_MEDPLUM_CLIENT_ID=your_client_id
   MEDPLUM_CLIENT_SECRET=your_client_secret
   ```

   The other variables can be left as is.

3. Run the development server:
   ```bash
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Creating a SMART Health Link

1. Sign in with Medplum on the home page using a `Patient` account ([invite yourself if needed](https://www.medplum.com/docs/app/invite))
2. Click on "Add Sample Data" if needed
3. Click "Create SMART Health Link"
4. Set a passcode (minimum 6 characters); optionally set label and `L` flag
5. Submit the form; the server will:
   - Build a FHIR Bundle and a SMART Health Card from your Medplum data
   - Encrypt and upload the bundle as JWE files using Medplum `Binary` FHIR resources inside `DocumentReference` resources
   - Persist SHL payload and manifest builder attributes in Medplum as FHIR `DocumentManifest` resources (which point to the `DocumentReference` resources that hold the JWE files)
6. You'll get a `shlink:/...` URI and a button to open the viewer

### Viewing a SMART Health Link

1. Navigate to `/viewer` (or open from the creation screen)
2. Paste the SMART Health Link URI (or it is pre-filled when opened via button)
3. Enter the passcode and your name as the recipient
4. Click "View Health Information" to resolve and decrypt the link content

## Development

### Project Structure

```
demo/medplum-shl/
├── app/
│   ├── api/
│   │   └── shl/
│   │       ├── route.ts                # POST /api/shl - Create SHLs
│   │       └── manifests/
│   │           └── [entropy]/
│   │               └── manifest.json/
│   │                   └── route.ts    # POST manifest endpoint
│   │       └── files/proxy/
│   │           └── route.ts            # GET file endpoint (proxy to Medplum's S3 presigned URLs)
│   ├── viewer/
│   │   └── page.tsx                    # SHL viewer page
│   ├── layout.tsx
│   ├── page.tsx                        # Home page - SHL creation
│   └── root.tsx
├── components/
│   ├── CreateSHLForm.tsx               # Form for creating SHLs
│   └── SHLDisplay.tsx                  # Component for displaying created SHLs
├── lib/
│   ├── auth.ts                         # Passcode hashing and verification
│   ├── medplum-file-handlers.ts        # JWE file upload/URL generation for SHL files
│   └── medplum-storage.ts              # FHIR-based SHL storage using Medplum resources
├── package.json
└── README.md
```

### API Endpoints

- **`POST /api/shl`**: Create a new SMART Health Link (requires Medplum bearer token)
- **`POST /api/shl/manifests/[entropy]/manifest.json`**: Serve SHL manifests (passcode enforced)
- **`GET /api/shl/files/proxy`**: Proxy to serve files from Medplum's S3 presigned URLs (`Binary` URLs are not allowed to be accessed directly from the client side due to CORS issues)

### Data Storage

All SHL data is stored as FHIR resources in Medplum:

- **`DocumentManifest`**: Stores SHL payload, manifest builder attributes, hashed passcodes, references to `DocumentReference` resources that hold the JWE files
- **`DocumentReference`**: Stores individual JWE file metadata and a reference to the `Binary` resource that stores the JWE file content
- **`AuditEvent`**: Tracks all SHL access attempts for audit trail
