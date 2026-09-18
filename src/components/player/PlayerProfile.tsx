import { useState, type ComponentType } from 'react';
import type { PlayerSummary, RatingCard } from '@/types/player';
import { useElementSize } from '@/hooks/useElementSize';
import { useLargeTitle } from '@/hooks/useShell';
import { Skeleton } from '@/components/ui/Feedback';
import {
  CalendarIcon,
  ChartIcon,
  ClockIcon,
  CrownIcon,
  ExternalIcon,
  GlobeIcon,
  MapPinIcon,
  UsersIcon,
} from '@/components/ui/Icons';
import { formatDate, formatNumber, formatRelative } from '@/utils/format';
import { totalRecord } from '@/services/playerService';
import { cn } from '@/utils/cn';

/** Narrowest a fact's box may get before the boxes take another row. */
const MIN_FACT_WIDTH = 130;
/** The gap between boxes, in pixels — `gap-3`. */
const FACT_GAP = 12;

interface Fact {
  label: string;
  value: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** A `tone-*` class from index.css: each kind of fact keeps its own colour. */
  tone: string;
}

/**
 * Profile header: identity, ratings and account facts, all from the public API.
 *
 * The card is in two parts: on the left, the player as a contact card shows them
 * — the picture, the name and the link to Chess.com, centred — and on the right
 * the facts, each in a box tinted with a system colour of its own. Where the card
 * is too narrow for both, the player sits above the facts.
 */
export function PlayerProfile({ player }: { player: PlayerSummary }) {
  const record = totalRecord(player);
  // The name is this page's large title; the bar takes it once it scrolls away.
  const titleRef = useLargeTitle<HTMLHeadingElement>();
  const [factsRef, factsBox] = useElementSize<HTMLDListElement>();

  const facts: Fact[] = [];
  if (player.countryName) facts.push({ label: 'Country', value: player.countryName, icon: GlobeIcon, tone: 'tone-blue' });
  if (player.location) facts.push({ label: 'Location', value: player.location, icon: MapPinIcon, tone: 'tone-orange' });
  if (player.fide !== null) {
    facts.push({ label: 'FIDE', value: formatNumber(player.fide), icon: CrownIcon, tone: 'tone-yellow' });
  }
  facts.push({ label: 'Joined', value: formatDate(player.joined), icon: CalendarIcon, tone: 'tone-indigo' });
  facts.push({ label: 'Last online', value: formatRelative(player.lastOnline), icon: ClockIcon, tone: 'tone-green' });
  if (player.followers !== null) {
    facts.push({ label: 'Followers', value: formatNumber(player.followers), icon: UsersIcon, tone: 'tone-pink' });
  }
  if (record.total > 0) {
    facts.push({
      label: 'Record',
      value: `${formatNumber(record.win)}W · ${formatNumber(record.loss)}L · ${formatNumber(record.draw)}D`,
      icon: ChartIcon,
      tone: 'tone-teal',
    });
  }

  // Two even rows beside the picture — three and three rather than five and one —
  // or more rows where the boxes would otherwise get too narrow. The last box
  // stretches over whatever the last row leaves empty, so the grid always closes.
  const fitColumns =
    factsBox.width > 0 ? Math.max(1, Math.floor((factsBox.width + FACT_GAP) / (MIN_FACT_WIDTH + FACT_GAP))) : facts.length;
  const preferredColumns = facts.length <= 3 ? facts.length : Math.ceil(facts.length / 2);
  const rows = Math.ceil(facts.length / Math.max(1, Math.min(fitColumns, preferredColumns)));
  const columns = Math.max(1, Math.ceil(facts.length / rows));
  const remainder = facts.length % columns;
  const lastSpan = remainder === 0 ? 1 : columns - remainder + 1;

  return (
    <>
      <section className="panel flex flex-col @2xl:flex-row">
        <div className="flex min-w-0 shrink-0 flex-col items-center px-6 pt-6 pb-5 text-center @2xl:w-64 @2xl:justify-center @2xl:py-6">
          <Avatar player={player} />

          <div className="mt-3 flex max-w-full min-w-0 flex-wrap items-center justify-center gap-2">
            {player.title && <span className="chip chip-warning">{player.title}</span>}
            <h1 ref={titleRef} className="truncate text-[28px] leading-tight font-bold tracking-[-0.02em]">
              {player.username}
            </h1>
            {player.isStreamer && <span className="chip chip-purple">Streamer</span>}
          </div>

          {player.displayName !== player.username && (
            <p className="text-muted mt-0.5 max-w-full truncate text-[15px]">{player.displayName}</p>
          )}

          {player.profileUrl && (
            <a
              href={player.profileUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-subtle mt-3 h-8 px-3.5 text-[13px]"
            >
              <ExternalIcon size={13} />
              Chess.com profile
            </a>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-center px-4 pb-4 @2xl:py-5 @2xl:pr-5 @2xl:pl-0">
          <dl
            ref={factsRef}
            className="grid w-full gap-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {facts.map(({ label, value, icon: Icon, tone }, index) => (
              <div
                key={label}
                className={cn('tone-box min-w-0 rounded-2xl px-4 py-3', tone)}
                style={lastSpan > 1 && index === facts.length - 1 ? { gridColumn: `span ${lastSpan}` } : undefined}
              >
                <dt className="tone-ink flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.04em] uppercase">
                  <Icon size={14} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </dt>
                <dd className="mt-1 text-[17px] leading-snug font-semibold text-balance tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* The ratings as a row of widgets, one system colour each — as many to a row as fit. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-3">
        {player.ratings.map((card, index) => (
          <RatingTile key={card.key} card={card} tone={STAT_TONES[index % STAT_TONES.length]} />
        ))}
      </div>
    </>
  );
}

/** The widget colours, cycled in order. */
const STAT_TONES = ['stat-primary', 'stat-warning', 'stat-info', 'stat-success', 'stat-teal', 'stat-muted'];

function Avatar({ player }: { player: PlayerSummary }) {
  const [failed, setFailed] = useState(false);
  const initials = player.username.slice(0, 2).toUpperCase();

  if (!player.avatar || failed) {
    return (
      <span className="monogram mx-auto h-24 w-24 text-[34px]" aria-hidden="true">
        {initials}
      </span>
    );
  }

  return (
    <img
      src={player.avatar}
      alt=""
      width={96}
      height={96}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="surface-raised mx-auto h-24 w-24 rounded-full object-cover"
    />
  );
}

function RatingTile({ card, tone }: { card: RatingCard; tone: string }) {
  const games = card.record ? card.record.win + card.record.loss + card.record.draw : null;

  return (
    <div className={cn('stat-card', tone)}>
      <div className="stat-card-top">
        <p className="stat-card-label">{card.label}</p>
        <CrownIcon className="stat-card-glyph" />
      </div>
      <p className="stat-card-value">{card.rating !== null ? formatNumber(card.rating) : '—'}</p>
      <p className="stat-card-sub">
        {card.best !== null && card.key !== 'puzzles' && (
          <>
            <CrownIcon size={11} className="mr-1 inline align-[-1px]" />
            {formatNumber(card.best)}{' '}
          </>
        )}
        {games !== null && games > 0 && <>· {formatNumber(games)} games</>}
      </p>
    </div>
  );
}

export function PlayerProfileSkeleton() {
  return (
    <>
      {/* The same two parts as the card it stands in for, so nothing jumps when it lands. */}
      <section className="panel flex flex-col @2xl:flex-row">
        <div className="flex shrink-0 flex-col items-center px-6 pt-6 pb-5 @2xl:w-64 @2xl:justify-center @2xl:py-6">
          <Skeleton className="h-24 w-24 rounded-full" />
          <Skeleton className="mt-4 h-7 w-40" />
          <Skeleton className="mt-2 h-4 w-28" />
          <Skeleton className="mt-3 h-8 w-36 rounded-full" />
        </div>
        <div className="grid flex-1 grid-cols-2 content-center gap-3 px-4 pb-4 @xl:grid-cols-3 @2xl:py-5 @2xl:pr-5 @2xl:pl-0">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[4.25rem] rounded-2xl" />
          ))}
        </div>
      </section>

      {/* Matches the widget row it stands in for, so the page does not jump. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-[8.5rem] rounded-[var(--radius-widget)]" />
        ))}
      </div>
    </>
  );
}
