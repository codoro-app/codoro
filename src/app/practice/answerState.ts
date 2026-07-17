/**
 * Shared per-choice visual state used by all three interaction bodies
 * (Mcq's choice buttons, TapLine's snippet lines, SwipeBinary's two
 * buttons) once the shell has committed an answer. Kept in one place so
 * the "chosen but wrong turns red, the actual right answer turns green"
 * rule reads the same way in each body.
 */
export type AnswerState = 'default' | 'correct' | 'wrong' | 'reveal-correct'
