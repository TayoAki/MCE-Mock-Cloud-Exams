import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { useCurrentEnrollment } from '@/lib/queries';
import { Button, ErrorState, LoadingState, Screen } from '@/components/ui';

/** Startup gate: onboarding for new learners, the daily path for everyone else. */
export default function Index() {
  const { status, signOut } = useAuth();
  const { enrollment, isLoading, error, refetch } = useCurrentEnrollment();

  if (status === 'loading') return <Screen><LoadingState /></Screen>;
  if (status === 'signedOut') return <Redirect href="/onboarding/exam" />;
  if (isLoading) return <Screen><LoadingState /></Screen>;
  if (error) {
    return (
      <Screen>
        <ErrorState error={error} onRetry={() => refetch()} />
        <Button label="Sign out" variant="ghost" onPress={signOut} />
      </Screen>
    );
  }
  if (!enrollment) return <Redirect href="/onboarding/exam" />;
  return <Redirect href="/learn" />;
}
