import { useState } from 'react';
import { EventPhotoPicker, EventPhotos } from './EventPhotos';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { indiaToday } from '../../lib/booking';
import { DemoNotice, useDemo } from '../DemoState';
import { EventCard, FeatureBack, MissingEvent } from './CommunityParts';
import {
  covers,
  eventError,
  interests,
  newEvent,
  type CommunityEvent,
} from './model';

export function EventForm() {
  const { id } = useParams();
  const { state } = useDemo();
  const existing = state.events.find((e) => e.id === id);
  if (id && (!existing || !existing.mine || existing.status === 'cancelled'))
    return <MissingEvent />;
  return <Form key={id ?? 'new'} existing={existing} />;
}
function Form({ existing }: { existing?: CommunityEvent }) {
  const { state, update, remoteEvents } = useDemo();
  const navigate = useNavigate();
  const [event, setEvent] = useState(() =>
    existing ? { ...existing } : newEvent(),
  );
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [photosBusy, setPhotosBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const change = <K extends keyof CommunityEvent>(
    key: K,
    value: CommunityEvent[K],
  ) => setEvent((e) => ({ ...e, [key]: value }));
  const next = () => {
    const message = eventError(event, step);
    setError(message);
    if (!message) setStep((s) => s + 1);
  };
  const submit = async () => {
    if (photosBusy || saving) return;
    const message = eventError(event);
    if (message) {
      setError(message);
      return;
    }
    if (remoteEvents) {
      setSaving(true);
      setError('');
      try {
        const saved = await remoteEvents.save(event, !!existing);
        navigate(`/community/events/${saved.id}${existing ? '' : '/created'}`, {
          replace: true,
        });
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not save the event. Try again.',
        );
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!existing && state.events.length >= 60) {
      setError('This browser has reached the limit of 50 created events.');
      return;
    }
    update((s) => ({
      ...s,
      events: existing
        ? s.events.map((e) =>
            e.id === event.id
              ? {
                  ...event,
                  title: event.title.trim(),
                  description: event.description.trim(),
                }
              : e,
          )
        : [...s.events, event],
    }));
    navigate(`/community/events/${event.id}${existing ? '' : '/created'}`, {
      replace: true,
    });
  };
  return (
    <div className="page feature-page form-page">
      <FeatureBack />
      <h1>{existing ? 'Edit your event' : 'Create an experience'}</h1>
      <p className="muted" aria-live="polite">
        Step {step + 1} of 4 ·{' '}
        {['Details', 'When and where', 'Group and price', 'Preview'][step]}
      </p>
      <div className="step-progress" aria-hidden="true">
        {[0, 1, 2, 3].map((n) => (
          <i key={n} className={n <= step ? 'done' : ''} />
        ))}
      </div>
      <DemoNotice />
      <form
        className="feature-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!photosBusy) step < 3 ? next() : submit();
        }}
      >
        {step === 0 && (
          <>
            <EventPhotoPicker
              photos={event.images ?? []}
              onBusyChange={setPhotosBusy}
              onChange={(images) =>
                setEvent((current) => ({
                  ...current,
                  images,
                  image: images[0] ?? covers[0]!,
                }))
              }
            />
            <label>
              Title
              <input
                value={event.title}
                maxLength={60}
                onChange={(e) => change('title', e.target.value)}
              />
            </label>
            <label>
              What will people do?
              <textarea
                value={event.description}
                maxLength={400}
                onChange={(e) => change('description', e.target.value)}
              />
            </label>
            <label>
              Interest
              <select
                value={event.interest}
                onChange={(e) =>
                  change(
                    'interest',
                    e.target.value as CommunityEvent['interest'],
                  )
                }
              >
                {interests.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {step === 1 && (
          <>
            <label>
              Date
              <input
                type="date"
                min={indiaToday()}
                value={event.date}
                onChange={(e) => change('date', e.target.value)}
              />
            </label>
            <div className="form-columns">
              <label>
                Starts · IST
                <input
                  type="time"
                  value={event.start}
                  onChange={(e) => change('start', e.target.value)}
                />
              </label>
              <label>
                Ends · IST
                <input
                  type="time"
                  value={event.end}
                  onChange={(e) => change('end', e.target.value)}
                />
              </label>
            </div>
            <label>
              Area
              <input
                value={event.area}
                maxLength={60}
                placeholder="e.g. Pakyong"
                onChange={(e) => change('area', e.target.value)}
              />
            </label>
            <label>
              Public meeting point
              <input
                value={event.meeting}
                maxLength={120}
                placeholder="A public place, not a home address"
                onChange={(e) => change('meeting', e.target.value)}
              />
            </label>
          </>
        )}
        {step === 2 && (
          <>
            <label>
              Maximum participants
              <input
                type="number"
                min={Math.max(2, event.attendees)}
                max={30}
                required
                inputMode="numeric"
                value={Number.isNaN(event.capacity) ? '' : event.capacity}
                onChange={(e) => change('capacity', e.target.valueAsNumber)}
              />
            </label>
            <label>
              Price per person · ₹0 for free
              <input
                type="number"
                min={0}
                max={10000}
                step={1}
                required
                inputMode="numeric"
                value={Number.isNaN(event.price) ? '' : event.price}
                onChange={(e) => change('price', e.target.valueAsNumber)}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={event.approval}
                onChange={(e) => change('approval', e.target.checked)}
              />
              Ask the host to approve joining
            </label>
            <p className="muted">
              {remoteEvents
                ? 'Your event will be visible to everyone. Joining and payments are not open yet.'
                : 'No real payment, event listing or message is sent.'}
            </p>
          </>
        )}
        {step === 3 && (
          <>
            <section className="feature-panel">
              <EventPhotos
                photos={event.images?.length ? event.images : [event.image]}
                title={event.title}
              />
              <h2>{event.title}</h2>
              <p>
                {event.area} · {event.date} · {event.start}–{event.end} IST
              </p>
              <p>
                {event.capacity} places · ₹{event.price} per person
              </p>
            </section>
            <p>{event.description}</p>
            <p>Meeting point: {event.meeting}</p>
            <p>
              {event.approval ? 'Host approval required' : 'Instant joining'}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="feature-actions">
          {step > 0 && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setStep((s) => s - 1);
                setError('');
              }}
            >
              Previous step
            </button>
          )}
          <button
            className="button button-primary"
            type="submit"
            disabled={photosBusy || saving}
          >
            {step === 3
              ? existing && (!remoteEvents || existing.revision)
                ? 'Save changes'
                : remoteEvents
                  ? 'Publish event'
                  : 'Save event on this device'
              : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
export function EventCreated() {
  const { id } = useParams();
  const { state, remoteEvents } = useDemo();
  const e = state.events.find((e) => e.id === id && e.mine);
  if (!e) return <MissingEvent />;
  return (
    <div className="page feature-page form-page">
      <h1>
        {remoteEvents
          ? 'Your event is published'
          : 'Your event is saved on this device'}
      </h1>
      <p>
        {remoteEvents
          ? 'Guests and other travellers can now see your event and photos.'
          : 'It is saved in this browser. No real event has been published.'}
      </p>
      <DemoNotice />
      <EventCard event={e} />
      <div className="feature-actions">
        <Link
          className="button button-primary"
          to={`/community/events/${e.id}`}
        >
          Manage event
        </Link>
        <Link className="button button-secondary" to="/community?tab=Created">
          Your created events
        </Link>
      </div>
    </div>
  );
}
