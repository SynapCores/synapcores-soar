import { AppPageHeader } from '@synapcores/app-framework';
import { ApprovalQueue } from '@/components/ApprovalQueue';

export default function ApprovalsPage() {
  return (
    <div className="p-6">
      <AppPageHeader
        title="Approval Queue"
        description="Pending workflow approvals awaiting your decision"
      />
      <ApprovalQueue />
    </div>
  );
}
