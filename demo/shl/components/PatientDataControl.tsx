import React, { useState, useEffect, useCallback } from 'react';
import { Card, Title, Text, Stack, Button, LoadingOverlay, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { Bundle } from '@medplum/fhirtypes';
import { PatientDataBundleDisplay } from './PatientIPSControl';
import ipsBundleData from '../data/Bundle-bundle-ips-all-sections.json';

interface PatientDataControlProps {
  /** Title for the health data section */
  title?: string;
  selectedSections?: Record<string, boolean>;
  onSelectionsChange?: (selections: Record<string, boolean>) => void;
}

// IPS Bundle data is imported directly and used as the primary data source
const IPS_BUNDLE: Bundle = ipsBundleData as Bundle;

export const PatientDataControl: React.FC<PatientDataControlProps> = ({
  title = 'International Patient Summary',
  selectedSections = {},
  onSelectionsChange,
}) => {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadIPSHealthData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Use the static IPS bundle data
      setBundle(IPS_BUNDLE);
    } catch (error) {
      console.error('Error loading IPS data:', error);
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to load IPS data',
        color: 'red',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-load IPS data on mount
  useEffect(() => {
    loadIPSHealthData();
  }, [loadIPSHealthData]);

  return (
    <Card withBorder p="xl">
      <Stack gap="md" pos="relative">
        <LoadingOverlay visible={isLoading} />

        <Title order={3}>{title}</Title>

        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {bundle?.entry?.length
              ? `Currently showing ${bundle.entry.length} resource${
                  bundle.entry.length > 1 ? 's' : ''
                } from International Patient Summary`
              : 'No IPS data available'}
          </Text>
        </Stack>

        {bundle && bundle.entry && bundle.entry.length > 0 ? (
          <Stack gap="md">
            <PatientDataBundleDisplay
              bundle={bundle}
              selectedSections={selectedSections}
              onSelectionsChange={onSelectionsChange}
            />
          </Stack>
        ) : (
          !isLoading && (
            <Text c="dimmed" size="sm">
              No International Patient Summary data available
            </Text>
          )
        )}
      </Stack>
    </Card>
  );
};
