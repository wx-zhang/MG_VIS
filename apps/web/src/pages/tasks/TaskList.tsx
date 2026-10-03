import type { AppSnapshot, TaskRecord } from '@tyr-ai/contracts';
import { TASK_STATUSES } from './taskConstants';
import { TaskCard } from './TaskCard';

export function TaskList({ snapshot, tasks, selectedTask, onOpenTask, onStatusChange, onDeleteTask }: {
  snapshot: AppSnapshot;
  tasks: TaskRecord[];
  selectedTask: TaskRecord | null;
  onOpenTask: (task: TaskRecord) => void;
  onStatusChange: (task: TaskRecord, status: TaskRecord['status']) => void;
  onDeleteTask: (task: TaskRecord) => void;
}) {
  return (
    <div className="task-list-view">
      {TASK_STATUSES.map(([status, label]) => {
        const statusTasks = tasks.filter((task) => task.status === status);
        return (
          <section key={status} className="task-list-section">
            <div className="column-title task-lane-title">
              <span className={`task-lane-dot ${status}`} aria-hidden="true" />
              <span className={`task-tag ${status}`}>{label}</span>
              <small>{statusTasks.length}</small>
            </div>
            {statusTasks.length === 0 && <div className="empty-box">No {label.toLowerCase().replace('_', ' ')} tasks.</div>}
            {statusTasks.map((task) => (
              <TaskCard key={task.id} snapshot={snapshot} task={task} selected={selectedTask?.id === task.id} list onOpen={() => onOpenTask(task)} onStatusChange={(statusValue) => onStatusChange(task, statusValue)} onDelete={() => onDeleteTask(task)} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
