import { NavLink, Outlet } from 'react-router-dom';
import { PageHead } from '../../components/ui';

export default function AdminLayout() {
  const links = [['users', 'Users & access'], ['roles', 'Roles & permissions'], ['workflow', 'Workflow'], ['pricing', 'Price data'], ['audit', 'Audit log'], ['errors', 'Error log']];
  return (
    <>
      <PageHead crumb="Admin" title="Administration" sub="Manage the back end from here. Every change is written to the audit log." />
      <div className="subtabs">
        {links.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => `subtab ${isActive ? 'active' : ''}`}>{label}</NavLink>)}
      </div>
      <Outlet />
    </>
  );
}
