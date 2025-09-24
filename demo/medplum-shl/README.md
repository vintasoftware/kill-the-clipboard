# Smart Health Links (SHL) Demo

This is a Next.js demo application that demonstrates Smart Health Links (SHL) functionality using Medplum as the backend and the `kill-the-clipboard` library.

**⚠️ Warning: This is a demo project. For production use, ensure proper security measures are implemented.**

## What this demo implements

- **Smart Health Link Generator**: Creates Smart Health Links that point to a manifest; `U` flag unsupported
    - **Passcode protection (`P` flag)**: Server-enforced passcode prompted on the viewer; passcodes are stored as Argon2id hashes in Medplum FHIR resources using OWASP recommended security parameters
    - **Persistent Manifest storage**: Serialized `SHLManifestBuilder` state and metadata stored as FHIR `DocumentManifest` resources in Medplum.
    - **File storage**: Encrypted JWE files persisted to Medplum as `Binary` resources; file URLs are FHIR URLs for `Binary` resources
    - **QR code rendering**: Rendering of SHL QR codes using `qr` library
    - **Audit trail**: All SHL access attempts (successful and failed) are tracked using FHIR `AuditEvent` resources
- **Smart Health Link Viewer**: Resolves `shlink:/...`, prompts for passcode if needed, fetches manifest, decrypts files, and displays FHIR resources
    - **Manifest serving**: POST manifest endpoint; embeds JWEs ≤ 4 KiB, otherwise returns JWE file URLs
    - **Optional long-term flag (`L`)**: Flag is settable on creation; no polling implemented yet
    - **Failed attempt tracking**: Tracks failed passcode attempts and permanently invalidates SHLs after exceeding the configured limit (default: 100 attempts)

## URL Paths

- **SHL Generator** (`/`): Create SHLs
- **SHL Generation API** (`/api/shl`): Server-side SHL generation
- **SHL Viewer** (`/viewer`): Resolve and display SHLs
- **Manifest API** (`/api/shl/manifests/[entropy]/manifest.json`): Serve SHL manifests

## Important limitations

- SHL Viewer requires a valid Medplum session to fetch files due to how Medplum's `Binary` resources are protected by its FHIR server
- No polling for SHLs with `L` flag
- No rate limiting for manifest requests

## Setup

### Prerequisites

- Node.js 20.19.0 or higher
- pnpm package manager
- Medplum account and credentials
- Proper Patient Access Policy (see section below)

### Patient Access Policy setup

Ensure your project has the proper [Access Policy](https://www.medplum.com/docs/access/access-policies) for Patients. Patient users must have access to all resource types this demo requires, especially `DocumentManifest` and `DocumentReference` to support SHL file serving. Check the file [`patient-access-policy.json`](./patient-access-policy.json) for the policy you can use in your project.

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

### Creating a Smart Health Link

1. Sign in with Medplum on the home page using a `Patient` account ([invite yourself if needed](https://www.medplum.com/docs/app/invite))
2. Click "Create Smart Health Link"
3. Set a passcode (minimum 6 characters); optionally set label and `L` flag
4. Submit the form; the server will:
   - Build a FHIR Bundle and a Smart Health Card from your Medplum data
   - Encrypt and upload the bundle as JWE files using Medplum `Binary` FHIR resources
   - Persist builder state and metadata in Medplum as FHIR `DocumentManifest` resources
5. You'll get a `shlink:/...` URI and a button to open the viewer

### Viewing a Smart Health Link

1. Sign in with Medplum
2. Navigate to `/viewer` (or open from the creation screen)
3. Paste the Smart Health Link URI (or it is pre-filled when opened via button)
4. Enter the passcode and your name as the recipient
5. Click "View Health Information" to resolve and decrypt the link content

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
│   ├── medplum-fetch.ts                # Medplum-authenticated fetch wrapper
│   ├── medplum-file-handlers.ts        # JWE file upload/URL generation for SHL files
│   └── medplum-storage.ts              # FHIR-based storage using Medplum resources
├── package.json
└── README.md
```

### API Endpoints

- **`POST /api/shl`**: Create a new Smart Health Link (requires Medplum bearer token)
- **`POST /api/shl/manifests/[entropy]/manifest.json`**: Serve SHL manifests (requires Medplum bearer token; passcode enforced)

### Data Storage

All SHL data is stored as FHIR resources in Medplum:

- **`DocumentManifest`**: Stores SHL metadata, builder state, passcodes, and configuration
- **`DocumentReference`**: Stores individual manifest file metadata  
- **`Binary`**: Stores encrypted JWE file content
- **`AuditEvent`**: Tracks all SHL access attempts for audit trail

You can inspect and manage the stored resources through the Medplum App at your Medplum project URL.
