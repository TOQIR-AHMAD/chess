/**
 * Figurine algebraic notation.
 *
 * `Bd2` becomes `♝d2` — the piece letter is replaced by its chess symbol. This is the
 * standard international form (it is language-independent, which is why FIDE
 * publications use it), and it makes a move list far quicker to scan than a wall of
 * letters.
 *
 * Uses the Unicode chess block, so no image assets are involved.
 *
 * The solid glyphs are used for both colours: the hollow "white" ones (♔♕♖♗♘) render
 * as thin outlines that all but disappear at move-list size, and the notation only
 * needs to say *which piece* — the column already says whose move it is.
 */
const FIGURINE: Record<string, string> = {
  K: '♚',
  Q: '♛',
  R: '♜',
  B: '♝',
  N: '♞',
};

/**
 * Split SAN into its leading piece symbol and the rest.
 * Pawn moves and castling have no piece letter, so `figurine` comes back empty.
 */
export function splitSan(san: string): { figurine: string; rest: string } {
  const first = san[0];
  if (!first || !/[KQRBN]/.test(first)) return { figurine: '', rest: san };
  // A promotion suffix (`=Q`) keeps its letter; only the moving piece is replaced.
  return { figurine: FIGURINE[first] ?? '', rest: san.slice(1) };
}

/** Whole-string conversion, used where a line is rendered as one run of text. */
export function toFigurine(san: string): string {
  const { figurine, rest } = splitSan(san);
  return figurine ? `${figurine}${rest}` : san;
}

/** `2.2s`, `14s`, `1:05` — compact think time for the move list. */
export function formatThinkTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
