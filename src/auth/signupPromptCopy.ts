/**
 * T5: draft copy for the four signup-prompt trigger moments — reviewed and
 * approved against the mockup (2026-09-10). Each names the concrete thing
 * that just happened rather than a generic "sign up now," tone deliberately
 * flat/matter-of-fact rather than hypey.
 */
import type { SignupPromptCopy } from './SignupPromptSheet'
import type { SignupPromptTrigger } from './signupPrompts'

export const SIGNUP_PROMPT_COPY: Record<SignupPromptTrigger, SignupPromptCopy> = {
  'boss-clear': {
    icon: '★',
    title: 'Boss cleared. Keep the run.',
    body: 'Create an account and this clear — and your next one — syncs across every device you play on.',
  },
  'streak-7-day': {
    icon: '🔥',
    title: '7 days in a row.',
    body: 'A streak this good is worth protecting — an account keeps it safe if you switch phones or clear your browser.',
  },
  'leaderboard-view': {
    icon: '▤',
    title: "You're playing — the board doesn't know it yet.",
    body: 'Create an account to put a name on this board instead of showing up as “anon.”',
  },
  'stats-second-visit': {
    icon: '◷',
    title: 'This is all on one device, for now.',
    body: 'An account backs up this rating and history so a lost phone doesn’t mean starting over.',
  },
}
