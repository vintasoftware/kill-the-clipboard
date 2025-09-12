'use client';
import {
  Card,
  TextInput,
  PasswordInput,
  Checkbox,
  Button,
  Stack,
  Text,
  Alert,
  Group,
  LoadingOverlay,
  Badge,
  Box,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { IconAlertCircle } from '@tabler/icons-react';

interface CreateSHLFormProps {
  onSHLCreated: (shlUri: string) => void;
  onCancel: () => void;
  selectedSections?: Record<string, boolean>;
}

interface FormValues {
  passcode: string;
  confirmPasscode: string;
  label: string;
  longTerm: boolean;
}

export function CreateSHLForm({ onSHLCreated, onCancel, selectedSections = {} }: CreateSHLFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Map section codes to human-readable names
  const sectionNames: Record<string, string> = {
    '11450-4': 'Problem List',
    '48765-2': 'Allergies and Intolerances',
    '10160-0': 'Medication Summary',
    '11369-6': 'Immunizations',
    '30954-2': 'Results',
    '47519-4': 'History of Procedures',
    '46264-8': 'Device Use',
    '8716-3': 'Vital Signs',
    '29762-2': 'Social History',
    '104605-1': 'Alerts',
    '81338-6': 'Patient Story',
    '42348-3': 'Advance Directives',
    '47420-5': 'Functional Status',
    '11348-0': 'History of Past Problems',
    '10162-6': 'History of Pregnancy',
    '18776-5': 'Plan of Care',
  };

  const selectedSectionNames = Object.entries(selectedSections)
    .filter(([_, isSelected]) => isSelected)
    .map(([code]) => sectionNames[code] || code);

  const form = useForm<FormValues>({
    initialValues: {
      passcode: '',
      confirmPasscode: '',
      label: '',
      longTerm: false,
    },
    validate: {
      passcode: (value) => {
        if (!value) return 'Passcode is required';
        if (value.length < 6) return 'Passcode must be at least 6 characters';
        return null;
      },
      confirmPasscode: (value, values) => {
        if (value !== values.passcode) return 'Passcodes do not match';
        return null;
      },
      label: (value) => {
        if (value && value.length > 80) return 'Label must be 80 characters or less';
        return null;
      },
    },
  });

  const handleSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/shl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          passcode: values.passcode,
          label: values.label.trim() || undefined,
          longTerm: values.longTerm,
          selectedSections,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to create Smart Health Link');
      }

      const { shlUri } = await response.json();
      form.reset();
      onSHLCreated(shlUri);
    } catch (error) {
      console.error('Error creating SHL:', error);
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to create Smart Health Link',
        color: 'red',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card withBorder p="xl" pos="relative">
      <LoadingOverlay visible={isSubmitting} zIndex={1000} overlayProps={{ radius: 'sm', blur: 2 }} />
      <Stack gap="lg">
        <div>
          <Text size="lg" fw={500} mb="xs">
            Create Smart Health Link
          </Text>
          <Text size="sm" c="dimmed">
            This will create a secure link to your health information that you can share with others.
          </Text>
        </div>

        <Alert icon={<IconAlertCircle size="1rem" />} color="blue">
          Your health information will be encrypted and can only be accessed with the passcode you set.
        </Alert>

        {selectedSectionNames.length > 0 && (
          <Box>
            <Text size="sm" fw={500} mb="xs">
              Selected sections to share:
            </Text>
            <Group gap="xs">
              {selectedSectionNames.map((name, index) => (
                <Badge key={index} variant="light" size="sm">
                  {name}
                </Badge>
              ))}
            </Group>
            <Text size="xs" c="dimmed" mt="xs">
              {selectedSectionNames.length} section{selectedSectionNames.length !== 1 ? 's' : ''} selected
            </Text>
          </Box>
        )}

        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="md">
            <PasswordInput
              label="Passcode"
              description="Set a passcode to protect your health information (minimum 6 characters)"
              placeholder="Enter passcode"
              required
              disabled={isSubmitting}
              {...form.getInputProps('passcode')}
            />

            <PasswordInput
              label="Confirm Passcode"
              placeholder="Confirm passcode"
              required
              disabled={isSubmitting}
              {...form.getInputProps('confirmPasscode')}
            />

            <TextInput
              label="Label (Optional)"
              description="A short description of this health information (max 80 characters)"
              placeholder="e.g., Annual Physical Results"
              disabled={isSubmitting}
              {...form.getInputProps('label')}
            />

            <Checkbox
              label="Long-term link"
              description="Allow the link to be accessed multiple times (recommended for ongoing care)"
              disabled={isSubmitting}
              {...form.getInputProps('longTerm', { type: 'checkbox' })}
            />

            <Group justify="flex-end" mt="md">
              <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
                Create Smart Health Link
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Card>
  );
}
