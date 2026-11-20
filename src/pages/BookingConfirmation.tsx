import { useEffect, useState } from 'react';
import {
  Link,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router-dom';
import QRCode from 'qrcode';
import type { AppContext } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { experiences, formatPrice } from '../data/experiences';
import { dateLabel, findDemoBooking, type DemoBooking } from '../lib/booking';

function ticketText(booking: DemoBooking) {
  const experience = experiences.find(
    (item) => item.id === booking.experienceId,
  )!;
  return `SIKKIM EXPERIENCES — DEMO TICKET\nNot a real reservation. Not valid for entry. No payment taken.\n\n${experience.title}\n${dateLabel(booking.date)}, ${booking.time} IST\n${booking.participants} people · ${experience.area}\nSample total: ${formatPrice(experience.price * booking.participants)}\nReference: ${booking.reference}\n\nMeeting point is illustrative. Confirm real arrangements with a host before travelling.`;
}

export function BookingConfirmation() {
  const { reference = '' } = useParams();
  const booking = findDemoBooking(reference);
  return booking ? (
    <Ticket key={booking.reference} booking={booking} />
  ) : (
    <div className="page booking-page">
      <EmptyState
        title="This demo ticket isn’t on this browser."
        action="Browse experiences"
        to="/explore"
      >
        Tickets are saved only on the browser that created them. It may have
        been cleared or storage may be unavailable. You can make a new demo
        booking.
      </EmptyState>
    </div>
  );
}

function Ticket({ booking }: { booking: DemoBooking }) {
  const { state } = useLocation();
  const { savedIds, toggleSaved } = useOutletContext<AppContext>();
  const experience = experiences.find(
    (item) => item.id === booking.experienceId,
  )!;
  const [qr, setQr] = useState('');
  const [qrFailed, setQrFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [manualShare, setManualShare] = useState(false);
  const text = ticketText(booking);
  const saved = savedIds.includes(experience.id);
  const shareText = `${text}\n\nExplore this idea: ${window.location.origin}/experiences/${experience.id}`;
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(text, { width: 240, margin: 4, errorCorrectionLevel: 'M' })
      .then((value) => {
        if (active) setQr(value);
      })
      .catch(() => {
        if (active) setQrFailed(true);
      });
    return () => {
      active = false;
    };
  }, [text]);
  const share = async () => {
    setNotice('');
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Sikkim Experiences — demo ticket',
          text: shareText,
        });
        setNotice('Demo ticket shared.');
      } else {
        await navigator.clipboard.writeText(shareText);
        setNotice('Demo ticket copied. Paste it into a message to share.');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setManualShare(true);
      setNotice(
        'Sharing isn’t available here. Select and copy the ticket below.',
      );
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([text], { type: 'text/plain;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${booking.reference}.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Your demo ticket download has started.');
  };
  return (
    <div className="page booking-page confirmation-page">
      <div className="confirmation-heading">
        <span className="confirmation-check">
          <Icon name="check" size={32} />
        </span>
        <p className="eyebrow accent">DEMO COMPLETE</p>
        <h1>You’re in. Just for practice.</h1>
        <p>No payment taken. No real place reserved.</p>
        <p className="field-help">
          Saved on this browser only. Download a copy to keep it.
        </p>
      </div>
      {state?.temporary && (
        <p className="storage-notice" role="status">
          Your browser could not save this ticket. Download it now; it may
          disappear after a reload.
        </p>
      )}
      <article className="demo-ticket" aria-label="Demo ticket">
        <img
          className="ticket-cover"
          src={experience.image}
          alt={experience.imageAlt}
          width="768"
          height="512"
        />
        <div className="ticket-content">
          <span className="detail-chip">DEMO · NOT VALID FOR ENTRY</span>
          <h2>{experience.title}</h2>
          <dl className="ticket-facts">
            <div>
              <dt>Date & time</dt>
              <dd>
                {dateLabel(booking.date)} · {booking.time} IST
              </dd>
            </div>
            <div>
              <dt>People</dt>
              <dd>{booking.participants}</dd>
            </div>
            <div>
              <dt>Area</dt>
              <dd>{experience.area}</dd>
            </div>
            <div>
              <dt>Sample total</dt>
              <dd>{formatPrice(experience.price * booking.participants)}</dd>
            </div>
          </dl>
          <div className="ticket-code">
            {qr ? (
              <img
                src={qr}
                alt="QR code containing the demo ticket text; not valid for entry"
                width="240"
                height="240"
              />
            ) : (
              <p role="status">
                {qrFailed
                  ? 'QR unavailable. Your reference and downloadable ticket still work.'
                  : 'Preparing your demo QR…'}
              </p>
            )}
            <p>Demo reference</p>
            <code>{booking.reference}</code>
          </div>
        </div>
      </article>
      <div className="ticket-actions">
        <button
          className="button button-primary"
          type="button"
          onClick={download}
        >
          Download demo ticket
          <Icon name="arrow-down" size={18} />
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={share}
        >
          Share demo ticket
          <Icon name="arrow-right" size={18} />
        </button>
        <button
          className="button button-secondary"
          type="button"
          aria-pressed={saved}
          onClick={() => toggleSaved(experience.id)}
        >
          <Icon name={saved ? 'check' : 'bookmark'} size={18} />
          {saved ? 'Saved to your ideas' : 'Save experience'}
        </button>
      </div>
      <p className="share-notice" role="status">
        {notice}
      </p>
      {manualShare && (
        <label className="manual-share">
          Copy your demo ticket
          <textarea
            readOnly
            value={shareText}
            rows={9}
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
      <section className="ticket-directions">
        <h2>Finding the meeting point</h2>
        <p>
          This demo uses {experience.area} as a sample area, not a confirmed
          meeting point. A real host would provide exact directions before
          travel.
        </p>
        <a
          className="text-link"
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${experience.area}, Sikkim, India`)}`}
          target="_blank"
          rel="noreferrer"
        >
          View sample area on Google Maps
          <Icon name="map" size={17} />
        </a>
        <p className="field-help">
          Opens an external map; an internet connection is needed.
        </p>
      </section>
      <div className="ticket-links">
        <Link className="text-link" to={`/experiences/${experience.id}`}>
          Back to experience
        </Link>
        <Link className="text-link" to="/">
          Back to Home
        </Link>
      </div>
    </div>
  );
}
