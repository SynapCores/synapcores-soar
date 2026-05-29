import {
  AppPageHeader,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@synapcores/app-framework';
import { requireSession } from '@/lib/session';

/**
 * SAR drafts + filings. Phase 3 wires the sar-drafter agent + the
 * jurisdiction-specific narrative editor. Phase 4 adds the FinCEN BSA
 * E-Filing adapter for actual filing.
 */
export default async function SarsPage() {
  await requireSession();
  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">
      <AppPageHeader
        title="SARs"
        description="Drafted + filed Suspicious Activity Reports."
      />
      <Card>
        <CardHeader>
          <CardTitle>No SARs yet</CardTitle>
          <CardDescription>
            Drafts land here when the <code>sar-drafter</code> agent runs against
            a case. Phase 3 wires the dispatch + jurisdiction-specific narrative
            template (FinCEN SAR, JMLSG/NCA, AUSTRAC SMR, FINTRAC STR, EU goAML).
            Phase 4 adds the BSA E-Filing adapter for one-click submission.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
