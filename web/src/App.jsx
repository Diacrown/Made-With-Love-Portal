import { Navigate, Route, Routes } from 'react-router-dom';
import { configError } from './lib/supabase';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth, RequirePerm } from './components/Layout';
import { ErrorBoundary, ErrorScreen, ToastProvider } from './components/ui';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Jobs from './pages/Jobs';
import JobDetail from './pages/JobDetail';
import NewJob from './pages/NewJob';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Workflow from './pages/Workflow';
import Account from './pages/Account';
import Backend from './pages/Backend';
import Quotes from './pages/Quotes';
import QuotePage from './pages/QuotePage';
import AdminPricing from './pages/admin/Pricing';
import AdminLayout from './pages/admin/AdminLayout';
import AdminUsers from './pages/admin/Users';
import AdminRoles from './pages/admin/Roles';
import AdminWorkflow from './pages/admin/WorkflowAdmin';
import AdminAudit from './pages/admin/Audit';
import AdminErrors from './pages/admin/Errors';

export default function App() {
  if (configError) {
    return (
      <div className="center">
        <div className="error-screen">
          <div className="error-code">⚙ SETUP</div>
          <h1>The portal is not configured</h1>
          <p>{configError}</p>
          <p className="muted">Set them in web/.env for local use, or in Netlify → Site configuration → Environment variables.</p>
        </div>
      </div>
    );
  }
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth />}>
              <Route index element={<Overview />} />
              <Route path="jobs" element={<RequirePerm perm="job.read"><Jobs /></RequirePerm>} />
              <Route path="jobs/new" element={<RequirePerm perm="job.create"><NewJob /></RequirePerm>} />
              <Route path="jobs/:id" element={<RequirePerm perm="job.read"><JobDetail /></RequirePerm>} />
              <Route path="customers" element={<RequirePerm perm="customer.read"><Customers /></RequirePerm>} />
              <Route path="customers/:id" element={<RequirePerm perm="customer.read"><CustomerDetail /></RequirePerm>} />
              <Route path="quotes" element={<RequirePerm perm="quote.read"><Quotes /></RequirePerm>} />
              <Route path="quotes/new" element={<RequirePerm perm="quote.write"><QuotePage /></RequirePerm>} />
              <Route path="quotes/:id" element={<RequirePerm perm="quote.read"><QuotePage /></RequirePerm>} />
              <Route path="workflow" element={<Workflow />} />
              <Route path="account" element={<Account />} />
              <Route path="backend" element={<Backend />} />
              <Route path="admin" element={<RequirePerm admin><AdminLayout /></RequirePerm>}>
                <Route index element={<Navigate to="users" replace />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="roles" element={<AdminRoles />} />
                <Route path="workflow" element={<AdminWorkflow />} />
                <Route path="pricing" element={<AdminPricing />} />
                <Route path="audit" element={<AdminAudit />} />
                <Route path="errors" element={<AdminErrors />} />
              </Route>
              <Route path="*" element={<ErrorScreen kind="notfound" title="Page not found" message="This address does not match any screen in the portal." />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
