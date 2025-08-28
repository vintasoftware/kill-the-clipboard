# Smart Health Links (SHL) Demo

This is a Next.js demo application that demonstrates Smart Health Links (SHL) functionality using Medplum and the `kill-the-clipboard` library.

## Features

- **Create Smart Health Links**: Generate secure, encrypted links to health information
- **Passcode Protection**: Secure access with user-defined passcodes
- **Long-term Links**: Support for ongoing access to health data
- **Viewer Interface**: Resolve and view Smart Health Links
- **Medplum Integration**: Leverage Medplum's FHIR data store

## Architecture

The demo consists of:

1. **Patient Portal** (`/`): Create and manage Smart Health Links
2. **SHL Creation API** (`/api/shl`): Server-side SHL generation
3. **Manifest API** (`/api/shl/manifests/[entropy]/manifest.json`): Serve SHL manifests
4. **Viewer** (`/viewer`): Resolve and display Smart Health Links

## Setup

### Prerequisites

- Node.js 20.19.0 or higher
- pnpm package manager
- Medplum account and credentials

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
   # Medplum Configuration
   MEDPLUM_BASE_URL=https://api.medplum.com
   MEDPLUM_CLIENT_ID=your_client_id
   MEDPLUM_CLIENT_SECRET=your_client_secret
   
   # SHL Configuration
   SHL_BASE_URL=https://your-domain.com/api/shl/manifests
   
   # SHC Signing Keys (for production)
   SHC_PRIVATE_KEY=your_es256_private_key
   SHC_PUBLIC_KEY=your_es256_public_key
   
   # Passcode Security
   SHL_PASSCODE_PEPPER=your_global_pepper
   ```

3. Run the development server:
   ```bash
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Creating a Smart Health Link

1. Navigate to the home page
2. Click "Create Smart Health Link"
3. Set a passcode (minimum 6 characters)
4. Optionally add a label and enable long-term access
5. Submit the form to generate the SHL

### Viewing a Smart Health Link

1. Navigate to `/viewer`
2. Paste the Smart Health Link URI
3. Enter your name as the recipient
4. If required, enter the passcode
5. Click "View Health Information" to resolve the link

## Development

### Project Structure

```
demo/shl/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   └── shl/          # SHL-related APIs
│   ├── components/        # React components
│   ├── viewer/            # SHL viewer page
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   └── root.tsx           # Medplum provider wrapper
├── components/            # Shared components
├── package.json           # Dependencies
└── README.md             # This file
```

### Key Components

- **`CreateSHLForm`**: Form for creating new Smart Health Links
- **`SHLDisplay`**: Display created SHLs with QR codes and sharing options
- **`ViewerPage`**: Interface for resolving and viewing SHLs

### API Endpoints

- **`POST /api/shl`**: Create a new Smart Health Link
- **`POST /api/shl/manifests/[entropy]/manifest.json`**: Serve SHL manifests

## Security Considerations

- All SHL content is encrypted using AES-256-GCM
- Passcodes are hashed and never stored in plain text
- File URLs are short-lived and single-use
- CORS is configured for cross-origin manifest requests
- HTTPS is required for production deployments

## Future Enhancements

- [ ] QR code generation using `qrcode.react`
- [ ] Database integration for persistent storage
- [ ] Rate limiting on manifest requests
- [ ] Enhanced FHIR resource display
- [ ] Patient authentication and data fetching from Medplum

## Contributing

This is a demo project. For production use, ensure proper security measures are implemented.

## License

See the main project license.
