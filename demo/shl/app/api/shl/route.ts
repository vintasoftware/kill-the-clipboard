import { NextRequest, NextResponse } from 'next/server';
import { MedplumClient } from '@medplum/core';
import { Patient, Bundle, Resource } from '@medplum/fhirtypes';
import { SHL, SHLManifestBuilder, SmartHealthCard } from 'kill-the-clipboard';
import { storeManifestBuilder, storePasscode } from '@/lib/storage';
import { hashPasscode } from '@/lib/auth';
import { createManifestFileHandlers } from '@/lib/medplum-file-handlers';

// Initialize Medplum client for server-side operations
const medplum = new MedplumClient({
  baseUrl: process.env.MEDPLUM_BASE_URL || 'https://api.medplum.com',
  clientId: process.env.MEDPLUM_CLIENT_ID!,
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

    // Fetch patient data from Medplum
    let patientData: Patient;
    try {
      // Try to get the patient resource for the authenticated user
      const patients = await medplum.searchResources('Patient', {
        _count: '1',
      });

      if (patients.length === 0) {
        // Create a demo patient if none exists
        patientData = await medplum.createResource({
          resourceType: 'Patient',
          name: [{
            given: [profile.name?.[0]?.given?.[0] || 'Demo'],
            family: profile.name?.[0]?.family || 'Patient'
          }],
          gender: 'unknown',
          birthDate: '1990-01-01'
        });
      } else {
        patientData = patients[0];
      }
    } catch (error) {
      console.error('Error fetching patient data:', error);
      // Create a minimal demo patient
      patientData = {
        resourceType: 'Patient',
        id: 'demo-patient',
        name: [{
          given: ['Demo'],
          family: 'Patient'
        }],
        gender: 'unknown',
        birthDate: '1990-01-01'
      };
    }

    // Create a FHIR Bundle with the patient data
    const fhirBundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: patientData
        }
      ]
    };

    // Try to fetch additional health data
    try {
      // Fetch allergies
      const allergies = await medplum.searchResources('AllergyIntolerance', {
        patient: patientData.id!,
        _count: '10'
      });

      allergies.forEach(allergy => {
        fhirBundle.entry!.push({ resource: allergy });
      });

      // Fetch conditions
      const conditions = await medplum.searchResources('Condition', {
        patient: patientData.id!,
        _count: '10'
      });

      conditions.forEach(condition => {
        fhirBundle.entry!.push({ resource: condition });
      });

      // Fetch medications
      const medications = await medplum.searchResources('MedicationRequest', {
        patient: patientData.id!,
        _count: '10'
      });

      medications.forEach(medication => {
        fhirBundle.entry!.push({ resource: medication });
      });

      // Fetch observations (labs, vitals)
      const observations = await medplum.searchResources('Observation', {
        patient: patientData.id!,
        _count: '20'
      });

      observations.forEach(observation => {
        fhirBundle.entry!.push({ resource: observation });
      });
    } catch (error) {
      console.warn('Could not fetch additional health data:', error);
    }

    // Add the FHIR bundle to the manifest
    await manifestBuilder.addFHIRResource({
      content: fhirBundle as any, // Type assertion to handle version differences
      enableCompression: true
    });

    // Create and add a basic Smart Health Card if we have the keys
    // if (process.env.SHC_PRIVATE_KEY) {
    //   try {
    //     await manifestBuilder.addHealthCard({
    //       shc: ...,
    //       enableCompression: false
    //     });
    //   } catch (shcError) {
    //     console.warn('Could not add Smart Health Card:', shcError);
    //   }
    // }

    // Extract entropy from the manifest URL for database key
    const manifestUrl = shl.url;
    const urlParts = manifestUrl.split('/');
    const entropy = urlParts[urlParts.length - 2]; // Get the entropy part before manifest.json

    // Store the manifest builder state in database
    await storeManifestBuilder(entropy, manifestBuilder.serialize(), profile.id);

    // Hash and store the passcode
    const { hash } = hashPasscode(passcode);
    await storePasscode(entropy, hash);

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
