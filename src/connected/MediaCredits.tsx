import { useSearchParams } from 'react-router-dom';
import { useResource } from '../api/react';
import type { Experience, HomeData, MediaItem } from '../api/types';
import { MediaCredits } from '../pages/MediaCredits';
import { ErrorNotice, Loading } from './shared';

type Sources = HomeData | Experience | { frames: { media: MediaItem }[] };
export function ConnectedMediaCredits() {
  const [params] = useSearchParams();
  const experience = params.get('experience');
  const story = params.get('story');
  const path = experience
    ? '/experiences/' + encodeURIComponent(experience)
    : story
      ? '/stories/' + encodeURIComponent(story)
      : '/home';
  const result = useResource<Sources>(path);
  const data = result.data;
  const media = !data
    ? []
    : 'rows' in data
      ? data.rows.flatMap((row) =>
          row.experiences.flatMap((item) => item.media),
        )
      : 'frames' in data
        ? data.frames.map((frame) => frame.media)
        : data.media;
  return (
    <MediaCredits
      entries={media.map((item) => ({
        title: item.place,
        author: item.credit.author,
        source: item.credit.sourceUrl,
        licence: item.credit.licenceUrl,
      }))}
    >
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
    </MediaCredits>
  );
}
