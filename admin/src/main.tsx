import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ApiError } from './api';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { AuditPage } from './pages/Audit';
import { DashboardPage } from './pages/Dashboard';
import { ExamVersionPage } from './pages/ExamVersion';
import { ExamsPage } from './pages/Exams';
import { IssuesPage } from './pages/Issues';
import { LearnerDetailPage } from './pages/LearnerDetail';
import { LearnersPage } from './pages/Learners';
import { LoginPage } from './pages/Login';
import { OutcomesPage } from './pages/Outcomes';
import { QuestionDetailPage } from './pages/QuestionDetail';
import { NewQuestionPage } from './pages/QuestionNew';
import { QuestionsPage } from './pages/Questions';
import { StaffPage } from './pages/Staff';
import { VersionProvider } from './version';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

function RequireStaff() {
  const { user, isStaff, signOut } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!isStaff) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-xl border border-border bg-surface p-6 text-center">
          <h1 className="text-lg font-semibold">Staff only</h1>
          <p className="mt-2 text-sm text-muted">This backoffice is for content reviewers and admins. Learner accounts use the CertPath app.</p>
          <button type="button" className="mt-4 text-sm font-medium text-primary hover:underline" onClick={signOut}>
            Sign in with a different account
          </button>
        </div>
      </div>
    );
  }
  return (
    <VersionProvider>
      <Layout />
    </VersionProvider>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <RequireStaff />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'exams', element: <ExamsPage /> },
      { path: 'exam-versions/:id', element: <ExamVersionPage /> },
      { path: 'questions', element: <QuestionsPage /> },
      { path: 'questions/new', element: <NewQuestionPage /> },
      { path: 'questions/:id', element: <QuestionDetailPage /> },
      { path: 'issues', element: <IssuesPage /> },
      { path: 'learners', element: <LearnersPage /> },
      { path: 'learners/:id', element: <LearnerDetailPage /> },
      { path: 'outcomes', element: <OutcomesPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'staff', element: <StaffPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
