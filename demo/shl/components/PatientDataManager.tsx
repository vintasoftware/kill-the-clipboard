import React, { useState, useEffect, useCallback } from 'react';
import { Card, Title, Text, Stack, Button, LoadingOverlay } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import { notifications } from '@mantine/notifications';
import { AllergyIntolerance, Bundle, Condition, MedicationRequest, Observation } from '@medplum/fhirtypes';
import { PatientDataBundleDisplay } from './PatientDataBundleDisplay';

interface PatientDataManagerProps {
  /** Whether to show the "Add Sample Data" button and fetch from Medplum */
  enableSampleData?: boolean;
  /** Title for the health data section */
  title?: string;
}

const SAMPLE_ALLERGIES: AllergyIntolerance[] = [
  {
    resourceType: 'AllergyIntolerance',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
      text: 'Active',
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '227493005',
          display: 'Cashew nuts',
        },
      ],
      text: 'Cashew nuts',
    },
    patient: { reference: 'Patient/' },
    recordedDate: new Date().toISOString().split('T')[0],
  },
  {
    resourceType: 'AllergyIntolerance',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
      text: 'Active',
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '387517004',
          display: 'Paracetamol',
        },
      ],
      text: 'Paracetamol',
    },
    patient: { reference: 'Patient/' },
    recordedDate: new Date().toISOString().split('T')[0],
  },
  {
    resourceType: 'AllergyIntolerance',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
      text: 'Active',
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '762952008',
          display: 'Peanuts',
        },
      ],
      text: 'Peanuts',
    },
    patient: { reference: 'Patient/' },
    recordedDate: new Date().toISOString().split('T')[0],
  },
  {
    resourceType: 'AllergyIntolerance',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
      text: 'Active',
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '226955001',
          display: 'Shellfish',
        },
      ],
      text: 'Shellfish',
    },
    patient: { reference: 'Patient/' },
    recordedDate: new Date().toISOString().split('T')[0],
  },
  {
    resourceType: 'AllergyIntolerance',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
      text: 'Active',
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '3718001',
          display: 'Cow milk protein',
        },
      ],
      text: 'Cow milk',
    },
    patient: { reference: 'Patient/' },
    recordedDate: new Date().toISOString().split('T')[0],
  },
];

const SAMPLE_CONDITIONS: Condition[] = [
  {
    resourceType: 'Condition',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '38341003',
          display: 'Hypertensive disorder',
        },
      ],
      text: 'High blood pressure',
    },
    subject: { reference: 'Patient/' },
    recordedDate: new Date().toISOString().split('T')[0],
  },
  {
    resourceType: 'Condition',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '44054006',
          display: 'Diabetes mellitus type 2',
        },
      ],
      text: 'Type 2 Diabetes',
    },
    subject: { reference: 'Patient/' },
    recordedDate: new Date().toISOString().split('T')[0],
  },
  {
    resourceType: 'Condition',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '195967001',
          display: 'Asthma',
        },
      ],
      text: 'Asthma',
    },
    subject: { reference: 'Patient/' },
    recordedDate: new Date().toISOString().split('T')[0],
  },
  {
    resourceType: 'Condition',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'resolved',
          display: 'Resolved',
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '36971009',
          display: 'Sinusitis',
        },
      ],
      text: 'Acute sinusitis',
    },
    subject: { reference: 'Patient/' },
    recordedDate: new Date().toISOString().split('T')[0],
  },
  {
    resourceType: 'Condition',
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '72892002',
          display: 'Normal pregnancy',
        },
      ],
      text: 'Pregnancy',
    },
    subject: { reference: 'Patient/' },
    recordedDate: new Date().toISOString().split('T')[0],
  },
];

const SAMPLE_MEDICATIONS: MedicationRequest[] = [
  {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: {
      coding: [
        {
          system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
          code: '308136',
          display: 'Lisinopril 10 MG Oral Tablet',
        },
      ],
      text: 'Lisinopril 10mg',
    },
    subject: { reference: 'Patient/' },
    authoredOn: new Date().toISOString().split('T')[0],
  },
  {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: {
      coding: [
        {
          system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
          code: '860975',
          display: 'Metformin 500 MG Oral Tablet',
        },
      ],
      text: 'Metformin 500mg',
    },
    subject: { reference: 'Patient/' },
    authoredOn: new Date().toISOString().split('T')[0],
  },
  {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: {
      coding: [
        {
          system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
          code: '1998447',
          display: 'Albuterol 0.09 MG/ACTUAT Inhalation Spray',
        },
      ],
      text: 'Albuterol inhaler',
    },
    subject: { reference: 'Patient/' },
    authoredOn: new Date().toISOString().split('T')[0],
  },
  {
    resourceType: 'MedicationRequest',
    status: 'completed',
    intent: 'order',
    medicationCodeableConcept: {
      coding: [
        {
          system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
          code: '197696',
          display: 'Amoxicillin 500 MG Oral Capsule',
        },
      ],
      text: 'Amoxicillin 500mg',
    },
    subject: { reference: 'Patient/' },
    authoredOn: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  },
  {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: {
      coding: [
        {
          system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
          code: '316049',
          display: 'Prenatal Vitamins',
        },
      ],
      text: 'Prenatal vitamins',
    },
    subject: { reference: 'Patient/' },
    authoredOn: new Date().toISOString().split('T')[0],
  },
];

const SAMPLE_OBSERVATIONS: Observation[] = [
  {
    resourceType: 'Observation',
    status: 'final',
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '8480-6',
          display: 'Systolic blood pressure',
        },
      ],
      text: 'Blood Pressure Systolic',
    },
    subject: { reference: 'Patient/' },
    effectiveDateTime: new Date().toISOString().split('T')[0],
    valueQuantity: {
      value: 145,
      unit: 'mmHg',
      system: 'http://unitsofmeasure.org',
      code: 'mm[Hg]',
    },
  },
  {
    resourceType: 'Observation',
    status: 'final',
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '8462-4',
          display: 'Diastolic blood pressure',
        },
      ],
      text: 'Blood Pressure Diastolic',
    },
    subject: { reference: 'Patient/' },
    effectiveDateTime: new Date().toISOString().split('T')[0],
    valueQuantity: {
      value: 90,
      unit: 'mmHg',
      system: 'http://unitsofmeasure.org',
      code: 'mm[Hg]',
    },
  },
  {
    resourceType: 'Observation',
    status: 'final',
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '33747-0',
          display: 'General blood glucose measurement',
        },
      ],
      text: 'Blood Glucose',
    },
    subject: { reference: 'Patient/' },
    effectiveDateTime: new Date().toISOString().split('T')[0],
    valueQuantity: {
      value: 120,
      unit: 'mg/dL',
      system: 'http://unitsofmeasure.org',
      code: 'mg/dL',
    },
  },
  {
    resourceType: 'Observation',
    status: 'final',
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '29463-7',
          display: 'Body Weight',
        },
      ],
      text: 'Weight',
    },
    subject: { reference: 'Patient/' },
    effectiveDateTime: new Date().toISOString().split('T')[0],
    valueQuantity: {
      value: 70,
      unit: 'kg',
      system: 'http://unitsofmeasure.org',
      code: 'kg',
    },
  },
  {
    resourceType: 'Observation',
    status: 'final',
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '8302-2',
          display: 'Body height',
        },
      ],
      text: 'Height',
    },
    subject: { reference: 'Patient/' },
    effectiveDateTime: new Date().toISOString().split('T')[0],
    valueQuantity: {
      value: 165,
      unit: 'cm',
      system: 'http://unitsofmeasure.org',
      code: 'cm',
    },
  },
];

export const PatientDataManager: React.FC<PatientDataManagerProps> = ({
  enableSampleData = false,
  title = 'Health Information',
}) => {
  const medplum = useMedplum();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAddingSample, setIsAddingSample] = useState(false);

  const fetchHealthData = useCallback(async () => {
    if (!medplum || !medplum.getProfile()) return;

    setIsLoading(true);
    try {
      const profile = medplum.getProfile();
      if (!profile || profile.resourceType !== 'Patient') {
        throw new Error('Profile is not a patient');
      }

      const patientId = profile.id!;

      // Fetch all health data in parallel
      const [allergies, conditions, medications, observations] = await Promise.all([
        medplum.searchResources('AllergyIntolerance', {
          patient: patientId,
          _count: '10',
        }),
        medplum.searchResources('Condition', {
          patient: patientId,
          _count: '10',
        }),
        medplum.searchResources('MedicationRequest', {
          patient: patientId,
          _count: '20',
        }),
        medplum.searchResources('Observation', {
          patient: patientId,
          _count: '20',
        }),
      ]);

      // Create a FHIR Bundle with the patient data
      const fhirBundle: Bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          { fullUrl: medplum.fhirUrl('Patient', profile.id!).toString(), resource: profile },
          ...allergies.map((resource) => ({
            fullUrl: medplum.fhirUrl('AllergyIntolerance', resource.id!).toString(),
            resource,
          })),
          ...conditions.map((resource) => ({
            fullUrl: medplum.fhirUrl('Condition', resource.id!).toString(),
            resource,
          })),
          ...medications.map((resource) => ({
            fullUrl: medplum.fhirUrl('MedicationRequest', resource.id!).toString(),
            resource,
          })),
          ...observations.map((resource) => ({
            fullUrl: medplum.fhirUrl('Observation', resource.id!).toString(),
            resource,
          })),
        ],
      };

      setBundle(fhirBundle);
    } catch (error) {
      console.error('Error fetching health data:', error);
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to fetch health data',
        color: 'red',
      });
    } finally {
      setIsLoading(false);
    }
  }, [medplum]);

  const addSampleData = useCallback(async () => {
    if (!medplum || !medplum.getProfile()) return;

    setIsAddingSample(true);
    try {
      const profile = medplum.getProfile();
      if (!profile || profile.resourceType !== 'Patient') {
        throw new Error('Profile is not a patient');
      }

      const patientId = profile.id!;

      // Update patient references in sample data
      const allergiesWithPatientRef = SAMPLE_ALLERGIES.map((allergy) => ({
        ...allergy,
        patient: { reference: `Patient/${patientId}` },
      }));

      const conditionsWithPatientRef = SAMPLE_CONDITIONS.map((condition) => ({
        ...condition,
        subject: { reference: `Patient/${patientId}` },
      }));

      const medicationsWithPatientRef = SAMPLE_MEDICATIONS.map((medication) => ({
        ...medication,
        subject: { reference: `Patient/${patientId}` },
      }));

      const observationsWithPatientRef = SAMPLE_OBSERVATIONS.map((observation) => ({
        ...observation,
        subject: { reference: `Patient/${patientId}` },
      }));

      // Create all sample resources
      const allSamples = [
        ...allergiesWithPatientRef,
        ...conditionsWithPatientRef,
        ...medicationsWithPatientRef,
        ...observationsWithPatientRef,
      ];

      await Promise.all(allSamples.map((sample) => medplum.createResource(sample)));

      notifications.show({
        title: 'Success',
        message: 'Sample health data added successfully',
        color: 'green',
      });

      // Refresh health data
      await fetchHealthData();
    } catch (error) {
      console.error('Error adding sample data:', error);
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to add sample data',
        color: 'red',
      });
    } finally {
      setIsAddingSample(false);
    }
  }, [medplum, fetchHealthData]);

  // Auto-fetch data on mount if enabled
  useEffect(() => {
    if (medplum?.getProfile()) {
      fetchHealthData();
    }
  }, [fetchHealthData, medplum]);

  return (
    <Card withBorder p="xl">
      <Stack gap="md" pos="relative">
        <LoadingOverlay visible={isLoading || isAddingSample} />

        <Title order={3}>{title}</Title>

        {enableSampleData && (
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {bundle?.entry?.length
                ? `Currently showing ${bundle.entry.length} resource${bundle.entry.length > 1 ? 's' : ''}`
                : 'No health data available'}
            </Text>
            <Button onClick={addSampleData} variant="outline" size="sm" loading={isAddingSample}>
              Add Sample Data
            </Button>
          </Stack>
        )}

        {bundle && bundle.entry && bundle.entry.length > 0 ? (
          <Stack gap="md">
            <PatientDataBundleDisplay bundle={bundle} />
          </Stack>
        ) : (
          !isLoading && (
            <Text c="dimmed" size="sm">
              No health information available
            </Text>
          )
        )}
      </Stack>
    </Card>
  );
};
