import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  colorName,
  formatSanLine,
  isInCheck,
  kingSquare,
  legalTargets,
  materialBalance,
  materialForSide,
  materialSnapshot,
  sacrificedMaterial,
  sideToMove,
  staticExchangeEval,
  terminalState,
  uciLineToSan,
  uciToSan,
} from './chess';

describe('fen helpers', () => {
  it('reads the side to move', () => {
    expect(sideToMove(START_FEN)).toBe('w');
    expect(sideToMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1')).toBe('b');
    expect(colorName('w')).toBe('white');
    expect(colorName('b')).toBe('black');
  });

  it('counts material', () => {
    expect(materialForSide(START_FEN, 'w')).toBe(39);
    expect(materialForSide(START_FEN, 'b')).toBe(39);
    expect(materialBalance(START_FEN)).toBe(0);
    // White a queen up.
    expect(materialBalance('4k3/8/8/8/8/8/8/3QK3 w - - 0 1')).toBe(9);
  });

  it('snapshots captured pieces', () => {
    const snapshot = materialSnapshot('4k3/8/8/8/8/8/8/3QK3 w - - 0 1');
    expect(snapshot.diff).toBe(9);
    expect(snapshot.capturedByWhite).toContain('q');
    expect(snapshot.capturedByWhite.filter((piece) => piece === 'p')).toHaveLength(8);
  });

  it('detects check and finds the king', () => {
    const check = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    expect(isInCheck(check)).toBe(true);
    expect(kingSquare(check, 'w')).toBe('e1');
    expect(isInCheck(START_FEN)).toBe(false);
  });

  it('reports terminal states', () => {
    expect(terminalState(START_FEN)).toBeNull();
    expect(terminalState('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toBe('checkmate');
    expect(terminalState('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBe('stalemate');
    expect(terminalState('4k3/8/8/8/8/8/8/4K3 w - - 0 1')).toBe('draw');
  });

  it('lists legal destinations for a square', () => {
    expect(legalTargets(START_FEN, 'e2').sort()).toEqual(['e3', 'e4']);
    expect(legalTargets(START_FEN, 'e4')).toEqual([]);
  });
});

describe('uci ⇄ san', () => {
  it('converts a single move', () => {
    expect(uciToSan(START_FEN, 'e2e4')).toBe('e4');
    expect(uciToSan(START_FEN, 'g1f3')).toBe('Nf3');
    expect(uciToSan(START_FEN, 'e2e5')).toBeNull();
  });

  it('converts a whole line and stops at the first illegal move', () => {
    expect(uciLineToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Nf3']);
    expect(uciLineToSan(START_FEN, ['e2e4', 'a1a8'])).toEqual(['e4']);
    expect(uciLineToSan('not a fen', ['e2e4'])).toEqual([]);
  });

  it('numbers a SAN line from the position it starts in', () => {
    expect(formatSanLine(START_FEN, ['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
    const blackToMove = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(formatSanLine(blackToMove, ['e5', 'Nf3'])).toBe('1... e5 2. Nf3');
  });
});

describe('staticExchangeEval', () => {
  it('wins a free pawn', () => {
    // White pawn e4 can take an undefended pawn on d5.
    expect(staticExchangeEval('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'd5')).toBe(1);
  });

  it('is level when the pawn is defended by another pawn', () => {
    expect(staticExchangeEval('4k3/8/2p5/3p4/4P3/8/8/4K3 w - - 0 1', 'd5')).toBe(0);
  });

  it('returns zero when nothing attacks the square', () => {
    expect(staticExchangeEval('4k3/8/8/3p4/8/8/8/4K3 w - - 0 1', 'd5')).toBe(0);
    expect(staticExchangeEval(START_FEN, 'e4')).toBe(0);
  });

  it('refuses a losing capture', () => {
    // A rook on f1 can take a pawn on f7 but the king recaptures: not worth it.
    expect(staticExchangeEval('4k3/5p2/8/8/8/8/8/4KR2 w - - 0 1', 'f7')).toBe(0);
  });
});

describe('sacrificedMaterial', () => {
  it('reports the material offered by a rook-for-pawn sacrifice', () => {
    // Rxf7 gives up a rook (5) and wins a pawn (1) → 4 offered.
    expect(sacrificedMaterial('4k3/5p2/8/8/8/8/8/4KR2 w - - 0 1', ['f1f7'])).toBe(4);
  });

  it('does not count an even trade as a sacrifice', () => {
    // exd5 cxd5 is a straight pawn trade.
    expect(sacrificedMaterial('4k3/8/2p5/3p4/4P3/8/8/4K3 w - - 0 1', ['e4d5'])).toBe(0);
  });

  it('does not count winning free material as a sacrifice', () => {
    expect(sacrificedMaterial('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', ['e4d5'])).toBe(0);
  });

  it('counts a piece left hanging even when the engine line declines it', () => {
    // The knight steps to d5 where the c6 pawn can take it for free.
    const fen = '4k3/8/2p5/8/8/2N5/8/4K3 w - - 0 1';
    expect(sacrificedMaterial(fen, ['c3d5', 'e8e7'])).toBe(3);
  });

  it('returns zero for an empty or illegal move list', () => {
    expect(sacrificedMaterial(START_FEN, [])).toBe(0);
    expect(sacrificedMaterial(START_FEN, ['a1a8'])).toBe(0);
  });

  it('counts material that is still missing when the line runs out', () => {
    // Rf1xf7 and the king takes: White is a rook down for a pawn four plies later.
    const fen = '4k3/5p2/8/8/8/8/6R1/5R1K w - - 0 1';
    expect(sacrificedMaterial(fen, ['f1f7', 'e8f7', 'g2g7', 'f7g7'], 6)).toBe(4);
  });

  /*
   * The two cases below come from a real game (chess.com 173508802494) where an
   * ordinary developing move and an ordinary recapture were both reported as
   * sacrifices, and therefore as brilliancies. Both failed the same way: the
   * material balance was read mid-exchange, before the answer to a capture.
   */
  it('does not call a developing move a sacrifice when the line trades later', () => {
    // 3. Bc4 in the King's Pawn. The engine line reaches ...Nxc4 at the edge of
    // the window, but dxc4 wins the piece straight back on the very next ply.
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5Q2/PPPP1PPP/RNB1KBNR w KQkq - 2 3';
    const pv = ['f1c4', 'g8f6', 'g1e2', 'c6a5', 'd2d3', 'a5c4', 'd3c4'];
    expect(sacrificedMaterial(fen, pv, 6)).toBe(0);
  });

  it('does not call a recapture a sacrifice', () => {
    // 6...Rxf7 takes the knight back; Bxf7+ Kxf7 leaves Black a point ahead.
    const fen = 'r1bq1rk1/pppp1Npp/2n2n2/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K2R b KQ - 0 6';
    const pv = ['f8f7', 'c4f7', 'g8f7', 'd2d3', 'd7d5', 'b1c3'];
    expect(sacrificedMaterial(fen, pv, 6)).toBe(0);
  });
});
