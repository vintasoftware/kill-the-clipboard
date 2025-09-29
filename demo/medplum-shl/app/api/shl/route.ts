import { NextRequest, NextResponse } from 'next/server';
import { MedplumClient } from '@medplum/core';
import { Bundle } from '@medplum/fhirtypes';
import { SHL, SHLManifestBuilder, SHCIssuer } from 'kill-the-clipboard';
import { createMedplumStorage } from '@/lib/medplum-storage';
import { hashPasscode } from '@/lib/auth';
import { buildManifestFileHandlers } from '@/lib/medplum-file-handlers';

const medplum = new MedplumClient({
  baseUrl: process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || 'https://api.medplum.com',
  clientId: process.env.NEXT_PUBLIC_MEDPLUM_CLIENT_ID!,
  clientSecret: process.env.MEDPLUM_CLIENT_SECRET!,
});

interface CreateSHLRequest {
  passcode: string;
  label?: string;
  longTerm: boolean;
}

export async function POST(request: NextRequest) {
  try {
    // Get authorization header and authenticate with Medplum
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Authorization required' }, { status: 401 });
    }

    // Set the authorization header for the server-side client
    const accessToken = authHeader.replace('Bearer ', '');
    medplum.setAccessToken(accessToken);

    // Verify the user is authenticated
    const profile = await medplum.getProfileAsync();
    if (!profile) {
      return NextResponse.json({ error: 'Invalid authentication' }, { status: 401 });
    }

    const body: CreateSHLRequest = await request.json();
    const { passcode, label, longTerm } = body;

    // Validate required fields
    if (!passcode) {
      return NextResponse.json({ error: 'Passcode is required' }, { status: 400 });
    }

    // Get the base URL for manifest construction
    const baseManifestURL = process.env.SHL_SERVER_BASE_URL! + '/manifests/'

    // Create SHL instance
    const shl = SHL.generate({
      baseManifestURL: baseManifestURL,
      manifestPath: 'manifest.json',
      flag: longTerm ? 'LP' : 'P', // P for passcode, LP for long-term + passcode
      label,
    });

    // Create manifest builder with Medplum file storage
    const manifestBuilder = new SHLManifestBuilder({
      shl,
      ...buildManifestFileHandlers(medplum),
    });

    // Get patient data from Medplum
    if (profile.resourceType !== 'Patient') {
      return NextResponse.json(
        { error: 'Only patients can create SHLs, authenticate as a patient' },
        { status: 401 }
      );
    }
    const patientData = profile;

    // Create a FHIR Bundle with the patient data
    const fhirBundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          fullUrl: medplum.fhirUrl('Patient', patientData.id).toString(),
          resource: patientData
        }
      ]
    };

    // Try to fetch additional health data
    // Fetch allergies
    const allergies = await medplum.search('AllergyIntolerance', {
      patient: patientData.id!,
      _count: '10'
    });
    fhirBundle.entry!.push(...allergies.entry!);

    // Fetch conditions
    const conditions = await medplum.search('Condition', {
      patient: patientData.id!,
      _count: '10'
    });
    fhirBundle.entry!.push(...conditions.entry!);

    // Fetch medications
    const medications = await medplum.search('MedicationRequest', {
      patient: patientData.id!,
      _count: '20'
    });
    fhirBundle.entry!.push(...medications.entry!);

    // Fetch observations (labs, vitals)
    const observations = await medplum.search('Observation', {
      patient: patientData.id!,
      _count: '20'
    });
    fhirBundle.entry!.push(...observations.entry!);

    // Add the FHIR bundle to the manifest
    await manifestBuilder.addFHIRResource({ content: fhirBundle, enableCompression: false });

    // Add the FHIR bundle as a SMART Health Card to the manifest
    const shcIssuer = new SHCIssuer({
      issuer: process.env.SHC_ISSUER!,
      privateKey: JSON.parse(process.env.SHC_PRIVATE_KEY!),
      publicKey: JSON.parse(process.env.SHC_PUBLIC_KEY!),
    });
    fhirBundle.type = 'collection';  // Required by SMART Health Cards spec
    const shc = await shcIssuer.issue(fhirBundle);
    await manifestBuilder.addHealthCard({ shc, enableCompression: false });

    // Extract entropy (unique identifier) from the manifest URL:
    // https://shl.example.org/manifests/{entropy}/manifest.json
    const manifestUrl = shl.url;
    const urlParts = manifestUrl.split('/');
    const entropy = urlParts[urlParts.length - 2];
    if (!entropy || entropy.length !== 43) {
      return NextResponse.json({ error: 'Invalid manifest URL' }, { status: 500 });
    }

    // Create Medplum storage instance
    const storage = createMedplumStorage(medplum);

    // Hash the passcode
    const { hash } = await hashPasscode(passcode);

    // Store the manifest builder state and metadata in FHIR resources
    await storage.storeManifestBuilder({
      entropy,
      shlPayload: shl.payload,
      builderAttrs: manifestBuilder.toDBAttrs(),
      hashedPasscode: hash
    });

    // Return the SHL URI
    const shlUri = shl.toURI();

    return NextResponse.json({
      shlUri,
    });

  } catch (error) {
    console.error('Error creating SHL:', error);
    return NextResponse.json(
      { error: `Failed to create SMART Health Link: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
