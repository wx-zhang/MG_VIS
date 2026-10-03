import { type CSSProperties, type ReactNode, useMemo, useState } from 'react';
import { CheckSquare, ClipboardList, List, MessageSquare, Plus, UserRound } from 'lucide-react';
import { type AppSnapshot, type ChannelRecord, type CursorPageInfo, type TaskRecord } from '@tyr-ai/contracts';
import { type TaskFilterState } from '../../taskFilters';
import { emptyTaskFilters, normalizeTaskFilters, sortTasks, taskFilterCount, taskMatchesFilters, toggleFilterValue, uniqueTaskOptions } from '../../taskFilters';
import { useThreadPanelResize } from '../../threadPanelResize';
import { AttachmentPreviewModal } from '../../shared/messages';
import { TopBar, type WorkspaceTopBarProps } from '../../shared/ui';
import { TASK_STATUSES } from './taskConstants';
import { TaskFilterMenu } from './TaskFilters';
import { TaskBoard } from './TaskBoard';
import { TaskList } from './TaskList';
import { TaskThreadPanel } from './TaskThreadPanel';
import { CreateChannelTasksModal } from './TaskModals';
import { useTaskMutations } from './useTaskMutations';
import { useTaskBoardDrag } from './useTaskBoardDrag';
import { channelDisplayLabel } from '../../resourceAccess';

export function TasksView({ snapshot, topbarProps, selectedTaskId, filters, taskPageInfo, taskLoading, onLoadMoreTasks, onFiltersChange, onRefresh, onSelectTask, onCloseTask, onViewInChannel, onViewMessageInChannel }: {
  snapshot: AppSnapshot;
  topbarProps: WorkspaceTopBarProps;
  selectedTaskId?: string;
  filters?: TaskFilterState;
  taskPageInfo: CursorPageInfo;
  taskLoading: boolean;
  onLoadMoreTasks: () => Promise<void>;
  onFiltersChange: (filters: TaskFilterState) => void;
  onRefresh: () => Promise<void>;
  onSelectTask: (taskId: string) => void;
  onCloseTask: () => void;
  onViewInChannel: (task: TaskRecord) => void;
  onViewMessageInChannel: (channelId: string, messageId: string) => void;
}) {
  const [mode, setMode] = useState<'board' | 'list'>('board');
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const activeFilters = normalizeTaskFilters(filters);
  const sortedTasks = useMemo(() => sortTasks(snapshot.tasks), [snapshot.tasks]);
  const visibleTasks = useMemo(() => sortedTasks.filter((task) => taskMatchesFilters(task, activeFilters)), [sortedTasks, activeFilters]);
  const selectedTask = sortedTasks.find((task) => task.id === selectedTaskId) ?? null;
  const mutations = useTaskMutations(onRefresh, { onDelete: onCloseTask });
  const drag = useTaskBoardDrag(sortedTasks, mutations.updateStatus);
  const threadPanelResize = useThreadPanelResize();
  const activeFilterCount = taskFilterCount(activeFilters);
  const visibleOpenCount = visibleTasks.filter((task) => task.status !== "done" && task.status !== "closed").length;
  const visibleClosedCount = visibleTasks.filter((task) => task.status === "closed").length;
  const channelOptions = snapshot.channels
    .filter((channel) => channel.type !== 'thread')
    .map((channel) => ({ id: channel.id, label: channelDisplayLabel(channel, snapshot.agents) }));
  const statusOptions = TASK_STATUSES.map(([id, label]) => ({ id, label }));
  const creatorOptions = uniqueTaskOptions(sortedTasks, (task) => task.createdById, (task) => task.createdByName || task.createdById);
  const assigneeOptions = uniqueTaskOptions(sortedTasks, (task) => task.assigneeAgentId, (task) => task.assigneeName || task.assigneeAgentId);
  function updateFilters(patch: Partial<TaskFilterState>) {
    onFiltersChange({ ...activeFilters, ...patch });
  }
  return (
    <div className="view">
      <TopBar title="Tasks" {...topbarProps} />
      <div className="task-dashboard">
        <div className="task-dashboard-head">
          <div className="task-dashboard-title">
            <span className="task-dashboard-icon"><ClipboardList size={20} /></span>
            <div>
              <h1>Workspace Tasks Board</h1>
              <p>Track message-backed tasks, agent execution, reviews, and archived work across conversations.</p>
            </div>
          </div>
          <div className="task-dashboard-metrics" aria-label="Task summary">
            <span><b>{visibleTasks.length}</b><small>Visible</small></span>
            <span><b>{visibleOpenCount}</b><small>Open</small></span>
            <span><b>{visibleClosedCount}</b><small>Closed</small></span>
          </div>
        </div>
        <div className="task-toolbar">
          <div className="task-filter-bar">
            <TaskFilterMenu label="STATUS" icon={<CheckSquare size={16} />} count={activeFilters.statusIds.length} options={statusOptions} selected={activeFilters.statusIds} onToggle={(id) => updateFilters({ statusIds: toggleFilterValue(activeFilters.statusIds, id as TaskRecord['status']) })} onClear={() => updateFilters({ statusIds: [] })} />
            <TaskFilterMenu label="CONVERSATION" icon={<MessageSquare size={16} />} count={activeFilters.channelIds.length} options={channelOptions} selected={activeFilters.channelIds} onToggle={(id) => updateFilters({ channelIds: toggleFilterValue(activeFilters.channelIds, id) })} onClear={() => updateFilters({ channelIds: [] })} />
            <TaskFilterMenu label="CREATOR" icon={<UserRound size={16} />} count={activeFilters.creatorIds.length} options={creatorOptions} selected={activeFilters.creatorIds} onToggle={(id) => updateFilters({ creatorIds: toggleFilterValue(activeFilters.creatorIds, id) })} onClear={() => updateFilters({ creatorIds: [] })} />
            <TaskFilterMenu label="ASSIGNEE" icon={<UserRound size={16} />} count={activeFilters.assigneeIds.length} options={assigneeOptions} selected={activeFilters.assigneeIds} onToggle={(id) => updateFilters({ assigneeIds: toggleFilterValue(activeFilters.assigneeIds, id) })} onClear={() => updateFilters({ assigneeIds: [] })} />
            {activeFilterCount > 0 && <button className="btn small" onClick={() => onFiltersChange(emptyTaskFilters())}>Clear all</button>}
          </div>
          <div className="task-view-toggle">
            <button className={mode === 'board' ? 'btn active small' : 'btn small'} onClick={() => setMode('board')}><ClipboardList size={15} /> Board</button>
            <button className={mode === 'list' ? 'btn active small' : 'btn small'} onClick={() => setMode('list')}><List size={15} /> List</button>
          </div>
        </div>
        {mutations.errorMessage && <p className="task-mutation-error" role="status">{mutations.errorMessage}</p>}
        <div className="task-workspace">
          {mode === 'board' ? (
            <TaskBoard snapshot={snapshot} tasks={visibleTasks} selectedTask={selectedTask} dragTaskId={drag.dragTaskId} dragOverStatus={drag.dragOverStatus} onColumnDragOver={drag.handleColumnDragOver} onColumnDragLeave={drag.handleColumnDragLeave} onDropTask={drag.dropTaskOnStatus} onStartTaskDrag={drag.startTaskDrag} onFinishTaskDrag={drag.finishTaskDrag} onOpenTask={(task) => onSelectTask(task.id)} onStatusChange={(task, status) => void mutations.updateStatus(task, status)} onDeleteTask={(task) => void mutations.deleteTask(task)} />
          ) : (
            <TaskList snapshot={snapshot} tasks={visibleTasks} selectedTask={selectedTask} onOpenTask={(task) => onSelectTask(task.id)} onStatusChange={(task, status) => void mutations.updateStatus(task, status)} onDeleteTask={(task) => void mutations.deleteTask(task)} />
          )}
        </div>
        {taskPageInfo.hasMore && (
          <div className="inbox-pagination">
            <button className="btn small" disabled={taskLoading} onClick={() => void onLoadMoreTasks()}>
              {taskLoading ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
        {selectedTask && (
          <TaskThreadDrawer style={threadPanelResize.workspaceStyle} onClose={onCloseTask}>
            <TaskThreadPanel snapshot={snapshot} task={selectedTask} onClose={onCloseTask} onRefresh={onRefresh} onViewInChannel={() => onViewInChannel(selectedTask)} onViewMessageInChannel={onViewMessageInChannel} onPreviewAttachment={setPreviewAttachmentId} onBeginResize={threadPanelResize.beginResize} />
          </TaskThreadDrawer>
        )}
      </div>
      {previewAttachmentId && <AttachmentPreviewModal attachmentId={previewAttachmentId} onClose={() => setPreviewAttachmentId(null)} />}
    </div>
  );
}

export function ChannelTasksView({ snapshot, channel, onRefresh, onViewInChannel, onViewMessageInChannel }: { snapshot: AppSnapshot; channel: ChannelRecord; onRefresh: () => Promise<void>; onViewInChannel: (task: TaskRecord) => void; onViewMessageInChannel: (channelId: string, messageId: string) => void }) {
  const [mode, setMode] = useState<'board' | 'list'>('board');
  const [createOpen, setCreateOpen] = useState(false);
  const [filters, setFilters] = useState<TaskFilterState>(emptyTaskFilters());
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const tasks = useMemo(() => sortTasks(snapshot.tasks.filter((task) => task.channelId === channel.id)), [channel.id, snapshot.tasks]);
  const activeFilters = normalizeTaskFilters(filters);
  const visibleTasks = useMemo(() => tasks.filter((task) => taskMatchesFilters(task, activeFilters)), [activeFilters, tasks]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const mutations = useTaskMutations(onRefresh, { onDelete: () => setSelectedTaskId('') });
  const drag = useTaskBoardDrag(tasks, mutations.updateStatus);
  const threadPanelResize = useThreadPanelResize();
  const statusOptions = TASK_STATUSES.map(([id, label]) => ({ id, label }));
  const assigneeOptions = uniqueTaskOptions(tasks, (task) => task.assigneeAgentId, (task) => task.assigneeName || task.assigneeAgentId);
  function updateFilters(patch: Partial<TaskFilterState>) {
    setFilters((current) => ({ ...normalizeTaskFilters(current), ...patch }));
  }
  return (
    <div className={selectedTask ? 'channel-task-surface with-thread' : 'channel-task-surface'} style={selectedTask ? threadPanelResize.workspaceStyle : undefined}>
      <div className="task-toolbar channel-task-toolbar">
        <button className="btn primary small" onClick={() => setCreateOpen(true)}><Plus size={15} /> New Task</button>
        <div className="task-filter-bar">
          <TaskFilterMenu label="STATUS" icon={<CheckSquare size={16} />} count={activeFilters.statusIds.length} options={statusOptions} selected={activeFilters.statusIds} onToggle={(id) => updateFilters({ statusIds: toggleFilterValue(activeFilters.statusIds, id as TaskRecord['status']) })} onClear={() => updateFilters({ statusIds: [] })} />
          <TaskFilterMenu label="ASSIGNEE" icon={<UserRound size={16} />} count={activeFilters.assigneeIds.length} options={assigneeOptions} selected={activeFilters.assigneeIds} onToggle={(id) => updateFilters({ assigneeIds: toggleFilterValue(activeFilters.assigneeIds, id) })} onClear={() => updateFilters({ assigneeIds: [] })} />
          {taskFilterCount(activeFilters) > 0 && <button className="btn small" onClick={() => setFilters(emptyTaskFilters())}>Clear all</button>}
        </div>
        <div className="task-toolbar-spacer" />
        <div className="task-view-toggle">
          <button className={mode === 'board' ? 'btn active small' : 'btn small'} onClick={() => setMode('board')}><ClipboardList size={15} /> Board</button>
          <button className={mode === 'list' ? 'btn active small' : 'btn small'} onClick={() => setMode('list')}><List size={15} /> List</button>
        </div>
      </div>
      {mutations.errorMessage && <p className="task-mutation-error" role="status">{mutations.errorMessage}</p>}
      {tasks.length === 0 ? (
        <div className="channel-task-empty">
          <CheckSquare size={54} />
          <b>No tasks yet</b>
          <p>Create one with the New Task button.</p>
        </div>
      ) : (
        <div className="task-workspace">
          {mode === 'board' ? (
            <TaskBoard className="task-board runtime-board channel-board" snapshot={snapshot} tasks={visibleTasks} selectedTask={selectedTask} dragTaskId={drag.dragTaskId} dragOverStatus={drag.dragOverStatus} onColumnDragOver={drag.handleColumnDragOver} onColumnDragLeave={drag.handleColumnDragLeave} onDropTask={drag.dropTaskOnStatus} onStartTaskDrag={drag.startTaskDrag} onFinishTaskDrag={drag.finishTaskDrag} onOpenTask={(task) => setSelectedTaskId(task.id)} onStatusChange={(task, status) => void mutations.updateStatus(task, status)} onDeleteTask={(task) => void mutations.deleteTask(task)} />
          ) : (
            <TaskList snapshot={snapshot} tasks={visibleTasks} selectedTask={selectedTask} onOpenTask={(task) => setSelectedTaskId(task.id)} onStatusChange={(task, status) => void mutations.updateStatus(task, status)} onDeleteTask={(task) => void mutations.deleteTask(task)} />
          )}
        </div>
      )}
      {selectedTask && (
        <TaskThreadDrawer variant="inline" style={threadPanelResize.workspaceStyle} onClose={() => setSelectedTaskId('')}>
          <TaskThreadPanel snapshot={snapshot} task={selectedTask} onClose={() => setSelectedTaskId('')} onRefresh={onRefresh} onViewInChannel={() => onViewInChannel(selectedTask)} onViewMessageInChannel={onViewMessageInChannel} onPreviewAttachment={setPreviewAttachmentId} onBeginResize={threadPanelResize.beginResize} />
        </TaskThreadDrawer>
      )}
      {createOpen && <CreateChannelTasksModal channel={channel} onClose={() => setCreateOpen(false)} onCreated={async () => {
        setCreateOpen(false);
        await onRefresh();
      }} />}
      {previewAttachmentId && <AttachmentPreviewModal attachmentId={previewAttachmentId} onClose={() => setPreviewAttachmentId(null)} />}
    </div>
  );
}

type TaskThreadDrawerVariant = "overlay" | "inline";

export function TaskThreadDrawer({ variant = "overlay", style, onClose, children }: { variant?: TaskThreadDrawerVariant; style: CSSProperties; onClose: () => void; children: ReactNode }) {
  // inline 用在群聊上下文：桌面是右侧并排栏，移动端再由 CSS 回落为浮动抽屉。
  const className = variant === "inline" ? "task-thread-drawer-shell inline" : "task-thread-drawer-shell";
  return (
    <div className={className} style={style}>
      <button className="task-thread-drawer-backdrop" type="button" aria-label="Close task details" onClick={onClose} />
      <div className="task-thread-drawer">
        {children}
      </div>
    </div>
  );
}
