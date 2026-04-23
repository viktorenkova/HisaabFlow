import React from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import headerLogo from '../../assets/header-logo.png';
import { Sun, Moon } from '../ui/Icons';

const AppHeader = () => {
  const theme = useTheme();

  const headerStyles = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    backgroundColor: theme.colors.background.paper,
    borderBottom: `1px solid ${theme.colors.border}`,
    boxShadow: theme.shadows.sm,
    position: 'sticky',
    top: 0,
    zIndex: 100,
    minHeight: '64px',
  };

  const brandingStyles = {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.md,
  };

  const logoStyles = {
    display: 'flex',
    alignItems: 'center',
    textDecoration: 'none',
  };

  const taglineStyles = {
    color: theme.colors.text.secondary,
    fontSize: '14px',
    fontStyle: 'italic',
    marginLeft: theme.spacing.md,
  };

  const actionsStyles = {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.md,
  };

  const themeToggleStyles = {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    backgroundColor: 'transparent',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.text.primary,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontSize: '14px',
  };

  return (
    <header style={headerStyles}>
      {/* Branding Section */}
      <div style={brandingStyles}>
        <div style={logoStyles}>
          <img
            src={headerLogo}
            alt="Program logo"
            style={{
              display: 'block',
              height: '40px',
              width: 'auto',
              objectFit: 'contain',
            }}
          />
        </div>
        <span style={taglineStyles}>
          Local Refund Statement Analyzer
        </span>
      </div>

      {/* Actions Section */}
      <div style={actionsStyles}>
        {/* Theme Toggle */}
        <button
          onClick={theme.toggleDarkMode}
          style={themeToggleStyles}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = theme.colors.action.hover;
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = 'transparent';
          }}
          title={`Switch to ${theme.darkMode ? 'light' : 'dark'} mode`}
        >
          {theme.darkMode ? (
            <>
              <Sun size={16} />
              <span>Light</span>
            </>
          ) : (
            <>
              <Moon size={16} />
              <span>Dark</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
};

export default AppHeader;
