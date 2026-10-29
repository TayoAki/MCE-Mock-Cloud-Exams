import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, StatusBadge, Textarea } from '../components/ui';
import type { StoryDetail } from '../types';
import { useWorkingVersion } from '../version';

const TEMPLATE = {
  slug: 'new-story',
  title: 'A new story',
  summary: 'One line about the situation.',
  characters: [
    { name: 'Priya', role: 'Data engineer' },
    { name: 'Marco', role: 'Analytics lead' },
  ],
  parts: [
    { kind: 'line', speaker: 'Marco', text: 'Something looks wrong with the dashboard.' },
    { kind: 'line', speaker: null, text: 'Narration has no speaker.' },
    { kind: 'question', family_key: 'an-existing-family-key' },
  ],
  status: 'draft',
};

/** Edits a story as JSON: lines and questions in order, with questions named by family key. */
function StoryEditor({ story, versionId, onDone }: { story: StoryDetail | null; versionId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const initial = story ? { slug: story.slug, title: story.title, summary: story.summary, characters: story.characters, parts: story.parts, status: story.status } : TEMPLATE;
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => (story ? api.put<StoryDetail>(`/admin/stories/${story.id}`, body) : api.post<StoryDetail>('/admin/stories', body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories', versionId] });
      onDone();
    },
  });
  function submit() {
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      setParseError(null);
      save.mutate({ ...body, exam_version_id: versionId });
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }
  return (
    <Card title={story ? `Edit ${story.title}` : 'New story'}>
      <p className="mb-2 text-xs text-muted">
        Questions are bank questions named by family key. Saving tags them with this story so regular practice skips them. Publish every question before publishing the story. Speakers must be listed characters; use null for narration.
      </p>
      <Textarea rows={22} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {parseError ? <p className="mt-2 text-sm text-coral-ink">{parseError}</p> : null}
      {save.error ? (
        <div className="mt-2">
          <ErrorBox error={save.error} />
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={submit} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save story'}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

export function StoriesPage() {
  const { versionId } = useWorkingVersion();
  const [editing, setEditing] = useState<StoryDetail | 'new' | null>(null);
  const stories = useQuery({
    queryKey: ['stories', versionId],
    queryFn: () => api.get<{ stories: StoryDetail[] }>(`/admin/stories?exam_version_id=${versionId}`),
    enabled: !!versionId,
  });
  if (!versionId) return <Loading />;
  return (
    <>
      <PageHeader
        title="Stories"
        subtitle="Short workplace scenarios told line by line, with bank questions where a decision is needed."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            New story
          </Button>
        }
      />
      {editing ? (
        <div className="mb-4">
          <StoryEditor key={editing === 'new' ? 'new' : editing.id} story={editing === 'new' ? null : editing} versionId={versionId} onDone={() => setEditing(null)} />
        </div>
      ) : null}
      {stories.isLoading ? <Loading /> : null}
      {stories.error ? <ErrorBox error={stories.error} /> : null}
      {stories.data && stories.data.stories.length === 0 ? <Empty title="No stories yet">Create one from questions already in the bank.</Empty> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {stories.data?.stories.map((s) => (
          <Card
            key={s.id}
            title={
              <span className="flex items-center gap-2">
                {s.title} <StatusBadge status={s.status} />
              </span>
            }
            actions={
              <Button size="sm" onClick={() => setEditing(s)}>
                Edit
              </Button>
            }
          >
            <p className="text-sm text-muted">{s.summary}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.characters.map((c) => (
                <Badge key={c.name}>
                  {c.name} · {c.role}
                </Badge>
              ))}
            </div>
            <ol className="mt-3 space-y-1.5 text-sm">
              {s.parts.map((p, i) =>
                p.kind === 'line' ? (
                  <li key={i}>
                    {p.speaker ? <span className="font-medium">{p.speaker}: </span> : null}
                    <span className={p.speaker ? '' : 'italic text-muted'}>{p.text}</span>
                  </li>
                ) : (
                  <li key={i} className="rounded-md bg-primary-tint px-2 py-1 font-mono text-xs">
                    Question · {p.family_key}
                  </li>
                ),
              )}
            </ol>
          </Card>
        ))}
      </div>
    </>
  );
}
