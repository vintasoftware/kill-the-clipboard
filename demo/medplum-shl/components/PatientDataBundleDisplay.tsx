import React, { useState } from 'react';
import { Card, Text, Stack, Divider, List, Code, Collapse, Box, Button } from '@mantine/core';
import { Bundle } from '@medplum/fhirtypes';

interface PatientDataBundleDisplayProps {
  bundle: Bundle;
}

export const PatientDataBundleDisplay: React.FC<PatientDataBundleDisplayProps> = ({ bundle }) => {
  const [showRawData, setShowRawData] = useState(false);
  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
  const getResources = (type: string) =>
    entries.map((e: any) => e.resource).filter((r: any) => r?.resourceType === type);
  const patient = getResources('Patient')[0];
  const allergies = getResources('AllergyIntolerance');
  const conditions = getResources('Condition');
  const medications = getResources('MedicationRequest');
  const observations = getResources('Observation');

  return (
    <Card withBorder p="md">
      {patient && (
        <Stack gap="xs" mb="sm">
          <Text fw={500}>Patient</Text>
          <Text size="sm">
            <strong>Name:</strong> {patient.name?.[0]?.given?.join(' ')} {patient.name?.[0]?.family}
          </Text>
          <Text size="sm">
            <strong>Birth Date:</strong> {patient.birthDate || 'Not specified'}
          </Text>
          <Text size="sm">
            <strong>Gender:</strong> {patient.gender || 'Not specified'}
          </Text>
        </Stack>
      )}

      <Divider my="sm" />

      {allergies.length > 0 && (
        <Stack gap="xs" mt="sm">
          <Text fw={500}>Allergies</Text>
          <List size="sm">
            {allergies.map((a: any, i: number) => (
              <List.Item key={`allergy-${i}`}>
                {a.code?.text || a.code?.coding?.[0]?.display || 'Unnamed allergy'}
                {a.clinicalStatus?.text ? ` (${a.clinicalStatus.text})` : ''}
              </List.Item>
            ))}
          </List>
        </Stack>
      )}

      {conditions.length > 0 && (
        <Stack gap="xs" mt="sm">
          <Text fw={500}>Conditions</Text>
          <List size="sm">
            {conditions.map((c: any, i: number) => (
              <List.Item key={`condition-${i}`}>
                {c.code?.text || c.code?.coding?.[0]?.display || 'Unnamed condition'}
              </List.Item>
            ))}
          </List>
        </Stack>
      )}

      {medications.length > 0 && (
        <Stack gap="xs" mt="sm">
          <Text fw={500}>Medications</Text>
          <List size="sm">
            {medications.map((m: any, i: number) => (
              <List.Item key={`med-${i}`}>
                {m.medicationCodeableConcept?.text || m.medicationCodeableConcept?.coding?.[0]?.display || 'Medication'}
              </List.Item>
            ))}
          </List>
        </Stack>
      )}

      {observations.length > 0 && (
        <Stack gap="xs" mt="sm">
          <Text fw={500}>Observations</Text>
          <List size="sm">
            {observations.map((o: any, i: number) => (
              <List.Item key={`obs-${i}`}>
                {(o.code?.text || o.code?.coding?.[0]?.display || 'Observation') +
                  (o.valueQuantity ? `: ${o.valueQuantity.value} ${o.valueQuantity.unit || ''}` : '')}
                {o.effectiveDateTime ? ` (${o.effectiveDateTime})` : ''}
              </List.Item>
            ))}
          </List>
        </Stack>
      )}

      <Box mt="xs">
        <Button size="xs" variant="outline" onClick={() => setShowRawData(!showRawData)}>
          View raw data
        </Button>
        <Collapse in={showRawData}>
          <Code block mt="xs">
            {JSON.stringify(bundle, null, 2)}
          </Code>
        </Collapse>
      </Box>
    </Card>
  );
};
