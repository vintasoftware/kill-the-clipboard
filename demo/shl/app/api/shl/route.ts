import { NextRequest, NextResponse } from 'next/server';
import { MedplumClient } from '@medplum/core';
import { Bundle } from '@medplum/fhirtypes';
import { SHL, SHLManifestBuilder, SmartHealthCardIssuer } from 'kill-the-clipboard';
import { storeManifestBuilder, storePasscode } from '@/lib/storage';
import { hashPasscode } from '@/lib/auth';
import { createManifestFileHandlers } from '@/lib/medplum-file-handlers';

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
    const baseUrl = process.env.SHL_BASE_URL || `${request.nextUrl.origin}/api/shl/manifests`;

    // Create SHL instance
    const shl = SHL.generate({
      baseManifestURL: baseUrl,
      manifestPath: 'manifest.json',
      flag: longTerm ? 'LP' : 'P', // P for passcode, LP for long-term + passcode
      label,
    });

    // Create manifest builder with Medplum file storage
    const manifestBuilder = new SHLManifestBuilder({
      shl,
      ...createManifestFileHandlers(medplum),
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
    await manifestBuilder.addFHIRResource({
      content: fhirBundle,
      enableCompression: true
    });

    // Add the FHIR bundle as a Smart Health Card to the manifest
    const shcIssuer = new SmartHealthCardIssuer({
      issuer: process.env.SHC_ISSUER!,
      privateKey: process.env.SHC_PRIVATE_KEY!,
      publicKey: process.env.NEXT_PUBLIC_SHC_PUBLIC_KEY!,
    });
    const shc = await shcIssuer.issue(fhirBundle);
    await manifestBuilder.addHealthCard({ shc });

    // Extract manifestID from the manifest URL for database key
    const manifestUrl = shl.url;
    const urlParts = manifestUrl.split('/');
    const manifestID = urlParts[urlParts.length - 2]; // Get the manifestID part before manifest.json

    // Store the manifest builder state in database
    await storeManifestBuilder(manifestID, manifestBuilder.serialize(), profile.id);

    // Hash and store the passcode
    const { hash } = hashPasscode(passcode);
    await storePasscode(manifestID, hash);

    // Return the SHL URI
    const shlUri = shl.generateSHLinkURI();

    return NextResponse.json({
      shlUri,
    });

  } catch (error) {
    console.error('Error creating SHL:', error);
    return NextResponse.json(
      { error: `Failed to create Smart Health Link: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
