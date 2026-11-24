// Display names and theme colors for the AI agents (CLAUDE.md agent colors).
// The class names are written out in full so Tailwind can find them.
import type { AgentId } from './types/ai'

export const AGENT_LABELS: Record<AgentId, string> = {
  parser: 'Request Parser',
  matcher: 'Property Matcher',
  risk: 'Review & Risk',
  fairness: 'Fairness Auditor',
  explanation: 'Explanation',
  chair: 'Booking Assistant Chair',
}

export const AGENT_TEXT: Record<AgentId, string> = {
  parser: 'text-agent-parser',
  matcher: 'text-agent-matcher',
  risk: 'text-agent-risk',
  fairness: 'text-agent-fairness',
  explanation: 'text-agent-explanation',
  chair: 'text-agent-chair',
}

export const AGENT_BORDER: Record<AgentId, string> = {
  parser: 'border-agent-parser',
  matcher: 'border-agent-matcher',
  risk: 'border-agent-risk',
  fairness: 'border-agent-fairness',
  explanation: 'border-agent-explanation',
  chair: 'border-agent-chair',
}

// Name for any actor_id in an event ("harness" and guest ids aren't agents).
export function actorLabel(actorId: string): string {
  if (actorId === 'harness') return 'Harness'
  return AGENT_LABELS[actorId as AgentId] ?? actorId
}
