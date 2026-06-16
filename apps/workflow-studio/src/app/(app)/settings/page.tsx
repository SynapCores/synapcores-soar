import { AppPageHeader } from '@synapcores/app-framework';
import { EngineSettingsForm } from '@/components/EngineSettingsForm';

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-2xl">
      <AppPageHeader
        title="Engine Settings"
        description="Connect Workflow Studio to a SynapCores engine"
      />
      <EngineSettingsForm />
    </div>
  );
}
