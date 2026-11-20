import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDemo } from '../DemoState';
import { MissingEvent } from './CommunityParts';
export function Story() {
  const { id } = useParams();
  const { state, update } = useDemo();
  const e = state.events.find((e) => e.id === id);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (e && !state.seen.includes(e.id))
      update((s) => ({ ...s, seen: [...s.seen, e.id] }));
  }, [e, state.seen, update]);
  if (!e) return <MissingEvent />;
  const frames = [
    e.title,
    `${e.host} welcomes a small group in ${e.area}`,
    e.description,
  ];
  return (
    <div
      className="story-view"
      style={{
        backgroundImage: `linear-gradient(180deg,#0009,transparent 30%,#000e),url(${e.image})`,
      }}
    >
      <header>
        <div className="step-progress">
          {frames.map((_, n) => (
            <i key={n} className={n <= frame ? 'done' : ''} />
          ))}
        </div>
        <div className="feature-row">
          <span>{e.host}</span>
          <Link className="button button-secondary" to="/community">
            Close story
          </Link>
        </div>
      </header>
      <div className="story-copy">
        <p className="demo-caption">Concept image</p>
        <h1>{frames[frame]}</h1>
        <div className="feature-actions">
          <button
            className="button button-secondary"
            disabled={frame === 0}
            onClick={() => setFrame((n) => n - 1)}
          >
            Previous
          </button>
          <button
            className="button button-secondary"
            disabled={frame === frames.length - 1}
            onClick={() => setFrame((n) => n + 1)}
          >
            Next
          </button>
        </div>
        <Link className="button button-white" to={`/community/events/${e.id}`}>
          View event
        </Link>
      </div>
    </div>
  );
}
