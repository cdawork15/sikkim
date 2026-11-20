import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { reelExperiences, reelMedia } from '../data/reels';
import './media-credits.css';

export type MediaCredit = {
  title: string;
  author: string;
  source: string;
  licence: string;
};
const bundled = reelExperiences.map((experience) => {
  const media = reelMedia(experience);
  return {
    title: media.place,
    author: media.author,
    source: media.source,
    licence: media.license,
  };
});

export function MediaCredits({
  entries = [],
  children,
}: {
  entries?: MediaCredit[];
  children?: ReactNode;
}) {
  const credits = [
    ...new Map(
      [...entries, ...bundled].map((entry) => [entry.source, entry]),
    ).values(),
  ];
  return (
    <div className="page interior-page media-information">
      <Link className="text-link" to="/">
        Back to Home
      </Link>
      <header className="page-heading">
        <h1>About our media</h1>
        <p>The people and sources behind the photos and videos.</p>
      </header>
      {children}
      <ul className="media-source-list">
        {credits.map((entry) => (
          <li key={entry.source}>
            <h2>{entry.title}</h2>
            <p>By {entry.author}</p>
            <div>
              <a href={entry.source} target="_blank" rel="noreferrer">
                Original source
                <span className="sr-only"> (opens a new tab)</span>
              </a>
              <a href={entry.licence} target="_blank" rel="noreferrer">
                Licence<span className="sr-only"> (opens a new tab)</span>
              </a>
            </div>
          </li>
        ))}
      </ul>
      <p>
        Clips have been trimmed and resized for playback. Poster frames, cropped
        backgrounds and descriptive captions have been added. Our bundled Sikkim
        footage and its adaptations use CC BY-SA 4.0. The footage shows the
        named places; it does not identify a sample host or confirm a bookable
        route. No creator endorsement is implied.
      </p>
      <p>
        Some preview images are AI concept artwork. Demo experiences and prices
        are examples, not confirmed offers.
      </p>
      <a className="text-link" href="/videos/CREDITS.txt">
        Full bundled footage credits
      </a>
    </div>
  );
}
