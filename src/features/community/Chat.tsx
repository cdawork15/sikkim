import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { chatAllowed, DemoNotice, useDemo } from '../DemoState';
import { FeatureBack, MissingEvent } from './CommunityParts';
export function Chat() {
  const { id } = useParams();
  const { state, update } = useDemo();
  const e = state.events.find((e) => e.id === id);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  if (!e) return <MissingEvent />;
  if (!chatAllowed(state, e))
    return (
      <div className="page feature-page form-page">
        <FeatureBack to={`/community/events/${e.id}`} children="event" />
        <h1>Join this event to open chat</h1>
        <p>
          Chat is available to joined participants and the host. Waiting-list
          and cancelled events have no chat access.
        </p>
        <Link
          className="button button-primary"
          to={`/community/events/${e.id}`}
        >
          View event
        </Link>
      </div>
    );
  return (
    <div className="page feature-page form-page">
      <FeatureBack to={`/community/events/${e.id}`} children="event" />
      <h1>{e.title}</h1>
      <DemoNotice />
      <div
        className="chat-log"
        role="log"
        aria-label="Messages on this device"
        aria-live="polite"
      >
        <p className="muted">
          Messages here are saved on this device and aren’t sent to anyone.
        </p>
        {state.messages
          .filter((m) => m.eventId === id)
          .map((m) => (
            <div key={m.id} className="chat-message mine">
              <strong>You · local only</strong>
              <p>{m.text}</p>
              <small>
                {new Date(m.at).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </small>
            </div>
          ))}
      </div>
      <form
        className="feature-form"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!text.trim()) {
            setError('Write a message first.');
            return;
          }
          update((s) => {
            const event = s.events.find((x) => x.id === id);
            return event && chatAllowed(s, event)
              ? {
                  ...s,
                  messages: [
                    ...s.messages,
                    {
                      id: crypto.randomUUID(),
                      eventId: id!,
                      text: text.trim(),
                      at: new Date().toISOString(),
                    },
                  ].slice(-200),
                }
              : s;
          });
          setText('');
          setError('');
        }}
      >
        <label>
          Message
          <textarea
            maxLength={500}
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            placeholder="Write a message"
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="button button-primary">Save message</button>
      </form>
    </div>
  );
}
