import { reducedMotion } from './env';

// The hero opening sequence plays once per page load: returning to the homepage within the same
// visit shows the finished composition straight away. Kept tiny and separate so the main bundle can
// ask "will it play?" without loading the sequence code (that lives in the lazy 3D chunk).
let playedThisLoad = false;
export const introWillPlay = () => !playedThisLoad && !reducedMotion();
export function claimIntro(): boolean {
  if (playedThisLoad) return false;
  playedThisLoad = true;
  return true;
}
