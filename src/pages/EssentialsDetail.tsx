import { Link, NavLink, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { dateLabel, listDemoBookings } from '../lib/booking';
import { experiences } from '../data/experiences';
import { essentialsSections, OfficialLink } from './essentials-shared';
import './travel-essentials.css';

const tourism = 'https://sikkimtourism.gov.in/';
const permitGuide =
  'https://www.sikkim.gov.in/departments/tourism-civil-aviation-department/general-info';
const transport = 'https://gangtokdistrict.nic.in/travelaccess/';
const taxiFares =
  'https://www.sntd.in/News.aspx?Name=LATEST+TAXI+FARE&ismvd=1&type=86';
const emergency = 'https://police.sikkim.gov.in/visitor/erss';
const checkedOn = '2026-11-11';

export function EssentialsDetail({
  connected = false,
}: {
  connected?: boolean;
}) {
  const { section } = useParams();
  const current = essentialsSections.find((item) => item.id === section);
  const bookings =
    section === 'bookings' && !connected ? listDemoBookings() : [];
  return (
    <div className="page essentials-page essentials-detail">
      <Link className="essentials-back" to="/essentials">
        <Icon name="arrow-left" size={18} /> All essentials
      </Link>
      <header className="essentials-detail-heading">
        <p className="eyebrow">TRAVEL ESSENTIALS</p>
        <h1>{current?.label ?? 'This guide isn’t available.'}</h1>
        {!current && (
          <p>Choose a section below or return to Travel essentials.</p>
        )}
      </header>
      <div className="essentials-detail-layout">
        <div>
          {section === 'permits' && (
            <section
              id="permits"
              aria-labelledby="permits-heading"
              className="essentials-panel"
            >
              <span className="essentials-kicker">01 / BEFORE YOU GO</span>
              <h2 id="permits-heading">A little paperwork, sorted.</h2>
              <p>
                Permit requirements depend on where you’re going and your
                nationality. Check the official guidance before making
                arrangements.
              </p>
              <ul className="essentials-list">
                <li>
                  <Icon name="check" />
                  <span>
                    <strong>Check your destination</strong>Ask whether your
                    route needs a permit and who can arrange it.
                  </span>
                </li>
                <li>
                  <Icon name="check" />
                  <span>
                    <strong>Confirm your documents</strong>Check the required
                    ID, photos and traveller details with the issuing office or
                    registered operator.
                  </span>
                </li>
                <li>
                  <Icon name="check" />
                  <span>
                    <strong>Confirm dates and costs</strong>Ask about processing
                    time, fees and entry conditions before paying.
                  </span>
                </li>
              </ul>
              <OfficialLink href={permitGuide}>
                Official permit guidance
              </OfficialLink>
              <p className="essentials-note">
                This page provides guidance. Permits are arranged through the
                relevant authority or authorised operator.
              </p>
            </section>
          )}
          {section === 'transport' && (
            <section
              id="taxis"
              aria-labelledby="taxis-heading"
              className="essentials-panel"
            >
              <span className="essentials-kicker">02 / GETTING AROUND</span>
              <h2 id="taxis-heading">The journey matters, too.</h2>
              <p>
                For airport or station transfers, shared rides and private
                taxis, agree the details directly with your operator.
              </p>
              <div className="essentials-transport-types">
                <span>Airport & station</span>
                <span>Shared rides</span>
                <span>Private taxis</span>
              </div>
              <p className="essentials-subheading">Before you confirm a ride</p>
              <ul className="essentials-list essentials-list-compact">
                <li>
                  <Icon name="check" /> Pickup, destination, date and group size
                </li>
                <li>
                  <Icon name="check" /> Vehicle, luggage space and any access
                  needs
                </li>
                <li>
                  <Icon name="check" /> Total fare, waiting, parking and permit
                  charges
                </li>
                <li>
                  <Icon name="check" /> Cancellation terms and operator contact
                </li>
              </ul>
              <div className="essentials-links">
                <OfficialLink href={taxiFares}>
                  Published taxi fares
                </OfficialLink>
                <OfficialLink href={transport}>Getting to Sikkim</OfficialLink>
              </div>
              <p className="essentials-note">
                Need help finding an operator? Visit Help & contacts for Sikkim
                Tourism enquiries. Taxi reservations are not taken in this app.
              </p>
            </section>
          )}
          {section === 'bookings' && (
            <section
              id="bookings"
              aria-labelledby="bookings-heading"
              className="essentials-panel essentials-bookings"
            >
              <span className="essentials-kicker">03 / YOUR EXPERIENCES</span>
              <h2 id="bookings-heading">Your bookings, together.</h2>
              {bookings.length ? (
                <>
                  <p>
                    Demo tickets saved on this browser. No payment taken and no
                    real place reserved.
                  </p>
                  <ul className="essentials-tickets">
                    {bookings.map((booking) => (
                      <li key={booking.reference}>
                        <Link to={'/demo-bookings/' + booking.reference}>
                          <Icon name="ticket" size={24} />
                          <span>
                            <strong>
                              {
                                experiences.find(
                                  (item) => item.id === booking.experienceId,
                                )?.title
                              }
                            </strong>
                            <small>
                              {dateLabel(booking.date)} · {booking.time} IST ·
                              Demo ticket
                            </small>
                          </span>
                          <Icon name="arrow-right" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p>
                    {connected
                      ? 'Booking here isn’t available yet. When it opens, your reservations and tickets will be kept here.'
                      : 'Any demo tickets you create will appear here. Demo bookings do not reserve real places or take payment.'}
                  </p>
                  <Link className="button button-white" to="/explore?view=list">
                    Browse experiences
                    <Icon name="arrow-right" size={18} />
                  </Link>
                </>
              )}
              <Link className="essentials-saved" to="/saved">
                <Icon name="bookmark" size={18} /> Your saved experiences
                <Icon name="arrow-right" size={16} />
              </Link>
            </section>
          )}
          {section === 'help' && (
            <section
              id="help"
              aria-labelledby="help-heading"
              className="essentials-panel"
            >
              <span className="essentials-kicker">04 / A HELPING HAND</span>
              <h2 id="help-heading">Keep these close.</h2>
              <div className="essentials-contact">
                <div>
                  <strong>Sikkim Tourism</strong>
                  <p>Travel information and operator enquiries</p>
                </div>
                <a
                  href="tel:+913592232218"
                  aria-label="Call Sikkim Tourism on 03592 232218"
                >
                  <Icon name="phone" size={18} />
                  03592 232218
                </a>
              </div>
              <OfficialLink href={tourism}>Tourism contact source</OfficialLink>
              <div className="essentials-contact essentials-emergency">
                <div>
                  <strong>Emergency assistance</strong>
                  <p>Police, fire or medical emergency</p>
                </div>
                <a href="tel:112" aria-label="Call emergency assistance on 112">
                  <Icon name="phone" size={18} />
                  112
                </a>
              </div>
              <OfficialLink href={emergency}>
                Sikkim Police emergency guidance
              </OfficialLink>
            </section>
          )}
          {section === 'before-you-go' && (
            <section
              className="essentials-checklist"
              aria-labelledby="checklist-heading"
            >
              <div>
                <p className="essentials-kicker">SMALL THINGS, SMOOTHER DAYS</p>
                <h2 id="checklist-heading">Before you travel.</h2>
              </div>
              <ul>
                {[
                  [
                    'Documents handy',
                    'Keep your required ID, permits and confirmed booking details accessible.',
                  ],
                  [
                    'Pack for the day',
                    'Bring suitable layers, rain protection and a charged power bank.',
                  ],
                  [
                    'Keep a backup',
                    'Save important contacts and directions before leaving reliable internet.',
                  ],
                  [
                    'Check with your host',
                    'Confirm the meeting point, payment options and anything you need to bring.',
                  ],
                ].map(([title, detail]) => (
                  <li key={title}>
                    <Icon name="check" size={18} />
                    <div>
                      <strong>{title}</strong>
                      <p>{detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {section === 'updates' && (
            <section
              className="essentials-panel"
              aria-labelledby="updates-heading"
            >
              <span className="essentials-kicker">
                CHECK BEFORE YOU SET OFF
              </span>
              <h2 id="updates-heading">Know before you go.</h2>
              <p>
                Confirm road access and local restrictions with official sources
                and your operator before travelling.
              </p>
              <ul className="essentials-list">
                <li>
                  <Icon name="check" />
                  <span>
                    <strong>Check your route</strong>Ask your operator about
                    road access, timings and any changes to your journey.
                  </span>
                </li>
                <li>
                  <Icon name="check" />
                  <span>
                    <strong>Look at the date</strong>Read when an official
                    notice was issued and which places it covers.
                  </span>
                </li>
                <li>
                  <Icon name="check" />
                  <span>
                    <strong>Confirm before leaving</strong>Recheck with your
                    host or operator before setting off.
                  </span>
                </li>
              </ul>
              <OfficialLink href={tourism}>Tourism updates</OfficialLink>
              <p className="essentials-note">
                Live travel alerts are not available here yet. This page does
                not confirm that roads or destinations are open.
              </p>
              <Link className="essentials-saved" to="/essentials/help">
                Help & contacts <Icon name="arrow-right" size={16} />
              </Link>
            </section>
          )}
          {current && section !== 'bookings' && (
            <p className="essentials-reviewed">
              Source links and contact numbers checked{' '}
              <time dateTime={checkedOn}>11 November 2026</time>. Guidance can
              change; confirm current requirements before travel. External
              websites need an internet connection.
            </p>
          )}
        </div>
        <nav className="essentials-directory" aria-label="More essentials">
          <p>In essentials</p>
          {essentialsSections.map((item) => (
            <NavLink key={item.id} to={'/essentials/' + item.id}>
              <Icon name={item.icon} size={18} /> {item.label}
              <Icon name="arrow-right" size={16} />
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
