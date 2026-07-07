/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { ContextNotePanel } from '../context-note-panel';

jest.mock('../context-note-viewer', () => ({
  ContextNoteViewer: ({ content }: { content: string }) => (
    <article aria-label="note viewer">{content}</article>
  ),
}));

jest.mock('../context-note-editor', () => ({
  ContextNoteEditor: ({
    content,
    onUpdate,
    placeholder,
  }: {
    content: string;
    onUpdate: (content: string) => void;
    placeholder?: string;
  }) => (
    <div>
      <div aria-label="note toolbar">Toolbar</div>
      <textarea
        aria-label="note editor"
        placeholder={placeholder}
        defaultValue={content}
        onChange={(event) => onUpdate(event.target.value)}
      />
    </div>
  ),
}));

describe('ContextNotePanel', () => {
  it('shows content in view mode without the editor toolbar by default', () => {
    render(
      <ContextNotePanel
        content="<p>Readable note</p>"
        onUpdate={jest.fn()}
        updatedAt="2026-07-07T10:30:00Z"
      />
    );

    expect(screen.getByLabelText('note viewer')).toHaveTextContent('Readable note');
    expect(screen.queryByLabelText('note toolbar')).not.toBeInTheDocument();
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });

  it('switches to edit mode and forwards content updates', () => {
    const onUpdate = jest.fn();

    render(
      <ContextNotePanel
        content="<p>Draft note</p>"
        onUpdate={onUpdate}
        placeholder="Write context"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(screen.getByLabelText('note toolbar')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('note editor'), {
      target: { value: '<p>Changed note</p>' },
    });

    expect(onUpdate).toHaveBeenCalledWith('<p>Changed note</p>');
  });

  it('shows an empty state with an edit action for blank notes', () => {
    render(<ContextNotePanel content="<p></p>" onUpdate={jest.fn()} />);

    expect(screen.getByText('No notes yet')).toBeInTheDocument();
    expect(screen.queryByLabelText('note viewer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(screen.getByLabelText('note editor')).toBeInTheDocument();
  });
});
