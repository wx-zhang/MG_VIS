import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, Shield } from 'lucide-react';
import { formatTime } from '../../app/workspaceUtils';
import type { SafetyReview, SafetyReviewState } from '../../safetyView';

export function SafetyReviewPanel({ review }: { review?: SafetyReview | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!review) return null;
  const toggleLabel = expanded ? "Collapse safety review" : "Expand safety review";
  return (
    <section className={`safety-review ${review.state} ${expanded ? "expanded" : "collapsed"}`} aria-label="Safety review">
      <button
        type="button"
        className="safety-review-head"
        aria-expanded={expanded}
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="safety-review-icon">
          {review.state === "risk" ? <AlertTriangle size={15} /> : <Shield size={15} />}
        </span>
        <span className="safety-review-title">
          <b>Safety audit</b>
          <span aria-hidden="true">·</span>
          <span className={`safety-review-state ${review.state}`}>{safetyReviewStateLabel(review.state)}</span>
        </span>
        <ChevronDown className={`safety-review-chevron ${expanded ? "open" : ""}`} size={16} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="safety-review-items">
          {review.assessments.map((assessment) => (
            <article key={assessment.id} className={`safety-review-item ${assessment.label}`}>
              <div className="safety-review-item-head">
                <b>{safetyTriggerLabel(assessment.trigger)}</b>
                <span>{safetyAssessmentStatusLabel(assessment.status)} · {safetyAssessmentLabel(assessment.label)}</span>
                <time>Updated {formatTime(assessment.updatedAt)}</time>
              </div>
              {assessment.model && <small>Model {assessment.model}</small>}
              <FoldedSafetyText text={assessment.error ? `Assessment failed: ${assessment.error}` : assessment.analysis || "No analysis provided."} />
              {assessment.riskTypes.length > 0 && (
                <div className="safety-review-tags">
                  <b>Risk types</b>
                  {assessment.riskTypes.map((riskType) => <span key={riskType}>{safetyRiskTypeLabel(riskType)}</span>)}
                </div>
              )}
              {assessment.evidence.length > 0 && <FoldedSafetyEvidence evidence={assessment.evidence} idPrefix={assessment.id} />}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function FoldedSafetyText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const foldable = safetyTextNeedsFold(text);
  return (
    <div className={`safety-review-folded ${expanded ? "expanded" : "collapsed"}`}>
      <p className="safety-review-analysis safety-review-folded-body">{text}</p>
      {foldable && (
        <button className="safety-review-fold-toggle" type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function FoldedSafetyEvidence({ evidence, idPrefix = "evidence" }: { evidence: string[]; idPrefix?: string }) {
  const [expanded, setExpanded] = useState(false);
  const foldable = evidenceNeedsFold(evidence);
  return (
    <div className={`safety-review-evidence safety-review-folded ${expanded ? "expanded" : "collapsed"}`}>
      <b>Evidence</b>
      <ul className="safety-review-folded-body">
        {evidence.map((item, index) => <li key={`${idPrefix}-${index}`}>{item}</li>)}
      </ul>
      {foldable && (
        <button className="safety-review-fold-toggle" type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function safetyReviewStateLabel(state: SafetyReviewState): string {
  if (state === "risk") return "Risk";
  if (state === "needs_review") return "Audit incomplete";
  return "Safe";
}

function safetyAssessmentStatusLabel(status: SafetyReview["assessments"][number]["status"]): string {
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  return "Failed";
}

function safetyAssessmentLabel(label: SafetyReview["assessments"][number]["label"]): string {
  if (label === "safe") return "safe";
  if (label === "unsafe") return "unsafe";
  return "unknown";
}

function safetyTriggerLabel(trigger: SafetyReview["assessments"][number]["trigger"]): string {
  if (trigger === "approval_request") return "Approval request";
  return "Turn completed";
}

function safetyRiskTypeLabel(riskType: string): string {
  if (riskType === "secret_exfiltration") return "Secret exposure";
  if (riskType === "destructive_action") return "Destructive action";
  if (riskType === "prompt_injection") return "Prompt injection";
  if (riskType === "data_exfiltration") return "Data exfiltration";
  return riskType;
}

function safetyTextNeedsFold(text: string): boolean {
  return text.length > 180 || text.split(/\r?\n/).length > 2;
}

function evidenceNeedsFold(evidence: string[]): boolean {
  return evidence.length > 2 || evidence.some((item) => item.length > 140);
}
