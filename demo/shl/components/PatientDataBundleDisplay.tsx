import React, { useCallback, useState } from 'react';
import {
  Card,
  Text,
  Stack,
  Code,
  Collapse,
  Box,
  Button,
  Table,
  Title,
  Mark,
  Popover,
  Checkbox,
  Group,
} from '@mantine/core';
import { Bundle } from '@medplum/fhirtypes';

// Utility function to format dates in a human-readable way
const formatDate = (dateString: string | undefined): string => {
  if (!dateString) return '';

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; // Return original if invalid

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch (error) {
    return dateString; // Return original if parsing fails
  }
};

interface PatientDataBundleDisplayProps {
  bundle: Bundle;
  onSelectionsChange?: (selections: Record<string, boolean>) => void;
  selectedSections?: Record<string, boolean>;
}

interface SectionProps {
  isSelected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  sectionKey: string;
}

// Section header with checkbox
interface SectionHeaderProps {
  title: string;
  isSelected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  rowSpan: number;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, isSelected = true, onSelectionChange, rowSpan }) => (
  <Table.Td rowSpan={rowSpan} style={{ backgroundColor: '#f8f9fa', width: '200px', verticalAlign: 'top' }}>
    <Stack gap={4}>
      <Text size="sm" fw="bold">
        {title}
      </Text>
      {onSelectionChange && (
        <Checkbox
          size="sm"
          checked={isSelected}
          onChange={(event) => onSelectionChange(event.currentTarget.checked)}
          label="Include"
        />
      )}
    </Stack>
  </Table.Td>
);

// Reusable truncate with popover component
const truncate = (input: string, length: number) =>
  input.length > length ? `${input.substring(0, length)}...` : input;

const TruncatedText = ({ text, length, textSize = 'sm' }: { text: string; length: number; textSize?: string }) => {
  if (text.length <= length) {
    return <Text size={textSize}>{text}</Text>;
  }

  return (
    <Popover middlewares={{ flip: true, shift: true, inline: true }} position="bottom">
      <Popover.Target>
        <Text size={textSize}>
          <Mark>{truncate(text, length)}</Mark>
        </Text>
      </Popover.Target>
      <Popover.Dropdown w={200}>
        <Text size={textSize}>{text}</Text>
      </Popover.Dropdown>
    </Popover>
  );
};

// Common narrative display components
interface NarrativeToggleProps {
  showNarrative: boolean;
  onToggle: () => void;
}

const NarrativeToggle: React.FC<NarrativeToggleProps> = ({ showNarrative, onToggle }) => (
  <Button variant="subtle" size="xs" onClick={onToggle}>
    👁 {showNarrative ? 'HIDE' : 'SHOW'} NARRATIVE
  </Button>
);

interface NarrativeContentProps {
  showNarrative: boolean;
  resources: any[];
  getDisplayName?: (resource: any, index: number) => string;
}

const NarrativeContent: React.FC<NarrativeContentProps> = ({ showNarrative, resources, getDisplayName }) => (
  <Collapse in={showNarrative}>
    <Box mt="xs" p="sm" style={{ backgroundColor: '#f8f9fa', borderRadius: '4px', border: '1px solid #e9ecef' }}>
      {resources.map((resource: any, i: number) => (
        <Box key={`narrative-${i}`} mb="sm">
          <Text size="sm" fw={500} mb={4}>
            {getDisplayName ? getDisplayName(resource, i) : `Resource ${i + 1}`}
          </Text>
          {resource.text?.div ? (
            <div
              dangerouslySetInnerHTML={{ __html: resource.text.div }}
              style={{ fontSize: '13px', lineHeight: '1.4', color: '#495057' }}
            />
          ) : (
            <Text size="sm" c="dimmed" fs="italic">
              No narrative text available for this resource.
            </Text>
          )}
        </Box>
      ))}
    </Box>
  </Collapse>
);

// Individual section components
const PatientSection: React.FC<{ patient: any }> = ({ patient }) => {
  if (!patient) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td style={{ backgroundColor: '#f8f9fa', fontWeight: 'bold', width: '200px' }}>Patient</Table.Td>
            <Table.Td>
              <Text fw={500}>
                {patient.name?.[0]?.given?.join(' ')} {patient.name?.[0]?.family}
              </Text>
              <Text size="sm" c="dimmed">
                DOB: {formatDate(patient.birthDate) || 'Not specified'}
              </Text>
              <Text size="sm" c="dimmed">
                Gender: {patient.gender || 'Not specified'}
              </Text>
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </Box>
  );
};

const ProblemListSection: React.FC<{ conditions: any[] } & SectionProps> = ({
  conditions,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (conditions.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="Problem List"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={conditions.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Status</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', minWidth: '100px' }}>Name</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Severity</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Since</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Recorded</Table.Td>
          </Table.Tr>
          {conditions.map((c: any, i: number) => (
            <Table.Tr key={`condition-${i}`}>
              <Table.Td>{c.clinicalStatus?.coding?.[0]?.code}</Table.Td>
              <Table.Td>{c.code?.text || c.code?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{c.severity?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{formatDate(c.onsetDateTime || c.onsetPeriod?.start)}</Table.Td>
              <Table.Td>{formatDate(c.recordedDate)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={conditions}
        getDisplayName={(condition: any, i: number) =>
          condition.code?.text || condition.code?.coding?.[0]?.display || `Condition ${i + 1}`
        }
      />
    </Box>
  );
};

const AllergiesSection: React.FC<{ allergies: any[] } & SectionProps> = ({
  allergies,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (allergies.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="Allergies and Intolerances"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={allergies.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Status</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', minWidth: '100px' }}>Name</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Criticality</Table.Td>
          </Table.Tr>
          {allergies.map((a: any, i: number) => (
            <Table.Tr key={`allergy-${i}`}>
              <Table.Td>{a.clinicalStatus?.coding?.[0]?.code}</Table.Td>
              <Table.Td>{a.code?.text || a.code?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{a.criticality}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={allergies}
        getDisplayName={(allergy: any, i: number) =>
          allergy.code?.text || allergy.code?.coding?.[0]?.display || `Allergy ${i + 1}`
        }
      />
    </Box>
  );
};

const MedicationSummarySection: React.FC<{ medications: any[] } & SectionProps> = ({
  medications,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (medications.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="Medication Summary"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={medications.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Status</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', minWidth: '200px' }}>Name</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '200px' }}>Dosage</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Effective</Table.Td>
          </Table.Tr>
          {medications.map((m: any, i: number) => (
            <Table.Tr key={`med-${i}`}>
              <Table.Td>{m.status}</Table.Td>
              <Table.Td>
                {m.medicationCodeableConcept?.coding?.[0]?.display ||
                  m.medicationCodeableConcept?.text ||
                  'No information about medications'}
              </Table.Td>
              <Table.Td>
                <TruncatedText text={m.dosage?.[0]?.text} length={30} />
              </Table.Td>
              <Table.Td>{formatDate(m.effectiveDateTime || m.effectivePeriod?.start)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={medications}
        getDisplayName={(medication: any, i: number) =>
          medication.medicationCodeableConcept?.text ||
          medication.medicationCodeableConcept?.coding?.[0]?.display ||
          `Medication ${i + 1}`
        }
      />
    </Box>
  );
};

const ImmunizationsSection: React.FC<{ immunizations: any[] } & SectionProps> = ({
  immunizations,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (immunizations.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="Immunizations"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={immunizations.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', minWidth: '200px' }}>Vaccine</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Lot Number</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Date</Table.Td>
          </Table.Tr>
          {immunizations.map((imm: any, i: number) => (
            <Table.Tr key={`imm-${i}`}>
              <Table.Td>{imm.vaccineCode?.text || imm.vaccineCode?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{imm.lotNumber}</Table.Td>
              <Table.Td>{formatDate(imm.occurrenceDateTime) || imm.occurrenceString}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={immunizations}
        getDisplayName={(imm: any, i: number) =>
          imm.vaccineCode?.text || imm.vaccineCode?.coding?.[0]?.display || `Vaccine ${i + 1}`
        }
      />
    </Box>
  );
};

const ResultsSection: React.FC<{ labResults: any[] } & SectionProps> = ({
  labResults,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  const getValue = useCallback((obs: any) => {
    return obs.valueQuantity
      ? `${obs.valueQuantity.value} ${obs.valueQuantity.unit}`
      : obs.valueString || obs.valueCodeableConcept?.text;
  }, []);

  if (labResults.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="Results"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={labResults.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Category</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', minWidth: '100px' }}>Test</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Value</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Note</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Date</Table.Td>
          </Table.Tr>
          {labResults.map((obs: any, i: number) => (
            <Table.Tr key={`lab-${i}`}>
              <Table.Td>{obs.category?.[0]?.coding?.[0]?.code}</Table.Td>
              <Table.Td>{obs.code?.text || obs.code?.coding?.[0]?.display}</Table.Td>
              <Table.Td>
                <TruncatedText text={getValue(obs)} length={30} />
              </Table.Td>
              <Table.Td>
                <TruncatedText text={obs.note?.[0]?.text} length={40} />
              </Table.Td>
              <Table.Td>{formatDate(obs.effectiveDateTime)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={labResults}
        getDisplayName={(obs: any, i: number) =>
          obs.code?.text || obs.code?.coding?.[0]?.display || `Lab Test ${i + 1}`
        }
      />
    </Box>
  );
};

const ProceduresSection: React.FC<{ procedures: any[] } & SectionProps> = ({
  procedures,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (procedures.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="History of Procedures"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={procedures.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', minWidth: '200px' }}>Procedure</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Date</Table.Td>
          </Table.Tr>
          {procedures.map((proc: any, i: number) => (
            <Table.Tr key={`proc-${i}`}>
              <Table.Td>{proc.code?.text || proc.code?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{formatDate(proc.performedDateTime || proc.performedPeriod?.start)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={procedures}
        getDisplayName={(proc: any, i: number) =>
          proc.code?.text || proc.code?.coding?.[0]?.display || `Procedure ${i + 1}`
        }
      />
    </Box>
  );
};

const DeviceUseSection: React.FC<{ deviceUseStatements: any[]; devices: any[] } & SectionProps> = ({
  deviceUseStatements,
  devices,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (deviceUseStatements.length === 0 && devices.length === 0) return null;

  const allDeviceResources = [...deviceUseStatements, ...devices];
  const totalRows = deviceUseStatements.length + devices.length;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="Device Use"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={totalRows + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', minWidth: '100px' }}>Device</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Status</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Body Site</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Start</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>End</Table.Td>
          </Table.Tr>
          {deviceUseStatements.map((deviceUse: any, i: number) => (
            <Table.Tr key={`device-${i}`}>
              <Table.Td>{deviceUse.device?.display}</Table.Td>
              <Table.Td>{deviceUse.status}</Table.Td>
              <Table.Td>{deviceUse.bodySite?.text || deviceUse.bodySite?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{formatDate(deviceUse.timingDateTime || deviceUse.timingPeriod?.start)}</Table.Td>
              <Table.Td>{formatDate(deviceUse.timingPeriod?.end)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={allDeviceResources}
        getDisplayName={(device: any, i: number) =>
          device.device?.display ||
          device.deviceName?.[0]?.name ||
          device.type?.text ||
          device.type?.coding?.[0]?.display ||
          `Device ${i + 1}`
        }
      />
    </Box>
  );
};

const VitalSignsSection: React.FC<{ vitalSigns: any[] } & SectionProps> = ({
  vitalSigns,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (vitalSigns.length === 0) return null;

  // Helper function to render vital sign value recursively
  const renderVitalValue = (vital: any) => {
    // If it has a direct value, display it
    if (vital.valueQuantity) {
      return `${vital.valueQuantity.value} ${vital.valueQuantity.unit}`;
    }

    // If it has components (like blood pressure), display them
    if (vital.component && vital.component.length > 0) {
      return vital.component.map((comp: any, idx: number) => (
        <div key={idx} style={{ marginBottom: '2px' }}>
          <Text size="sm" c="dimmed">
            {comp.code?.coding?.[0]?.display || comp.code?.text || `Component ${idx + 1}`}:
          </Text>{' '}
          <Text size="sm" span>
            {comp.valueQuantity ? `${comp.valueQuantity.value} ${comp.valueQuantity.unit}` : 'N/A'}
          </Text>
        </div>
      ));
    }

    return 'N/A';
  };

  // Calculate total rows needed (including component rows)
  const totalRows = vitalSigns.reduce((total, vital) => {
    if (vital.component && vital.component.length > 0) {
      return total + 1; // Main row for the vital sign
    }
    return total + 1;
  }, 0);

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="Vital Signs"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={totalRows + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Category</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', minWidth: '200px' }}>Measurement</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '200px' }}>Value</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Date</Table.Td>
          </Table.Tr>
          {vitalSigns.map((vital: any, i: number) => (
            <Table.Tr key={`vital-${i}`}>
              <Table.Td>{vital.category?.[0]?.coding?.[0]?.code}</Table.Td>
              <Table.Td>
                <Text size="sm" fw={vital.component && vital.component.length > 0 ? 500 : 400}>
                  {vital.code?.text || vital.code?.coding?.[0]?.display}
                </Text>
              </Table.Td>
              <Table.Td>{renderVitalValue(vital)}</Table.Td>
              <Table.Td>{formatDate(vital.effectiveDateTime)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={vitalSigns}
        getDisplayName={(vital: any, i: number) =>
          vital.code?.text || vital.code?.coding?.[0]?.display || `Vital Sign ${i + 1}`
        }
      />
    </Box>
  );
};

const SocialHistorySection: React.FC<{ socialHistory: any[] } & SectionProps> = ({
  socialHistory,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (socialHistory.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="Social History"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={socialHistory.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Category</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', minWidth: '200px' }}>Observation</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '200px' }}>Value</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Date</Table.Td>
          </Table.Tr>
          {socialHistory.map((social: any, i: number) => (
            <Table.Tr key={`social-${i}`}>
              <Table.Td>{social.category?.[0]?.coding?.[0]?.code}</Table.Td>
              <Table.Td>{social.code?.text || social.code?.coding?.[0]?.display}</Table.Td>
              <Table.Td>
                {social.valueCodeableConcept?.text ||
                  social.valueCodeableConcept?.coding?.[0]?.display ||
                  (social.valueQuantity ? `${social.valueQuantity.value} ${social.valueQuantity.unit}` : '')}
              </Table.Td>
              <Table.Td>{formatDate(social.effectiveDateTime)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={socialHistory}
        getDisplayName={(social: any, i: number) =>
          social.code?.text || social.code?.coding?.[0]?.display || `Social History ${i + 1}`
        }
      />
    </Box>
  );
};

const AlertsSection: React.FC<{ flags: any[] } & SectionProps> = ({
  flags,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  if (flags.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="Alerts"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={flags.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', minWidth: '100px' }}>Alert</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Status</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Category</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Priority</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Start</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>End</Table.Td>
          </Table.Tr>
          {flags.map((flag: any, i: number) => (
            <Table.Tr key={`flag-${i}`}>
              <Table.Td>{flag.code?.text || flag.code?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{flag.status}</Table.Td>
              <Table.Td>{flag.category?.[0]?.text || flag.category?.[0]?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{flag.priority}</Table.Td>
              <Table.Td>{formatDate(flag.period?.start)}</Table.Td>
              <Table.Td>{formatDate(flag.period?.end)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  );
};

const PatientStorySection: React.FC<{ title: string; consents: any[] } & SectionProps> = ({
  title,
  consents,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (consents.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title={title}
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={consents.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Status</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Scope</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', minWidth: '200px' }}>Category</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Date</Table.Td>
          </Table.Tr>
          {consents.map((consent: any, i: number) => (
            <Table.Tr key={`consent-${i}`}>
              <Table.Td>{consent.status}</Table.Td>
              <Table.Td>{consent.scope?.text || consent.scope?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{consent.category?.[0]?.text || consent.category?.[0]?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{formatDate(consent.dateTime)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={consents}
        getDisplayName={(consent: any, i: number) =>
          consent.category?.[0]?.text || consent.category?.[0]?.coding?.[0]?.display || `Consent ${i + 1}`
        }
      />
    </Box>
  );
};

const FunctionalStatusSection: React.FC<{ conditions: any[] } & SectionProps> = ({
  conditions,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (conditions.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="Functional Status"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={conditions.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Status</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', minWidth: '100px' }}>Condition</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Severity</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Since</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Recorded</Table.Td>
          </Table.Tr>
          {conditions.map((cond: any, i: number) => (
            <Table.Tr key={`functional-${i}`}>
              <Table.Td>
                {`${cond.clinicalStatus?.coding?.[0]?.code} / ${cond.verificationStatus?.coding?.[0]?.code}`}
              </Table.Td>
              <Table.Td>{cond.code?.text || cond.code?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{cond.severity?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{formatDate(cond.onsetDateTime || cond.onsetPeriod?.start)}</Table.Td>
              <Table.Td>{formatDate(cond.recordedDate)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={conditions}
        getDisplayName={(cond: any, i: number) =>
          cond.code?.text || cond.code?.coding?.[0]?.display || `Functional Status ${i + 1}`
        }
      />
    </Box>
  );
};

const PastProblemsSection: React.FC<{ conditions: any[] } & SectionProps> = ({
  conditions,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (conditions.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="History of Past Problems"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={conditions.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Status</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', minWidth: '100px' }}>Problem</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Severity</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Since</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Recorded</Table.Td>
          </Table.Tr>
          {conditions.map((cond: any, i: number) => (
            <Table.Tr key={`past-${i}`}>
              <Table.Td>
                {`${cond.clinicalStatus?.coding?.[0]?.code} / ${cond.verificationStatus?.coding?.[0]?.code}`}
              </Table.Td>
              <Table.Td>{cond.code?.text || cond.code?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{cond.severity?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{formatDate(cond.onsetDateTime || cond.onsetPeriod?.start)}</Table.Td>
              <Table.Td>{formatDate(cond.recordedDate)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={conditions}
        getDisplayName={(cond: any, i: number) =>
          cond.code?.text || cond.code?.coding?.[0]?.display || `Past Problem ${i + 1}`
        }
      />
    </Box>
  );
};

const PregnancyHistorySection: React.FC<{ pregnancyHistory: any[] } & SectionProps> = ({
  pregnancyHistory,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  const [showNarrative, setShowNarrative] = useState(false);

  if (pregnancyHistory.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="History of Pregnancy"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={pregnancyHistory.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', minWidth: '200px' }}>Status</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '200px' }}>Value</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Date</Table.Td>
          </Table.Tr>
          {pregnancyHistory.map((preg: any, i: number) => (
            <Table.Tr key={`pregnancy-${i}`}>
              <Table.Td>{preg.code?.text || preg.code?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{preg.valueCodeableConcept?.text || preg.valueCodeableConcept?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{formatDate(preg.effectiveDateTime)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Box mt="xs" style={{ textAlign: 'right' }}>
        <NarrativeToggle showNarrative={showNarrative} onToggle={() => setShowNarrative(!showNarrative)} />
      </Box>

      <NarrativeContent
        showNarrative={showNarrative}
        resources={pregnancyHistory}
        getDisplayName={(preg: any, i: number) =>
          preg.code?.text || preg.code?.coding?.[0]?.display || `Pregnancy Status ${i + 1}`
        }
      />
    </Box>
  );
};

const PlanOfCareSection: React.FC<{ carePlans: any[] } & SectionProps> = ({
  carePlans,
  isSelected = true,
  onSelectionChange,
  sectionKey,
}) => {
  if (carePlans.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <SectionHeader
              title="Plan of Care"
              isSelected={isSelected}
              onSelectionChange={onSelectionChange}
              rowSpan={carePlans.length + 1}
            />
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Title</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', minWidth: '200px' }}>Description</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Status</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Intent</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Category</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Period Start</Table.Td>
            <Table.Td style={{ fontWeight: 'bold', width: '100px' }}>Period End</Table.Td>
          </Table.Tr>
          {carePlans.map((plan: any, i: number) => (
            <Table.Tr key={`plan-${i}`}>
              <Table.Td>{plan.title}</Table.Td>
              <Table.Td>{plan.description}</Table.Td>
              <Table.Td>{plan.status}</Table.Td>
              <Table.Td>{plan.intent}</Table.Td>
              <Table.Td>{plan.category?.[0]?.text || plan.category?.[0]?.coding?.[0]?.display}</Table.Td>
              <Table.Td>{formatDate(plan.period?.start)}</Table.Td>
              <Table.Td>{formatDate(plan.period?.end)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  );
};

const CompositionSection: React.FC<{ composition: any }> = ({ composition }) => {
  if (!composition) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td style={{ backgroundColor: '#f8f9fa', fontWeight: 'bold', width: '200px' }}>Composition</Table.Td>
            <Table.Td>{composition.title || 'International Patient Summary'}</Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </Box>
  );
};

const SummaryPreparedBySection: React.FC<{ organizations: any[] }> = ({ organizations }) => {
  if (organizations.length === 0) return null;

  return (
    <Box>
      <Table>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td style={{ backgroundColor: '#f8f9fa', fontWeight: 'bold', width: '200px' }}>
              Summary prepared by
            </Table.Td>
            <Table.Td>{organizations[0]?.name}</Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </Box>
  );
};

export const PatientDataBundleDisplay: React.FC<PatientDataBundleDisplayProps> = ({
  bundle,
  onSelectionsChange,
  selectedSections = {},
}) => {
  const [showRawData, setShowRawData] = useState(false);
  const [localSelections, setLocalSelections] = useState<Record<string, boolean>>(selectedSections);
  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];

  // Handle selection changes
  const handleSelectionChange = (sectionKey: string, selected: boolean) => {
    const updatedSelections = {
      ...localSelections,
      [sectionKey]: selected,
    };
    setLocalSelections(updatedSelections);
    onSelectionsChange?.(updatedSelections);
  };
  // Create a map of resource references to resources for easy lookup
  const resourceMap = new Map();
  entries.forEach((entry: any) => {
    if (entry.fullUrl && entry.resource) {
      resourceMap.set(entry.fullUrl, entry.resource);
      // Also map by resource type/id for internal references
      if (entry.resource.resourceType && entry.resource.id) {
        resourceMap.set(`${entry.resource.resourceType}/${entry.resource.id}`, entry.resource);
      }
    }
  });

  const getResources = (type: string) =>
    entries.map((e: any) => e.resource).filter((r: any) => r?.resourceType === type);

  const patient = getResources('Patient')[0];
  const composition = getResources('Composition')[0];
  const organizations = getResources('Organization');

  // Function to resolve references to actual resources
  const resolveReferences = (references: string[]) => {
    return references
      .map((ref) => resourceMap.get(ref) || resourceMap.get(ref.replace('Patient/', 'Patient/')))
      .filter(Boolean);
  };

  // Build sections from Composition
  const sections =
    composition?.section?.map((section: any) => {
      const sectionResources = section.entry ? resolveReferences(section.entry.map((e: any) => e.reference)) : [];

      return {
        title: section.title,
        code: section.code,
        text: section.text,
        resources: sectionResources,
      };
    }) || [];

  // Handle select/deselect all - defined after sections are available
  const handleSelectAll = () => {
    const allSections: Record<string, boolean> = {};
    sections.forEach((section: any) => {
      const code = section.code?.coding?.[0]?.code;
      const sectionKey = code || section.title;
      allSections[sectionKey] = true;
    });
    setLocalSelections(allSections);
    onSelectionsChange?.(allSections);
  };

  const handleDeselectAll = () => {
    const noSections: Record<string, boolean> = {};
    sections.forEach((section: any) => {
      const code = section.code?.coding?.[0]?.code;
      const sectionKey = code || section.title;
      noSections[sectionKey] = false;
    });
    setLocalSelections(noSections);
    onSelectionsChange?.(noSections);
  };

  // Check if all sections are selected
  const allSectionsSelected = sections.every((section: any) => {
    const code = section.code?.coding?.[0]?.code;
    const sectionKey = code || section.title;
    return localSelections[sectionKey] ?? true;
  });

  // Check if no sections are selected
  const noSectionsSelected = sections.every((section: any) => {
    const code = section.code?.coding?.[0]?.code;
    const sectionKey = code || section.title;
    return !(localSelections[sectionKey] ?? true);
  });

  // Map LOINC codes to section components
  const getSectionComponent = (section: any) => {
    const code = section.code?.coding?.[0]?.code;
    const resources = section.resources;
    const sectionKey = code || section.title;
    const isSelected = localSelections[sectionKey] ?? true;

    const commonProps = {
      sectionKey,
      isSelected,
      onSelectionChange: onSelectionsChange
        ? (selected: boolean) => handleSelectionChange(sectionKey, selected)
        : undefined,
    };

    switch (code) {
      case '11450-4': // Problem list - Reported
        return <ProblemListSection key={code} conditions={resources} {...commonProps} />;
      case '48765-2': // Allergies and adverse reactions Document
        return <AllergiesSection key={code} allergies={resources} {...commonProps} />;
      case '10160-0': // History of Medication use Narrative
        return <MedicationSummarySection key={code} medications={resources} {...commonProps} />;
      case '11369-6': // History of Immunization note
        return <ImmunizationsSection key={code} immunizations={resources} {...commonProps} />;
      case '30954-2': // Relevant diagnostic tests/laboratory data note
        return <ResultsSection key={code} labResults={resources} {...commonProps} />;
      case '47519-4': // History of Procedures Document
        return <ProceduresSection key={code} procedures={resources} {...commonProps} />;
      case '46264-8': // History of medical device use
        const devices = getResources('Device');
        return <DeviceUseSection key={code} deviceUseStatements={resources} devices={devices} {...commonProps} />;
      case '8716-3': // Vital signs note
        return <VitalSignsSection key={code} vitalSigns={resources} {...commonProps} />;
      case '29762-2': // Social history note
        return <SocialHistorySection key={code} socialHistory={resources} {...commonProps} />;
      case '104605-1': // Alert
        return <AlertsSection key={code} flags={resources} {...commonProps} />;
      case '81338-6': // Patient Goals, preferences, and priorities for care experience
        return <PatientStorySection title="Patient Story" key={code} consents={resources} {...commonProps} />;
      case '42348-3': // Advance healthcare directives
        return <PatientStorySection title="Advance Directives" key={code} consents={resources} {...commonProps} />;
      case '47420-5': // Functional status assessment note
        return <FunctionalStatusSection key={code} conditions={resources} {...commonProps} />;
      case '11348-0': // History of Past illness note
        return <PastProblemsSection key={code} conditions={resources} {...commonProps} />;
      case '10162-6': // History of pregnancies Narrative
        return <PregnancyHistorySection key={code} pregnancyHistory={resources} {...commonProps} />;
      case '18776-5': // Plan of care note
        return <PlanOfCareSection key={code} carePlans={resources} {...commonProps} />;
      default:
        // Generic section for unknown codes
        return (
          <Box key={code || section.title} mb="md">
            <Title order={3} size="h4" mb="xs">
              {section.title}
            </Title>
            {resources.length > 0 ? (
              <Text size="sm" c="dimmed">
                {resources.length} resource(s)
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                No entries
              </Text>
            )}
          </Box>
        );
    }
  };

  return (
    <Card withBorder p="md">
      <Stack gap="md">
        <PatientSection patient={patient} />

        <CompositionSection composition={composition} />

        {/* Selection controls - only show if onSelectionsChange is provided */}
        {onSelectionsChange && sections.length > 0 && (
          <Card withBorder p="sm" style={{ backgroundColor: '#f8f9fa' }}>
            <Group justify="space-between" align="center">
              <Text size="sm" fw={500}>
                Select sections to include in your Smart Health Link:
              </Text>
              <Group gap="xs">
                {!allSectionsSelected && (
                  <Button size="xs" variant="light" onClick={handleSelectAll}>
                    Include All
                  </Button>
                )}
                {!noSectionsSelected && (
                  <Button size="xs" variant="light" color="red" onClick={handleDeselectAll}>
                    Deselect All
                  </Button>
                )}
              </Group>
            </Group>
          </Card>
        )}

        {/* Render sections based on Composition structure */}
        {sections.map((section: any) => getSectionComponent(section))}
        <SummaryPreparedBySection organizations={organizations} />

        <Box mt="md">
          <Button size="xs" variant="outline" onClick={() => setShowRawData(!showRawData)}>
            View raw data
          </Button>
          <Collapse in={showRawData}>
            <Code block mt="xs">
              {JSON.stringify(bundle, null, 2)}
            </Code>
          </Collapse>
        </Box>
      </Stack>
    </Card>
  );
};
