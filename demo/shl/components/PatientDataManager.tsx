import React, { useState, useEffect, useCallback } from 'react';
import { Card, Title, Text, Stack, Button, LoadingOverlay, Group, Modal } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import { notifications } from '@mantine/notifications';
import { AllergyIntolerance, Bundle, Condition, MedicationRequest, Observation } from '@medplum/fhirtypes';
import { PatientDataBundleDisplay } from './PatientDataBundleDisplay';
import sampleAllergies from '../data/sample-allergies.json';
import sampleConditions from '../data/sample-conditions.json';
import sampleMedications from '../data/sample-medications.json';
import sampleObservations from '../data/sample-observations.json';

interface PatientDataManagerProps {
  /** Title for the health data section */
  title?: string;
}

const SAMPLE_ALLERGIES: AllergyIntolerance[] = sampleAllergies as AllergyIntolerance[];
const SAMPLE_CONDITIONS: Condition[] = sampleConditions as Condition[];
const SAMPLE_MEDICATIONS: MedicationRequest[] = sampleMedications as MedicationRequest[];
const SAMPLE_OBSERVATIONS: Observation[] = sampleObservations as Observation[];

function AddSampleDataControl(props: { onAdded: () => Promise<void> | void }) {
  const { onAdded } = props;
  const medplum = useMedplum();
  const [isAddingSample, setIsAddingSample] = useState(false);

  const addSampleData = useCallback(async () => {
    if (!medplum || !medplum.getProfile()) return;

    setIsAddingSample(true);
    try {
      const profile = medplum.getProfile();
      if (!profile || profile.resourceType !== 'Patient') {
        throw new Error('Profile is not a patient');
      }

      const patientId = profile.id!;

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

      const allSamples = [
        ...allergiesWithPatientRef,
        ...conditionsWithPatientRef,
        ...medicationsWithPatientRef,
        ...observationsWithPatientRef,
      ];

      await Promise.all(allSamples.map((sample) => medplum.createResource(sample)));
      await onAdded();
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
  }, [medplum, onAdded]);

  return (
    <Button onClick={addSampleData} variant="outline" size="sm" loading={isAddingSample}>
      Add Sample Data
    </Button>
  );
}

function DeletePatientDataControl(props: { onDeleted: () => Promise<void> | void }) {
  const { onDeleted } = props;
  const medplum = useMedplum();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteAll = useCallback(async () => {
    if (!medplum || !medplum.getProfile()) return;

    try {
      setIsDeleting(true);
      const profile = medplum.getProfile();
      if (!profile || profile.resourceType !== 'Patient') {
        throw new Error('Profile is not a patient');
      }

      const patientId = profile.id!;

      const [allergies, conditions, medications, observations] = await Promise.all([
        medplum.searchResources('AllergyIntolerance', { patient: patientId, _count: '50' }),
        medplum.searchResources('Condition', { patient: patientId, _count: '50' }),
        medplum.searchResources('MedicationRequest', { patient: patientId, _count: '50' }),
        medplum.searchResources('Observation', { patient: patientId, _count: '50' }),
      ]);

      const resourcesToDelete = [
        ...allergies.map((r) => ({ resourceType: 'AllergyIntolerance', id: r.id! })),
        ...conditions.map((r) => ({ resourceType: 'Condition', id: r.id! })),
        ...medications.map((r) => ({ resourceType: 'MedicationRequest', id: r.id! })),
        ...observations.map((r) => ({ resourceType: 'Observation', id: r.id! })),
      ];

      await Promise.all(resourcesToDelete.map((r) => medplum.deleteResource(r.resourceType as any, r.id)));
      await onDeleted();
    } catch (error) {
      console.error('Error deleting health data:', error);
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to delete health data',
        color: 'red',
      });
    } finally {
      setIsDeleting(false);
      setConfirmOpen(false);
    }
  }, [medplum, onDeleted]);

  return (
    <>
      <Button color="red" size="sm" variant="filled" onClick={() => setConfirmOpen(true)} loading={isDeleting}>
        Delete Data
      </Button>
      <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title="Delete all data?" centered>
        <Stack gap="sm">
          <Text>
            This will permanently delete all Allergies, Conditions, Medications, and Observations for your account.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button color="red" loading={isDeleting} onClick={handleDeleteAll}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export const PatientDataManager: React.FC<PatientDataManagerProps> = ({ title = 'Health Information' }) => {
  const medplum = useMedplum();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

  // removed addSampleData in favor of AddSampleDataControl

  // Auto-fetch data on mount if enabled
  useEffect(() => {
    if (medplum?.getProfile()) {
      fetchHealthData();
    }
  }, [fetchHealthData, medplum]);

  return (
    <Card withBorder p="xl">
      <Stack gap="md" pos="relative">
        <LoadingOverlay visible={isLoading} />

        <Title order={3}>{title}</Title>

        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {bundle?.entry?.length
              ? `Currently showing ${bundle.entry.length} resource${bundle.entry.length > 1 ? 's' : ''}`
              : 'No health data available'}
          </Text>
          <Group>
            <AddSampleDataControl onAdded={fetchHealthData} />
            <DeletePatientDataControl onDeleted={fetchHealthData} />
          </Group>
        </Stack>

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
