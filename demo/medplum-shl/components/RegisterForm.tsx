'use client';
import { Button, Container, Paper, Stack, Text, Title } from '@mantine/core';
import { RegisterForm as MedplumRegisterForm } from '@medplum/react';

interface RegisterFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function RegisterForm({ onSuccess, onCancel }: RegisterFormProps) {
  const projectId = process.env.NEXT_PUBLIC_MEDPLUM_PROJECT_ID!;
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_MEDPLUM_RECAPTCHA_SITE_KEY!;

  return (
    <Container size="sm">
      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <Stack gap="lg">
          <div>
            <Title order={2} ta="center" mb="md">
              Create Account
            </Title>
            <Text c="dimmed" size="sm" ta="center">
              Register as a new patient to access your health information
            </Text>
          </div>

          <MedplumRegisterForm
            type="patient"
            projectId={projectId}
            recaptchaSiteKey={recaptchaSiteKey}
            onSuccess={() => {
              onSuccess?.();
            }}
          />

          {onCancel && (
            <Button variant="subtle" onClick={onCancel} mt="md">
              Back to sign in
            </Button>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
