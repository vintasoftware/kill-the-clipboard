'use client';
import { Container, Stack, Button, Group } from '@mantine/core';
import { Suspense, useState } from 'react';
import { CreateSHLForm } from '@/components/CreateSHLForm';
import { SHLDisplay } from '@/components/SHLDisplay';
import { PatientDataControl } from '@/components/PatientDataControl';
import { PaperlessIntakeBanner } from '@/components/PaperlessIntakeBanner';

export default function HomePage() {
  const [isCreating, setIsCreating] = useState(false);
  const [createdSHL, setCreatedSHL] = useState<string | null>(null);
  const [selectedSections, setSelectedSections] = useState<Record<string, boolean>>({});

  const handleCreateSHL = () => {
    setIsCreating(true);
  };

  const handleSHLCreated = (shlUri: string) => {
    setCreatedSHL(shlUri);
    setIsCreating(false);
  };

  const handleReset = () => {
    setCreatedSHL(null);
    setIsCreating(false);
  };

  const handleSelectionsChange = (selections: Record<string, boolean>) => {
    setSelectedSections(selections);
  };

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <PaperlessIntakeBanner />

        <Suspense fallback={<div>Loading...</div>}>
          {!isCreating && !createdSHL && (
            <Stack gap="lg">
              <PatientDataControl
                title="International Patient Summary"
                selectedSections={selectedSections}
                onSelectionsChange={handleSelectionsChange}
              />
              <Group>
                <Button size="lg" onClick={handleCreateSHL}>
                  Create SMART Health Link
                </Button>
              </Group>
            </Stack>
          )}

          {isCreating && (
            <CreateSHLForm
              onSHLCreated={handleSHLCreated}
              onCancel={() => setIsCreating(false)}
              selectedSections={selectedSections}
            />
          )}

          {createdSHL && <SHLDisplay shlUri={createdSHL} onReset={handleReset} />}
        </Suspense>
      </Stack>
    </Container>
  );
}
