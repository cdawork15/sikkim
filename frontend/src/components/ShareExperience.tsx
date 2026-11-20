import { useState } from 'react';
import type { Experience } from '../data/experiences';
import { Icon } from './Icon';

export function ShareExperience({ experience }: { experience: Experience }) {
  const [notice, setNotice] = useState('');
  const [manual, setManual] = useState(false);
  const url = `${window.location.origin}/experiences/${experience.id}`;
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: experience.title,
          text: 'An idea for your next Sikkim visit.',
          url,
        });
        setNotice('Experience shared.');
      } else {
        await navigator.clipboard.writeText(url);
        setNotice('Link copied. Paste it into a message.');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setManual(true);
      setNotice('Select and copy this link to share.');
    }
  };
  return (
    <div className="reel-share">
      <button type="button" onClick={share} aria-label="Share experience">
        <Icon name="share" />
        <span>Share</span>
      </button>
      {notice && <p role="status">{notice}</p>}
      {manual && (
        <label>
          Experience link
          <input
            value={url}
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
    </div>
  );
}
