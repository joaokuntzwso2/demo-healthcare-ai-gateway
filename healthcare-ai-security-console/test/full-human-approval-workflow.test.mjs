import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProposalForTest,
  reviewHumanApprovalProposal,
  humanApprovalSummary,
  humanApprovalAudit,
  resetHumanApprovalWorkflow
} from '../server/services/human-approval-workflow.mjs';
import { demoCatalog } from '../server/services/demo-catalog.mjs';

const actorId='neph-001';
const patientId='pat-1001';

test.beforeEach(()=>resetHumanApprovalWorkflow({actorId,patientId}));

test('AI proposal starts pending human review and cannot execute',()=>{
  const proposal=createProposalForTest({actorId,patientId});

  assert.equal(proposal.status,'PENDING_HUMAN_REVIEW');
  assert.equal(proposal.proposedAction.statement,'Repeat potassium tomorrow.');
  assert.equal(proposal.proposedAction.authoritative,false);
  assert.equal(proposal.proposedAction.createdBy,'AI_ASSISTANT');
  assert.equal(proposal.humanReview.status,'PENDING');
  assert.equal(proposal.execution.supported,false);
  assert.equal(proposal.execution.executed,false);
  assert.equal(proposal.execution.orderId,null);
});

test('proposal review evidence uses current corrected potassium and keeps superseded provenance',()=>{
  const proposal=createProposalForTest({actorId,patientId});

  assert.equal(proposal.evidence.current.value,4.8);
  assert.equal(proposal.evidence.current.version,2);
  assert.equal(proposal.evidence.current.status,'CURRENT_CORRECTED');

  assert.equal(proposal.evidence.superseded[0].value,5.8);
  assert.equal(proposal.evidence.superseded[0].version,1);
  assert.equal(proposal.evidence.superseded[0].status,'SUPERSEDED');

  assert.equal(proposal.evidence.selectionRule,'LATEST_VALID_VERSION_IN_RESULT_CHAIN');
});

test('physician approval records human authority but remains not executed',()=>{
  const proposal=createProposalForTest({actorId,patientId});
  const approved=reviewHumanApprovalProposal({
    proposalId:proposal.proposalId,
    reviewerActorId:actorId,
    decision:'APPROVE',
    comment:'Reviewed synthetic evidence; approve workflow proposal for demo.'
  });

  assert.equal(approved.status,'APPROVED_NOT_EXECUTED');
  assert.equal(approved.humanReview.status,'APPROVED');
  assert.equal(approved.humanReview.decision,'APPROVE');
  assert.equal(approved.humanReview.reviewerActorId,actorId);
  assert.equal(approved.humanReview.evidenceReviewed,true);
  assert.equal(approved.execution.supported,false);
  assert.equal(approved.execution.executed,false);
  assert.equal(approved.execution.orderId,null);
});

test('physician rejection records decision and creates no order',()=>{
  const proposal=createProposalForTest({actorId,patientId});
  const rejected=reviewHumanApprovalProposal({
    proposalId:proposal.proposalId,
    reviewerActorId:actorId,
    decision:'REJECT',
    comment:'Reject synthetic proposal.'
  });

  assert.equal(rejected.status,'REJECTED');
  assert.equal(rejected.humanReview.status,'REJECTED');
  assert.equal(rejected.humanReview.decision,'REJECT');
  assert.equal(rejected.execution.executed,false);
  assert.equal(rejected.execution.orderId,null);
});

test('human decision is terminal and cannot be changed by a second decision',()=>{
  const proposal=createProposalForTest({actorId,patientId});
  reviewHumanApprovalProposal({
    proposalId:proposal.proposalId,
    reviewerActorId:actorId,
    decision:'APPROVE'
  });

  assert.throws(
    ()=>reviewHumanApprovalProposal({
      proposalId:proposal.proposalId,
      reviewerActorId:actorId,
      decision:'REJECT'
    }),
    e=>e.code==='HUMAN_REVIEW_ALREADY_COMPLETED'
  );
});

test('workflow audit separates AI proposal from human authority and confirms non-execution',()=>{
  const proposal=createProposalForTest({actorId,patientId});
  reviewHumanApprovalProposal({
    proposalId:proposal.proposalId,
    reviewerActorId:actorId,
    decision:'APPROVE'
  });

  const events=humanApprovalAudit({patientId,proposalId:proposal.proposalId});
  const created=events.find(e=>e.type==='AI_PROPOSAL_CREATED');
  const approved=events.find(e=>e.type==='HUMAN_REVIEW_APPROVED');
  const nonExecution=events.find(e=>e.type==='NON_EXECUTION_CONFIRMED');

  assert.ok(created);
  assert.equal(created.authority,'AI_ASSISTED');

  assert.ok(approved);
  assert.equal(approved.authority,'HUMAN');

  assert.ok(nonExecution);
  assert.equal(nonExecution.authority,'SYSTEM');
  assert.equal(nonExecution.executed,false);
  assert.equal(nonExecution.details.orderId,null);

  const reviewRequired=events.find(e=>e.type==='HUMAN_REVIEW_REQUIRED');
  assert.ok(reviewRequired);
  assert.equal(reviewRequired.authority,'SYSTEM');
});

test('summary policy explicitly denies AI approval and execution',()=>{
  createProposalForTest({actorId,patientId});
  const summary=humanApprovalSummary({actorId,patientId});

  assert.equal(summary.policy.aiMayPropose,true);
  assert.equal(summary.policy.aiMayApprove,false);
  assert.equal(summary.policy.aiMayReject,false);
  assert.equal(summary.policy.humanDecisionRequired,true);
  assert.equal(summary.policy.executionSupported,false);
  assert.equal(summary.policy.realOrderCreated,false);
});

test('executive catalog exposes full human approval workflow',()=>{
  const story=demoCatalog().executiveStories.find(x=>x.id==='full-human-approval-workflow');
  assert.ok(story);
  assert.equal(story.patientId,'pat-1001');
  assert.equal(story.actorId,'neph-001');
  assert.equal(story.purpose,'lab-review');
});
