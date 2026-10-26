import React from 'react';
import { useApp } from '../context/AppContext';

/**
 * Simple navigation link component used in the Navbar.
 * It determines the active state based on the currentPath from AppContext
 * and triggers navigation when clicked.
 */
export default function NavLink({ to, exact = false, children }) {
  const { currentPath, navigate } = useApp();
  const isActive = exact ? currentPath === to : currentPath.startsWith(to);

  const handleClick = () => {
    navigate(to);
  };

  return (
    <button className={`nav-item ${isActive ? 'active' : ''}`} onClick={handleClick}>
      {children}
    </button>
  );
}
