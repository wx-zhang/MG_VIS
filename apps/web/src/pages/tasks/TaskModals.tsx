import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { ChannelRecord, MessageRecord } from '@tyr-ai/contracts';
import { api } from '../../lib/api';
import { Modal } from '../../shared/ui';

export function ConvertMessageTaskModal({ message, onClose, onSubmit }: { message: MessageRecord; onClose: () => void; onSubmit: (message: MessageRecord, title: string) => Promise<void> }) {
  const [title, setTitle] = useState(message.content);
  const validTitle = title.trim();
  async function submit() {
    if (!validTitle) return;
    await onSubmit(message, validTitle);
  }
  return (
    <Modal title="CREATE TASK" onClose={onClose} className="template-form-modal template-form-modal-sm" backdropClassName="template-form-modal-backdrop" titleIcon={<Plus size={18} />}>
      <form className="template-form-content" onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}>
        <div className="template-form-grid">
          <div className="template-form-field full">
            <label className="field-label">TASK TITLE *</label>
            <input className="input" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task title" />
          </div>
        </div>
        <div className="modal-actions template-form-actions">
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={!validTitle}>Create Task</button>
        </div>
      </form>
    </Modal>
  );
}

export function CreateChannelTasksModal({ channel, onClose, onCreated }: { channel: ChannelRecord; onClose: () => void; onCreated: () => Promise<void> }) {
  const [titles, setTitles] = useState([""]);
  const validTitles = titles.map((title) => title.trim()).filter(Boolean);

  async function createTasks() {
    if (validTitles.length === 0) return;
    await api(`/api/tasks/channel/${channel.id}`, {
      method: "POST",
      body: JSON.stringify({ tasks: validTitles.map((title) => ({ title })) })
    });
    await onCreated();
  }

  function updateTitle(index: number, value: string) {
    setTitles((current) => current.map((title, itemIndex) => itemIndex === index ? value : title));
  }

  return (
    <Modal title="CREATE TASK" onClose={onClose} className="template-form-modal template-form-modal-sm" backdropClassName="template-form-modal-backdrop" titleIcon={<Plus size={18} />}>
      <form className="template-form-content" onSubmit={(event) => {
        event.preventDefault();
        void createTasks();
      }}>
        <div className="template-form-grid">
          <div className="template-form-field full">
            <label className="field-label">TASKS *</label>
          {titles.map((title, index) => (
            <input
              key={index}
              className="input"
              autoFocus={index === 0}
              value={title}
              onChange={(event) => updateTitle(index, event.target.value)}
              placeholder={`Task ${index + 1}`}
            />
          ))}
          </div>
        </div>
        <div className="modal-actions template-form-actions">
          <button className="btn small" type="button" onClick={() => setTitles((current) => [...current, ""])}><Plus size={15} /> Add another</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={validTitles.length === 0}>Create Task</button>
        </div>
      </form>
    </Modal>
  );
}
