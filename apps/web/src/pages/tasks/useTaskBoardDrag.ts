import { type DragEvent, useState } from 'react';
import type { TaskRecord } from '@tyr-ai/contracts';
import { TASK_CARD_DRAG_MIME, nextTaskDropStatus } from '../../taskBoardDrag';

export function useTaskBoardDrag(tasks: TaskRecord[], updateStatus: (task: TaskRecord, status: TaskRecord['status']) => void | Promise<void>) {
  const [dragTaskId, setDragTaskId] = useState('');
  const [dragOverStatus, setDragOverStatus] = useState<TaskRecord['status'] | null>(null);

  function startTaskDrag(event: DragEvent<HTMLElement>, task: TaskRecord) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(TASK_CARD_DRAG_MIME, task.id);
    setDragTaskId(task.id);
  }

  function finishTaskDrag() {
    setDragTaskId('');
    setDragOverStatus(null);
  }

  function handleColumnDragOver(event: DragEvent<HTMLDivElement>, status: TaskRecord['status']) {
    const isTaskDrag = Boolean(dragTaskId) || Array.from(event.dataTransfer.types).includes(TASK_CARD_DRAG_MIME);
    if (!isTaskDrag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverStatus(status);
  }

  function handleColumnDragLeave(event: DragEvent<HTMLDivElement>, status: TaskRecord['status']) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDragOverStatus((current) => current === status ? null : current);
  }

  function dropTaskOnStatus(event: DragEvent<HTMLDivElement>, status: TaskRecord['status']) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData(TASK_CARD_DRAG_MIME) || dragTaskId;
    const task = tasks.find((item) => item.id === taskId);
    finishTaskDrag();
    if (!task) return;
    const nextStatus = nextTaskDropStatus(task.status, status);
    if (nextStatus) void updateStatus(task, nextStatus);
  }

  return { dragTaskId, dragOverStatus, startTaskDrag, finishTaskDrag, handleColumnDragOver, handleColumnDragLeave, dropTaskOnStatus };
}

