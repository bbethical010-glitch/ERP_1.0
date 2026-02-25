import { useEffect } from 'react';

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function useGlobalShortcuts(handlers) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.defaultPrevented) return;
      const typing = isTypingTarget(event.target);

      if (!typing && event.altKey && event.key.toLowerCase() === 'c' && handlers.onCreate) {
        event.preventDefault();
        handlers.onCreate();
      }

      if (!typing && event.key === 'Escape' && handlers.onBack) {
        event.preventDefault();
        handlers.onBack();
      }

      if (!typing && event.key === 'Enter' && handlers.onSave) {
        event.preventDefault();
        handlers.onSave();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
