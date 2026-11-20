export function isReelsLocation(pathname: string, search: string) {
  return (
    pathname === '/explore/reels' ||
    (pathname === '/explore' &&
      [...new URLSearchParams(search).keys()].every((key) => key === 'reel'))
  );
}
