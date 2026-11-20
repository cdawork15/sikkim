import { experiences, type Experience } from './experiences';

const clips: Record<string, { file: string; place: string; title: string }> = {
  'first-light': {
    file: 'nathu',
    place: 'Nathu La, Sikkim',
    title: 'Mountain_Landscape_near_Nathu_La_Pass,_Sikkim.webm',
  },
  'monastery-mornings': {
    file: 'enchey',
    place: 'Enchey Monastery, Gangtok',
    title: 'Prayer_flags_at_Enchey_Monastery,_Gangtok.webm',
  },
  'mountain-pause': {
    file: 'tsongmo',
    place: 'Tsongmo Lake, Sikkim',
    title: 'Tsongmo_Lake,_Sikkim,_2026.webm',
  },
};
export const reelExperiences = experiences.filter(
  (experience) => clips[experience.id],
);
export function reelMedia(experience: Experience) {
  const clip = clips[experience.id]!;
  return {
    video: `/videos/${clip.file}.mp4`,
    captions: `/videos/${clip.file}.vtt`,
    poster: `/videos/${clip.file}.webp`,
    place: clip.place,
    author: 'Rajani Gairshail',
    source: `https://commons.wikimedia.org/wiki/File:${clip.title}`,
    license: 'https://creativecommons.org/licenses/by-sa/4.0/',
  };
}
