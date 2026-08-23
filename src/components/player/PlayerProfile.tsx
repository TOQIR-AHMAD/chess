import { useState } from 'react';
import type { PlayerSummary, RatingCard } from '@/types/player';
import { Skeleton } from '@/components/ui/Feedback';
import { CrownIcon, ExternalIcon } from '@/components/ui/Icons';
import { formatDate, formatNumber, formatRelative } from '@/utils/format';
import { totalRecord } from '@/services/playerService';
import { cn } from '@/utils/cn';

/** Profile header: identity, ratings and account facts, all from the public API. */
export function PlayerProfile({ player }: { player: PlayerSummary }) {
  const record = totalRecord(player);

  return (
    <>
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:p-5">
        <Avatar player={player} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {player.title && (
              <span className="chip chip-warning font-bold">
                {player.title}
              </span>
            )}
            <h1 className="truncate text-xl font-bold sm:text-2xl">{player.username}</h1>
            {player.isStreamer && (
              <span className="chip bg-purple-500/15 text-purple-300 ring-1 ring-purple-500/30">Streamer</span>
            )}
          </div>

          {player.displayName !== player.username && (
            <p className="text-secondary mt-0.5 truncate text-sm">{player.displayName}</p>
          )}

          <dl className="text-secondary mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3 lg:grid-cols-4">
            {player.countryName && <Fact label="Country" value={player.countryName} />}
            {player.location && <Fact label="Location" value={player.location} />}
            {player.fide !== null && <Fact label="FIDE" value={formatNumber(player.fide)} />}
            <Fact label="Joined" value={formatDate(player.joined)} />
            <Fact label="Last online" value={formatRelative(player.lastOnline)} />
            {player.followers !== null && <Fact label="Followers" value={formatNumber(player.followers)} />}
            {record.total > 0 && (
              <Fact
                label="Record"
                value={`${formatNumber(record.win)}W · ${formatNumber(record.loss)}L · ${formatNumber(record.draw)}D`}
              />
            )}
          </dl>

          {player.profileUrl && (
            <a
              href={player.profileUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted hover-accent mt-3 inline-flex items-center gap-1.5 text-xs transition-colors"
            >
              <ExternalIcon size={13} />
              Chess.com profile
            </a>
          )}
        </div>
      </div>

    </section>

    {/*
      * The dashboard's counter row: one solid block of colour per rating, the
      * number carried at full contrast and everything else sitting back into it.
      */}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {player.ratings.map((card, index) => (
        <RatingTile key={card.key} card={card} tone={STAT_TONES[index % STAT_TONES.length]} />
      ))}
    </div>
    </>
  );
}

/** The console's dashboard colours, cycled in its order. */
const STAT_TONES = ['stat-primary', 'stat-warning', 'stat-info', 'stat-success', 'stat-muted'];

function Avatar({ player }: { player: PlayerSummary }) {
  const [failed, setFailed] = useState(false);
  const initials = player.username.slice(0, 2).toUpperCase();

  if (!player.avatar || failed) {
    return (
      <div className="from-brand-500 to-brand-700 flex h-16 w-16 shrink-0 items-center justify-center bg-gradient-to-br text-xl font-bold text-white sm:h-20 sm:w-20">
        {initials}
      </div>
    );
  }

  return (
    <img
      src={player.avatar}
      alt=""
      width={80}
      height={80}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="surface-raised h-16 w-16 shrink-0 rounded-xl object-cover sm:h-20 sm:w-20"
    />
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted text-[10px] font-semibold tracking-wide uppercase">{label}</dt>
      <dd className="truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}

function RatingTile({ card, tone }: { card: RatingCard; tone: string }) {
  const games = card.record ? card.record.win + card.record.loss + card.record.draw : null;

  return (
    <div className={cn('stat-card', tone)}>
      <CrownIcon size={44} className="stat-card-glyph" />
      <p className="stat-card-value">
        {card.rating !== null ? formatNumber(card.rating) : '—'}
      </p>
      <p className="stat-card-label">{card.label}</p>
      <p className="stat-card-sub flex items-center gap-1">
        {card.best !== null && card.key !== 'puzzles' && (
          <>
            <CrownIcon size={11} />
            {formatNumber(card.best)}
          </>
        )}
        {games !== null && games > 0 && <span>· {formatNumber(games)} games</span>}
      </p>
    </div>
  );
}

export function PlayerProfileSkeleton() {
  return (
    <>
    <section className="panel overflow-hidden">
      <div className="flex gap-4 p-5">
        <Skeleton className="h-20 w-20 rounded-xl" />
        <div className="flex-1 space-y-2.5">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-3.5 w-32" />
          <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-8" />
            ))}
          </div>
        </div>
      </div>
    </section>

    {/* Matches the counter row it stands in for, so the page does not jump. */}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className="h-[104px] rounded-[var(--radius-panel)]" />
      ))}
    </div>
    </>
  );
}
