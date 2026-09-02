import { useState, useEffect } from 'react';
import { FeedbackPanel } from '../Global/FeedbackPanel';
import { UserFeedbackPanel } from '../Global/UserFeedbackPanel';
import { PermissionsPanel } from './PermissionsPanel';
import { ProfilePanel } from './ProfilePanel';
import { SubscriptionPanel } from './SubscriptionPanel';
import {
  UI_FONT_OPTIONS,
  EDITOR_FONT_OPTIONS,
  THEME_STORAGE_KEY,
  themeStorageKeyForUser,
  DEFAULT_THEME,
  type WorkspaceTheme
} from '../../theme';
import { useAuth } from '../../hooks/useAuth';
import { safeStorage } from '../../safeStorage';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'general' | 'profile' | 'subscription' | 'permissions' | 'feedback' | 'my-feedback'>('general');
  const [theme, setTheme] = useState<WorkspaceTheme>(DEFAULT_THEME);
  const scopedThemeStorageKey = themeStorageKeyForUser(user?.id);

  useEffect(() => {
    const raw = safeStorage.getItem(scopedThemeStorageKey) ?? safeStorage.getItem(THEME_STORAGE_KEY);
    if (raw) {
      try {
        setTheme({ ...DEFAULT_THEME, ...JSON.parse(raw) });
      } catch (e) {
        console.error('Failed to parse theme', e);
      }
    }
  }, [scopedThemeStorageKey]);

  const updateTheme = (patch: Partial<WorkspaceTheme>) => {
    const next = { ...theme, ...patch };
    setTheme(next);
    safeStorage.setItem(scopedThemeStorageKey, JSON.stringify(next));
    safeStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));
    if ((window as any).applyTypstrTheme) {
      (window as any).applyTypstrTheme();
    }
  };

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'profile', label: 'Profile' },
    { id: 'subscription', label: 'Subscription' },
    { id: 'permissions', label: 'Permissions' },
    { id: 'feedback', label: 'Send Feedback' },
    { id: 'my-feedback', label: 'My Feedback' },
  ] as const;


  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      background: 'var(--overlay-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
    }}>
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--panel-border)', padding: '24px', borderRadius: '12px', width: '600px', maxHeight: '85vh', color: 'var(--text-bright)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--surface-shadow-strong)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Settings</h2>
          <button onClick={onClose} style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'var(--muted-text)', fontSize: '24px', padding: '4px' }}>✕</button>
        </div>
        
        <div style={{ display: 'flex', borderBottom: '1px solid var(--panel-border)', marginBottom: '24px', gap: '8px' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '12px 16px', cursor: 'pointer', background: 'none', border: 'none',
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--muted-text)',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                fontWeight: activeTab === tab.id ? 'bold' : 'normal',
                fontSize: '14px'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
          {activeTab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
              <section>
                <h4 style={{ marginBottom: '14px', color: 'var(--text-strong)', fontSize: '15px' }}>Interface Typography</h4>
                <select 
                  value={theme.uiFontFamily} 
                  onChange={(e) => updateTheme({ uiFontFamily: e.target.value })}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'var(--editor-bg)', color: 'var(--text-bright)', border: '1px solid var(--panel-border)', cursor: 'pointer' }}
                >
                  {UI_FONT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                <div style={{ display: 'flex', justifyContent: 'space-between', margin: '12px 0 8px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--muted-text)' }}>UI Font Size</span>
                  <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{theme.uiFontSize}pt</span>
                </div>
                <input
                  type="range" min="9" max="24" step="1"
                  value={theme.uiFontSize}
                  onChange={(e) => updateTheme({ uiFontSize: Number(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </section>

              <section>
                <h4 style={{ marginBottom: '14px', color: 'var(--text-strong)', fontSize: '15px' }}>Editor Typography</h4>
                <select 
                  value={theme.editorFontFamily} 
                  onChange={(e) => updateTheme({ editorFontFamily: e.target.value })}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'var(--editor-bg)', color: 'var(--text-bright)', border: '1px solid var(--panel-border)', marginBottom: '16px', cursor: 'pointer' }}
                >
                  {EDITOR_FONT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', color: 'var(--muted-text)' }}>Editor Font Size</span>
                    <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{theme.editorFontSize}pt</span>
                  </div>
                  <input 
                    type="range" min="9" max="24" step="1"
                    value={theme.editorFontSize} 
                    onChange={(e) => updateTheme({ editorFontSize: Number(e.target.value) })}
                    style={{ width: '100%', cursor: 'pointer' }}
                  />
                </div>
              </section>
            </div>
          )}

          {activeTab === 'profile' && (
            <div style={{ height: '100%' }}>
              <ProfilePanel />
            </div>
          )}

          {activeTab === 'permissions' && (
            <div style={{ height: '100%' }}>
              <PermissionsPanel />
            </div>
          )}

          {activeTab === 'subscription' && (
            <div style={{ height: '100%' }}>
              <SubscriptionPanel />
            </div>
          )}

          {activeTab === 'feedback' && (
            <div style={{ height: '100%' }}>
              <FeedbackPanel onClose={onClose} embedded />
            </div>
          )}

          {activeTab === 'my-feedback' && (
            <div style={{ height: '100%' }}>
              <UserFeedbackPanel onClose={onClose} embedded />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
