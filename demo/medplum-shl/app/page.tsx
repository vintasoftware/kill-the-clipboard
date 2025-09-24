'use client';
import { Container, Title, Text, Stack, Button, Group, Loader } from '@mantine/core';
import { SignInForm, useMedplumContext } from '@medplum/react';
import { Suspense, useEffect, useState } from 'react';
import { CreateSHLForm } from '@/components/CreateSHLForm';
import { SHLDisplay } from '@/components/SHLDisplay';
import { PatientDataManager } from '@/components/PatientDataManager';

export default function HomePage() {
  const { medplum, loading: medplumLoading, profile } = useMedplumContext();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (medplum && !medplumLoading) {
      setIsLoading(false);
    }
  }, [medplum, medplumLoading]);

  const [isCreating, setIsCreating] = useState(false);
  const [createdSHL, setCreatedSHL] = useState<string | null>(null);

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

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <div>
          <Title order={1} mb="md">
            Smart Health Links Demo
          </Title>
          <Text size="lg" c="dimmed">
            Create and share your health information using Smart Health Links
          </Text>
        </div>

        {isLoading && (
          <div>
            <Loader size="lg" />
          </div>
        )}

        {!profile && !isLoading && (
          <div>
            <Text mb="md">Please sign in to create Smart Health Links with your health data.</Text>
            <SignInForm>Sign in</SignInForm>
          </div>
        )}

        {profile && (
          <Suspense fallback={<div>Loading...</div>}>
            <div>
              <Text mb="md">
                Welcome, {profile.name?.[0]?.given?.[0]} {profile.name?.[0]?.family}!
              </Text>
              <Group mb="md">
                <Button variant="outline" onClick={() => medplum.signOut()}>
                  Sign out
                </Button>
              </Group>
            </div>

            {!isCreating && !createdSHL && (
              <Stack gap="lg">
                <PatientDataManager title="Your Health Information" />
                <Group>
                  <Button size="lg" onClick={handleCreateSHL}>
                    Create Smart Health Link
                  </Button>
                </Group>
              </Stack>
            )}

            {isCreating && <CreateSHLForm onSHLCreated={handleSHLCreated} onCancel={() => setIsCreating(false)} />}

            {createdSHL && <SHLDisplay shlUri={createdSHL} onReset={handleReset} />}
          </Suspense>
        )}
      </Stack>
    </Container>
  );
}
