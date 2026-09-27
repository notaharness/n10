import { VcsError } from '@n10/vcs-core';
import { ghRest } from './gh-graphql.js';
import type { Required } from './gh-check-nodes.js';

/**
 * The base branch's rules: classic protection's required checks, which
 * GitHub shows anyone who can read the repository, and the rule sets
 * that apply to it. Conversation resolution is only visible from rule
 * sets, so under classic protection it is not known.
 */

interface ProtectionAnswer {
  protection?: {
    enabled?: boolean;
    required_status_checks?: {
      enforcement_level?: string;
      checks?: { context: string; app_id: number | null }[];
    };
  };
}

interface RuleAnswer {
  type: string;
  parameters?: {
    required_status_checks?: {
      context: string;
      integration_id?: number | null;
    }[];
    required_review_thread_resolution?: boolean;
  };
}

/** Rule sets asked for in one page; a full page may not be all. */
const RULES_PAGE = 100;

/** Classic protection's required checks, and whether it is on. */
function classic(answer: ProtectionAnswer): {
  required: Required[];
  enabled: boolean;
} {
  const protection = answer.protection;
  const checks = protection?.required_status_checks;
  const enforced = checks?.enforcement_level !== 'off';
  return {
    required: enforced
      ? (checks?.checks ?? []).map((c) => ({
          name: c.context,
          appId: c.app_id ?? null,
        }))
      : [],
    enabled: protection?.enabled ?? false,
  };
}

export async function branchRules(
  owner: string,
  repo: string,
  branch: string
): Promise<{ required: Required[]; resolution: boolean | null }> {
  const name = encodeURIComponent(branch);
  const [branchAnswer, rules] = await Promise.all([
    ghRest(`repos/${owner}/${repo}/branches/${name}`),
    ghRest(
      `repos/${owner}/${repo}/rules/branches/${name}?per_page=${RULES_PAGE}`
    ),
  ]);
  if ((rules as RuleAnswer[]).length >= RULES_PAGE) {
    throw new VcsError(
      'unexpected-response',
      `${branch} has more rules than n10 reads in one page`
    );
  }
  const { required, enabled } = classic(branchAnswer as ProtectionAnswer);
  let resolution: boolean | null = enabled ? null : false;
  for (const rule of rules as RuleAnswer[]) {
    const params = rule.parameters;
    for (const c of params?.required_status_checks ?? []) {
      required.push({ name: c.context, appId: c.integration_id ?? null });
    }
    if (params?.required_review_thread_resolution) resolution = true;
  }
  return { required, resolution };
}
