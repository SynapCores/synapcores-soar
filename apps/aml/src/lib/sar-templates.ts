/**
 * Jurisdiction-specific SAR narrative templates.
 *
 * The agent's prompt is jurisdiction-aware; the deterministic fallback
 * uses these templates directly. Real customer deployments override
 * via a templates table (Phase 4+).
 *
 * Each template is a function that takes a SARContext and emits a
 * narrative. Convention: 5W structure (who/what/when/where/why) so the
 * regulator can parse it without rework.
 */

export type Jurisdiction =
  | 'us-fincen'
  | 'uk-nca'
  | 'au-austrac'
  | 'ca-fintrac'
  | 'eu-goaml';

export interface SARContext {
  customerId: string | null;
  customerName?: string;
  counterparty: string | null;
  counterpartyCountry: string | null;
  txAmount: number;
  txCurrency: string;
  txType: string;
  txTimestamp: string;
  flags: Record<string, boolean | undefined>;
  narrative?: string | null;
  /** Recent peer transactions in the window — for the structuring story. */
  peerCount?: number;
  peerAggregate?: number;
}

const FLAGS_DESCRIPTION: Record<string, string> = {
  structuring: 'a pattern of multiple sub-CTR-threshold transactions in a rolling 24-hour window',
  velocity: 'an aggregate transaction value exceeding the configured 24-hour velocity threshold',
  cross_border_cash: 'a cash-equivalent transfer to a jurisdiction outside the United States',
  ctr_threshold: 'a transaction above the Currency Transaction Report threshold',
  round_number: 'an exact round-number amount consistent with layering tradecraft',
};

function flagSentence(flags: Record<string, boolean | undefined>): string {
  const active = Object.keys(flags).filter((k) => flags[k]);
  if (active.length === 0) {
    return 'characteristics inconsistent with the customer\'s historical activity profile';
  }
  return active.map((f) => FLAGS_DESCRIPTION[f] ?? f).join(', and ');
}

function moneyFmt(n: number, ccy: string): string {
  return `${ccy} ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export function buildSarNarrative(
  jurisdiction: Jurisdiction,
  ctx: SARContext,
): string {
  const subject = ctx.customerName ?? ctx.customerId ?? 'an account holder';
  const cp =
    ctx.counterparty ?? 'a counterparty referenced in the transaction';
  const cpCountry = ctx.counterpartyCountry
    ? ` (${ctx.counterpartyCountry})`
    : '';
  const amt = moneyFmt(ctx.txAmount, ctx.txCurrency);
  const when = new Date(ctx.txTimestamp).toUTCString();
  const flagSent = flagSentence(ctx.flags);
  const peer =
    ctx.peerCount && ctx.peerAggregate
      ? ` In the rolling 24-hour window preceding this transaction, the same subject originated ${ctx.peerCount} additional transaction(s) aggregating ${moneyFmt(ctx.peerAggregate, ctx.txCurrency)}, all directed to the same counterparty.`
      : '';

  switch (jurisdiction) {
    case 'us-fincen':
      return [
        `SUSPICIOUS ACTIVITY REPORT NARRATIVE — FinCEN SAR`,
        ``,
        `On ${when}, the institution identified a ${ctx.txType} transaction in the amount of ${amt} originated by ${subject} and directed to ${cp}${cpCountry}.`,
        ``,
        `The transaction exhibited ${flagSent}.${peer}`,
        ``,
        `Based on the foregoing pattern, the institution determined that the activity is inconsistent with the subject's stated business purpose and known source of funds, and warrants reporting under 31 CFR 1020.320.`,
        ``,
        `The subject's account remains active pending further investigation. No customer contact has been made regarding this filing. Evidence supporting this report has been retained in the institution's case-management system and is available for production upon request.`,
      ].join('\n');

    case 'uk-nca':
      return [
        `SUSPICIOUS ACTIVITY REPORT — UK National Crime Agency (Defence Against Money Laundering)`,
        ``,
        `Reporting institution identified, on ${when}, a ${ctx.txType} payment of ${amt} from ${subject} to ${cp}${cpCountry}.`,
        ``,
        `The transaction displays ${flagSent}.${peer}`,
        ``,
        `Submission is made pursuant to sections 330–331 of the Proceeds of Crime Act 2002. Consent is requested where applicable.`,
        ``,
        `Supporting evidence is retained under the institution's data-protection record-keeping policy.`,
      ].join('\n');

    case 'au-austrac':
      return [
        `SUSPICIOUS MATTER REPORT — AUSTRAC SMR`,
        ``,
        `On ${when}, the reporting entity observed a ${ctx.txType} transaction of ${amt} initiated by ${subject} to ${cp}${cpCountry}.`,
        ``,
        `Observed indicators: ${flagSent}.${peer}`,
        ``,
        `This Suspicious Matter Report is submitted pursuant to section 41 of the Anti-Money Laundering and Counter-Terrorism Financing Act 2006.`,
      ].join('\n');

    case 'ca-fintrac':
      return [
        `SUSPICIOUS TRANSACTION REPORT — FINTRAC STR`,
        ``,
        `The reporting entity observed, on ${when}, a ${ctx.txType} transaction of ${amt} from ${subject} to ${cp}${cpCountry}.`,
        ``,
        `The observed activity reflects ${flagSent}.${peer}`,
        ``,
        `This STR is filed pursuant to the Proceeds of Crime (Money Laundering) and Terrorist Financing Act.`,
      ].join('\n');

    case 'eu-goaml':
      return [
        `SUSPICIOUS TRANSACTION REPORT — EU goAML`,
        ``,
        `On ${when}, the reporting entity identified a ${ctx.txType} transaction of ${amt} from ${subject} to ${cp}${cpCountry}.`,
        ``,
        `Indicators: ${flagSent}.${peer}`,
        ``,
        `Submission made under the applicable national transposition of Directive (EU) 2015/849.`,
      ].join('\n');
  }
}
