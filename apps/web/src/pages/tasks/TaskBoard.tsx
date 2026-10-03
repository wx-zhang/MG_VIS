import { type DragEvent } from 'react';
import type { AppSnapshot, TaskRecord } from '@tyr-ai/contracts';
import { TASK_STATUSES } from './taskConstants';
import { TaskCard } from './TaskCard';

export function TaskBoard({ snapshot, tasks, selectedTask, className = 'task-board runtime-board', dragTaskId, dragOverStatus, onColumnDragOver, onColumnDragLeave, onDropTask, onStartTaskDrag, onFinishTaskDrag, onOpenTask, onStatusChange, onDeleteTask }: {
  snapshot: AppSnapshot;
  tasks: TaskRecord[];
  selectedTask: TaskRecord | null;
  className?: string;
  dragTaskId: string;
  dragOverStatus: TaskRecord['status'] | null;
  onColumnDragOver: (event: DragEvent<HTMLDivElement>, status: TaskRecord['status']) => void;
  onColumnDragLeave: (event: DragEvent<HTMLDivElement>, status: TaskRecord['status']) => void;
  onDropTask: (event: DragEvent<HTMLDivElement>, status: TaskRecord['status']) => void;
  onStartTaskDrag: (event: DragEvent<HTMLElement>, task: TaskRecord) => void;
  onFinishTaskDrag: () => void;
  onOpenTask: (task: TaskRecord) => void;
  onStatusChange: (task: TaskRecord, status: TaskRecord['status']) => void;
  onDeleteTask: (task: TaskRecord) => void;
}) {
  return (
    <div className={className}>
      {TASK_STATUSES.map(([status, label]) => {
        const statusTasks = tasks.filter((task) => task.status === status);
        return (
          <div
            key={status}
            className={dragOverStatus === status ? 'task-column drop-target' : dragTaskId ? 'task-column can-drop' : 'task-column'}
            data-task-status={status}
            onDragOver={(event) => onColumnDragOver(event, status)}
            onDragLeave={(event) => onColumnDragLeave(event, status)}
            onDrop={(event) => onDropTask(event, status)}
          >
            <div className="column-title task-lane-title">
              <span className={`task-lane-dot ${status}`} aria-hidden="true" />
              <span className={`task-tag ${status}`}>{label}</span>
              <small>{statusTasks.length}</small>
            </div>
            <div className="task-lane-scroll">
              {statusTasks.length === 0 && <div className="empty-box">No {label.toLowerCase().replace('_', ' ')} tasks.</div>}
              {statusTasks.map((task) => (
                <TaskCard key={task.id} snapshot={snapshot} task={task} selected={selectedTask?.id === task.id} dragEnabled dragging={dragTaskId === task.id} onDragStart={(event) => onStartTaskDrag(event, task)} onDragEnd={onFinishTaskDrag} onOpen={() => onOpenTask(task)} onStatusChange={(statusValue) => onStatusChange(task, statusValue)} onDelete={() => onDeleteTask(task)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
