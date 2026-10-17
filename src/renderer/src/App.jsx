import React, { useEffect, useMemo, useState } from 'react';

const api = window.flipbrief;

function statusLabel(status) {
  return status ? status[0].toUpperCase() + status.slice(1) : 'Idle';
}

function useMedia(filePath) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!filePath) {
      setUrl('');
      return undefined;
    }
    api.mediaUrl(filePath).then((next) => {
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);
  return url;
}

function PageImage({ page }) {
  const url = useMedia(page?.imagePath);
  if (!url) return <div className="image-placeholder" aria-hidden="true" />;
  return <img className="page-image" src={url} alt="" />;
}

function FlipBook({ book, index, total, onNextBook, onPrevBook }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [turn, setTurn] = useState('next');
  const pages = book?.pages || [];
  const page = pages[pageIndex] || null;

  useEffect(() => {
    setPageIndex(0);
    setTurn('next');
  }, [book?.id]);

  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'ArrowRight' || event.key === ' ') next();
      if (event.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  function next() {
    setTurn('next');
    if (pageIndex < pages.length - 1) setPageIndex(pageIndex + 1);
    else onNextBook?.();
  }

  function prev() {
    setTurn('prev');
    if (pageIndex > 0) setPageIndex(pageIndex - 1);
    else onPrevBook?.();
  }

  if (!book) {
    return (
      <main className="viewer empty-state">
        <div className="empty-mark" />
        <h1>FlipBrief</h1>
        <p>Import a playlist or add a YouTube video from Chrome.</p>
      </main>
    );
  }

  return (
    <main className="viewer">
      <div className="viewer-top">
        <div>
          <p className="eyebrow">{index + 1} of {total}</p>
          <h1>{book.title}</h1>
        </div>
        <div className={`status-pill ${book.status}`}>{statusLabel(book.status)}</div>
      </div>

      <section className="book-stage" aria-label="Flipbook viewer">
        <button className="page-nav prev" onClick={prev} aria-label="Previous page">‹</button>
        <div className="book-shell">
          <div className="book-spine" />
          <article
            key={`${book.id}-${pageIndex}`}
            className={`paper-page turn-${turn} ${page?.type || ''}`}
            onClick={next}
          >
            <div className="page-number">{pageIndex + 1}/{pages.length || 1}</div>
            <PageImage page={page} />
            <div className="page-copy">
              {page?.startSec != null && <span className="timestamp">{formatTime(page.startSec)}</span>}
              <h2>{page?.heading || book.title}</h2>
              <p>{page?.body || book.error || book.summary}</p>
            </div>
          </article>
        </div>
        <button className="page-nav next" onClick={next} aria-label="Next page">›</button>
      </section>

      {book.error && <p className="error-line">{book.error}</p>}
    </main>
  );
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60);
  const rest = String(safe % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

function ImportPanel({ settings, onImport, busy }) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [latestCount, setLatestCount] = useState(settings.latestCount || 20);

  useEffect(() => {
    setLatestCount(settings.latestCount || 20);
  }, [settings.latestCount]);

  function submit(event) {
    event.preventDefault();
    if (!sourceUrl.trim()) return;
    onImport({ sourceUrl: sourceUrl.trim(), latestCount });
  }

  return (
    <form className="import-panel" onSubmit={submit}>
      <label htmlFor="sourceUrl">YouTube URL</label>
      <input
        id="sourceUrl"
        value={sourceUrl}
        onChange={(event) => setSourceUrl(event.target.value)}
        placeholder="Playlist or video URL"
      />
      <label htmlFor="latestCount">Latest videos</label>
      <div className="step-row">
        <input
          id="latestCount"
          type="number"
          min="1"
          max="50"
          value={latestCount}
          onChange={(event) => setLatestCount(event.target.value)}
        />
        <button type="submit" disabled={busy || !sourceUrl.trim()}>Import</button>
      </div>
    </form>
  );
}

function Library({ books, selectedId, onSelect }) {
  return (
    <section className="library" aria-label="Library">
      <div className="section-title">Books</div>
      <div className="book-list">
        {books.map((book) => (
          <button
            key={book.id}
            className={`book-row ${selectedId === book.id ? 'active' : ''}`}
            onClick={() => onSelect(book.id)}
          >
            <span className={`dot ${book.status}`} />
            <span>
              <strong>{book.title}</strong>
              <small>{statusLabel(book.status)}{book.pages?.length ? ` - ${book.pages.length} pages` : ''}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Jobs({ jobs }) {
  return (
    <section className="jobs" aria-label="Jobs">
      <div className="section-title">Queue</div>
      {jobs.length === 0 ? <p className="muted">No active imports.</p> : null}
      {jobs.slice(0, 5).map((job) => (
        <div className="job-row" key={job.id}>
          <div>
            <strong>{statusLabel(job.status)}</strong>
            <small>{job.currentTitle || job.sourceUrl}</small>
          </div>
          {job.total ? <span>{job.current || 0}/{job.total}</span> : null}
        </div>
      ))}
    </section>
  );
}

function Settings({ meta, settings, keys, onSaveSettings, onSaveKey, onClearKey, onRefreshToken }) {
  const [draft, setDraft] = useState(settings);
  const [keyDraft, setKeyDraft] = useState({});

  useEffect(() => setDraft(settings), [settings]);

  return (
    <aside className="settings">
      <div className="section-title">Connector</div>
      <div className="pairing">
        <span>127.0.0.1:{meta?.bridge?.port || '...'}</span>
        <button onClick={() => navigator.clipboard.writeText(meta?.bridge?.token || '')}>Copy token</button>
        <button onClick={onRefreshToken}>Rotate</button>
      </div>
      <button className="wide" onClick={() => api.openExtensionFolder()}>Open extension folder</button>

      <div className="section-title">Keys</div>
      {['YOUTUBE_API_KEY', 'OPENAI_API_KEY'].map((name) => (
        <div className="key-row" key={name}>
          <label>{name}</label>
          <div className="key-controls">
            <input
              type="password"
              placeholder={keys[name] ? 'Saved' : 'Paste key'}
              value={keyDraft[name] || ''}
              onChange={(event) => setKeyDraft({ ...keyDraft, [name]: event.target.value })}
            />
            <button onClick={() => {
              onSaveKey(name, keyDraft[name] || '');
              setKeyDraft({ ...keyDraft, [name]: '' });
            }}>Save</button>
            <button onClick={() => onClearKey(name)}>Clear</button>
          </div>
        </div>
      ))}

      <div className="section-title">Defaults</div>
      <label>Pages per video</label>
      <input
        type="number"
        min="4"
        max="8"
        value={draft.pageCount || 5}
        onChange={(event) => setDraft({ ...draft, pageCount: event.target.value })}
      />
      <label>AI model</label>
      <input
        value={draft.openAIModel || ''}
        onChange={(event) => setDraft({ ...draft, openAIModel: event.target.value })}
      />
      <button className="wide" onClick={() => onSaveSettings(draft)}>Save settings</button>
      <button className="wide ghost" onClick={() => api.openDataFolder()}>Open data folder</button>
    </aside>
  );
}

export default function App() {
  const [meta, setMeta] = useState(null);
  const [settings, setSettings] = useState({ latestCount: 20, pageCount: 5, openAIModel: 'gpt-4.1-mini' });
  const [keys, setKeys] = useState({});
  const [books, setBooks] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const selectedIndex = Math.max(0, books.findIndex((book) => book.id === selectedId));
  const selectedBook = books[selectedIndex] || null;
  const busy = jobs.some((job) => job.status === 'queued' || job.status === 'running');

  async function refresh() {
    const [nextMeta, nextSettings, nextKeys, nextBooks, nextJobs] = await Promise.all([
      api.appMeta(),
      api.getSettings(),
      api.keysStatus(),
      api.listBooks(),
      api.listJobs(),
    ]);
    setMeta(nextMeta);
    setSettings(nextSettings);
    setKeys(nextKeys);
    setBooks(nextBooks);
    setJobs(nextJobs);
    if (!selectedId && nextBooks[0]) setSelectedId(nextBooks[0].id);
  }

  useEffect(() => {
    refresh();
    const offBooks = api.onBooksChanged(refresh);
    const offJobs = api.onJobChanged(refresh);
    return () => {
      offBooks();
      offJobs();
    };
  }, []);

  const orderedComplete = useMemo(() => books.filter((book) => book.pages?.length), [books]);

  async function onImport(payload) {
    await api.queueImport(payload);
    await refresh();
  }

  async function saveKey(keyName, value) {
    await api.saveKey(keyName, value);
    setKeys(await api.keysStatus());
  }

  async function clearKey(keyName) {
    await api.clearKey(keyName);
    setKeys(await api.keysStatus());
  }

  async function saveSettings(next) {
    setSettings(await api.saveSettings(next));
  }

  async function refreshToken() {
    await api.regenerateToken();
    setMeta(await api.appMeta());
  }

  function nextBook() {
    if (!orderedComplete.length) return;
    const current = orderedComplete.findIndex((book) => book.id === selectedId);
    const next = orderedComplete[(current + 1 + orderedComplete.length) % orderedComplete.length];
    setSelectedId(next.id);
  }

  function prevBook() {
    if (!orderedComplete.length) return;
    const current = orderedComplete.findIndex((book) => book.id === selectedId);
    const prev = orderedComplete[(current - 1 + orderedComplete.length) % orderedComplete.length];
    setSelectedId(prev.id);
  }

  return (
    <div className="app">
      <button
        className="drawer-handle drawer-handle-left"
        aria-label="Open import and library drawer"
        aria-expanded={leftOpen}
        aria-controls="library-drawer"
        onClick={() => setLeftOpen(!leftOpen)}
      >
        ☰
      </button>
      <button
        className="drawer-handle drawer-handle-right"
        aria-label="Open settings drawer"
        aria-expanded={rightOpen}
        aria-controls="settings-drawer"
        onClick={() => setRightOpen(!rightOpen)}
      >
        ⚙
      </button>

      {(leftOpen || rightOpen) && <button className="drawer-scrim" aria-label="Close drawers" onClick={() => {
        setLeftOpen(false);
        setRightOpen(false);
      }} />}

      <aside id="library-drawer" className={`drawer drawer-left ${leftOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">F</div>
          <div>
            <strong>FlipBrief</strong>
            <span>YouTube to flipbook</span>
          </div>
        </div>
        <ImportPanel settings={settings} onImport={onImport} busy={busy} />
        <Jobs jobs={jobs} />
        <Library books={books} selectedId={selectedId} onSelect={setSelectedId} />
      </aside>

      <FlipBook
        book={selectedBook}
        index={selectedIndex}
        total={books.length}
        onNextBook={nextBook}
        onPrevBook={prevBook}
      />

      <div id="settings-drawer" className={`drawer drawer-right ${rightOpen ? 'open' : ''}`}>
        <Settings
          meta={meta}
          settings={settings}
          keys={keys}
          onSaveSettings={saveSettings}
          onSaveKey={saveKey}
          onClearKey={clearKey}
          onRefreshToken={refreshToken}
        />
      </div>
    </div>
  );
}
