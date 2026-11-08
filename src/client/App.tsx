import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clapperboard,
  Download,
  Film,
  Heart,
  ImagePlus,
  LoaderCircle,
  Plus,
  RotateCcw,
  Scissors,
  Share2,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { PRESETS, getPreset } from '../shared/presets';
import type { Character, CharacterInput, Crop, PresetId, ProjectView } from '../shared/contracts';
import { api, ApiError } from './api';
import { isModerationFailure } from '../shared/provider-errors';
import { preparePortrait } from './portraits';
import { CropDialog, type CropRequest } from './CropDialog';
interface Config {
  mode: 'mock' | 'real';
  previewMode: 'illustrative' | 'generated';
  releaseChannel: string;
  generationEnabled: boolean;
  turnstileSiteKey: string | null;
  localOperatorAccess: boolean;
  usageLimitsEnabled: boolean;
}
const toInput = (c: Character): CharacterInput => ({
  id: c.id,
  sourceAssetId: c.sourceAssetId,
  name: c.name,
  description: c.description,
  provenance: c.provenance,
  crop: c.crop,
  framing: c.framing,
});
const serialize = (people: Character[], preset: PresetId | null) =>
  JSON.stringify({ characters: people.map(toInput), preset });
const sample = (preset: PresetId, kind = 'poster') => `/api/samples/${preset}/${kind}`;
const PHASES = [
  {
    state: 'creating_cast',
    label: 'Drawing your cast',
    detail: 'Giving familiar faces a very cartoon Christmas.',
  },
  {
    state: 'creating_frames',
    label: 'Setting up the scenes',
    detail: 'A few festive props. A spectacular lack of coordination.',
  },
  {
    state: 'animating',
    label: 'Animating your family',
    detail: 'Putting those questionable holiday moves in motion.',
  },
  {
    state: 'rendering',
    label: 'Putting it together',
    detail: 'Four little moments. One very shareable cartoon.',
  },
];

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [project, setProject] = useState<ProjectView | null>(null);
  const [people, setPeople] = useState<Character[]>([]);
  const [preset, setPreset] = useState<PresetId | null>(null);
  const [stage, setStage] = useState<'upload' | 'personalize'>('upload');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [crop, setCrop] = useState<CropRequest | null>(null);
  const [preview, setPreview] = useState<PresetId | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceId = useRef<string | null>(null);
  const projectRef = useRef<ProjectView | null>(null);
  const peopleRef = useRef<Character[]>([]);
  const presetRef = useRef<PresetId | null>(null);
  const saved = useRef('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const creating = useRef<Promise<ProjectView> | null>(null);
  const descriptionsPending = useRef(false);
  peopleRef.current = people;
  presetRef.current = preset;
  const accept = useCallback((p: ProjectView, replace = true) => {
    projectRef.current = p;
    setProject(p);
    if (replace) {
      setPeople(p.characters);
      setPreset(p.preset);
      saved.current = serialize(p.characters, p.preset);
    }
  }, []);
  useEffect(() => {
    let active = true;
    void api<Config>('/api/config')
      .then((c) => active && setConfig(c))
      .catch(() => setError('The studio couldn’t connect. Refresh this page to try again.'));
    const match = /^\/p\/([a-f0-9-]+)$/.exec(location.pathname);
    const id = match?.[1] ?? localStorage.getItem('holiday-project');
    if (id)
      void api<ProjectView>(`/api/projects/${id}`)
        .then((p) => {
          if (active) {
            accept(p);
            if (p.characters.length) setStage('personalize');
            history.replaceState(null, '', `/p/${p.id}`);
          }
        })
        .catch((e) => {
          if (active) {
            if (e instanceof ApiError && [401, 404].includes(e.status)) {
              localStorage.removeItem('holiday-project');
              history.replaceState(null, '', '/');
            } else setError(e.message);
          }
        });
    return () => {
      active = false;
    };
  }, [accept]);
  useEffect(() => {
    if (!project || ['draft', 'ready', 'failed'].includes(project.state)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const p = await api<ProjectView>(`/api/projects/${project.id}`);
        if (alive) {
          accept(p);
          setError('');
        }
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : 'Progress is temporarily unavailable.');
      } finally {
        if (alive) timer = setTimeout(poll, 2000);
      }
    };
    timer = setTimeout(poll, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project?.id, project?.state, accept]);
  const ensureProject = async () => {
    if (projectRef.current) return projectRef.current;
    creating.current ??= api<ProjectView>('/api/projects', { method: 'POST', body: '{}' });
    try {
      const p = await creating.current;
      accept(p);
      localStorage.setItem('holiday-project', p.id);
      history.replaceState(null, '', `/p/${p.id}`);
      return p;
    } finally {
      creating.current = null;
    }
  };
  const save = useCallback(async () => {
    const snapshot = { people: peopleRef.current, preset: presetRef.current };
    const text = serialize(snapshot.people, snapshot.preset);
    const operation = queue.current
      .catch(() => {})
      .then(async () => {
        const p = projectRef.current;
        if (!p || p.state !== 'draft' || descriptionsPending.current || text === saved.current)
          return p;
        setSaving(true);
        try {
          const updated = await api<ProjectView>(`/api/projects/${p.id}/cast`, {
            method: 'PATCH',
            body: JSON.stringify({
              revision: p.revision,
              characters: snapshot.people.map(toInput),
              preset: snapshot.preset,
            }),
          });
          accept(updated, false);
          saved.current = text;
          return updated;
        } finally {
          setSaving(false);
        }
      });
    queue.current = operation;
    return operation;
  }, [accept]);
  useEffect(() => {
    if (!project || project.state !== 'draft') return;
    const timer = setTimeout(() => {
      void save().catch((e) => setError(e.message));
    }, 650);
    return () => clearTimeout(timer);
  }, [people, preset, project?.id, project?.state, busyIds.length, save]);
  const askCrop = (request: Omit<CropRequest, 'onComplete'>) =>
    new Promise<Crop | null>((resolve) =>
      setCrop({
        ...request,
        onComplete: (c) => {
          setCrop(null);
          resolve(c);
        },
      }),
    );
  const upload = async (files: FileList | File[]) => {
    if (uploading) return;
    const list = Array.from(files);
    setError('');
    setUploading(true);
    try {
      const p = await ensureProject();
      if (p.state !== 'draft')
        throw new Error(
          'This cartoon has already started. Finish or remove it before starting another.',
        );
      const replacement = replaceId.current;
      replaceId.current = null;
      if (!replacement && peopleRef.current.length + list.length > 6)
        throw new Error(
          'Six is the holiday party limit. Add one clear individual photo for each of 1–6 people.',
        );
      for (const file of replacement ? list.slice(0, 1) : list) {
        setStatus(`Checking ${file.name}…`);
        const prepared = await preparePortrait(file);
        let chosen = prepared.crop;
        if (prepared.manual) {
          const confirmed = await askCrop({
            preview: prepared.preview,
            crop: chosen,
            manual: true,
          });
          if (!confirmed) {
            URL.revokeObjectURL(prepared.preview);
            continue;
          }
          chosen = confirmed;
        }
        setStatus('Saving your portrait…');
        const ticket = await api<{ uploadUrl: string }>(`/api/projects/${p.id}/uploads`, {
          method: 'POST',
          body: JSON.stringify({ mime: 'image/jpeg', size: prepared.blob.size }),
        });
        const result = await api<{ assetId: string }>(ticket.uploadUrl, {
          method: 'PUT',
          body: prepared.blob,
          headers: { 'content-type': 'image/jpeg' },
        });
        const old = replacement ? peopleRef.current.find((c) => c.id === replacement) : null;
        const person: Character = {
          id: old?.id ?? crypto.randomUUID(),
          sourceAssetId: result.assetId,
          name: old?.name ?? '',
          description: old?.description ?? '',
          provenance: old?.provenance ?? 'user',
          crop: chosen,
          framing: prepared.manual ? 'manual' : 'detected',
          sourceUrl: `/api/projects/${p.id}/assets/${result.assetId}`,
        };
        const next = old
          ? peopleRef.current.map((c) => (c.id === old.id ? person : c))
          : [...peopleRef.current, person];
        peopleRef.current = next;
        setPeople(next);
        URL.revokeObjectURL(prepared.preview);
        await save();
        if (prepared.warning) setStatus(prepared.warning);
        else
          setStatus(
            `${next.length} ${next.length === 1 ? 'person' : 'people'} in the cast. Looking festive.`,
          );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This photo couldn’t be added.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const choose = async (ids: string[], onlyEmpty: boolean) => {
    setError('');
    try {
      await save();
      const p = projectRef.current!;
      descriptionsPending.current = true;
      setBusyIds(ids);
      const updated = await api<ProjectView>(`/api/projects/${p.id}/character-descriptions`, {
        method: 'POST',
        body: JSON.stringify({ characterIds: ids, onlyEmpty }),
      });
      accept(updated, false);
      const next = peopleRef.current.map((c) => {
        const chosen = updated.characters.find((x) => x.id === c.id);
        return ids.includes(c.id) && chosen
          ? { ...c, description: chosen.description, provenance: chosen.provenance }
          : c;
      });
      saved.current = serialize(updated.characters, updated.preset);
      setPeople(next);
      setStatus(
        onlyEmpty
          ? 'Empty descriptions are ready. Edit anything you like.'
          : 'One fresh dose of holiday personality.',
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Descriptions are unavailable. You can still write your own.',
      );
      const p = projectRef.current;
      if (p)
        try {
          accept(await api<ProjectView>(`/api/projects/${p.id}`), false);
        } catch {
          /* preserve local text */
        }
    } finally {
      descriptionsPending.current = false;
      setBusyIds([]);
    }
  };
  const generate = async () => {
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      await save();
      const p = projectRef.current!;
      const storageKey = `holiday-generation-${p.id}`;
      const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
      await api(`/api/projects/${p.id}/generate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ turnstileToken: turnstileToken || undefined }),
      });
      accept(await api<ProjectView>(`/api/projects/${p.id}`));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your cartoon couldn’t start. Your cast is saved.');
      setTurnstileToken('');
    } finally {
      setStarting(false);
    }
  };
  const event = (name: string) => {
    if (project)
      void api(`/api/projects/${project.id}/events`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }).catch(() => {});
  };
  const share = async () => {
    if (!project) return;
    setError('');
    try {
      const { url } = await api<{ url: string }>(`/api/projects/${project.id}/share`, {
        method: 'POST',
        body: '{}',
      });
      setShareUrl(url);
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Our family Christmas cartoon', url });
          setStatus('Your cartoon is ready to share.');
        } catch (e) {
          if (!(e instanceof DOMException && e.name === 'AbortError')) {
            await navigator.clipboard.writeText(url);
            setStatus('Link copied. Let the family group chat know.');
          }
        }
      } else {
        try {
          await navigator.clipboard.writeText(url);
          setStatus('Link copied. Let the family group chat know.');
        } catch {
          setStatus('Your share link is ready below.');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The share link couldn’t be created.');
    }
  };
  const reset = () => {
    localStorage.removeItem('holiday-project');
    projectRef.current = null;
    setProject(null);
    setPeople([]);
    setPreset(null);
    setStage('upload');
    setError('');
    setStatus('');
    setShareUrl('');
    setConfirmDelete(false);
    saved.current = '';
    history.replaceState(null, '', '/');
  };
  const removeProject = async () => {
    if (!project) return;
    try {
      await api(`/api/projects/${project.id}`, { method: 'DELETE' });
      reset();
      setStatus('Your link has been revoked and file removal has been scheduled.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This cartoon couldn’t be removed.');
    }
  };
  const editing = !project || project.state === 'draft';
  const ready = project?.state === 'ready';
  const failed = project?.state === 'failed';
  const complete = people.filter((c) => c.description.trim()).length;
  return (
    <>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Family Christmas Cartoon home">
          <span className="brand-icon">
            <Film size={23} />
            <Sparkles size={11} />
          </span>
          <span>
            family christmas
            <br />
            <strong>cartoon</strong>
            <span className="brand-dot">✳</span>
          </span>
        </a>
        <span className="header-note">
          <span className="little-star">✳</span> Made for the family group chat.
        </span>
        <button className="text-button header-sample" onClick={() => setPreview('snowball')}>
          See a sample <ChevronRight size={16} />
        </button>
      </header>
      {config?.mode === 'mock' && (
        <div className="demo-banner">
          <span className="demo-dot" /> You’re in the demo studio. Results use illustrative
          fixtures, not your uploaded faces. No paid generation.
        </div>
      )}
      {config?.mode === 'real' && config.releaseChannel === 'dev' && (
        <div className="demo-banner">
          <span className="demo-dot" />{' '}
          {config.usageLimitsEnabled === false
            ? 'Local development · No app usage caps'
            : 'Development studio'}{' '}
          ·{' '}
          {config.generationEnabled
            ? 'Generating uses paid AI services.'
            : 'Live generation is temporarily paused.'}{' '}
          Scene previews are illustrative; your cartoon is generated from your photos.
        </div>
      )}
      <main>
        {editing && (
          <>
            <section className={`intro ${stage === 'personalize' ? 'intro-small' : ''}`}>
              {stage === 'upload' ? (
                <>
                  <div className="hero-copy">
                    <div className="eyebrow">
                      <span className="line" /> A VERY PERSONAL CHRISTMAS SPECIAL
                    </div>
                    <h1>
                      Your family.
                      <br />
                      Unwrap the <em>chaos.</em>
                      <span className="title-star">✳</span>
                    </h1>
                    <p className="hero-description">
                      Upload your people. Pick a Christmas scene.
                      <br />
                      Get a ridiculously shareable family cartoon.
                    </p>
                    <a href="#casting" className="button primary">
                      Make your family cartoon <ArrowDown size={17} />
                    </a>
                    <div className="hero-facts">
                      <span>
                        <Check size={14} /> 1–6 familiar faces
                      </span>
                      <span>
                        <Check size={14} /> 20 seconds of silliness
                      </span>
                      <span>
                        <Check size={14} /> No script needed
                      </span>
                    </div>
                  </div>
                  <div className="hero-art">
                    <div className="art-topline">
                      <span>
                        <Snowflake size={15} /> THE HOLIDAY SPECIAL
                      </span>
                      <span>EST. THIS CHRISTMAS</span>
                    </div>
                    <div className="art-image">
                      <img
                        src={sample('snowball')}
                        alt="Illustrative cartoon people in a snowy yard, caught in a ridiculous snowball fight"
                      />
                      <button
                        className="play-sample"
                        onClick={() => setPreview('snowball')}
                        aria-label="Play Snowball Showdown sample"
                      >
                        <span>▶</span> A glimpse of the chaos
                      </button>
                      <span className="art-spark one">✦</span>
                      <span className="art-spark two">✧</span>
                    </div>
                    <div className="art-bottom">
                      <span>Starring: your favourite people.</span>
                      <span className="round-seal">
                        100%
                        <br />
                        <strong>
                          holiday
                          <br />
                          nonsense
                        </strong>
                      </span>
                    </div>
                    <div className="art-caption">
                      {config?.previewMode === 'generated'
                        ? 'A pre-generated sample. Your cast makes it yours.'
                        : 'Illustrative demo animation · silent'}
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <div className="eyebrow">
                    <Sparkles size={15} /> THE PERSONAL TOUCH
                  </div>
                  <h1>
                    Meet your holiday
                    <br />
                    <em>troublemakers.</em>
                  </h1>
                  <p className="hero-description">
                    Familiar faces. Unfamiliar levels of festive chaos.
                  </p>
                </div>
              )}
            </section>
            <nav className="steps" aria-label="Creation steps">
              <button
                aria-current={stage === 'upload' ? 'step' : undefined}
                className={stage === 'upload' ? 'active' : 'done'}
                onClick={() => setStage('upload')}
              >
                <span>{people.length && stage === 'personalize' ? <Check size={14} /> : '01'}</span>
                Upload your people
              </button>
              <div />
              <button
                aria-current={stage === 'personalize' ? 'step' : undefined}
                className={stage === 'personalize' ? 'active' : ''}
                onClick={() => people.length && setStage('personalize')}
                disabled={!people.length}
              >
                <span>02</span>Make it personal
              </button>
              <div />
              <span className="step-future">
                <b>03</b>Enjoy the chaos
              </span>
            </nav>
          </>
        )}
        {error && (
          <div role="alert" className="error-box">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setError('')}
            >
              <X size={17} />
            </button>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">
          {status}
        </div>
        {editing && (
          <section id="casting" className="studio-section">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple={!replaceId.current}
              className="sr-only"
              aria-label="Upload individual portraits"
              onChange={(e) => e.target.files && void upload(e.target.files)}
            />
            <div className="section-heading">
              <div>
                <div className="eyebrow">
                  {stage === 'upload' ? 'THE CASTING CALL' : 'THE LEADING CHARACTERS'}
                </div>
                <h2>
                  {stage === 'upload'
                    ? 'Every great cartoon starts with your people.'
                    : 'A little personality goes a long way.'}
                </h2>
                <p>
                  {stage === 'upload'
                    ? 'One clear photo per person. Big grins encouraged.'
                    : 'Give each person a comic character. Choose for me makes the introductions easy.'}
                </p>
              </div>
              <span className="cast-counter">
                {people.length}
                <span> / 6 people</span>
              </span>
            </div>
            {stage === 'upload' ? (
              <>
                <button
                  className={`upload-zone ${uploading ? 'uploading' : ''}`}
                  disabled={uploading || people.length >= 6}
                  onClick={() => {
                    replaceId.current = null;
                    fileInput.current?.click();
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!uploading && people.length < 6) void upload(e.dataTransfer.files);
                  }}
                >
                  <span className="upload-icon">
                    {uploading ? (
                      <LoaderCircle className="spin" size={30} />
                    ) : (
                      <ImagePlus size={32} />
                    )}
                  </span>
                  <strong>
                    {uploading
                      ? 'Getting your cast together…'
                      : people.length >= 6
                        ? 'The whole cast is here!'
                        : 'Drop your favourite faces here'}
                  </strong>
                  <span>{uploading ? status : 'or tap to choose photos'}</span>
                  <small>One person in each photo · JPEG, PNG or WebP · Up to 15 MiB each</small>
                </button>
                {people.length > 0 && (
                  <div className="upload-cast">
                    {people.map((person, i) => (
                      <article className="upload-person" key={person.id}>
                        <Portrait person={person} />
                        <div>
                          <strong>{person.name || `Person ${i + 1}`}</strong>
                          <span>Ready for their close-up</span>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`Adjust crop for Person ${i + 1}`}
                          onClick={async () => {
                            const c = await askCrop({
                              preview: person.sourceUrl,
                              crop: person.crop,
                              manual: false,
                            });
                            if (c)
                              setPeople((p) =>
                                p.map((x) => (x.id === person.id ? { ...x, crop: c } : x)),
                              );
                          }}
                        >
                          <Scissors size={17} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Remove Person ${i + 1}`}
                          onClick={() => setPeople((p) => p.filter((x) => x.id !== person.id))}
                        >
                          <X size={17} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
                <div className="upload-bottom">
                  <div className="privacy-note">
                    <ShieldCheck size={20} />
                    <p>
                      Use photos you have permission to use. Photos are processed by our
                      media-generation service; automatic descriptions use a text service. Source
                      photos stay private.
                    </p>
                  </div>
                  <button
                    className="button primary"
                    disabled={!people.length || uploading}
                    onClick={() => {
                      setStage('personalize');
                      void save().catch((e) => setError(e.message));
                      document
                        .querySelector('.steps')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    Meet the cast <ArrowRight size={17} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="cast-toolbar">
                  <span>
                    <Heart size={15} /> Names are optional. Personality is everything.
                  </span>
                  <button
                    className="button small outline"
                    disabled={complete === people.length || !!busyIds.length || uploading}
                    onClick={() =>
                      void choose(
                        people.filter((c) => !c.description.trim()).map((c) => c.id),
                        true,
                      )
                    }
                  >
                    <Sparkles size={15} />
                    Choose for all empty descriptions
                  </button>
                </div>
                <div className="character-grid">
                  {people.map((person, i) => (
                    <article className="character-card" key={person.id}>
                      <div className="character-photo">
                        <Portrait person={person} />
                        <span className="person-number">CAST {String(i + 1).padStart(2, '0')}</span>
                        <button
                          className="icon-button photo-remove"
                          aria-label={`Remove Person ${i + 1}`}
                          disabled={busyIds.includes(person.id)}
                          onClick={() => setPeople((p) => p.filter((x) => x.id !== person.id))}
                        >
                          <X size={16} />
                        </button>
                        <div className="photo-actions">
                          <button
                            onClick={() => {
                              replaceId.current = person.id;
                              fileInput.current?.click();
                            }}
                            disabled={uploading || busyIds.includes(person.id)}
                          >
                            <Upload size={13} />
                            Replace
                          </button>
                          <button
                            onClick={async () => {
                              const c = await askCrop({
                                preview: person.sourceUrl,
                                crop: person.crop,
                                manual: false,
                              });
                              if (c)
                                setPeople((p) =>
                                  p.map((x) => (x.id === person.id ? { ...x, crop: c } : x)),
                                );
                            }}
                          >
                            <Scissors size={13} />
                            Crop
                          </button>
                        </div>
                      </div>
                      <div className="character-fields">
                        <label htmlFor={`name-${person.id}`}>
                          Name <span>optional</span>
                        </label>
                        <input
                          id={`name-${person.id}`}
                          maxLength={60}
                          placeholder={`Person ${i + 1}`}
                          value={person.name}
                          onChange={(e) =>
                            setPeople((p) =>
                              p.map((x) =>
                                x.id === person.id ? { ...x, name: e.target.value } : x,
                              ),
                            )
                          }
                        />
                        <div className="description-label">
                          <label htmlFor={`description-${person.id}`}>Character description</label>
                          <span>{person.description.length}/500</span>
                        </div>
                        <textarea
                          id={`description-${person.id}`}
                          maxLength={500}
                          rows={4}
                          placeholder="An overconfident gift wrapper who celebrates every tiny success with an enormous victory pose."
                          value={person.description}
                          disabled={busyIds.includes(person.id)}
                          onChange={(e) =>
                            setPeople((p) =>
                              p.map((x) =>
                                x.id === person.id
                                  ? { ...x, description: e.target.value, provenance: 'user' }
                                  : x,
                              ),
                            )
                          }
                        />
                        <button
                          className="choose-button"
                          disabled={!!busyIds.length}
                          onClick={() => void choose([person.id], false)}
                        >
                          {busyIds.includes(person.id) ? (
                            <LoaderCircle size={15} className="spin" />
                          ) : (
                            <Sparkles size={15} />
                          )}{' '}
                          {busyIds.includes(person.id)
                            ? 'Choosing a little mischief…'
                            : 'Choose for me'}
                        </button>
                      </div>
                    </article>
                  ))}
                  {people.length < 6 && (
                    <button
                      className="add-person"
                      disabled={uploading || !!busyIds.length}
                      onClick={() => {
                        replaceId.current = null;
                        fileInput.current?.click();
                      }}
                    >
                      <span>
                        <Plus size={28} />
                      </span>
                      <strong>Add another familiar face</strong>
                      <small>Up to six people. More personalities, more chaos.</small>
                    </button>
                  )}
                </div>
                <div className="preset-heading">
                  <div className="eyebrow">PICK YOUR FESTIVE FIASCO</div>
                  <h2>Same family. Three ways to lose the plot.</h2>
                  <p>
                    One classic 2D cartoon style. All visual comedy. Absolutely no lines to learn.
                  </p>
                </div>
                <div className="preset-grid" role="group" aria-label="Christmas scenes">
                  {PRESETS.map((p) => (
                    <article
                      key={p.id}
                      className={`preset-card ${preset === p.id ? 'selected' : ''}`}
                    >
                      <button
                        className="preset-pick"
                        aria-pressed={preset === p.id}
                        onClick={() => setPreset(p.id)}
                      >
                        <div className="preset-image" style={{ background: p.color }}>
                          <img src={sample(p.id)} alt={`${p.title} cartoon sample`} />
                          <span className="preset-selector">
                            {preset === p.id && <Check size={16} />}
                          </span>
                          <span className="preset-tag">{p.tag}</span>
                        </div>
                        <div className="preset-copy">
                          <h3>{p.title}</h3>
                          <p>{p.subtitle}</p>
                        </div>
                      </button>
                      <button
                        className="preset-preview text-button"
                        onClick={() => setPreview(p.id)}
                        aria-label={`Preview ${p.title}`}
                      >
                        ▶ Preview scene <span>20 sec</span>
                      </button>
                    </article>
                  ))}
                </div>
                <div className="generation-dock">
                  <div>
                    <span className="eyebrow">YOUR HOLIDAY SPECIAL</span>
                    <strong>
                      {people.length} {people.length === 1 ? 'character' : 'characters'}{' '}
                      <span>·</span> {preset ? getPreset(preset).title : 'Choose a scene'}
                    </strong>
                    <small>
                      {saving
                        ? 'Saving your cast…'
                        : complete < people.length
                          ? `${people.length - complete} ${people.length - complete === 1 ? 'description' : 'descriptions'} to go`
                          : !preset
                            ? 'Pick one of the three scenes above.'
                            : 'Cast ready. Comedy incoming.'}
                    </small>
                  </div>
                  <button
                    className="button primary generate-button"
                    disabled={
                      !people.length ||
                      complete !== people.length ||
                      !preset ||
                      starting ||
                      uploading ||
                      !!busyIds.length ||
                      config?.generationEnabled === false ||
                      (config?.mode === 'real' && !config.localOperatorAccess && !turnstileToken)
                    }
                    onClick={() => void generate()}
                  >
                    {starting ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <Sparkles size={18} />
                    )}{' '}
                    {starting ? 'Starting your cartoon…' : 'Generate my cartoon'}
                    <ArrowRight size={17} />
                  </button>
                </div>
                {config?.mode === 'real' &&
                  !config.localOperatorAccess &&
                  config.turnstileSiteKey && (
                    <Turnstile siteKey={config.turnstileSiteKey} onToken={setTurnstileToken} />
                  )}
                <p className="generation-note">
                  {config?.mode === 'mock'
                    ? 'Demo mode creates an illustrative fixture, not a likeness of your uploaded cast.'
                    : 'Your cartoon keeps working if you close this tab. Return in this browser to find it.'}
                </p>
              </>
            )}
          </section>
        )}
        {!editing && project && !ready && !failed && (
          <section className="progress-section">
            <div className="eyebrow">
              <Sparkles size={15} /> THE HOLIDAY STUDIO IS ROLLING
            </div>
            <h1>
              A little chaos
              <br />
              <em>is in the making.</em>
            </h1>
            <p>
              {PHASES.find((p) => p.state === project.state)?.detail ??
                'Your cast is saved. The studio is getting ready.'}
            </p>
            <div className="production-progress">
              {PHASES.map((phase, i) => {
                const current = PHASES.findIndex((p) => p.state === project.state);
                const done = i < current;
                return (
                  <div
                    key={phase.state}
                    className={done ? 'phase done' : i === current ? 'phase active' : 'phase'}
                  >
                    <span>
                      {done ? (
                        <Check size={17} />
                      ) : i === current ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        String(i + 1).padStart(2, '0')
                      )}
                    </span>
                    <strong>{phase.label}</strong>
                  </div>
                );
              })}
            </div>
            <p className="actual-count">
              {project.characters.filter((c) => c.canonicalUrl).length} of{' '}
              {project.characters.length} portraits drawn ·{' '}
              {project.shots.filter((s) => s.clipReady).length} of 4 scenes animated
            </p>
            <div className="cast-preview">
              {project.characters.map((c, i) => (
                <div key={c.id}>
                  {c.canonicalUrl ? (
                    <img
                      src={c.canonicalUrl}
                      alt={`Cartoon portrait for Person ${i + 1}${project.mode === 'mock' ? ' (illustrative fixture)' : ''}`}
                    />
                  ) : (
                    <div className="portrait-wait">
                      <Sparkles size={25} />
                    </div>
                  )}
                  <span>{c.name || `Person ${i + 1}`}</span>
                </div>
              ))}
            </div>
            <div className="scene-preview">
              {project.shots.map((s) => (
                <div key={s.id}>
                  {s.frameUrl ? (
                    <img src={s.frameUrl} alt={`Scene ${s.order + 1} starting frame`} />
                  ) : (
                    <span>
                      <Clapperboard size={24} />
                    </span>
                  )}
                  <small>
                    SCENE 0{s.order + 1} {s.clipReady && <Check size={13} />}
                  </small>
                </div>
              ))}
            </div>
            <div className="saved-note">
              <ShieldCheck size={18} />
              <span>
                Your cast is saved. It’s safe to close this tab.
                <br />
                <small>Come back in this browser. There’s no account to remember.</small>
              </span>
            </div>
          </section>
        )}
        {ready && project && (
          <section className="result-section">
            <div className="eyebrow">
              <span>✳</span> A VERY PERSONAL HOLIDAY PREMIERE
            </div>
            <h1>
              The group chat
              <br />
              <em>isn’t ready.</em>
            </h1>
            <p>Your holiday special is here. Let the family laugh first.</p>
            {project.mode === 'mock' && (
              <div className="notice">
                Illustrative demo output · This animation was not generated from your photos.
                Development audio is silent.
              </div>
            )}
            <video
              className="result-video"
              controls
              playsInline
              preload="metadata"
              poster={project.posterUrl}
              src={project.videoUrl}
              onPlay={() => event('playback_started')}
            >
              <track kind="captions" />
            </video>
            <div className="result-actions">
              <button className="button primary" onClick={() => void share()}>
                <Share2 size={18} />
                Share the holiday chaos
              </button>
              <a
                className="button outline"
                href={`${project.videoUrl}?download=1`}
                download
                onClick={() => event('download_requested')}
              >
                <Download size={18} />
                Download video
              </a>
              <button
                className="button outline"
                onClick={() => {
                  const v = document.querySelector<HTMLVideoElement>('.result-video');
                  if (v) {
                    v.currentTime = 0;
                    void v.play();
                    event('replayed');
                  }
                }}
              >
                <RotateCcw size={17} />
                Replay
              </button>
            </div>
            {shareUrl && (
              <div className="share-link">
                <label htmlFor="share-url">Anyone with this unlisted link can watch.</label>
                <input
                  id="share-url"
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.target.select()}
                />
                <a href={shareUrl} target="_blank" rel="noreferrer">
                  Open share page ↗
                </a>
              </div>
            )}
            <div className="result-details">
              <span>
                <Film size={16} />
                20 seconds · 720p · MP4
              </span>
              <span>
                <Volume2 size={16} />
                {project.mode === 'mock' ? 'Silent development fixture' : 'Instrumental music only'}
              </span>
              <span>
                <ShieldCheck size={16} />
                Available until{' '}
                {new Date(project.expiresAt).toLocaleDateString('en-CA', {
                  timeZone: 'America/Toronto',
                })}
              </span>
            </div>
            <p className="result-footnote">
              Download a copy to keep the laughs beyond your link’s expiry date.
            </p>
            <button className="text-button new-cartoon" onClick={reset}>
              Make another holiday special <ArrowRight size={16} />
            </button>
          </section>
        )}
        {failed && project && (
          <section className="failure-section">
            <div className="eyebrow">
              <Clapperboard size={16} /> A LITTLE STUDIO SNAG
            </div>
            <h1>
              {isModerationFailure(project.errorCode) ? (
                <>
                  Content screening
                  <br />
                  <em>stopped this cartoon.</em>
                </>
              ) : (
                <>
                  This take hit
                  <br />
                  <em>a snowdrift.</em>
                </>
              )}
            </h1>
            <p>{project.error}</p>
            <div className="cast-preview">
              {project.characters
                .filter((c) => c.canonicalUrl)
                .map((c, i) => (
                  <div key={c.id}>
                    <img src={c.canonicalUrl} alt={`Saved cartoon portrait ${i + 1}`} />
                  </div>
                ))}
            </div>
            <p className="generation-note">
              Completed artwork stays saved for seven days. Automatic recovery has stopped.
            </p>
            <button className="button primary" onClick={reset}>
              Start a new cartoon <ArrowRight size={16} />
            </button>
          </section>
        )}
        {status && !uploading && <p className="visible-status">{status}</p>}
        {project && (
          <div className="owner-actions">
            {confirmDelete ? (
              <div className="delete-confirm">
                <p>
                  Remove this cartoon and revoke its share link? File cleanup follows. Copies
                  already downloaded by recipients can’t be recalled.
                </p>
                <button className="button danger small" onClick={() => void removeProject()}>
                  Yes, remove cartoon
                </button>
                <button className="text-button" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </div>
            ) : (
              <button className="text-button" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} />
                Remove this cartoon
              </button>
            )}
          </div>
        )}
      </main>
      <footer className="site-footer">
        <span className="footer-mark">✳</span>
        <span>
          A little holiday magic.
          <br />
          <strong>A whole lot of you.</strong>
        </span>
        <p>
          Family Christmas Cartoon
          <br />
          <small>Made with fal & Cloudflare. Made for a laugh.</small>
        </p>
        <a
          href="#top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
        >
          ↑
        </a>
      </footer>
      {crop && <CropDialog key={crop.preview} request={crop} />}
      {preview && (
        <SampleDialog
          preset={preview}
          mode={config?.previewMode ?? 'illustrative'}
          close={() => setPreview(null)}
        />
      )}
    </>
  );
}
function Portrait({ person }: { person: Character }) {
  return (
    <img
      className="portrait-photo"
      src={person.sourceUrl}
      alt={person.name ? `${person.name}’s individual portrait` : 'Uploaded individual portrait'}
      style={{
        objectPosition: `${(person.crop.x + person.crop.width / 2) * 100}% ${(person.crop.y + person.crop.height / 2) * 100}%`,
      }}
    />
  );
}
function SampleDialog({
  preset,
  mode,
  close,
}: {
  preset: PresetId;
  mode: string;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const el = ref.current;
    el?.addEventListener('cancel', close);
    return () => el?.removeEventListener('cancel', close);
  }, [close]);
  return (
    <dialog ref={ref} className="sample-dialog" aria-labelledby="sample-title">
      <button className="icon-button dialog-close" aria-label="Close sample" onClick={close}>
        <X size={21} />
      </button>
      <div className="eyebrow">A GLIMPSE OF THE CHAOS</div>
      <h2 id="sample-title">{getPreset(preset).title}</h2>
      <p>
        {mode === 'illustrative'
          ? 'Illustrative demo, drawn with code. Silent development audio. This isn’t a generated likeness sample.'
          : 'A representative pre-generated sample. Your own cast will make it personal.'}
      </p>
      <video
        controls
        playsInline
        preload="metadata"
        poster={sample(preset)}
        src={sample(preset, 'video')}
      />
      <button className="button primary" onClick={close}>
        Back to my family <ArrowLeft size={16} />
      </button>
    </dialog>
  );
}
function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (s: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    let widget: string | undefined;
    let active = true;
    const render = () => {
      if (!active || !root.current) return;
      widget = window.turnstile?.render(root.current, {
        sitekey: siteKey,
        action: 'generate',
        callback: (token: string) => callback.current(token),
        'expired-callback': () => callback.current(''),
        'error-callback': () => callback.current(''),
      });
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (window.turnstile) render();
    else if (script) script.addEventListener('load', render);
    else {
      script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.dataset.turnstile = 'true';
      script.onload = render;
      document.head.appendChild(script);
    }
    return () => {
      active = false;
      if (widget) window.turnstile?.remove(widget);
      script?.removeEventListener('load', render);
    };
  }, [siteKey]);
  return <div className="turnstile" ref={root} />;
}
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}
