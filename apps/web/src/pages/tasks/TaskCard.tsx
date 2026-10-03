import { type DragEvent } from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
import { type AppSnapshot, type TaskRecord } from '@tyr-ai/contracts';
import { setTaskCardDragImage } from '../../taskBoardDrag';
import { threadExecutionApprovals } from '../../approvalView';
import { safetyReviewForContext, type SafetyReview } from '../../safetyView';
import { taskChannelLabel } from './taskFormatters';
import { safetyReviewStateLabel } from './SafetyReviewPanel';
import { TaskStatusMenu } from './TaskStatusMenu';

export type TaskCardProps = {
  snapshot: AppSnapshot;
  task: TaskRecord;
  selected: boolean;
  list?: boolean;
  dragEnabled?: boolean;
  dragging?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onOpen: () => void;
  onStatusChange: (status: TaskRecord["status"]) => void;
  onDelete: () => void;
};

export function TaskCard({ snapshot, task, selected, list = false, dragEnabled = false, dragging = false, onDragStart, onDragEnd, onOpen, onStatusChange, onDelete }: TaskCardProps) {
  const threadUnreadCount = task.threadChannelId ? snapshot.unreadCounts[task.threadChannelId] ?? 0 : 0;
  const safetyReview = taskSafetyReview(snapshot, task);
  const cardSafetyReview = safetyReview?.state !== "safe" ? safetyReview : null;
  const cardClassName = [
    "task-card",
    selected ? "selected" : "",
    list ? "list" : "",
    dragEnabled ? "has-drag" : "",
    dragging ? "dragging" : ""
  ].filter(Boolean).join(" ");
  return (
    <div className={cardClassName} data-task-id={task.id} data-task-status={task.status} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    }}>
      {list && <span className={`task-list-status-strip ${task.status}`} aria-hidden="true" />}
      <div className="task-card-head">
        <small>{taskChannelLabel(snapshot, task)} <span>#{task.taskNumber}</span></small>
        <div className="task-card-tools">
          {dragEnabled && (
            <button
              type="button"
              className="task-drag-handle"
              draggable
              title="Drag task"
              aria-label={`Drag task #${task.taskNumber}`}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.stopPropagation();
                setTaskCardDragImage(event.dataTransfer, event.currentTarget);
                onDragStart?.(event);
              }}
              onDragEnd={(event) => {
                event.stopPropagation();
                onDragEnd?.();
              }}
            >
              <GripVertical size={14} />
            </button>
          )}
          <button className="task-delete-button" title="Delete task" aria-label={`Delete task #${task.taskNumber}`} onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="task-card-body">
        <h3>{task.title}</h3>
        {(cardSafetyReview || threadUnreadCount > 0) && (
          <div className="task-card-badges">
            {cardSafetyReview && (
              <span className={`safety-chip ${cardSafetyReview.state}`} title={`Safety review: ${safetyReviewStateLabel(cardSafetyReview.state)}`}>
                {safetyReviewStateLabel(cardSafetyReview.state)}
              </span>
            )}
            {threadUnreadCount > 0 && <span className="pill notice task-thread-unread">{threadUnreadCount} unread</span>}
          </div>
        )}
        <div className="task-card-meta">
          <span>creator @{task.createdByName || task.createdById}</span>
          <span>assignee {task.assigneeName || task.assigneeAgentId ? `@${task.assigneeName || task.assigneeAgentId}` : "unassigned"}</span>
        </div>
      </div>
      <TaskStatusMenu value={task.status} onChange={onStatusChange} />
    </div>
  );
}

function taskSafetyReview(snapshot: AppSnapshot, task: Pick<TaskRecord, "id" | "messageId" | "threadChannelId">): SafetyReview | null {
  const executionIds = (snapshot.runtimeExecutions ?? [])
    .filter((execution) =>
      execution.taskId === task.id ||
      execution.messageId === task.messageId ||
      Boolean(task.threadChannelId && execution.threadChannelId === task.threadChannelId)
    )
    .map((execution) => execution.id);
  const approvalIds = threadExecutionApprovals(snapshot.runtimeApprovals ?? [], {
    executionIds,
    taskId: task.id,
    messageId: task.messageId,
    threadChannelId: task.threadChannelId
  }).map((approval) => approval.id);
  // 任务卡片只展示 P1 审计的最高风险聚合态，避免把多条 approval/turn 明细塞进看板。
  return safetyReviewForContext(snapshot.safetyAssessments ?? [], {
    taskId: task.id,
    messageId: task.messageId,
    threadChannelId: task.threadChannelId,
    executionIds,
    approvalIds
  });
}
