import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui/Feedback';
import { usePageTitle } from '@/hooks/useShell';

export function NotFoundPage() {
  usePageTitle('Not Found');

  return (
    <div className="mx-auto max-w-md py-16">
      <EmptyState
        title="That page does not exist"
        description="The link may be out of date. Start from a player search."
        action={
          <Link to="/" className="btn btn-primary">
            Search a player
          </Link>
        }
      />
    </div>
  );
}
