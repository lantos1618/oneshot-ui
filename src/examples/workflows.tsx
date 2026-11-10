import { LOCALE } from '../lib/core'
import type { WorkflowMachine } from '../lib/statechart'

/* Sample workflows: the agent team that the showcase's StateMachine and AgentTransitMap run. */

/**
 * Sample agent-team workflows (the showcase runs them in StateMachine and AgentTransitMap): lines are agent teams, stations are
 * agents and orchestrators (the transit map draws exactly these stations). Pass them to WorkflowEngine or StateMachine.
 */
export const AGENT_WORKFLOWS: Record<string, WorkflowMachine> = {
  feature: { name: 'Feature spec', event: 'doc.changed', start: 'index', emits: () => 'deploy.finished', states: {
    index: { at: ['memory', 'Index'], trigger: true, label: 'Change detected', next: 'recall' },
    recall: { at: ['memory', 'Recall'], work: 1.0, label: 'Recall: load context', next: 'route' },
    route: { at: ['memory', 'Research'], orch: true, label: 'Research routes to Analyst', next: 'analyst' },
    analyst: { at: ['research', 'Analyst'], work: 2.2, label: 'Analyst: write spec', next: 'product' },
    product: { at: ['research', 'Product'], orch: true, label: 'Product forks review', fork: ['grade', 'risk'], join: 'deploy' },
    grade: { at: ['evals', 'Grader'], work: 1.8, label: 'Grader: run evals', next: 'back' },
    risk: { at: ['approvals', 'Risk'], work: 1.4, label: 'Risk: check exposure', next: 'back' },
    deploy: { at: ['research', 'Deploy'], work: 1.0, label: 'Deploy: ship', next: 'done' } } },
  purchase: { name: 'Purchase', event: 'invoice.received', start: 'index', emits: () => 'payment.booked',
    init: seq => ({ amount: [3400, 12000, 7800, 18500][seq % 4] }), title: j => `Purchase CHF ${(j.data.amount as number).toLocaleString(LOCALE)}`, states: {
      index: { at: ['memory', 'Index'], trigger: true, label: 'Invoice detected', next: 'recall' },
      recall: { at: ['memory', 'Recall'], work: 0.8, label: 'Recall: vendor history', next: 'route' },
      route: { at: ['memory', 'Research'], orch: true, label: 'Research routes to Payments', next: 'pay' },
      pay: { at: ['payments', 'Pay agent'], work: 2.0, label: 'Pay agent: draft PO', next: 'finance' },
      finance: { at: ['payments', 'Finance'], orch: true, label: 'Finance checks amount', next: j => (j.data.amount as number) > 10000 && !j.data.approved ? 'risk' : 'ledger', guard: 'amount > 10k', to: [['risk', '> 10k'], ['ledger', '≤ 10k']] },
      risk: { at: ['approvals', 'Risk'], work: 1.8, hitl: true, label: 'Risk: approve spend', next: j => { j.data.approved = true; return 'financeBack' }, to: [['financeBack', 'approved']] },
      financeBack: { at: ['approvals', 'Finance'], orch: true, label: 'Back to Finance', next: 'ledger' },
      ledger: { at: ['payments', 'Ledger'], work: 1.0, label: 'Ledger: book entry', next: 'done' } } },
  regression: { name: 'Regression fix', short: 'Regression', event: 'test.failed', start: 'index', emits: () => 'deploy.finished', states: {
    index: { at: ['memory', 'Index'], trigger: true, label: 'Failing test detected', next: 'recall' },
    recall: { at: ['memory', 'Recall'], work: 0.8, label: 'Recall: last green build', next: 'route' },
    route: { at: ['memory', 'Research'], orch: true, label: 'Research routes to Analyst', next: 'analyst' },
    analyst: { at: ['research', 'Analyst'], work: 1.6, label: 'Analyst: write fix', next: 'product' },
    product: { at: ['research', 'Product'], orch: true, label: 'Product sends to evals', next: 'grade' },
    grade: { at: ['evals', 'Grader'], work: 1.8, label: 'Grader: rerun suite', next: j => ((j.data.attempt as number)++ >= 1 || Math.random() < 0.55) ? 'ship' : 'retry', guard: 'tests pass?', to: [['ship', 'pass'], ['retry', 'fail']] },
    retry: { at: ['evals', 'Product'], orch: true, label: 'Tests failed: retry', next: 'analyst' },
    ship: { at: ['evals', 'Product'], orch: true, label: 'Tests green', next: 'deploy' },
    deploy: { at: ['research', 'Deploy'], work: 0.8, label: 'Deploy: ship fix', next: 'done' } } },
  intake: { name: 'Customer request', short: 'Request', event: 'request.received', start: 'intake', emits: () => 'deploy.finished', states: {
    intake: { at: ['research', 'Intake'], label: 'Request received', next: 'route' },
    route: { at: ['research', 'Research'], orch: true, label: 'Research triages', next: 'analyst' },
    analyst: { at: ['research', 'Analyst'], work: 1.6, label: 'Analyst: scope request', next: 'product' },
    product: { at: ['research', 'Product'], orch: true, label: 'Product asks for sign-off', next: 'human' },
    human: { at: ['approvals', 'Human'], work: 1.4, hitl: true, label: 'Human: approve scope', next: 'signed' },
    signed: { at: ['approvals', 'Product'], orch: true, label: 'Approved', next: 'deploy' },
    deploy: { at: ['research', 'Deploy'], work: 0.9, label: 'Deploy: ship', next: 'done' } } },
  smoke: { name: 'Smoke test', event: 'deploy.finished', start: 'shipped', emits: j => j.data.failed ? 'test.failed' : null, states: {
    shipped: { at: ['research', 'Deploy'], label: 'Deploy finished', next: 'product' },
    product: { at: ['research', 'Product'], orch: true, label: 'Product schedules checks', next: 'grade' },
    grade: { at: ['evals', 'Grader'], work: 1.2, label: 'Grader: smoke suite', next: j => { j.data.failed = Math.random() < 0.25; return j.data.failed ? 'done' : 'report' }, guard: 'smoke passes?', to: [['report', 'pass'], ['done', 'fail → test.failed']] },
    report: { at: ['evals', 'Evals'], work: 0.8, label: 'Evals: publish report', next: 'done' } } },
  audit: { name: 'Payment audit', short: 'Audit', event: 'payment.booked', start: 'booked', states: {
    booked: { at: ['payments', 'Ledger'], label: 'Payment booked', next: 'finance' },
    finance: { at: ['payments', 'Finance'], orch: true, label: 'Finance routes to Audit', next: 'audit' },
    audit: { at: ['approvals', 'Audit'], work: 1.6, label: 'Audit: reconcile entry', next: 'done' } } },
}
/** The machines the lap timer cycles through, in order (the other three are triggered by events). */
export const AGENT_WORKFLOW_ORDER = ['feature', 'purchase', 'regression']
