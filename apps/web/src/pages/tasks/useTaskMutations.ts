import { useCallback, useState } from 'react';
import type { TaskRecord } from '@tyr-ai/contracts';
import { api } from '../../lib/api';
import { confirmDialog } from '../../shared/confirmDialog';
import { taskDeleteMutation, taskMutationFailureMessage, taskStatusMutation } from '../../taskMutations';

export function useTaskMutations(onRefresh: () => Promise<void>, options: { onDelete?: () => void } = {}) {
  const [errorMessage, setErrorMessage] = useState("");

  const updateStatus = useCallback(async (task: TaskRecord, status: TaskRecord['status']) => {
    setErrorMessage("");
    try {
      const mutation = taskStatusMutation(task.id, status);
      await api(mutation.path, mutation.init);
      await onRefresh();
    } catch (error) {
      setErrorMessage(taskMutationFailureMessage('Update task status', error));
    }
  }, [onRefresh]);

  const deleteTask = useCallback(async (task: TaskRecord) => {
    setErrorMessage("");
    if (!(await confirmDialog({
      title: `Delete task #${task.taskNumber}?`,
      description: "The source message will stay in history.",
      confirmText: "Delete task",
      tone: "danger"
    }))) return;
    try {
      const mutation = taskDeleteMutation(task.id);
      await api(mutation.path, mutation.init);
      options.onDelete?.();
      await onRefresh();
    } catch (error) {
      setErrorMessage(taskMutationFailureMessage('Delete task', error));
    }
  }, [onRefresh, options]);

  const claimTask = useCallback(async (task: TaskRecord) => {
    setErrorMessage("");
    try {
      await api(`/api/tasks/${task.id}/claim`, { method: 'POST', body: '{}' });
      await onRefresh();
    } catch (error) {
      setErrorMessage(taskMutationFailureMessage('Claim task', error));
    }
  }, [onRefresh]);

  const resolveApproval = useCallback(async (approvalId: string, decision: 'approve' | 'reject' | 'custom', customResponse?: string) => {
    await api(`/api/runtime-approvals/${approvalId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ decision, customResponse })
    }).finally(() => onRefresh());
  }, [onRefresh]);

  return { updateStatus, deleteTask, claimTask, resolveApproval, errorMessage, clearError: () => setErrorMessage("") };
}
