import { useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { RotateCcw, Trash2 } from 'lucide-react';
import { revisionOf, useLifecycleChange, type SourceLifecycle } from '../lib/lifecycle';
import type { LibraryEntry } from '../lib/queries';

/** Names the source and what disappears, so the decision is made on the confirmation alone. */
export function ConfirmDelete({ title, onConfirm, pending, children }: { title: string; onConfirm: () => void; pending: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>{children}</Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="sheet-overlay" />
      <Dialog.Content className="confirm-dialog" role="alertdialog">
        <Dialog.Title className="confirm-title">Delete "{title}" permanently?</Dialog.Title>
        <Dialog.Description className="confirm-body">Shelf removes this source's saved original files, original text, generated analysis and notes. Quotations in existing conversations remain. This cannot be undone.</Dialog.Description>
        <div className="confirm-actions">
          <Dialog.Close className="confirm-cancel">Keep in Trash</Dialog.Close>
          <button type="button" className="confirm-delete" disabled={pending} onClick={() => { onConfirm(); setOpen(false); }}>Delete permanently</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** Shown above a trashed source. Right after Move to Trash, Restore is offered as Undo. */
export function TrashNotice({ sourceId, lifecycle, entry, justMoved }: { sourceId: string; lifecycle?: SourceLifecycle; entry?: LibraryEntry; justMoved?: boolean }) {
  const change = useLifecycleChange();
  return <div className="trash-notice" role="status">
    <p><strong className="trash-label">In Trash</strong> {justMoved ? 'Moved to Trash. ' : ''}This saved copy is read-only until you restore it.</p>
    <button type="button" disabled={change.isPending} onClick={() => change.mutate({ sourceId, action: 'restore', revision: revisionOf(lifecycle), entry })}>
      <RotateCcw size={16} aria-hidden="true" />{change.isPending ? 'Restoring…' : justMoved ? 'Undo' : 'Restore'}
    </button>
    {change.error && <p role="alert">{change.error.message}</p>}
  </div>;
}

export function MoveToTrash({ sourceId, lifecycle, onMoved }: { sourceId: string; lifecycle?: SourceLifecycle; onMoved: () => void }) {
  const change = useLifecycleChange();
  return <>
    <button type="button" className="trash-button" disabled={change.isPending} onClick={() => { onMoved(); change.mutate({ sourceId, action: 'trash', revision: revisionOf(lifecycle) }); }}>
      <Trash2 size={16} aria-hidden="true" />{change.isPending ? 'Moving…' : 'Move to Trash'}
    </button>
    {change.error && <p className="trash-error" role="alert">{change.error.message}</p>}
  </>;
}
